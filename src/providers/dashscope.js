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

export default adapter;
