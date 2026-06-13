import { gatewayError } from '../gateway/errors.js';

// 实现的是 sunoapi.org 网关形态（文档根：https://docs.sunoapi.org）。
// Suno 无稳定官方公开 REST API，本适配器面向 sunoapi.org 网关；换网关只需改 SUNO_API_BASE 与字段映射。
// ⚠️ 形态标注：sunoapi.org 文档根页可读取，但深层端点路径 404 未能验证——UNVERIFIED。
//    doc-calibration 来源：https://docs.sunoapi.org（根页）确认了 base URL、auth 格式、模型列表（V4/V4.5/V5/V5.5）；
//    具体端点形状（/api/v1/generate、/api/v1/generate/record-info）沿用任务规范中记录的社区文档形状。
//    接入真实 key 后需校验字段映射。
const BASE = (env) => env.SUNO_API_BASE || 'https://api.sunoapi.org';
const POLL_INTERVAL_MS = 8000;
const MAX_POLL_MS = 5 * 60 * 1000;
const auth = (env) => ({ authorization: `Bearer ${env.SUNO_API_KEY}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adapter = {
  id: 'suno',
  label: 'Suno（网关）',
  capabilities: ['music'],
  envKeys: ['SUNO_API_KEY'],
  isConfigured: (env) => Boolean(env.SUNO_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    // 余额/积分查询作为鉴权探测；无效 key → 401 → auth
    await ctx.fetchJson(`${BASE(ctx.env)}/api/v1/generate/credit`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (capability !== 'music') throw gatewayError('bad_request', `suno 不支持能力 ${capability}`, { providerId: 'suno' });
    return invokeMusic(request, ctx);
  },
};

async function invokeMusic(request, ctx) {
  const customMode = Boolean(request.lyrics || request.style || request.title);
  const body = {
    customMode,
    instrumental: Boolean(request.instrumental),
    model: request.model || 'V5',
    callBackUrl: 'https://example.com/none', // 占位：本适配器走轮询，不依赖回调
    ...(customMode
      ? { title: (request.title || '未命名').slice(0, 80), style: (request.style || 'pop').slice(0, 200), prompt: request.lyrics || '' }
      : { prompt: request.prompt || request.style || 'a cheerful pop song' }),
  };
  ctx.onProgress('提交 Suno 任务', 5);
  const submit = await ctx.fetchJson(`${BASE(ctx.env)}/api/v1/generate`, { headers: auth(ctx.env), body, timeoutMs: 60000 });
  const taskId = submit.data?.taskId || submit.data?.task_id;
  if (taskId == null) throw gatewayError('provider_error', `Suno 未返回 taskId: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'suno' });

  const deadline = Date.now() + MAX_POLL_MS;
  let lastPct = 5;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let info;
    try {
      info = await ctx.fetchJson(`${BASE(ctx.env)}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 });
      pollErrors = 0;
    } catch (err) {
      if (++pollErrors >= 3) throw err;
      ctx.onProgress('Suno: 轮询重试中', lastPct);
      continue;
    }
    const status = info.data?.status || '';
    lastPct = Math.max(lastPct, /SUCCESS|complete/i.test(status) ? 90 : 40);
    ctx.onProgress(`Suno: ${status || '生成中'}`, lastPct);
    if (/SUCCESS|complete/i.test(status)) {
      const track = info.data?.response?.sunoData?.[0] || info.data?.response?.data?.[0];
      const url = track?.audioUrl || track?.audio_url;
      if (!url) throw gatewayError('provider_error', 'Suno 成功但无音频 URL', { providerId: 'suno' });
      ctx.onProgress('下载音频', 95);
      const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 180000 });
      return { files: [ctx.saveFile(buf, 'mp3')], usage: { songs: 1 } };
    }
    if (/FAIL|ERROR/i.test(status)) {
      throw gatewayError('provider_error', `Suno 生成失败: ${info.data?.errorMessage || status}`, { providerId: 'suno' });
    }
  }
  throw gatewayError('timeout', `Suno 轮询超时（${MAX_POLL_MS / 60000} 分钟）`, { providerId: 'suno' });
}

export default adapter;
