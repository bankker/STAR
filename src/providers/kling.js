import crypto from 'node:crypto';
import { gatewayError } from '../gateway/errors.js';

const BASE = (env) => env.KLING_API_BASE || 'https://api-singapore.klingai.com';
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 15 * 60 * 1000;

function jwtToken(ak, sk) {
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const payload = b64u({ iss: ak, exp: now + 1800, nbf: now - 5 });
  const sig = crypto.createHmac('sha256', sk).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

const authHeaders = (env) => ({ authorization: `Bearer ${jwtToken(env.KLING_ACCESS_KEY, env.KLING_SECRET_KEY)}` });
const stripDataUrl = (s) => { const m = /^data:[^;,]+;base64,(.+)$/.exec(s || ''); return m ? m[1] : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adapter = {
  id: 'kling',
  label: 'Kling 官方',
  capabilities: ['video'],
  envKeys: ['KLING_ACCESS_KEY', 'KLING_SECRET_KEY'],
  isConfigured: (env) => Boolean(env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY),

  async probe(ctx) {
    const t = Date.now();
    // 轻量鉴权探测：列表查询；无效 key → 401 → 归一为 auth 错误
    await ctx.fetchJson(`${BASE(ctx.env)}/v1/videos/image2video?pageNum=1&pageSize=1`, {
      method: 'GET', headers: authHeaders(ctx.env), timeoutMs: 5000,
    });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (capability !== 'video') throw gatewayError('bad_request', `kling 不支持能力 ${capability}`, { providerId: 'kling' });
    return invokeVideo(request, ctx);
  },
};

async function invokeVideo(request, ctx) {
  const isI2V = Boolean(request.imageRef);
  const submitPath = isI2V ? '/v1/videos/image2video' : '/v1/videos/text2video';
  const body = {
    model_name: request.model,
    prompt: request.prompt || '',
    mode: 'std',
    duration: String(request.durationSec === 10 ? 10 : 5),
    ...(isI2V ? { image: stripDataUrl(request.imageRef) } : { aspect_ratio: request.aspect || '9:16' }),
  };
  ctx.onProgress('提交 Kling 任务', 5);
  const submit = await ctx.fetchJson(`${BASE(ctx.env)}${submitPath}`, { headers: authHeaders(ctx.env), body, timeoutMs: 60000 });
  const taskId = submit.data?.task_id;
  if (!taskId) throw gatewayError('provider_error', `Kling 未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'kling' });

  const deadline = Date.now() + MAX_POLL_MS;
  let lastPct = 5;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let st;
    try {
      st = await ctx.fetchJson(`${BASE(ctx.env)}${submitPath}/${taskId}`, { method: 'GET', headers: authHeaders(ctx.env), timeoutMs: 30000 });
      pollErrors = 0;
    } catch (err) {
      if (++pollErrors >= 3) throw err; // 连续 3 次轮询失败才放弃；瞬时网络抖动不应葬送长任务
      ctx.onProgress('Kling: 轮询重试中', lastPct);
      continue;
    }
    const status = st.data?.task_status;
    lastPct = Math.max(lastPct, status === 'processing' ? 50 : 20); // 进度只升不降
    ctx.onProgress(`Kling: ${status || '排队中'}`, lastPct);
    if (status === 'succeed') {
      const url = st.data?.task_result?.videos?.[0]?.url;
      if (!url) throw gatewayError('provider_error', 'Kling 成功但无视频 URL', { providerId: 'kling' });
      ctx.onProgress('下载视频', 90);
      const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 300000 });
      return {
        files: [ctx.saveFile(buf, 'mp4')],
        durationSec: request.durationSec || 5,
        usage: { seconds: request.durationSec || 5 },
      };
    }
    if (status === 'failed') {
      throw gatewayError('provider_error', `Kling 生成失败: ${st.data?.task_status_msg || '无详情'}`, { providerId: 'kling' });
    }
  }
  throw gatewayError('timeout', `Kling 轮询超时（${MAX_POLL_MS / 60000} 分钟）`, { providerId: 'kling' });
}

export default adapter;
