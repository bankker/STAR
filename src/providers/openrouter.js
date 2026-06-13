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
  const content = [{ type: 'text', text: request.prompt }];
  for (const ref of request.refImages || []) {
    content.push({ type: 'image_url', image_url: { url: ref } });
  }
  const data = await ctx.fetchJson(`${API}/chat/completions`, {
    headers: auth(ctx.env), timeoutMs: 180000,
    body: { model: request.model, messages: [{ role: 'user', content }], modalities: ['image', 'text'] },
  });
  const msg = data.choices?.[0]?.message || {};
  // OpenRouter 扩展形态 message.images[]；兼容 OpenAI 内容分片形态
  const fromImages = msg.images?.[0]?.image_url?.url;
  const fromParts = Array.isArray(msg.content)
    ? msg.content.find((p) => p.type === 'image_url')?.image_url?.url
    : null;
  const imgUrl = fromImages || fromParts;
  if (!imgUrl) throw gatewayError('provider_error', `OpenRouter 未返回图像: ${JSON.stringify(msg).slice(0, 200)}`, { providerId: 'openrouter' });
  let buf; let mime = 'image/png';
  if (imgUrl.startsWith('data:')) {
    try { ({ mime, buf } = dataUrlToBuffer(imgUrl)); }
    catch (e) { throw gatewayError('provider_error', `OpenRouter 图像 dataUrl 解析失败: ${e.message}`, { providerId: 'openrouter', retriable: false }); }
  } else {
    buf = await ctx.fetchBuffer(imgUrl, { method: 'GET', headers: {}, timeoutMs: 120000 });
    if (/\.jpe?g(\?|$)/i.test(imgUrl)) mime = 'image/jpeg';
  }
  return { files: [ctx.saveFile(buf, mime === 'image/jpeg' ? 'jpg' : 'png')], usage: { images: 1 } };
}

export default adapter;
