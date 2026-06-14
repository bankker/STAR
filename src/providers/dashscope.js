import { gatewayError } from '../gateway/errors.js';

const BASE = 'https://dashscope.aliyuncs.com';
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan']);
const auth = (env) => ({ authorization: `Bearer ${env.DASHSCOPE_API_KEY}` });

// Doc calibration: GET /compatible-mode/v1/models is not documented by Aliyun.
// 探测用 qwen-turbo 发 max_tokens:1 的最小请求（compatible-mode 无 GET /models 端点），可校验 key 且成本可忽略

const adapter = {
  id: 'dashscope',
  label: '阿里云百炼',
  capabilities: ['chat', 'content', 'world', 'plan', 'tts', 'asr', 'image', 'video', 'music'],
  envKeys: ['DASHSCOPE_API_KEY'],
  isConfigured: (env) => Boolean(env.DASHSCOPE_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${BASE}/compatible-mode/v1/chat/completions`, {
      headers: auth(ctx.env),
      body: { model: 'qwen-turbo', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
      timeoutMs: 5000,
    });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (TEXT_CAPS.has(capability)) return invokeText(request, ctx);
    if (capability === 'tts') return invokeTts(request, ctx);
    if (capability === 'asr') return invokeAsr(request, ctx);
    if (capability === 'image') return invokeImage(request, ctx);
    if (capability === 'video') return invokeVideo(request, ctx);
    if (capability === 'music') return invokeMusic(request, ctx);
    throw gatewayError('bad_request', `dashscope 暂未实现能力 ${capability}`, { providerId: 'dashscope' });
  },
};

async function invokeText(request, ctx) {
  const messages = request.system ? [{ role: 'system', content: request.system }, ...request.messages] : request.messages;
  const data = await ctx.fetchJson(`${BASE}/compatible-mode/v1/chat/completions`, {
    headers: auth(ctx.env),
    body: { model: request.model, messages, max_tokens: request.maxTokens || 2048 },
  });
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw gatewayError('provider_error', 'DashScope 返回空内容', { providerId: 'dashscope' });
  return { text, usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 } };
}

const MULTIMODAL = `${BASE}/api/v1/services/aigc/multimodal-generation/generation`;

async function invokeTts(request, ctx) {
  const data = await ctx.fetchJson(MULTIMODAL, {
    headers: auth(ctx.env), timeoutMs: 60000,
    body: { model: request.model, input: { text: request.text, voice: request.voice || 'Cherry' } },
  });
  const audioUrl = data.output?.audio?.url;
  const audioB64 = data.output?.audio?.data;
  let buf;
  if (audioUrl) buf = await ctx.fetchBuffer(audioUrl, { method: 'GET', headers: {}, timeoutMs: 60000 });
  else if (audioB64) buf = Buffer.from(audioB64, 'base64');
  else throw gatewayError('provider_error', `DashScope TTS 无音频输出: ${JSON.stringify(data.output || {}).slice(0, 200)}`, { providerId: 'dashscope' });
  const ext = (audioUrl ? (audioUrl.split('?')[0].match(/\.(\w+)$/) || [])[1] : null)?.toLowerCase() || 'wav';
  return { files: [ctx.saveFile(buf, ext)], usage: { chars: String(request.text || '').length } };
}

async function invokeAsr(request, ctx) {
  // ASR 文档 UNVERIFIED（帮助页返回 404）。按 multimodal-generation 端点实现；若平台仅接受公网 URL 请在前端托管音频后再调用。
  const data = await ctx.fetchJson(MULTIMODAL, {
    headers: auth(ctx.env), timeoutMs: 120000,
    body: { model: request.model, input: { messages: [{ role: 'user', content: [{ audio: request.audio }] }] } },
  });
  const content = data.output?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text || '').join('') : (content || '');
  if (!text) throw gatewayError('provider_error', `DashScope ASR 返回空文本: ${JSON.stringify(data.output || {}).slice(0, 200)}`, { providerId: 'dashscope' });
  return { text, usage: { minutes: 1 } };
}

const T2I_SUBMIT = `${BASE}/api/v1/services/aigc/text2image/image-synthesis`;
// 探针结论(2026-06-14)：万相图像参考在该区可用 —— wanx2.1-imageedit / image2image/image-synthesis
// 的 function:description_edit 接受 base_image_url（base64 dataUrl）并保人物外观换景，轮询 SUCCEEDED 返图。
// 据此：invokeImage 带 refImages 时切到图像参考保人物（一致性锁脸 image_ref），无 refImages 维持纯 t2i（向后兼容 S3 写真）。
const IMGEDIT_SUBMIT = `${BASE}/api/v1/services/aigc/image2image/image-synthesis`;
const IMGEDIT_MODEL = 'wanx2.1-imageedit';
const TASKS = `${BASE}/api/v1/tasks`;
const IMG_POLL_MS = 4000;
const IMG_MAX_MS = 4 * 60 * 1000;
const imgSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZE_BY_ASPECT = { '1:1': '1024*1024', '3:4': '768*1024', '9:16': '720*1280', '16:9': '1280*720' };

// 轮询万相图像 TASKS/{id}，成功后下载所有结果图落盘。submit 已发起、taskId 必有。
async function pollImageTask(taskId, ctx, failLabel) {
  const deadline = Date.now() + IMG_MAX_MS;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await imgSleep(IMG_POLL_MS);
    let st;
    try { st = await ctx.fetchJson(`${TASKS}/${taskId}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 }); pollErrors = 0; }
    catch (err) { if (++pollErrors >= 3) throw err; continue; }
    const status = st.output?.task_status;
    if (status === 'SUCCEEDED') {
      const urls = (st.output?.results || []).map((r) => r.url).filter(Boolean);
      if (!urls.length) throw gatewayError('provider_error', `${failLabel}成功但无图像 URL`, { providerId: 'dashscope' });
      const files = [];
      for (const url of urls) {
        const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 120000 });
        files.push(ctx.saveFile(buf, /\.jpe?g(\?|$)/i.test(url) ? 'jpg' : 'png'));
      }
      return { files, usage: { images: files.length } };
    }
    if (status === 'FAILED') throw gatewayError('provider_error', `${failLabel}失败: ${st.output?.message || st.output?.code || '无详情'}`, { providerId: 'dashscope' });
  }
  throw gatewayError('timeout', `${failLabel}轮询超时（${IMG_MAX_MS / 60000} 分钟）`, { providerId: 'dashscope' });
}

async function invokeImage(request, ctx) {
  const refs = Array.isArray(request.refImages) ? request.refImages.filter(Boolean) : [];
  if (refs.length) return invokeImageRef(request, ctx, refs);
  const n = Math.min(4, Math.max(1, Number(request.count) || 1));
  const size = SIZE_BY_ASPECT[request.aspect] || '1024*1024';
  const submit = await ctx.fetchJson(T2I_SUBMIT, {
    headers: { ...auth(ctx.env), 'X-DashScope-Async': 'enable' }, timeoutMs: 30000,
    body: { model: request.model, input: { prompt: request.prompt }, parameters: { size, n } },
  });
  const taskId = submit.output?.task_id;
  if (!taskId) throw gatewayError('provider_error', `万相未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'dashscope' });
  return pollImageTask(taskId, ctx, '万相生成');
}

// 图像参考保人物（image_ref 锁脸）：refs[0] 作为基图，description_edit 保外观换景/重构图。单主体编辑。
// 契约：仅 refs[0] 生效（多 ref 忽略）；n 固定 1；尺寸由基图决定（不接受 aspect/size，最终 9:16 由 compose 裁剪保证）。
async function invokeImageRef(request, ctx, refs) {
  const submit = await ctx.fetchJson(IMGEDIT_SUBMIT, {
    headers: { ...auth(ctx.env), 'X-DashScope-Async': 'enable' }, timeoutMs: 30000,
    body: {
      model: IMGEDIT_MODEL,
      input: { function: 'description_edit', prompt: request.prompt || '同一个人物，保持长相不变', base_image_url: refs[0] },
      parameters: { n: 1 },
    },
  });
  const taskId = submit.output?.task_id;
  if (!taskId) throw gatewayError('provider_error', `万相图像参考未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'dashscope' });
  return pollImageTask(taskId, ctx, '万相图像参考');
}

const I2V_SUBMIT = `${BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const VID_POLL_MS = 10000;
const VID_MAX_MS = 8 * 60 * 1000;
const vidSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function invokeVideo(request, ctx) {
  const img = request.imageRef;
  if (!img) throw gatewayError('bad_request', '图生视频需要首帧图（artist 需先有写真/定妆照）', { providerId: 'dashscope' });
  const submit = await ctx.fetchJson(I2V_SUBMIT, {
    headers: { ...auth(ctx.env), 'X-DashScope-Async': 'enable' }, timeoutMs: 30000,
    body: { model: request.model, input: { prompt: request.prompt || '', img_url: img }, parameters: {} },
  });
  const taskId = submit.output?.task_id;
  if (!taskId) throw gatewayError('provider_error', `万相视频未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'dashscope' });
  const deadline = Date.now() + VID_MAX_MS;
  let lastPct = 5, pollErrors = 0;
  while (Date.now() < deadline) {
    await vidSleep(VID_POLL_MS);
    let st;
    try { st = await ctx.fetchJson(`${BASE}/api/v1/tasks/${taskId}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 }); pollErrors = 0; }
    catch (err) { if (++pollErrors >= 3) throw err; ctx.onProgress('万相视频: 轮询重试', lastPct); continue; }
    const status = st.output?.task_status;
    lastPct = Math.max(lastPct, status === 'RUNNING' ? 50 : 20);
    ctx.onProgress(`万相视频: ${status || '排队'}`, lastPct);
    if (status === 'SUCCEEDED') {
      const url = st.output?.video_url || st.output?.results?.[0]?.url;
      if (!url) throw gatewayError('provider_error', '万相视频成功但无 URL', { providerId: 'dashscope' });
      ctx.onProgress('下载视频', 90);
      const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 300000 });
      return { files: [ctx.saveFile(buf, 'mp4')], durationSec: request.durationSec || 5, usage: { seconds: request.durationSec || 5 } };
    }
    if (status === 'FAILED') throw gatewayError('provider_error', `万相视频失败: ${st.output?.message || st.output?.code || '无详情'}`, { providerId: 'dashscope' });
  }
  throw gatewayError('timeout', `万相视频轮询超时（${VID_MAX_MS / 60000} 分钟）`, { providerId: 'dashscope' });
}

const MUSIC_GEN = `${BASE}/api/v1/services/audio/music/generation`;

async function invokeMusic(request, ctx) {
  const input = {};
  if (request.lyrics) input.lyrics = request.lyrics;
  else input.prompt = request.prompt || request.style || '一首流行歌曲';
  if (request.gender === 'male' || request.gender === 'female') input.gender = request.gender;
  const data = await ctx.fetchJson(MUSIC_GEN, {
    headers: auth(ctx.env), timeoutMs: 180000,
    body: { model: request.model, input },
  });
  const url = data.output?.audio?.url;
  if (!url) throw gatewayError('provider_error', `fun-music 无音频 URL: ${JSON.stringify(data.output || {}).slice(0, 200)}`, { providerId: 'dashscope' });
  const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 180000 });
  return { files: [ctx.saveFile(buf, 'mp3')], usage: { songs: 1 } };
}

export default adapter;
