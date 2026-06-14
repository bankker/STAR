# 深度访谈（S7）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让艺人对真人嘉宾做实时语音访谈（艺人 TTS 提问 → 浏览器麦克风录音 → ffmpeg 转码 → ASR 转写 → AI 追问），整理双方文字记录，再生成 AI 语音对谈记录与对口型（liveportrait）访谈影像。

**Architecture:** 新增 `lipsync` 能力（DashScope liveportrait，base64 image+audio，走 job 队列）。新增嘉宾实体与访谈会话两个 per-file store（mirror drama-store）。实时循环靠 ask（TTS 出题）/answer（录音→转码→ASR）两端点交替。Phase A 交付互动访谈+文字稿，Phase B 用 TTS 重配音 + 逐轮 liveportrait 拼接成片。

**Tech Stack:** Node ≥18 原生 http（ESM，零依赖）、DashScope（qwen-tts / qwen3-asr-flash / liveportrait）、ffmpeg（opus→wav 转码、拼接）、浏览器 MediaRecorder、node:test、SSE、M1 job 队列。

参照 spec：`docs/superpowers/specs/2026-06-14-deep-interview-design.md`。探针已验证：ASR 接受 base64；liveportrait（端点 `…/aigc/image2video/video-synthesis`，model `liveportrait`，`input:{image_url,audio_url}` 均 base64）真出对口型 MP4。

复用既有：drama-store per-file 原子写、interview compose SSE/concat 脊柱、i2v 适配器轮询、job 队列(submitJob/getJob/waitJob 见 routes.js)、generatedUrlToDataUrl、画廊 type:'interview'。

常量（写入 interview2.js）：`MAX_QUESTIONS=10`、`MAX_TURNS=24`、`MAX_ANSWER_SEC=120`。

---

# Phase A —— 互动访谈核心

## Task 1: `lipsync` 能力适配器 + 配置 + 估算 + 注册

**Files:** Modify `src/providers/dashscope.js`、`config/ai-providers.json`、`src/gateway/registry.js`、`src/gateway/costs.js`

- [ ] **Step 1: registry 注册能力**

`src/gateway/registry.js`：`CAPABILITIES` 数组加 `'lipsync'`：
```js
export const CAPABILITIES = [
  'chat', 'content', 'world', 'plan', 'image', 'video', 'music', 'tts', 'asr',
  'lipsync', 'drama-script', 'storyboard',
];
```

- [ ] **Step 2: dashscope 适配器**

`src/providers/dashscope.js`：(a) `adapter.capabilities` 数组加 `'lipsync'`；(b) `invoke` 分发加 `if (capability === 'lipsync') return invokeLipsync(request, ctx);`（放在 video 那行后）；(c) 在 `invokeVideo` 附近加端点常量与函数：

```js
const LIPSYNC_SUBMIT = `${BASE}/api/v1/services/aigc/image2video/video-synthesis`;

// 对口型说话头（liveportrait）：照片 image_url + 音频 audio_url（均 base64 dataUrl）→ 唇形同步视频。探针已验证。
async function invokeLipsync(request, ctx) {
  const img = request.imageRef;
  const aud = request.audioRef;
  if (!img || !aud) throw gatewayError('bad_request', '对口型需要照片与音频', { providerId: 'dashscope' });
  const submit = await ctx.fetchJson(LIPSYNC_SUBMIT, {
    headers: { ...auth(ctx.env), 'X-DashScope-Async': 'enable' }, timeoutMs: 30000,
    body: { model: request.model, input: { image_url: img, audio_url: aud }, parameters: {} },
  });
  const taskId = submit.output?.task_id;
  if (!taskId) throw gatewayError('provider_error', `liveportrait 未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'dashscope' });
  const deadline = Date.now() + VID_MAX_MS;
  let lastPct = 5, pollErrors = 0;
  while (Date.now() < deadline) {
    await vidSleep(VID_POLL_MS);
    let st;
    try { st = await ctx.fetchJson(`${BASE}/api/v1/tasks/${taskId}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 }); pollErrors = 0; }
    catch (err) { if (++pollErrors >= 3) throw err; ctx.onProgress('对口型: 轮询重试', lastPct); continue; }
    const status = st.output?.task_status;
    lastPct = Math.max(lastPct, status === 'RUNNING' ? 50 : 20);
    ctx.onProgress(`对口型: ${status || '排队'}`, lastPct);
    if (status === 'SUCCEEDED') {
      const url = st.output?.video_url || st.output?.results?.[0]?.url;
      if (!url) throw gatewayError('provider_error', 'liveportrait 成功但无 URL', { providerId: 'dashscope' });
      ctx.onProgress('下载对口型', 90);
      const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 300000 });
      return { files: [ctx.saveFile(buf, 'mp4')], durationSec: request.durationSec || 0, usage: { seconds: request.durationSec || 0 } };
    }
    if (status === 'FAILED') throw gatewayError('provider_error', `liveportrait 失败: ${st.output?.message || st.output?.code || '无详情'}`, { providerId: 'dashscope' });
  }
  throw gatewayError('timeout', `liveportrait 轮询超时（${VID_MAX_MS / 60000} 分钟）`, { providerId: 'dashscope' });
}
```
（`VID_SUBMIT`/`VID_POLL_MS`/`VID_MAX_MS`/`vidSleep` 已在 invokeVideo 区定义，复用即可——确认 invokeLipsync 放在它们之后。）

- [ ] **Step 3: 配置路由**

`config/ai-providers.json`：在 `video` 后加：
```json
  "lipsync": { "provider": "dashscope", "model": "liveportrait" },
```

- [ ] **Step 4: 成本估算**

`src/gateway/costs.js`：`BASE_PRICES` 加 `'dashscope:liveportrait': { perSecond: 0.15 },`；`estimateRequest` 加分支（放 video 后）：
```js
  if (capability === 'lipsync') return round((p.perSecond ?? 0.15) * (request.durationSec || 5));
```

- [ ] **Step 5: 验证**

Run: `npm run check && npm test` → 全绿（registry 单测会校验能力清单——若 test/registry.test.js 显式列举能力，把 `'lipsync'` 加进它的期望数组）。
Run（确认 estimate 可路由）：
```bash
cd "F:/projects/Starstudio"
for pid in $(powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3181 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { \$_.OwningProcess }" 2>/dev/null | tr -d '\r'); do taskkill //PID $pid //F >/dev/null 2>&1; done
PORT=3181 node server.js > /tmp/s7t1.log 2>&1 & sleep 2.5
curl -s -X POST localhost:3181/api/estimate -H 'Content-Type: application/json' -d '{"capability":"lipsync","request":{"durationSec":10}}' | head -c 200
for pid in $(powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3181 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { \$_.OwningProcess }" 2>/dev/null | tr -d '\r'); do taskkill //PID $pid //F >/dev/null 2>&1; done
```
Expected: 返回 `estimatedUsd` 数字（约 1.5），provider dashscope，model liveportrait。

- [ ] **Step 6: Commit**

```bash
git add src/providers/dashscope.js config/ai-providers.json src/gateway/registry.js src/gateway/costs.js test/registry.test.js
git commit -m "feat: lipsync 能力（DashScope liveportrait 对口型）适配器+配置+估算+注册"
```

---

## Task 2: 嘉宾 store + 会话 store + 接线 + 单测

**Files:** Create `src/studio/guests.js`、`src/studio/session-store.js`；Modify `src/lib/paths.js`、`src/bootstrap.js`；Test `test/guests.test.js`、`test/session-store.test.js`

- [ ] **Step 1: 写失败测试**

`test/guests.test.js`：
```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { initGuests, createGuest, getGuest, listGuests, updateGuest, addGuestPortrait, deleteGuest } from '../src/studio/guests.js';

before(() => initGuests(fs.mkdtempSync(path.join(os.tmpdir(), 'gst_'))));

test('createGuest + listGuests 过滤 artistId', () => {
  const g = createGuest('art_1', { name: '王总', title: 'CEO', company: 'X 公司', persona: '连续创业者', voice: 'Ethan' });
  assert.ok(g.id.startsWith('gst_'));
  assert.equal(g.portrait.current, -1);
  assert.ok(listGuests('art_1').some((x) => x.id === g.id));
  assert.ok(!listGuests('art_2').some((x) => x.id === g.id));
});

test('addGuestPortrait 追加版本并指向最新', () => {
  const g = createGuest('art_1', { name: 'x' });
  addGuestPortrait(g.id, { url: '/generated/p.png', prompt: 'p' });
  const g2 = getGuest(g.id);
  assert.equal(g2.portrait.versions[0].url, '/generated/p.png');
  assert.equal(g2.portrait.current, 0);
});

test('updateGuest / deleteGuest', () => {
  const g = createGuest('art_1', { name: '旧名' });
  assert.equal(updateGuest(g.id, { name: '新名' }).name, '新名');
  assert.equal(deleteGuest(g.id), true);
  assert.equal(getGuest(g.id), null);
});
```
`test/session-store.test.js`：
```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { initSessions, createSession, getSession, listSessions, appendTurn, updateSession, setTurnMedia } from '../src/studio/session-store.js';

before(() => initSessions(fs.mkdtempSync(path.join(os.tmpdir(), 'itv_'))));

const outline = { opening: '欢迎', questions: ['Q1', 'Q2'] };

test('createSession + appendTurn + cursor', () => {
  const s = createSession('art_1', 'gst_1', outline);
  assert.ok(s.id.startsWith('itv_'));
  assert.equal(s.status, 'interviewing');
  assert.equal(s.cursor, 0);
  appendTurn(s.id, { speaker: 'host', text: '欢迎', audioUrl: '/generated/h.wav' });
  appendTurn(s.id, { speaker: 'guest', text: '谢谢', audioUrl: '/generated/g.wav' });
  const s2 = getSession(s.id);
  assert.equal(s2.turns.length, 2);
  assert.ok(s2.turns[0].id);
  assert.equal(s2.turns[1].speaker, 'guest');
});

test('setTurnMedia 写回某轮媒体', () => {
  const s = createSession('art_1', 'gst_1', outline);
  appendTurn(s.id, { speaker: 'host', text: 'Q' });
  const tid = getSession(s.id).turns[0].id;
  setTurnMedia(s.id, tid, { lipsyncUrl: '/generated/lp.mp4' });
  assert.equal(getSession(s.id).turns[0].lipsyncUrl, '/generated/lp.mp4');
});

test('listSessions 过滤 + updateSession', () => {
  const s = createSession('art_9', 'gst_1', outline);
  assert.ok(listSessions('art_9').some((x) => x.id === s.id));
  assert.equal(updateSession(s.id, { status: 'done' }).status, 'done');
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test test/guests.test.js test/session-store.test.js` → FAIL（模块缺失）。

- [ ] **Step 3: 实现 `src/studio/guests.js`**（mirror drama-store 的 per-file 原子写）

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let dir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STR = (v) => (typeof v === 'string' ? v : '');

export function initGuests(d) { dir = d; fs.mkdirSync(d, { recursive: true }); try { for (const f of fs.readdirSync(d)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(d, f)); } catch {} }
const fileFor = (id) => path.join(dir, `${id}.json`);
function write(g) { g.updatedAt = new Date().toISOString(); const f = fileFor(g.id); fs.writeFileSync(`${f}.tmp`, JSON.stringify(g, null, 2)); fs.renameSync(`${f}.tmp`, f); return g; }

export function getGuest(id) { if (!dir || !SAFE_ID.test(id)) return null; const f = fileFor(id); if (!fs.existsSync(f)) return null; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
export function listGuests(artistId) {
  if (!dir || !SAFE_ID.test(artistId)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; try { const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (g.artistId === artistId) out.push(g); } catch {} }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function createGuest(artistId, profile) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const now = new Date().toISOString();
  const g = {
    id: `gst_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, artistId, schemaVersion: 1, createdAt: now, updatedAt: now,
    name: STR(profile?.name) || '嘉宾', title: STR(profile?.title), company: STR(profile?.company), persona: STR(profile?.persona),
    voice: STR(profile?.voice) || 'Ethan', portrait: { current: -1, versions: [] },
  };
  return write(g);
}
export function updateGuest(id, patch) { const g = getGuest(id); if (!g) return null; for (const k of ['name', 'title', 'company', 'persona', 'voice']) if (k in (patch || {})) g[k] = STR(patch[k]); return write(g); }
export function addGuestPortrait(id, version) { const g = getGuest(id); if (!g) return null; g.portrait.versions.push({ url: version.url, prompt: version.prompt || '', createdAt: new Date().toISOString() }); g.portrait.current = g.portrait.versions.length - 1; return write(g); }
export function deleteGuest(id) { if (!dir || !SAFE_ID.test(id)) return false; const f = fileFor(id); if (!fs.existsSync(f)) return false; fs.unlinkSync(f); return true; }
export function curGuestPortrait(guest) { const v = guest?.portrait?.versions; const i = guest?.portrait?.current; return (v && i >= 0 && v[i]) ? v[i].url : null; }
```

- [ ] **Step 4: 实现 `src/studio/session-store.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let dir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
export function initSessions(d) { dir = d; fs.mkdirSync(d, { recursive: true }); try { for (const f of fs.readdirSync(d)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(d, f)); } catch {} }
const fileFor = (id) => path.join(dir, `${id}.json`);
function write(s) { s.updatedAt = new Date().toISOString(); const f = fileFor(s.id); fs.writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 2)); fs.renameSync(`${f}.tmp`, f); return s; }
export function getSession(id) { if (!dir || !SAFE_ID.test(id)) return null; const f = fileFor(id); if (!fs.existsSync(f)) return null; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
export function listSessions(artistId) {
  if (!dir || !SAFE_ID.test(artistId)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; try { const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (s.artistId === artistId) out.push(s); } catch {} }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function createSession(artistId, guestId, outline) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const now = new Date().toISOString();
  const s = {
    id: `itv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, artistId, guestId, schemaVersion: 1, createdAt: now, updatedAt: now,
    status: 'interviewing', outline: outline || { opening: '', questions: [] }, cursor: 0, turns: [], recordUrl: null, videoUrl: null,
  };
  return write(s);
}
export function appendTurn(id, turn) {
  const s = getSession(id); if (!s) return null;
  s.turns.push({ id: `t_${s.turns.length + 1}_${crypto.randomBytes(2).toString('hex')}`, speaker: turn.speaker === 'guest' ? 'guest' : 'host', text: String(turn.text || ''), audioUrl: turn.audioUrl || null, lipsyncUrl: turn.lipsyncUrl || null });
  return write(s);
}
export function updateSession(id, patch) { const s = getSession(id); if (!s) return null; Object.assign(s, patch); return write(s); }
export function setTurnMedia(id, turnId, patch) { const s = getSession(id); if (!s) return null; const t = s.turns.find((x) => x.id === turnId); if (!t) return null; Object.assign(t, patch); return write(s); }
```

- [ ] **Step 5: 接线 paths + bootstrap**

`src/lib/paths.js`：仿 `DRAMA_DIR` 加 `export const GUESTS_DIR = path.join(DATA_DIR, 'guests');` 与 `export const INTERVIEWS_DIR = path.join(DATA_DIR, 'interviews');`。
`src/bootstrap.js`：import `initGuests`/`initSessions` 与两个常量，在 `initDrama(...)` 旁调用 `initGuests(GUESTS_DIR); initSessions(INTERVIEWS_DIR);`。

- [ ] **Step 6: 跑测试 + 全量 + Commit**

`node --test test/guests.test.js test/session-store.test.js` → PASS；`npm run check && npm test` → 全绿。
```bash
git add src/studio/guests.js src/studio/session-store.js test/guests.test.js test/session-store.test.js src/lib/paths.js src/bootstrap.js
git commit -m "feat: 嘉宾 store + 访谈会话 store（per-file 原子写）+ 接线"
```

---

## Task 3: `interview2.js` 纯函数 + 单测

**Files:** Create `src/studio/interview2.js`；Test `test/interview2.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOutline, assignGuestVoice, hostVoice, MAX_QUESTIONS, MAX_TURNS } from '../src/studio/interview2.js';

test('extractOutline 解析并裁剪问题上限', () => {
  const raw = '```json\n' + JSON.stringify({ opening: '欢迎来到节目', questions: Array.from({ length: 15 }, (_, i) => `问题${i}`) }) + '\n```';
  const o = extractOutline(raw);
  assert.equal(o.opening, '欢迎来到节目');
  assert.equal(o.questions.length, MAX_QUESTIONS);
});

test('extractOutline 无 JSON 抛错', () => {
  assert.throws(() => extractOutline('没有'), /未在响应中找到/);
});

test('assignGuestVoice 按性别且避开主持音色；hostVoice 按艺人', () => {
  assert.equal(hostVoice({ gender: '男' }), 'Ethan');
  assert.equal(hostVoice({ gender: '女' }), 'Cherry');
  const v = assignGuestVoice({ persona: '男企业家' }, { gender: '男' });   // 主持男=Ethan → 嘉宾男避开 Ethan
  assert.notEqual(v, 'Ethan');
});

assert.ok(MAX_TURNS > 0);
```

- [ ] **Step 2: 跑测试确认失败** — `node --test test/interview2.test.js` → FAIL。

- [ ] **Step 3: 实现 `src/studio/interview2.js`**

```js
const JSON_ONLY = '只输出一个 JSON 对象，不要额外文字、不要 markdown 围栏。';
export const MAX_QUESTIONS = 10;
export const MAX_TURNS = 24;
export const MAX_ANSWER_SEC = 120;
const STR = (v) => (typeof v === 'string' ? v : '');

export function buildOutlineMessages(artist, guest) {
  const a = artist || {}; const g = guest || {};
  const system = [
    '你是一档高端财经人物访谈节目的资深策划。为下面这位嘉宾设计一期专业、有深度、有钩子的访谈提纲。',
    `主持人（艺人）：${a.name || ''}，风格：${a.persona || ''}。`,
    `嘉宾：${g.name || ''}，头衔：${g.title || ''}，公司：${g.company || ''}，背景：${g.persona || ''}。`,
    `输出字段：opening（一段口语化、得体的开场白，点出嘉宾身份与看点）、questions（${MAX_QUESTIONS} 个以内、由浅入深、贴合嘉宾经历的问题数组，避免空泛）。`,
    'SFW，不影射真实公众人物隐私。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `请为嘉宾「${g.name || ''}」设计访谈提纲 JSON。` }] };
}

export function extractOutline(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) throw new Error('未在响应中找到提纲 JSON');
  let obj; try { obj = JSON.parse(s.slice(i, j + 1)); } catch { throw new Error('提纲 JSON 解析失败'); }
  const questions = (Array.isArray(obj.questions) ? obj.questions : []).map(STR).filter(Boolean).slice(0, MAX_QUESTIONS);
  return { opening: STR(obj.opening), questions };
}

// 主持人下一句：首轮=开场白；之后让主持顺着上一条回答追问或推进到下一个大纲问题。
export function buildNextQuestionMessages(artist, guest, outline, turns, cursor) {
  const a = artist || {}; const g = guest || {};
  const recent = (turns || []).slice(-6).map((t) => `${t.speaker === 'host' ? a.name || '主持' : g.name || '嘉宾'}：${t.text}`).join('\n');
  const remaining = (outline?.questions || []).slice(cursor).map((q, i) => `${cursor + i + 1}. ${q}`).join('\n');
  const system = [
    `你在扮演访谈主持人「${a.name || ''}」（风格：${a.persona || ''}），正在采访嘉宾「${g.name || ''}」。`,
    '根据已有对话与剩余提纲，输出主持人接下来要说的【一句】话：可以顺着嘉宾上一条回答自然追问，或自然过渡到下一个提纲问题。口语、得体、不复述。只输出这句话本身，不要前缀。',
  ].join('\n');
  const user = `已有对话（近段）：\n${recent || '（尚无）'}\n\n剩余提纲：\n${remaining || '（已问完，可做收尾提问或致谢）'}\n\n主持人下一句：`;
  return { system, messages: [{ role: 'user', content: user }] };
}

const FEMALE = ['Cherry', 'Serena']; const MALE = ['Ethan', 'Dylan'];
const isMale = (g) => /男|male/i.test(g || '');
export function hostVoice(artist) { return artist?.voiceProfile?.ttsVoice || (isMale(artist?.gender) ? 'Ethan' : 'Cherry'); }
export function assignGuestVoice(guest, artist) {
  const male = isMale(guest?.gender) || /男|先生|总|ceo|创始人|董事/i.test(guest?.persona || guest?.title || '');
  const pool = male ? MALE : FEMALE;
  const hv = hostVoice(artist);
  return pool.find((v) => v !== hv) || pool[0];
}
```

- [ ] **Step 4: 跑测试 + 全量 + Commit**

`node --test test/interview2.test.js` → PASS；`npm run check && npm test` → 全绿。
```bash
git add src/studio/interview2.js test/interview2.test.js
git commit -m "feat: 深度访谈纯函数（提纲/追问提示词、音色分配）"
```

---

## Task 4: `transcodeToWav` + 嘉宾 CRUD/形象端点

**Files:** Modify `src/lib/ffmpeg.js`、`src/api/routes.js`；Test `test/ffmpeg.test.js`

- [ ] **Step 1: ffmpeg 助手 + 测试**

`test/ffmpeg.test.js` 追加（确认导出存在；真实转码在端到端验）：
```js
test('transcodeToWav 导出存在', async () => {
  const m = await import('../src/lib/ffmpeg.js');
  assert.equal(typeof m.transcodeToWav, 'function');
});
```
`src/lib/ffmpeg.js` 加：
```js
// 任意音频（含浏览器 webm/opus）→ 16k 单声道 wav，供 ASR。
export function transcodeToWav(srcAbs, destAbs) {
  runFfmpeg(['-y', '-i', srcAbs, '-ar', '16000', '-ac', '1', destAbs]);
  return destAbs;
}
```
（`runFfmpeg` 已在本文件定义/导出，确认 import 同文件函数即可。）

- [ ] **Step 2: routes import**

`src/api/routes.js` 顶部：
- ffmpeg import 行加 `transcodeToWav`：`import { ffmpegAvailable, runFfmpeg, probeDurationSec, buildSrt, transcodeToWav } from '../lib/ffmpeg.js';`
- 新增：`import { createGuest, getGuest, listGuests, updateGuest, addGuestPortrait, deleteGuest, curGuestPortrait } from '../studio/guests.js';`（只 import 实际用到的）。
- `import { saveDataUrl } from '../lib/files.js';`（落盘上传/录音 base64；该函数在 Step 3 加进 files.js，generatedUrlToDataUrl 已在 files.js）。

- [ ] **Step 3: 落盘助手确认**

检查 `src/lib/files.js` 是否有「base64 dataUrl → 落盘 /generated 并返回 url」的函数（generatedUrlToDataUrl 的反向）。若没有，在 files.js 加：
```js
// base64 dataUrl 落盘到 GENERATED_DIR，返回 /generated/<name> url。ext 由 mime 或参数定。
export function saveDataUrl(genDir, dataUrl, fallbackExt = 'bin') {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('非法 dataUrl');
  const mime = m[1]; const buf = Buffer.from(m[2], 'base64');
  const ext = mime.includes('webm') ? 'webm' : mime.includes('wav') ? 'wav' : mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : mime.includes('mpeg') ? 'mp3' : fallbackExt;
  const name = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(genDir, name), buf);
  return `/generated/${name}`;
}
```
（确认 files.js 顶部已 import fs/path；并 export。routes.js import `saveDataUrl`。）

- [ ] **Step 4: 嘉宾端点**（放在短剧端点区之后）

```js
  route('POST /api/artist/:id/guests', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    if (!getArtist(params.id)) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    if (!String(body.name || '').trim()) return jsonError(res, 'bad_request', '嘉宾姓名必填');
    json(res, { guest: createGuest(params.id, body) });
  });
  route('GET /api/artist/:id/guests', async (req, res, { params }) => {
    if (!getArtist(params.id)) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    json(res, { guests: listGuests(params.id) });
  });
  route('GET /api/artist/:id/guest/:gid', async (req, res, { params }) => {
    const g = getGuest(params.gid);
    g && g.artistId === params.id ? json(res, { guest: g }) : jsonError(res, 'not_found', '无此嘉宾');
  });
  route('PUT /api/artist/:id/guest/:gid', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const g = getGuest(params.gid);
    if (!g || g.artistId !== params.id) return jsonError(res, 'not_found', '无此嘉宾');
    json(res, { guest: updateGuest(params.gid, body) });
  });
  route('DELETE /api/artist/:id/guest/:gid', async (req, res, { params }) => {
    const g = getGuest(params.gid);
    if (!g || g.artistId !== params.id) return jsonError(res, 'not_found', '无此嘉宾');
    json(res, { ok: deleteGuest(params.gid) });
  });
  // 形象：ai 出图 或 upload 落盘
  route('POST /api/artist/:id/guest/:gid/portrait', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id); const g = getGuest(params.gid);
    if (!artist || !g || g.artistId !== params.id) return jsonError(res, 'not_found', '无此嘉宾');
    try {
      let url;
      if (body.mode === 'upload') {
        if (!body.dataUrl) return jsonError(res, 'bad_request', '缺少图片');
        url = saveDataUrl(GENERATED_DIR, body.dataUrl, 'png');
      } else {
        const prompt = body.prompt || `商业人物肖像，${g.title || ''} ${g.company || ''}，${g.persona || ''}，正脸半身，专业布光，干净背景，SFW`;
        const r = await execute('image', { prompt, aspect: '9:16' });
        url = r.files?.[0]?.url; if (!url) return jsonError(res, 'provider_error', '出图失败');
      }
      addGuestPortrait(params.gid, { url, prompt: body.prompt || '嘉宾形象' });
      addAssets(params.id, [{ type: 'photo', url, prompt: `嘉宾：${g.name}`, title: g.name }]);
      json(res, { guest: getGuest(params.gid) });
    } catch (e) { sendGatewayError(res, e); }
  });
```
（`/api/artist/:id/guest/:gid/portrait` 的 upload 体可能较大——把这些 path 加进 `MEDIA_BODY_PATHS`？该集合是精确匹配，带 :gid 无法列举。改为：在 readJsonBody 的 limit 判断里，对含 `/guest/` 且以 `/portrait` 结尾、或含 `/answer` 的 pathname 用 MAX_MEDIA_BODY。实现：把 MEDIA_BODY_PATHS 判断改为函数 `isMediaPath(pathname)`，既匹配原集合，也匹配 `/\/(guest\/[^/]+\/portrait|interview2\/[^/]+\/answer)$/`。改 `readJsonBody` 用 isMediaPath。）

- [ ] **Step 5: 大体积请求体放行**

把 `src/api/routes.js` 的 `MEDIA_BODY_PATHS` 判断改造：
```js
const MEDIA_BODY_PATHS = new Set(['/api/ai/asr', '/api/ai/image', '/api/ai/video', '/api/ai/music']);
function isMediaPath(pathname) {
  return MEDIA_BODY_PATHS.has(pathname) || /\/(guest\/[^/]+\/portrait|interview2\/[^/]+\/answer)$/.test(pathname);
}
```
`readJsonBody` 内把 `MEDIA_BODY_PATHS.has(pathname)` 换成 `isMediaPath(pathname)`。

- [ ] **Step 6: 验证 + Commit**

`npm run check && npm test` → 全绿。手测嘉宾 CRUD（建/列/改/删）+ AI 形象（真出图一次）守卫。
```bash
git add src/lib/ffmpeg.js src/lib/files.js src/api/routes.js test/ffmpeg.test.js
git commit -m "feat: transcodeToWav + 嘉宾 CRUD/形象端点(AI/上传) + 大体积请求体放行"
```

---

## Task 5: 实时访谈端点（建会话/ask/answer/end/列表详情）

**Files:** Modify `src/api/routes.js`

- [ ] **Step 1: import**

加：`import { createSession, getSession, listSessions, appendTurn, updateSession } from '../studio/session-store.js';` 与 `import { buildOutlineMessages, extractOutline, buildNextQuestionMessages, hostVoice, assignGuestVoice, MAX_TURNS } from '../studio/interview2.js';`

- [ ] **Step 2: 建会话（出提纲）**

```js
  route('POST /api/artist/:id/interview2', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const guest = getGuest(body.guestId);
    if (!artist || !guest || guest.artistId !== params.id) return jsonError(res, 'not_found', '无此艺人或嘉宾');
    try {
      const { system, messages } = buildOutlineMessages(artist, guest);
      const r = await execute('content', { system, messages, maxTokens: 1500 });
      let outline; try { outline = extractOutline(r.text); } catch (e) { return jsonError(res, 'provider_error', `提纲解析失败：${e.message}`); }
      json(res, { session: createSession(params.id, guest.id, outline) });
    } catch (e) { sendGatewayError(res, e); }
  });
  route('GET /api/artist/:id/interviews', async (req, res, { params }) => {
    if (!getArtist(params.id)) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    json(res, { sessions: listSessions(params.id) });
  });
  route('GET /api/artist/:id/interview2/:sid', async (req, res, { params }) => {
    const s = getSession(params.sid);
    s && s.artistId === params.id ? json(res, { session: s }) : jsonError(res, 'not_found', '无此会话');
  });
```

- [ ] **Step 3: ask（主持出题 + TTS）**

```js
  route('POST /api/artist/:id/interview2/:sid/ask', async (req, res, { params }) => {
    const artist = getArtist(params.id);
    const s = getSession(params.sid);
    if (!artist || !s || s.artistId !== params.id) return jsonError(res, 'not_found', '无此会话');
    if (s.turns.length >= MAX_TURNS) return jsonError(res, 'bad_request', '访谈轮次已达上限');
    const guest = getGuest(s.guestId);
    try {
      let text;
      if (s.turns.length === 0) { text = s.outline.opening || `欢迎来到节目，今天的嘉宾是${guest?.name || ''}。`; }
      else {
        const { system, messages } = buildNextQuestionMessages(artist, guest, s.outline, s.turns, s.cursor);
        const r = await execute('content', { system, messages, maxTokens: 200 });
        text = r.text.trim().replace(/^["「]|["」]$/g, '');
        if (s.cursor < (s.outline.questions || []).length) updateSession(params.sid, { cursor: s.cursor + 1 });
      }
      const tts = await execute('tts', { text, voice: hostVoice(artist) });
      const audioUrl = tts.files?.[0]?.url || null;
      const session = appendTurn(params.sid, { speaker: 'host', text, audioUrl });
      json(res, { turn: session.turns[session.turns.length - 1] });
    } catch (e) { sendGatewayError(res, e); }
  });
```

- [ ] **Step 4: answer（录音→转码→ASR）**

```js
  route('POST /api/artist/:id/interview2/:sid/answer', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const s = getSession(params.sid);
    if (!artist || !s || s.artistId !== params.id) return jsonError(res, 'not_found', '无此会话');
    if (s.turns.length >= MAX_TURNS) return jsonError(res, 'bad_request', '访谈轮次已达上限');
    if (!body.audio) return jsonError(res, 'bad_request', '缺少录音');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg');
    try {
      const srcUrl = saveDataUrl(GENERATED_DIR, body.audio, 'webm');     // 落盘录音
      const srcAbs = path.join(GENERATED_DIR, srcUrl.replace('/generated/', ''));
      const wavName = `${Date.now()}_ans.wav`;
      const wavAbs = path.join(GENERATED_DIR, wavName);
      transcodeToWav(srcAbs, wavAbs);                                    // webm→wav
      const wavB64 = `data:audio/wav;base64,${fs.readFileSync(wavAbs).toString('base64')}`;
      const r = await execute('asr', { audio: wavB64 });
      const text = (r.text || '').trim();
      if (!text) return jsonError(res, 'provider_error', '未能识别语音，请重试');
      const session = appendTurn(params.sid, { speaker: 'guest', text, audioUrl: `/generated/${wavName}` });
      json(res, { turn: session.turns[session.turns.length - 1] });
    } catch (e) { sendGatewayError(res, e); }
  });
  route('POST /api/artist/:id/interview2/:sid/end', async (req, res, { params }) => {
    const s = getSession(params.sid);
    if (!s || s.artistId !== params.id) return jsonError(res, 'not_found', '无此会话');
    json(res, { session: updateSession(params.sid, { status: 'done' }) });
  });
```

- [ ] **Step 5: 验证（含真实 ask + ASR answer）**

`npm run check && npm test` → 全绿。真测：建艺人+嘉宾(AI 形象)→建会话(真提纲)→ask(真 TTS 出题，turn.audioUrl 存在)→用一段 TTS 生成的真实音频当"录音"走 answer(真 ASR 转写出文字)→记录 2 轮。脚本同 Task 用 PORT 起服务、生成 TTS 音频转 base64 喂 answer、断言 turn.speaker/text。结束清理临时数据。

- [ ] **Step 6: Commit**

```bash
git add src/api/routes.js
git commit -m "feat: 实时访谈端点（建会话出提纲 + ask 出题TTS + answer 录音转码ASR + end）"
```

---

## Task 6: 前端——嘉宾管理 + 提纲 + 实时访谈室（麦克风录音）

**Files:** Modify `prototype/index.html`、`prototype/app.js`、`prototype/styles.css`

参照既有「访谈成片」与「短剧工坊」前端（initInterviewStudio / initDramaStudio）的视图/路由/SSE/卡片模式。

- [ ] **Step 1: index.html**

左导航加「深度访谈」项 `data-view="deepiv"`；加 `<section id="view-deepiv" class="view" hidden>`，内含：无艺人态、嘉宾列表+新建表单、提纲面板、实时访谈室（问题区+🎤录音按钮+记录气泡面板+结束按钮）、成片区占位（Phase B 填）。

- [ ] **Step 2: app.js — 嘉宾管理 + 会话**

`initDeepInterview()`（boot 注册）：
- 进入视图（需当前艺人）→ `GET /guests` 渲染嘉宾卡 + 新建表单（姓名/头衔/公司/人设）→ `POST /guests`。
- 嘉宾形象：「AI 出图」→ `POST /guest/:gid/portrait {mode:'ai'}`；「上传」→ file input → `fileToDataUrl` → `POST .../portrait {mode:'upload', dataUrl}`（`fileToDataUrl` 已存在，见 initAsr）。
- 「开始访谈」→ `POST /interview2 {guestId}` → 渲染提纲 + 进入访谈室。

- [ ] **Step 3: app.js — 实时访谈室 + 麦克风录音（核心）**

```js
// 录音器（MediaRecorder）。点开始→getUserMedia→录；点停止→拿到 webm base64。
let mediaRec = null, recChunks = [], recStream = null;
async function startRec(btn) {
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { toast('无法访问麦克风，请允许权限', 'err'); return false; }
  recChunks = [];
  mediaRec = new MediaRecorder(recStream);
  mediaRec.ondataavailable = (ev) => { if (ev.data.size) recChunks.push(ev.data); };
  mediaRec.start();
  return true;
}
function stopRec() {
  return new Promise((resolve) => {
    if (!mediaRec) return resolve(null);
    mediaRec.onstop = async () => {
      recStream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);   // data:audio/webm;base64,...
      reader.readAsDataURL(blob);
    };
    mediaRec.stop();
  });
}
```
访谈室逻辑：
- `ask()`：`POST /interview2/:sid/ask` → 得 host turn → 渲染问题气泡 → 自动播放 `turn.audioUrl`（`new Audio(url).play()`）。
- 录音按钮：第一次点 = `startRec`（按钮变「停止并提交」）；再点 = `await stopRec()` 得 base64 → `POST /interview2/:sid/answer {audio}` → 得 guest turn → 渲染答案气泡 → 自动 `ask()` 下一问。
- 记录面板：host/guest 气泡不同色，含文字（可选播放各自 audioUrl）。
- 「结束访谈」→ `POST /interview2/:sid/end`，展示成片区按钮（Phase B）。
- 兜底：`if (!navigator.mediaDevices?.getUserMedia)` 显示「当前环境不支持麦克风录音」。

- [ ] **Step 4: styles.css**

访谈室布局、问题区、录音按钮（录音中红点动画）、双方气泡、嘉宾卡。复用 tokens。

- [ ] **Step 5: 验证**

`npm run check`（含 app.js 语法）→ 通过；`npm test` → 全绿。起服务器载入，确认页面含「深度访谈」「🎤」入口、app.js `node --check` 过、无 console 报错。麦克风真实录音受环境限制，深度交互在 Phase A 端到端（Task 7）确认结构；预览里可注入 mock 会话确认渲染。

- [ ] **Step 6: Commit**

```bash
git add prototype/index.html prototype/app.js prototype/styles.css
git commit -m "feat: 深度访谈前端——嘉宾管理 + 提纲 + 实时访谈室(麦克风录音/ASR/追问)"
```

---

## Task 7: Phase A 冒烟守卫 + 端到端 + 阶段合并

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1: 冒烟守卫**（沿用 call/ok，用既有 created.data.id）

```js
  const gstMiss = await call('/api/artist/nope_x/guests', { name: '王总' });
  ok('嘉宾未知艺人→not_found', gstMiss.status === 200 && gstMiss.data.error?.code === 'not_found', gstMiss.data.error?.code);
  const gstList = await call(`/api/artist/${created.data.id}/guests`);
  ok('嘉宾列表可读', gstList.status === 200 && Array.isArray(gstList.data.guests));
  const ivMiss = await call(`/api/artist/${created.data.id}/interview2/nope/ask`, {});
  ok('ask 未知会话→not_found', ivMiss.status === 200 && ivMiss.data.error?.code === 'not_found', ivMiss.data.error?.code);
```

- [ ] **Step 2: 跑冒烟** — `npm run smoke` → 全过（含新增 3）。

- [ ] **Step 3: 端到端（真实）** — 建艺人→建嘉宾→AI 形象→建会话(提纲)→ask(TTS)→用真实音频走 answer(ASR)→2-3 轮→GET 详情确认 turns 双方文字成型、host 有 audioUrl。记录结果。

- [ ] **Step 4: 全量绿 + 阶段提交**

`npm run check && npm test && npm run smoke` → 全绿。
```bash
git add scripts/smoke.mjs
git commit -m "test: 冒烟覆盖深度访谈 Phase A 守卫 + 端到端验证"
```
（不合并 master——Phase B 完再一起合，或此处先合 Phase A 由控制者定。）

---

# Phase B —— 语音对谈记录 + 对口型影像

## Task 8: record 端点（双方 TTS 重配音拼接）SSE

**Files:** Modify `src/api/routes.js`

- [ ] **Step 1: 端点**（放在 interview2 端点区）

```js
  route('POST /api/artist/:id/interview2/:sid/record', async (req, res, { params }) => {
    const artist = getArtist(params.id);
    const s = getSession(params.sid);
    if (!artist || !s || s.artistId !== params.id) return jsonError(res, 'not_found', '无此会话');
    if (!s.turns.length) return jsonError(res, 'bad_request', '尚无对话可生成记录');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg');
    const guest = getGuest(s.guestId);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec_'));
    try {
      const parts = [];
      for (let i = 0; i < s.turns.length; i++) {
        const t = s.turns[i];
        send('stage', { progress: Math.round(i / s.turns.length * 85), msg: `配音 ${i + 1}/${s.turns.length}` });
        const voice = t.speaker === 'host' ? hostVoice(artist) : (guest?.voice || 'Ethan');
        const r = await execute('tts', { text: t.text, voice });
        const u = r.files?.[0]?.url; if (!u) throw new Error('TTS 未返回音频');
        parts.push(path.join(GENERATED_DIR, u.replace('/generated/', '')));
        setTurnMedia(params.sid, t.id, { audioUrl: u });   // 写回干净 TTS 音频供 video 用
      }
      send('stage', { progress: 90, msg: '拼接录音' });
      const listFile = path.join(tmp, 'a.txt');
      fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
      const name = `itv_rec_${Date.now()}.mp3`;
      const outAbs = path.join(GENERATED_DIR, name);
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-ar', '44100', outAbs]);
      updateSession(params.sid, { recordUrl: `/generated/${name}` });
      addAssets(params.id, [{ type: 'interview', url: `/generated/${name}`, title: `访谈记录·${guest?.name || ''}` }]);
      send('done', { url: `/generated/${name}` });
    } catch (e) {
      if (e instanceof GatewayError) send('error', e.toJSON());
      else { console.error('[interview2] 录音失败', e.message); send('error', { code: 'internal', message: '语音记录生成失败' }); }
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} res.end(); }
  });
```
（需 import `setTurnMedia` from session-store。）

- [ ] **Step 2: 验证 + Commit** — `npm run check && npm test` 绿；真测 record（≥2 轮 → mp3 真出，ffprobe 有音轨）。
```bash
git add src/api/routes.js
git commit -m "feat: 访谈语音对谈记录端点（双方 TTS 重配音 concat）SSE"
```

---

## Task 9: video 端点（逐轮 liveportrait 对口型 + 拼接）SSE + 成本闸门

**Files:** Modify `src/api/routes.js`

- [ ] **Step 1: 端点**

```js
  route('POST /api/artist/:id/interview2/:sid/video', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const s = getSession(params.sid);
    if (!artist || !s || s.artistId !== params.id) return jsonError(res, 'not_found', '无此会话');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg');
    const withAudio = s.turns.filter((t) => t.audioUrl);
    if (!withAudio.length) return jsonError(res, 'bad_request', '请先生成语音对谈记录');
    const guest = getGuest(s.guestId);
    const hostFace = artist.portraits?.[0]?.url;
    const guestFace = curGuestPortrait(guest);
    if (!hostFace || !guestFace) return jsonError(res, 'bad_request', '主持人与嘉宾都需有形象照');
    if (body.confirm !== true) {
      return json(res, { error: { code: 'confirm_required', message: '需确认对口型出片成本',
        estimate: { capability: 'lipsync', count: withAudio.length, estimatedUsd: estimateFor('lipsync', { durationSec: 5 }).estimatedUsd * withAudio.length } } });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itv_'));
    try {
      const clips = [];
      for (let i = 0; i < withAudio.length; i++) {
        const t = withAudio[i];
        send('stage', { progress: Math.round(i / withAudio.length * 85), msg: `对口型 ${i + 1}/${withAudio.length}` });
        const faceUrl = t.speaker === 'host' ? hostFace : guestFace;
        const imageRef = generatedUrlToDataUrl(GENERATED_DIR, faceUrl);
        const audioAbs = path.join(GENERATED_DIR, t.audioUrl.replace('/generated/', ''));
        const audioRef = `data:audio/mpeg;base64,${fs.readFileSync(audioAbs).toString('base64')}`;
        const durationSec = probeDurationSec(audioAbs);
        const job = submitJob('lipsync', { imageRef, audioRef, durationSec });   // 不带 artistId
        const vurl = await waitJob(job.id);
        const vAbs = path.join(GENERATED_DIR, vurl.replace('/generated/', ''));
        const clip = path.join(tmp, `c_${i}.mp4`);
        runFfmpeg(['-y', '-i', vAbs, '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip], 300000);
        clips.push(clip);
        setTurnMedia(params.sid, t.id, { lipsyncUrl: vurl });
      }
      send('stage', { progress: 90, msg: '拼接成片' });
      const listFile = path.join(tmp, 'c.txt');
      fs.writeFileSync(listFile, clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
      const name = `itv_vid_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outAbs], 300000);
      updateSession(params.sid, { videoUrl: `/generated/${name}` });
      addAssets(params.id, [{ type: 'interview', url: `/generated/${name}`, title: `对口型访谈·${guest?.name || ''}` }]);
      send('done', { url: `/generated/${name}` });
    } catch (e) {
      if (e instanceof GatewayError) send('error', e.toJSON());
      else { console.error('[interview2] 影像失败', e.message); send('error', { code: 'internal', message: '访谈影像生成失败' }); }
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} res.end(); }
  });
```
（`submitJob`/`getJob`/`waitJob`/`generatedUrlToDataUrl`/`estimateFor` 均已在 routes.js 可用；确认 `curGuestPortrait` 已 import。）

- [ ] **Step 2: 验证 + Commit** — `npm run check && npm test` 绿；真测 video（先 record，再 video confirm，≥2 轮真 liveportrait + 拼接，ffprobe 确认音视频流；肉眼确认对口型）。
```bash
git add src/api/routes.js
git commit -m "feat: 对口型访谈影像端点（逐轮 liveportrait job + 拼接）SSE + 成本闸门"
```

---

## Task 10: 前端成片区（记录 + 对口型影像）

**Files:** Modify `prototype/app.js`、`prototype/styles.css`、`prototype/index.html`

- [ ] **Step 1: 成片区**（访谈结束后显示）

- 「生成语音对谈记录」→ SSE `POST /interview2/:sid/record`（复用 dramaSSE 风格的 reader 或 initInterviewStudio 的 SSE）→ 进度 → 完成放 `<audio controls src=recordUrl>`。
- 「生成对口型影像」→ 先 `POST /video {}` 取 `confirm_required` + estimate → 成本确认条 → `POST /video {confirm:true}` SSE 进度 → 完成放竖屏 `<video controls src=videoUrl>` + 入画廊提示。
- 记录/影像按钮置灰条件：无 turns / 未生成 record。

- [ ] **Step 2: 验证 + Commit** — `npm run check`/`npm test` 绿；预览注入 mock session 确认成片区渲染、无报错。
```bash
git add prototype/app.js prototype/styles.css prototype/index.html
git commit -m "feat: 深度访谈成片区（语音记录 + 对口型影像 + 成本确认 + SSE）"
```

---

## Task 11: Phase B 冒烟守卫 + 端到端 + 合并

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1: 冒烟守卫**

```js
  const recMiss = await call(`/api/artist/${created.data.id}/interview2/nope/record`, {});
  ok('record 未知会话→not_found', recMiss.status === 200 && recMiss.data.error?.code === 'not_found', recMiss.data.error?.code);
  const vidMiss2 = await call(`/api/artist/${created.data.id}/interview2/nope/video`, {});
  ok('video 未知会话→not_found', vidMiss2.status === 200 && vidMiss2.data.error?.code === 'not_found', vidMiss2.data.error?.code);
```

- [ ] **Step 2: 跑冒烟** — `npm run smoke` → 全过。

- [ ] **Step 3: 端到端（真实，控成本）** — 完整跑一遍：建嘉宾(AI 形象)+艺人首图→会话→ask/answer 2 轮→record(双方 TTS mp3)→video(confirm，2 轮 liveportrait 真对口型 + 拼接)→入画廊；ffprobe 确认成片音视频；肉眼确认唇形。记录成本与结论。

- [ ] **Step 4: 全量绿 + 合并 master**

`npm run check && npm test && npm run smoke` → 全绿。
```bash
git add scripts/smoke.mjs
git commit -m "test: 冒烟覆盖深度访谈 Phase B 守卫 + 端到端(对口型成片)"
git checkout master
git merge --no-ff s7-deep-interview -m "merge: S7 深度访谈（实时录音+ASR+追问 + 对口型 liveportrait 影像）"
npm run check && npm test && npm run smoke
git branch -d s7-deep-interview
```

- [ ] **Step 5: 收尾** — 更新记忆（S7 交付、lipsync 能力、liveportrait 探针结论）；重启 preview；汇报。

---

## 自检（spec 覆盖）
- 添加访谈对象(嘉宾) → Task 2(guests) + Task 4(CRUD/形象上传或AI)。✓
- AI 高质量提纲 → Task 3(buildOutlineMessages) + Task 5(建会话出提纲)。✓
- 艺人 TTS 提问 + 开场白 → Task 5(ask, 首轮 opening + hostVoice TTS)。✓
- 麦克风录音 → Task 6(MediaRecorder)。✓
- 录音→ASR → Task 4(transcodeToWav) + Task 5(answer)。✓
- AI 追问到结束 → Task 5(buildNextQuestionMessages/cursor/end + MAX_TURNS)。✓
- 双方文字记录 → Task 5(turns) + Task 6(记录面板)。✓
- AI 语音对谈记录 → Task 8(record 双方重配音)。✓
- 对口型访谈影像 → Task 1(lipsync) + Task 9(video liveportrait 逐轮)。✓
- 测试 → 各 Task 单测 + Task 7/11(冒烟+端到端)。✓

类型一致性：`lipsync`(Task1 注册→Task9 submitJob)、`transcodeToWav`(Task4→Task5 answer)、`saveDataUrl`(Task4→Task5 answer/Task4 portrait)、`hostVoice/assignGuestVoice`(Task3→Task5/8)、turn `{id,speaker,text,audioUrl,lipsyncUrl}`(Task2 store→Task5/8/9 读写)、`curGuestPortrait`(Task2→Task9)、`setTurnMedia`(Task2→Task8/9)、`isMediaPath`(Task4 改造→answer/portrait 大体积放行)。已核实适配器分发结构与 i2v 轮询常量复用。
