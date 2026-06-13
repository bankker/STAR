import { gatewayError } from '../gateway/errors.js';

const BASE = 'https://dashscope.aliyuncs.com';
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan']);
const auth = (env) => ({ authorization: `Bearer ${env.DASHSCOPE_API_KEY}` });

// Doc calibration: GET /compatible-mode/v1/models is not documented by Aliyun.
// 探测用 qwen-turbo 发 max_tokens:1 的最小请求（compatible-mode 无 GET /models 端点），可校验 key 且成本可忽略

const adapter = {
  id: 'dashscope',
  label: '阿里云百炼',
  capabilities: ['chat', 'content', 'world', 'plan', 'tts', 'asr'],
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
  return { files: [ctx.saveFile(buf, 'wav')], usage: { chars: String(request.text || '').length } };
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

export default adapter;
