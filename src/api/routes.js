import { execute, resolveRoute } from '../gateway/gateway.js';
import { GatewayError, gatewayError } from '../gateway/errors.js';
import { refreshHealth, getHealthSnapshot } from '../gateway/health.js';
import { listJobs, getJob, retryJob, sanitize, submitJob } from '../gateway/jobs.js';
import { estimateRequest } from '../gateway/costs.js';
import { summarize } from '../gateway/ledger.js';

const MAX_BODY = 1 * 1024 * 1024;
const MAX_MEDIA_BODY = 32 * 1024 * 1024;
// NOTE: 精确匹配——若未来新增子路径端点（如 /api/ai/image/variations）需扩展此集合
const MEDIA_BODY_PATHS = new Set(['/api/ai/asr', '/api/ai/image', '/api/ai/video', '/api/ai/music']);

export function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function jsonError(res, code, message) { json(res, { error: { code, message } }); }

export function sendGatewayError(res, e) {
  if (e instanceof GatewayError) return json(res, { error: e.toJSON() });
  console.error('[api] 未预期错误', e);
  json(res, { error: { code: 'internal', message: e.message } }, 500);
}

export function readJsonBody(req, pathname) {
  const limit = MEDIA_BODY_PATHS.has(pathname) ? MAX_MEDIA_BODY : MAX_BODY;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

export function estimateFor(capability, request) {
  const { chain, configured } = resolveRoute(capability);
  const entry = configured[0] || chain[0];
  if (!entry) throw gatewayError('bad_request', `能力 ${capability} 无可用路由`);
  return {
    capability, provider: entry.provider.id, model: entry.model,
    estimatedUsd: estimateRequest(capability, entry.provider.id, entry.model, request),
  };
}

// 重媒体统一提交流程：估算 → confirm 闸门 → 入队（CL-6）。Task 13/14 的 video/music 端点调用。
export async function handleMediaSubmit(capability, res, body, buildRequest) {
  let request;
  try { request = buildRequest(body); }
  catch (e) { return jsonError(res, 'bad_request', e.message); }
  try {
    const estimate = estimateFor(capability, request);
    if (body.confirm !== true) {
      return json(res, { error: { code: 'confirm_required', message: '需先确认预估成本', estimate } });
    }
    const job = submitJob(capability, request, { estimate });
    json(res, { jobId: job.id, estimate });
  } catch (e) { sendGatewayError(res, e); }
}

export function registerRoutes(route) {
  route('GET /api/ping', async (req, res) => json(res, { ok: true, ts: Date.now() }));

  const TEXT_ENDPOINTS = { '/api/ai/chat': 'chat', '/api/ai/content': 'content', '/api/ai/world': 'world', '/api/ai/plan': 'plan' };
  for (const [p, capability] of Object.entries(TEXT_ENDPOINTS)) {
    route(`POST ${p}`, async (req, res, { readJsonBody }) => {
      const body = await readJsonBody();
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return jsonError(res, 'bad_request', 'messages 必填且为非空数组');
      }
      try {
        const r = await execute(capability, { messages: body.messages, system: body.system, maxTokens: body.maxTokens });
        json(res, { text: r.text, provider: r.provider, model: r.model, usage: r.usage });
      } catch (e) { sendGatewayError(res, e); }
    });
  }

  route('GET /api/health', async (req, res, { url }) => {
    if (url.searchParams.get('refresh') === '1') await refreshHealth();
    json(res, { providers: getHealthSnapshot() });
  });

  route('GET /api/jobs', async (req, res) => json(res, { jobs: listJobs() }));
  route('GET /api/jobs/:id', async (req, res, { params }) => {
    const job = getJob(params.id);
    job ? json(res, { job: sanitize(job) }) : jsonError(res, 'not_found', `无此任务 ${params.id}`);
  });
  route('POST /api/jobs/:id/retry', async (req, res, { params }) => json(res, retryJob(params.id)));

  route('POST /api/estimate', async (req, res, { readJsonBody }) => {
    const { capability, request = {} } = await readJsonBody();
    if (!capability) return jsonError(res, 'bad_request', 'capability 必填');
    try { json(res, estimateFor(capability, request)); } catch (e) { sendGatewayError(res, e); }
  });

  route('GET /api/usage', async (req, res) => {
    const s = summarize({ sinceMs: Date.now() - 7 * 86400e3 });
    json(res, { ...s, textBudgetUsd: 2, textWarn: s.textUsd >= 1.6 });
  });

  route('POST /api/ai/image', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    if (!body.prompt) return jsonError(res, 'bad_request', 'prompt 必填');
    try {
      const r = await execute('image', { prompt: body.prompt, refImages: body.refImages || [], aspect: body.aspect });
      json(res, { files: r.files, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/ai/video', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    await handleMediaSubmit('video', res, body, (b) => {
      if (!b.prompt && !b.imageRef) throw new Error('prompt 与参考图至少填一项');
      return { prompt: b.prompt || '', imageRef: b.imageRef || null, durationSec: Number(b.durationSec) || 5, aspect: '9:16' };
    });
  });

  route('POST /api/ai/music', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    await handleMediaSubmit('music', res, body, (b) => {
      if (!b.title && !b.style && !b.prompt && !b.lyrics) throw new Error('歌名/曲风/描述至少填一项');
      return { title: b.title, style: b.style, lyrics: b.lyrics, prompt: b.prompt, instrumental: Boolean(b.instrumental) };
    });
  });

  route('POST /api/ai/tts', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    if (!body.text) return jsonError(res, 'bad_request', 'text 必填');
    if (String(body.text).length > 1000) return jsonError(res, 'bad_request', 'M1 的 TTS 限 1000 字以内');
    try {
      const r = await execute('tts', { text: body.text, voice: body.voice });
      json(res, { files: r.files, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/ai/asr', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    if (!body.audio) return jsonError(res, 'bad_request', 'audio（dataUrl）必填');
    try {
      const r = await execute('asr', { audio: body.audio });
      json(res, { text: r.text, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });
}
