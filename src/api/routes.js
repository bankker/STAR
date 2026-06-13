import { execute } from '../gateway/gateway.js';
import { GatewayError } from '../gateway/errors.js';
import { refreshHealth, getHealthSnapshot } from '../gateway/health.js';

const MAX_BODY = 1 * 1024 * 1024;
const MAX_MEDIA_BODY = 32 * 1024 * 1024;
// NOTE: 精确匹配——若未来新增子路径端点（如 /api/ai/image/variations）需扩展此集合
const MEDIA_BODY_PATHS = new Set(['/api/ai/asr', '/api/ai/image', '/api/ai/video']);

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
}
