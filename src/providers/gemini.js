import { gatewayError } from '../gateway/errors.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const headers = (env) => ({ 'x-goog-api-key': env.GEMINI_API_KEY });

const adapter = {
  id: 'gemini',
  label: 'Google Gemini 直连',
  capabilities: ['chat', 'content', 'image'],
  envKeys: ['GEMINI_API_KEY'],
  isConfigured: (env) => Boolean(env.GEMINI_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${API}/models?pageSize=1`, { method: 'GET', headers: headers(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (capability === 'image') return invokeImage(request, ctx);
    if (capability === 'chat' || capability === 'content') return invokeText(request, ctx);
    throw gatewayError('bad_request', `gemini 暂未实现能力 ${capability}`, { providerId: 'gemini' });
  },
};

function checkSafety(data) {
  const block = data.promptFeedback?.blockReason || (data.candidates?.[0]?.finishReason === 'SAFETY' ? 'SAFETY' : null);
  if (block) throw gatewayError('safety', `Gemini 安全策略拦截: ${block}`, { providerId: 'gemini', hint: '调整提示词后重试' });
}

async function invokeText(request, ctx) {
  const contents = request.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const data = await ctx.fetchJson(`${API}/models/${request.model}:generateContent`, {
    headers: headers(ctx.env),
    body: {
      contents,
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      generationConfig: { maxOutputTokens: request.maxTokens || 2048 },
    },
  });
  checkSafety(data);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw gatewayError('provider_error', 'Gemini 返回空内容', { providerId: 'gemini' });
  return { text, usage: { inputTokens: data.usageMetadata?.promptTokenCount || 0, outputTokens: data.usageMetadata?.candidatesTokenCount || 0 } };
}

async function invokeImage(request, ctx) {
  const parts = [{ text: request.prompt }];
  for (const ref of request.refImages || []) {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(ref);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  const data = await ctx.fetchJson(`${API}/models/${request.model}:generateContent`, {
    headers: headers(ctx.env), timeoutMs: 120000,
    body: { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } },
  });
  checkSafety(data);
  const img = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!img) throw gatewayError('provider_error', 'Gemini 未返回图像', { providerId: 'gemini' });
  const ext = img.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const saved = ctx.saveFile(Buffer.from(img.inlineData.data, 'base64'), ext);
  return { files: [saved], usage: { images: 1 } };
}

export default adapter;
