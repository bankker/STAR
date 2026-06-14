import { execute, resolveRoute, executeStream } from '../gateway/gateway.js';
import { GatewayError, gatewayError } from '../gateway/errors.js';
import { refreshHealth, getHealthSnapshot } from '../gateway/health.js';
import { listJobs, getJob, retryJob, sanitize, submitJob } from '../gateway/jobs.js';
import { estimateRequest } from '../gateway/costs.js';
import { summarize } from '../gateway/ledger.js';
import { loadConfig, updateConfig, listProviders } from '../gateway/registry.js';
import { setEnvKey } from '../lib/env.js';
import { generatedUrlToDataUrl } from '../lib/files.js';
import { ENV_FILE, GENERATED_DIR } from '../lib/paths.js';
import { buildPlanMessages, buildScriptMessages, extractDialogue } from '../studio/interview.js';
import { ffmpegAvailable, runFfmpeg, probeDurationSec, buildSrt } from '../lib/ffmpeg.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  createArtist, listArtists, getArtist, updateArtist, deleteArtist, addPortrait,
} from '../studio/artists.js';
import { getConversation, appendTurn, setMemory, trimToRecent, resetConversation } from '../studio/conversations.js';
import { buildChatMessages, shouldSummarize, buildSummarizeMessages, updateEmotion, RECENT_KEEP } from '../studio/companion.js';
import {
  buildInterviewMessages, buildFinalizeMessages, extractProfileJson, buildPortraitPrompt, buildPhotoPrompt,
} from '../studio/artist-create.js';
import { getGallery, addAssets, toggleFavorite, removeAsset } from '../studio/assets.js';
import { buildBlueprintMessages, extractBlueprint, blueprintToRenderReq } from '../studio/music.js';
import { buildScriptMessages as buildDramaScriptMessages, extractScript, assignVoices, buildCastPortraitPrompt, buildScenePrompt } from '../studio/drama.js';
import { createDrama, getDrama, listDramas, updateDrama, addPortraitVersion, addFrameVersion, setFrameCurrent } from '../studio/drama-store.js';
import os from 'node:os';

const MAX_BODY = 1 * 1024 * 1024;
const MAX_MEDIA_BODY = 32 * 1024 * 1024;

function stripFence(t) { return String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''); }
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

async function maybeSummarize(artistId, artist) {
  const conv = getConversation(artistId);
  if (!shouldSummarize(conv)) return;
  const old = conv.messages.slice(0, -RECENT_KEEP);
  if (!old.length) return;
  try {
    const { system, messages } = buildSummarizeMessages(old, conv.memory);
    const r = await execute('content', { system, messages, maxTokens: 300 });
    setMemory(artistId, r.text.trim());
    trimToRecent(artistId, RECENT_KEEP);
  } catch (e) { console.error('[chat] 记忆摘要失败（忽略）', e.message); }
}

// 取场景出镜角色的定妆照（主演优先）转 base64 dataUrl，供万相图像参考锁脸；description 模式返回空数组。
function sceneRefImages(drama, scene) {
  if (drama.consistencyMode !== 'image_ref') return [];
  const names = scene.characters || [];
  // 主演优先：按 isLead 标志排序（不依赖 cast 数组下标，cast 顺序变化也稳）。
  const isLeadName = (n) => (drama.cast.find((x) => x.name === n)?.isLead ? 1 : 0);
  const ordered = [...names].sort((a, b) => isLeadName(b) - isLeadName(a));
  const urls = [];
  for (const n of ordered) {
    const c = drama.cast.find((x) => x.name === n);
    const v = c?.portrait?.versions?.[c.portrait.current];
    if (v?.url) {
      const dataUrl = generatedUrlToDataUrl(GENERATED_DIR, v.url);
      if (dataUrl) urls.push(dataUrl);
    }
  }
  return urls;
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

  route('GET /api/config', async (req, res) => json(res, loadConfig()));

  route('PUT /api/config', async (req, res, { readJsonBody }) => {
    const next = await readJsonBody();
    try { updateConfig(next); json(res, { ok: true }); }
    catch (e) { jsonError(res, 'bad_request', `配置校验失败: ${e.message}`); }
  });

  route('GET /api/config/keys', async (req, res) => {
    const keys = [];
    for (const p of listProviders()) {
      for (const k of p.envKeys) {
        const v = process.env[k] || '';
        keys.push({ provider: p.label, key: k, configured: Boolean(v), tail: v ? v.slice(-4) : '' });
      }
    }
    json(res, { keys });
  });

  route('POST /api/config/keys', async (req, res, { readJsonBody }) => {
    const { key, value } = await readJsonBody();
    const known = new Set(listProviders().flatMap((p) => p.envKeys));
    if (!known.has(key)) return jsonError(res, 'bad_request', `未知的 key 名: ${key}`);
    if (typeof value !== 'string' || !value.trim()) return jsonError(res, 'bad_request', 'value 必填');
    try {
      setEnvKey(ENV_FILE, key, value.trim());
      await refreshHealth();
      json(res, { ok: true, tail: value.trim().slice(-4) });
    } catch (e) { jsonError(res, 'bad_request', e.message); }
  });

  // —— 艺人创设 ——
  route('POST /api/artist/interview', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    if (!Array.isArray(body.messages)) return jsonError(res, 'bad_request', 'messages 必填且为数组');
    try {
      const { system, messages } = buildInterviewMessages(body.messages);
      const r = await execute('content', { system, messages, maxTokens: 400 });
      json(res, { reply: r.text, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/finalize', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    if (!body.transcript || (Array.isArray(body.transcript) && body.transcript.length === 0)) {
      return jsonError(res, 'bad_request', 'transcript 必填且不能为空');
    }
    try {
      const { system, messages } = buildFinalizeMessages(body.transcript);
      const r = await execute('content', { system, messages, maxTokens: 1200 });
      let draft;
      try { draft = extractProfileJson(r.text); }
      catch (e) { return jsonError(res, 'provider_error', `档案解析失败：${e.message}`); }
      json(res, { draft, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('GET /api/artists', async (req, res) => json(res, { artists: listArtists() }));

  route('POST /api/artist', async (req, res, { readJsonBody }) => {
    const body = await readJsonBody();
    try {
      const artist = createArtist(body.profile || body);
      json(res, { id: artist.id, artist });
    } catch (e) { jsonError(res, 'bad_request', e.message); }
  });

  route('GET /api/artist/:id', async (req, res, { params }) => {
    const a = getArtist(params.id);
    a ? json(res, { artist: a }) : jsonError(res, 'not_found', `无此艺人 ${params.id}`);
  });

  route('PUT /api/artist/:id', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    try {
      const a = updateArtist(params.id, body.profile || body);
      a ? json(res, { artist: a }) : jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    } catch (e) { jsonError(res, 'bad_request', e.message); }
  });

  route('DELETE /api/artist/:id', async (req, res, { params }) => {
    const ok = deleteArtist(params.id);
    if (ok) resetConversation(params.id);
    json(res, { ok });
  });

  route('POST /api/artist/:id/portrait', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const prompt = buildPortraitPrompt(artist, body.stylePrompt);
      const r = await execute('image', { prompt, refImages: [], aspect: '3:4' });
      const url = r.files?.[0]?.url;
      if (!url) return jsonError(res, 'provider_error', '图像生成未返回文件');
      const updated = addPortrait(params.id, { url, prompt });
      json(res, { portrait: updated.portraits[updated.portraits.length - 1], artist: updated });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('GET /api/artist/:id/chat', async (req, res, { params }) => {
    if (!getArtist(params.id)) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    const c = getConversation(params.id);
    json(res, { messages: c.messages, state: c.state });
  });

  route('POST /api/artist/:id/chat', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    if (!body.message) return jsonError(res, 'bad_request', 'message 必填');
    try {
      const conv = getConversation(params.id);
      const { system, messages } = buildChatMessages(artist, conv, body.message);
      const r = await execute('chat', { system, messages, maxTokens: 600 });
      const state = updateEmotion(conv.state, body.message);
      appendTurn(params.id, body.message, r.text, state);
      await maybeSummarize(params.id, artist);
      json(res, { reply: r.text, state, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/:id/chat/stream', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    if (!body.message) return jsonError(res, 'bad_request', 'message 必填');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const conv = getConversation(params.id);
      const { system, messages } = buildChatMessages(artist, conv, body.message);
      const r = await executeStream('chat', { system, messages, maxTokens: 600 }, { onToken: (t) => send('token', { t }) });
      const state = updateEmotion(conv.state, body.message);
      appendTurn(params.id, body.message, r.text, state);
      await maybeSummarize(params.id, artist);
      send('done', { reply: r.text, state, provider: r.provider, model: r.model });
    } catch (e) {
      send('error', e instanceof GatewayError ? e.toJSON() : { code: 'internal', message: e.message });
    }
    res.end();
  });

  route('GET /api/artist/:id/gallery', async (req, res, { params }) => {
    if (!getArtist(params.id)) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    json(res, { assets: getGallery(params.id).assets });
  });

  route('POST /api/artist/:id/photo', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const prompt = buildPhotoPrompt(artist, { shot: body.shot, stylePrompt: body.stylePrompt });
      const r = await execute('image', { prompt, aspect: body.aspect || '3:4', count: Number(body.count) || 1 });
      const items = (r.files || []).map((f) => ({ type: 'photo', url: f.url, prompt, shot: body.shot || '', aspect: body.aspect || '3:4' }));
      const g = addAssets(params.id, items);
      json(res, { assets: g.assets.slice(0, items.length), provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/:id/video', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    await handleMediaSubmit('video', res, body, (b) => {
      const photos = getGallery(params.id).assets.filter((a) => a.type === 'photo');
      const frameUrl = b.frameUrl || photos[0]?.url || artist.portraits?.[0]?.url;
      if (!frameUrl) throw new Error('请先为该艺人生成一张写真作为视频首帧');
      const imageRef = generatedUrlToDataUrl(GENERATED_DIR, frameUrl);
      if (!imageRef) throw new Error('首帧图读取失败');
      return { artistId: params.id, imageRef, prompt: b.prompt || '', durationSec: Number(b.durationSec) || 5, aspect: '9:16' };
    });
  });

  route('POST /api/artist/:id/song/blueprint', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const { system, messages } = buildBlueprintMessages(artist, body.brief);
      const r = await execute('content', { system, messages, maxTokens: 1200 });
      let blueprint;
      try { blueprint = extractBlueprint(r.text); }
      catch (e) { return jsonError(res, 'provider_error', `蓝图解析失败：${e.message}`); }
      json(res, { blueprint, provider: r.provider, model: r.model });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/:id/song', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    await handleMediaSubmit('music', res, body, (b) => {
      if (!b.blueprint && !b.lyrics && !b.style) throw new Error('需先生成或填写作曲蓝图');
      const rr = b.blueprint ? blueprintToRenderReq(b.blueprint, artist)
                             : { title: b.title || '', lyrics: b.lyrics || '', style: b.style || '', gender: blueprintToRenderReq({}, artist).gender };
      return { artistId: params.id, lyrics: rr.lyrics, prompt: rr.style, style: rr.style, gender: rr.gender, title: rr.title };
    });
  });

  route('POST /api/artist/:id/interview/plan', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const { system, messages } = buildPlanMessages(artist, body.topic);
      const r = await execute('content', { system, messages, maxTokens: 1000 });
      let plan; try { plan = JSON.parse(stripFence(r.text)); } catch { return jsonError(res, 'provider_error', '企划解析失败'); }
      json(res, { plan });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/:id/interview/script', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const { system, messages } = buildScriptMessages(artist, body.plan || {});
      const r = await execute('content', { system, messages, maxTokens: 2000 });
      let dialogue; try { dialogue = extractDialogue(r.text); } catch (e) { return jsonError(res, 'provider_error', `脚本解析失败：${e.message}`); }
      json(res, { dialogue });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/:id/interview/compose', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    const dialogue = Array.isArray(body.dialogue) ? body.dialogue : null;
    if (!dialogue || !dialogue.length) return jsonError(res, 'bad_request', 'dialogue 必填');
    if (dialogue.length > 30) return jsonError(res, 'bad_request', '每次合成最多 30 行对话');
    if (dialogue.some((l) => String(l?.text || '').length > 300)) return jsonError(res, 'bad_request', '单行台词不超过 300 字');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg，请安装后重启服务');
    const frame = getGallery(params.id).assets.find((a) => a.type === 'photo')?.url || artist.portraits?.[0]?.url;
    if (!frame) return jsonError(res, 'bad_request', '请先为该艺人生成一张写真作为画面');

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv_'));
    try {
      send('stage', { stage: 'audio', progress: 5, msg: '配音中' });
      const artistVoice = (artist.gender || '').match(/男|male/i) ? 'Ethan' : 'Cherry';
      const segs = [];
      for (let i = 0; i < dialogue.length; i++) {
        const line = dialogue[i];
        const voice = line.speaker === '记者' ? 'Chelsie' : artistVoice;
        const r = await execute('tts', { text: line.text, voice });
        const url = r.files?.[0]?.url;
        if (!url) throw new Error('TTS 未返回音频');
        const abs = path.join(GENERATED_DIR, url.replace('/generated/', ''));
        segs.push({ text: line.text, file: abs, durationSec: probeDurationSec(abs) });
        send('stage', { stage: 'audio', progress: 5 + Math.round((i + 1) / dialogue.length * 60), msg: `配音 ${i + 1}/${dialogue.length}` });
      }
      send('stage', { stage: 'subtitle', progress: 68, msg: '生成字幕与音轨' });
      const listFile = path.join(tmp, 'list.txt');
      fs.writeFileSync(listFile, segs.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'));
      const audioOut = path.join(tmp, 'audio.mp3');
      // TTS 产物为 PCM/wav，concat 后重编码为 mp3（-c copy 无法把 PCM 塞进 mp3 容器）
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-ar', '44100', audioOut]);
      const srtFile = path.join(tmp, 'sub.srt');
      fs.writeFileSync(srtFile, buildSrt(segs));
      send('stage', { stage: 'final', progress: 80, msg: '合成成片' });
      const frameAbs = path.join(GENERATED_DIR, frame.replace('/generated/', ''));
      const name = `iv_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      const srtEsc = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
      runFfmpeg(['-y', '-loop', '1', '-i', frameAbs, '-i', audioOut,
        '-vf', `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,subtitles='${srtEsc}'`,
        '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', outAbs], 300000);
      const totalSec = segs.reduce((a, s) => a + s.durationSec, 0);
      addAssets(params.id, [{ type: 'interview', url: `/generated/${name}`, prompt: '访谈成片', durationSec: Math.round(totalSec), title: '访谈节目' }]);
      send('done', { url: `/generated/${name}`, durationSec: Math.round(totalSec) });
    } catch (e) {
      if (e instanceof GatewayError) { send('error', e.toJSON()); }
      else { console.error('[interview] 合成失败', e.message); send('error', { code: 'internal', message: '成片合成失败，请重试' }); }
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      res.end();
    }
  });

  route('POST /api/artist/:id/drama/script', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const { system, messages } = buildDramaScriptMessages(artist, body.brief || {});
      const r = await execute('content', { system, messages, maxTokens: 3000 });
      let parsed; try { parsed = extractScript(r.text, artist); }
      catch (e) { return jsonError(res, 'provider_error', `剧本解析失败：${e.message}`); }
      const tmpCast = [{ id: 'c_lead', isLead: true, gender: artist.gender },
        ...parsed.cast.map((c, i) => ({ id: `c_${i + 1}`, isLead: false, gender: c.gender }))];
      const voiceMap = assignVoices(tmpCast, artist);
      const drama = createDrama(params.id, artist, body.brief || {}, parsed, { voiceMap, consistencyMode: 'image_ref' });
      json(res, { drama });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('GET /api/artist/:id/dramas', async (req, res, { params }) => {
    if (!getArtist(params.id)) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    json(res, { dramas: listDramas(params.id) });
  });

  route('GET /api/artist/:id/drama/:did', async (req, res, { params }) => {
    const d = getDrama(params.did);
    if (!d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    json(res, { drama: d });
  });

  route('PUT /api/artist/:id/drama/:did', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const d = getDrama(params.did);
    if (!d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const patch = {};
    for (const k of ['title', 'theme', 'logline', 'cast', 'episodes']) if (k in body) patch[k] = body[k];
    json(res, { drama: updateDrama(params.did, patch) });
  });

  route('POST /api/artist/:id/drama/:did/cast', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const todo = d.cast.filter((c) => !c.isLead && c.portrait.current < 0);   // 主演与已出图者跳过
    // 无待出图配角（仅主演/已全部出图）→ 直接就绪，不必走 $0 成本闸门
    if (!todo.length) { updateDrama(params.did, { status: 'cast_ready' }); return json(res, { drama: getDrama(params.did) }); }
    let estimate;
    try { estimate = { capability: 'image', count: todo.length, estimatedUsd: estimateFor('image', { count: todo.length }).estimatedUsd }; }
    catch (e) { return sendGatewayError(res, e); }   // 图像无可用路由等 → 在开 SSE 前结构化报错
    if (body.confirm !== true) return json(res, { error: { code: 'confirm_required', message: '需确认选角出图成本', estimate } });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      for (let i = 0; i < todo.length; i++) {
        const c = todo[i];
        const prompt = buildCastPortraitPrompt(c);
        send('stage', { progress: Math.round(i / todo.length * 100), msg: `选角出图 ${i + 1}/${todo.length}：${c.name}` });
        const r = await execute('image', { prompt, aspect: '9:16' });
        const url = r.files?.[0]?.url;
        if (!url) throw new Error('未返回定妆照');
        addPortraitVersion(params.did, c.id, { url, prompt });
        addAssets(params.id, [{ type: 'photo', url, prompt: `选角：${c.name}`, title: c.name }]);
      }
      updateDrama(params.did, { status: 'cast_ready' });
      send('done', { drama: getDrama(params.did) });
    } catch (e) {
      if (e instanceof GatewayError) send('error', e.toJSON());
      else { console.error('[drama] 选角失败', e.message); send('error', { code: 'internal', message: '选角出图失败，请重试' }); }
    } finally { res.end(); }
  });

  route('POST /api/artist/:id/drama/:did/episode/:eid/storyboard', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const ep = d.episodes.find((e) => e.id === params.eid);
    if (!ep) return jsonError(res, 'not_found', '无此分集');
    const todo = ep.scenes.filter((s) => s.frame.current < 0);
    if (!todo.length) return json(res, { drama: d });
    let estimate;
    try { estimate = { capability: 'image', count: todo.length, estimatedUsd: estimateFor('image', { count: todo.length }).estimatedUsd }; }
    catch (e) { return sendGatewayError(res, e); }
    if (body.confirm !== true) return json(res, { error: { code: 'confirm_required', message: '需确认分镜出图成本', estimate } });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      for (let i = 0; i < todo.length; i++) {
        const sc = todo[i];
        send('stage', { progress: Math.round(i / todo.length * 100), msg: `分镜出图 ${i + 1}/${todo.length}` });
        const prompt = buildScenePrompt(artist, sc, d.cast, d.consistencyMode);
        const refImages = sceneRefImages(d, sc);
        const r = await execute('image', { prompt, aspect: '9:16', refImages });
        const url = r.files?.[0]?.url;
        if (!url) throw new Error('未返回分镜图');
        addFrameVersion(params.did, params.eid, sc.id, { url, prompt });
      }
      send('done', { drama: getDrama(params.did) });
    } catch (e) {
      if (e instanceof GatewayError) send('error', e.toJSON());
      else { console.error('[drama] 分镜失败', e.message); send('error', { code: 'internal', message: '分镜出图失败，请重试' }); }
    } finally { res.end(); }
  });

  route('POST /api/artist/:id/drama/:did/episode/:eid/scene/:sid/reframe', async (req, res, { params }) => {
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const ep = d.episodes.find((e) => e.id === params.eid);
    const sc = ep?.scenes.find((s) => s.id === params.sid);
    if (!sc) return jsonError(res, 'not_found', '无此场景');
    try {
      const prompt = buildScenePrompt(artist, sc, d.cast, d.consistencyMode);
      const r = await execute('image', { prompt, aspect: '9:16', refImages: sceneRefImages(d, sc) });
      const url = r.files?.[0]?.url;
      if (!url) return jsonError(res, 'provider_error', '未返回分镜图');
      json(res, { drama: addFrameVersion(params.did, params.eid, params.sid, { url, prompt }) });
    } catch (e) { sendGatewayError(res, e); }
  });

  route('POST /api/artist/:id/drama/:did/episode/:eid/scene/:sid/frame', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const d = getDrama(params.did);
    if (!getArtist(params.id) || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const drama = setFrameCurrent(params.did, params.eid, params.sid, Number(body.index));
    drama ? json(res, { drama }) : jsonError(res, 'not_found', '无此场景');
  });

  route('POST /api/artist/:id/gallery/:assetId/favorite', async (req, res, { params }) => {
    const g = toggleFavorite(params.id, params.assetId);
    g ? json(res, { ok: true }) : jsonError(res, 'not_found', '无此资产');
  });

  route('DELETE /api/artist/:id/gallery/:assetId', async (req, res, { params }) => {
    removeAsset(params.id, params.assetId);
    json(res, { ok: true });
  });
}
