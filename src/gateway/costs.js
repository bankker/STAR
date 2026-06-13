const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan', 'drama-script', 'storyboard']);

const BASE_PRICES = {
  'anthropic:claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'dashscope:qwen-flash': { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  'dashscope:qwen-tts': { perKChar: 0.03 },
  'dashscope:qwen3-asr-flash': { perMinute: 0.01 },
  'dashscope:wan2.2-t2i-flash': { perImage: 0.03 },
  'gemini:gemini-3-pro-image': { perImage: 0.12 },
  'kling:kling-v2-6': { perSecond: 0.07 },
  'suno:V5': { perSong: 0.4 },
  'openrouter:*': { inputPerMTok: 5, outputPerMTok: 15, perImage: 0.15, perSecond: 0.1 },
};

let overrides = {};
export function setPriceOverrides(map) { overrides = map || {}; }

function price(providerId, model) {
  const merged = { ...BASE_PRICES, ...overrides };
  return { ...(merged[`${providerId}:*`] || {}), ...(merged[`${providerId}:${model}`] || {}) };
}

const round = (n) => Math.round(n * 10000) / 10000;

export function estimateRequest(capability, providerId, model, request = {}) {
  const p = price(providerId, model);
  if (TEXT_CAPS.has(capability)) {
    // 注意：JSON.stringify 含结构字符，token 估算刻意偏保守（偏高 10–16%）
    const chars = JSON.stringify(request.messages || request.prompt || '').length;
    const inTok = Math.ceil(chars / 3);
    const outTok = request.maxTokens || 1024;
    return round(((p.inputPerMTok || 0) * inTok + (p.outputPerMTok || 0) * outTok) / 1e6);
  }
  if (capability === 'image') return round((p.perImage ?? 0.1) * (request.count || 1));
  if (capability === 'video') return round((p.perSecond ?? 0.1) * (request.durationSec || 5));
  if (capability === 'music') return round(p.perSong ?? 0.5);
  if (capability === 'tts') return round((p.perKChar ?? 0.05) * (String(request.text || '').length / 1000));
  if (capability === 'asr') return round((p.perMinute ?? 0.02) * ((request.durationSec || 60) / 60));
  return 0;
}

export function costOfUsage(providerId, model, usage = {}) {
  const p = price(providerId, model);
  let usd = 0;
  if (usage.inputTokens > 0) usd += (p.inputPerMTok || 0) * usage.inputTokens / 1e6;
  if (usage.outputTokens > 0) usd += (p.outputPerMTok || 0) * usage.outputTokens / 1e6;
  if (usage.images > 0) usd += (p.perImage || 0) * usage.images;
  if (usage.seconds > 0) usd += (p.perSecond || 0) * usage.seconds;
  if (usage.songs > 0) usd += (p.perSong || 0) * usage.songs;
  if (usage.chars > 0) usd += (p.perKChar || 0) * usage.chars / 1000;
  if (usage.minutes > 0) usd += (p.perMinute || 0) * usage.minutes;
  return round(usd);
}
