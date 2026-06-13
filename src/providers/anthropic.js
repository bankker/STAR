import { gatewayError } from '../gateway/errors.js';

const API = 'https://api.anthropic.com/v1';
const headers = (env) => ({ 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' });

export default {
  id: 'anthropic',
  label: 'Anthropic 直连',
  capabilities: ['chat', 'content', 'drama-script'],
  envKeys: ['ANTHROPIC_API_KEY'],
  isConfigured: (env) => Boolean(env.ANTHROPIC_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${API}/models?limit=1`, { method: 'GET', headers: headers(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    const data = await ctx.fetchJson(`${API}/messages`, {
      headers: headers(ctx.env),
      body: {
        model: request.model,
        max_tokens: request.maxTokens || 2048,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages,
      },
    });
    const text = (data.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
    if (!text) throw gatewayError('provider_error', 'Anthropic 返回空内容', { providerId: 'anthropic' });
    return { text, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } };
  },
};
