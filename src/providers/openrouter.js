import { gatewayError } from '../gateway/errors.js';
import { dataUrlToBuffer } from '../lib/files.js';

const API = 'https://openrouter.ai/api/v1';
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan']);
const auth = (env) => ({ authorization: `Bearer ${env.OPENROUTER_API_KEY}` });

const adapter = {
  id: 'openrouter',
  label: 'OpenRouter 聚合兜底',
  capabilities: ['chat', 'content', 'world', 'plan', 'image'], // video 随 Task 13 实现加回
  envKeys: ['OPENROUTER_API_KEY'],
  isConfigured: (env) => Boolean(env.OPENROUTER_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    // GET /api/v1/key 校验当前 key（无效 key → 401 → auth 错误）；/models 是公开端点不能用于鉴权探测
    await ctx.fetchJson(`${API}/key`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (TEXT_CAPS.has(capability)) return invokeText(request, ctx);
    if (capability === 'image') return invokeImage(request, ctx);
    throw gatewayError('bad_request', `openrouter 暂未实现能力 ${capability}`, { providerId: 'openrouter' });
  },
};

async function invokeText(request, ctx) {
  const messages = request.system ? [{ role: 'system', content: request.system }, ...request.messages] : request.messages;
  const data = await ctx.fetchJson(`${API}/chat/completions`, {
    headers: auth(ctx.env),
    body: { model: request.model, messages, max_tokens: request.maxTokens || 2048 },
  });
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw gatewayError('provider_error', 'OpenRouter 返回空内容', { providerId: 'openrouter' });
  return { text, usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 } };
}

async function invokeImage(request, ctx) {
  const data = await ctx.fetchJson(`${API}/chat/completions`, {
    headers: auth(ctx.env), timeoutMs: 180000,
    body: { model: request.model, messages: [{ role: 'user', content: request.prompt }], modalities: ['image', 'text'] },
  });
  const img = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) throw gatewayError('provider_error', 'OpenRouter 未返回图像', { providerId: 'openrouter' });
  const { mime, buf } = dataUrlToBuffer(img);
  return { files: [ctx.saveFile(buf, mime === 'image/jpeg' ? 'jpg' : 'png')], usage: { images: 1 } };
}

export default adapter;
