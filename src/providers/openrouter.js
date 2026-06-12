import { gatewayError } from '../gateway/errors.js';

const API = 'https://openrouter.ai/api/v1';
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan']);
const auth = (env) => ({ authorization: `Bearer ${env.OPENROUTER_API_KEY}` });

// Doc calibration: GET /api/v1/key returns 404. Use GET /api/v1/models for probe instead.

const adapter = {
  id: 'openrouter',
  label: 'OpenRouter 聚合兜底',
  capabilities: ['chat', 'content', 'world', 'plan', 'image', 'video'],
  envKeys: ['OPENROUTER_API_KEY'],
  isConfigured: (env) => Boolean(env.OPENROUTER_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${API}/models`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (TEXT_CAPS.has(capability)) return invokeText(request, ctx);
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

export default adapter;
