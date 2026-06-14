# S6 短剧工坊 Implementation Plan（专业成品）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为艺人产出多集竖屏短剧（AI 选角 + 逐镜真实 i2v 高质量出片 / 低成本静帧两档 + 多角色配音字幕 + 连播合集），端到端本机可验收。

**Architecture:** 复用 S5 compose 的「逐段媒体 → ffmpeg 拼接 → 一次性字幕烧录」SSE 脊柱，扩展成多场景 / 多集；分镜图走 S3 万相 t2i，高质量出片每场景以分镜图为首帧走 P2b 万相 i2v（M1 job 队列），低成本走 ffmpeg `zoompan`。短剧项目以「一项目一文件」持久化（沿用 `assets.js` 风格），含选角 / 分集 / 场景 / 版本。

**Tech Stack:** Node ≥18 原生 http（ESM，零依赖）、DashScope 万相（t2i / i2v / qwen-tts）、ffmpeg（本机 CPU）、node:test 单测、SSE。

参照规格：`docs/superpowers/specs/2026-06-14-s6-drama-studio-design.md`。

复用的既有模式（实现时对照）：
- 持久化：`src/studio/assets.js`（per-file + 原子 tmp→rename + `SAFE_ID`）、`src/studio/artists.js`（id 生成 `crypto.randomBytes(3)`）。
- 纯函数 + 解析：`src/studio/interview.js`（`extractDialogue` 围栏剥离 + 取首个 `{...}`）。
- 成片脊柱：`src/api/routes.js` 的 `POST /api/artist/:id/interview/compose`（SSE / TTS 循环 / ffmpeg concat 重编码 / `buildSrt` 一次性烧字幕 / `os.tmpdir()` / stderr 不外泄）。
- job 队列：`src/gateway/jobs.js`（`submitJob` / `getJob` / `retryJob` / `sanitize`）、`src/api/routes.js` 的 `handleMediaSubmit`（estimate + `confirm_required` 闸门）。
- i2v 适配器：`src/providers/dashscope.js` 的 `invokeVideo`（`imageRef` 首帧、轮询、`ctx.onProgress`）。
- 画廊入库：`src/bootstrap.js` 的 galleryExecutor（job 完成按 capability→type 入画廊）。

约定上限常量（写入 `drama.js`，全程护栏）：`MAX_CAST=3`（不含主演）、`MAX_SCENES=8`、`MAX_LINES_PER_SCENE=6`、`MAX_LINE_CHARS=200`、`MAX_EPISODES=6`。

---

## Task 1: 一致性能力探针 + `invokeImage` 支持 refImages

**目的：** 确定万相在该区是否有可用「图像参考保人物」能力。结果决定 `consistencyMode`。向后兼容：无 refImages 时维持现有 t2i 行为（S3 写真不受影响）。

**Files:**
- Modify: `src/providers/dashscope.js`（`invokeImage`）
- Create: `.test-gen/probe-imageref.mjs`（探针脚本，验证后删除）

- [ ] **Step 1: 先读懂现状**

Run: 阅读 `src/providers/dashscope.js:85-115`（`invokeImage` 仅发 `input:{prompt}`，忽略 `request.refImages`）。

- [ ] **Step 2: 写探针脚本**（用现有 env 的 DASHSCOPE_API_KEY，真实调用，判定图像参考是否在区可用）

Create `.test-gen/probe-imageref.mjs`：

```js
// 探针：万相图像参考/图生图保人物能力是否在区可用。
// 用一张现有 /generated 图当参考，跑「保人物换背景」提示词，看是否被接受且出图。
import { readEnv } from '../src/lib/env.js';
import { GENERATED_DIR } from '../src/lib/paths.js';
import fs from 'node:fs'; import path from 'node:path';

const KEY = readEnv().DASHSCOPE_API_KEY;
if (!KEY) { console.log('NO_KEY'); process.exit(0); }
const BASE = 'https://dashscope.aliyuncs.com';
// 取一张本机已有图转 base64 dataUrl 当参考
const img = fs.readdirSync(GENERATED_DIR).find((f) => /\.(png|jpg|jpeg)$/i.test(f));
if (!img) { console.log('NO_LOCAL_IMAGE 先生成一张写真再跑探针'); process.exit(0); }
const dataUrl = `data:image/${img.split('.').pop()};base64,` + fs.readFileSync(path.join(GENERATED_DIR, img)).toString('base64');

// 候选模型/端点（按文档逐个试；记录哪个被接受）
const candidates = [
  { model: 'wanx2.1-imageedit', url: `${BASE}/api/v1/services/aigc/image2image/image-synthesis`,
    body: { input: { function: 'description_edit', prompt: '同一人物，换到夜晚街道背景，电影感', base_image_url: dataUrl }, parameters: {} } },
  { model: 'wanx-style-repaint', url: `${BASE}/api/v1/services/aigc/image-generation/generation`,
    body: { input: { image_url: dataUrl, style_index: 3 } } },
];
for (const c of candidates) {
  try {
    const r = await fetch(c.url, { method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: c.model, ...c.body }) });
    const j = await r.json();
    console.log(c.model, r.status, JSON.stringify(j).slice(0, 300));
  } catch (e) { console.log(c.model, 'ERR', e.message); }
}
```

- [ ] **Step 3: 跑探针**

Run: `node .test-gen/probe-imageref.mjs`
Expected: 每个候选打印 HTTP 状态 + 响应片段。**判定**：出现 `task_id`（被接受）→ 该模型可用，记下模型名与端点形状；出现 403/AccessDenied/InvalidParameter/模型不存在 → 不可用。

- [ ] **Step 4: 据探针结果实现**

**若可用**——在 `invokeImage` 开头分支（保持无 ref 时原逻辑不变）：

```js
async function invokeImage(request, ctx) {
  const refs = Array.isArray(request.refImages) ? request.refImages.filter(Boolean) : [];
  if (refs.length) return invokeImageRef(request, ctx, refs);   // 探针确认的图像参考路径
  // —— 原有纯 t2i 逻辑保持不变 ——
  ...
}
```

并按探针确认的端点/字段写 `invokeImageRef`（提交 → 轮询 `TASKS/{id}` → 下载，复用本文件已有的 `imgSleep`/`IMG_MAX_MS`/`ctx.saveFile`/`ctx.fetchBuffer` 与轮询骨架）。`config/ai-providers.json` 如需新模型项则补上 image 路由。

**若不可用**——`invokeImage` 不变；refImages 被忽略（一致性走描述级）。在文件顶部加注释说明探针结论与日期。

- [ ] **Step 5: 记录结论**

把结论（`image_ref` 可用的模型名/端点，或 `description` 降级）写入 spec §3 末尾一行「探针结论（2026-06-14）：...」。删除探针脚本：`rm -rf .test-gen`。

- [ ] **Step 6: 验证既有图像未回归**

Run: `npm run check && npm test`
Expected: 全绿（未碰其他逻辑）。

- [ ] **Step 7: Commit**

```bash
git add src/providers/dashscope.js config/ai-providers.json docs/superpowers/specs/2026-06-14-s6-drama-studio-design.md
git commit -m "feat: 万相图像参考探针 + invokeImage 支持 refImages（一致性锁脸）"
```

---

## Task 2: `drama.js` 纯函数 + 单测

**Files:**
- Create: `src/studio/drama.js`
- Test: `test/drama.test.js`

- [ ] **Step 1: 写失败测试**

Create `test/drama.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractScript, assignVoices, estimateEpisodeCost,
  MAX_CAST, MAX_SCENES, MAX_LINES_PER_SCENE,
} from '../src/studio/drama.js';

const artist = { name: '凛', gender: '女', persona: '冷艳电子歌手', visualIdentity: '银发红瞳' };

test('extractScript 解析围栏 JSON 并裁剪上限', () => {
  const raw = '```json\n' + JSON.stringify({
    cast: Array.from({ length: 5 }, (_, i) => ({ name: `配${i}`, role: '配角', appearance: 'x', gender: '男' })),
    episodes: [{ title: '第一集', scenes: Array.from({ length: 12 }, (_, i) => ({
      setting: `场景${i}`, action: 'a',
      lines: Array.from({ length: 9 }, () => ({ character: '凛', text: 't', emotion: 'e' })),
    })) }],
  }) + '\n```';
  const s = extractScript(raw, artist);
  assert.ok(s.cast.length <= MAX_CAST);                          // 配角裁到上限
  assert.equal(s.episodes[0].scenes.length, MAX_SCENES);        // 场景裁到上限
  assert.ok(s.episodes[0].scenes[0].lines.length <= MAX_LINES_PER_SCENE);
});

test('extractScript 无 JSON 抛错', () => {
  assert.throws(() => extractScript('没有对象', artist), /未在响应中找到/);
});

test('assignVoices 主演按性别、配角去重', () => {
  const cast = [
    { id: 'c_lead', isLead: true, gender: '女' },
    { id: 'c_1', isLead: false, gender: '男' },
    { id: 'c_2', isLead: false, gender: '男' },
  ];
  const m = assignVoices(cast, artist);
  assert.equal(m.c_lead, 'Cherry');                 // 女主演
  assert.notEqual(m.c_1, m.c_2);                    // 同性别配角不同音色
  assert.ok(m.__narrator);                          // 旁白有音色
});

test('estimateEpisodeCost 两档', () => {
  const ep = { scenes: [{}, {}, {}] };
  assert.ok(estimateEpisodeCost(ep, 'high') > 0);   // 高质量按 i2v 计费
  assert.equal(estimateEpisodeCost(ep, 'low'), 0);  // 低成本无视频费
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/drama.test.js`
Expected: FAIL（`drama.js` 不存在）。

- [ ] **Step 3: 实现 `src/studio/drama.js`**

```js
// 短剧纯函数：脚本提示词/解析、配音分配、成本估算。无 I/O。
const JSON_ONLY = '只输出一个 JSON 对象，不要额外文字、不要 markdown 围栏。';
export const MAX_CAST = 3;
export const MAX_SCENES = 8;
export const MAX_LINES_PER_SCENE = 6;
export const MAX_LINE_CHARS = 200;
export const MAX_EPISODES = 6;
const I2V_USD_PER_SCENE = 0.5;   // 万相 i2v 单镜量级（接入时校准，与 costs.js 对齐）

const STR = (v) => (typeof v === 'string' ? v : '');

export function buildScriptMessages(artist, brief) {
  const a = artist || {};
  const b = brief || {};
  const system = [
    '你是竖屏短剧的编剧。主演是下面这位虚拟艺人，请创作分集短剧剧本，并设计需要的配角。',
    `主演：${a.name || ''}，性别：${a.gender || ''}，人设：${a.persona || ''}，外观：${a.visualIdentity || ''}，背景：${a.backstory || ''}。`,
    `题材：${b.theme || '都市悬疑'}；集数：${Math.min(b.episodeCount || 1, MAX_EPISODES)}；单集时长约 ${b.durationSec || 90} 秒。`,
    '输出字段：',
    `- cast：配角数组（不含主演，≤${MAX_CAST} 个），每项 {name, role(角色定位), appearance(外观一句), gender}。`,
    `- episodes：分集数组，每项 {title, scenes}；scenes ≤${MAX_SCENES} 个，每项 {setting(镜头/场景), action(动作情绪), characters(出镜角色名数组), lines}；lines ≤${MAX_LINES_PER_SCENE} 句，每句 {character(说话角色名或"旁白"), text(≤${MAX_LINE_CHARS}字), emotion}。`,
    '题材 SFW，不得影射真实公众人物。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `请为主演「${a.name || ''}」创作短剧剧本 JSON。` }] };
}

export function extractScript(text, artist) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) throw new Error('未在响应中找到剧本 JSON');
  let obj; try { obj = JSON.parse(s.slice(i, j + 1)); } catch { throw new Error('剧本 JSON 解析失败'); }
  const cast = (Array.isArray(obj.cast) ? obj.cast : []).slice(0, MAX_CAST).map((c, k) => ({
    name: STR(c.name) || `配角${k + 1}`, role: STR(c.role), appearance: STR(c.appearance), gender: STR(c.gender),
  }));
  const eps = (Array.isArray(obj.episodes) ? obj.episodes : []).slice(0, MAX_EPISODES).map((e, ei) => ({
    title: STR(e.title) || `第${ei + 1}集`,
    scenes: (Array.isArray(e.scenes) ? e.scenes : []).slice(0, MAX_SCENES).map((sc) => ({
      setting: STR(sc.setting), action: STR(sc.action),
      characters: Array.isArray(sc.characters) ? sc.characters.map(STR).filter(Boolean) : [],
      lines: (Array.isArray(sc.lines) ? sc.lines : []).slice(0, MAX_LINES_PER_SCENE).map((l) => ({
        character: STR(l.character) || '旁白', text: STR(l.text).slice(0, MAX_LINE_CHARS), emotion: STR(l.emotion),
      })).filter((l) => l.text),
    })).filter((sc) => sc.lines.length),
  })).filter((e) => e.scenes.length);
  if (!eps.length) throw new Error('剧本无有效场景');
  return { cast, episodes: eps };
}

export function buildCastPortraitPrompt(castMember) {
  const c = castMember || {};
  return `角色定妆照，竖屏半身，${c.appearance || ''}，${c.role || ''}，电影感打光，干净背景，SFW`;
}

export function buildScenePrompt(artist, scene, cast, consistencyMode) {
  const a = artist || {};
  const names = (scene.characters || []);
  const looks = names.map((n) => {
    if (n === a.name || n === '旁白') return a.name === n ? `${a.name}（${a.visualIdentity || ''}）` : '';
    const m = (cast || []).find((c) => c.name === n);
    return m ? `${m.name}（${m.appearance || ''}）` : n;
  }).filter(Boolean).join('，');
  const tag = consistencyMode === 'image_ref' ? '' : '，保持人物外观一致';
  return `竖屏电影分镜：${scene.setting || ''}；${scene.action || ''}；出镜：${looks}${tag}；9:16，电影级打光，SFW`;
}

export function buildI2vPrompt(scene) {
  return `${scene.action || ''}；自然运镜，轻微镜头推移，写实`.trim();
}

const FEMALE_VOICES = ['Cherry', 'Serena'];
const MALE_VOICES = ['Ethan', 'Dylan'];
const isMale = (g) => /男|male/i.test(g || '');

export function assignVoices(cast, artist) {
  const map = {};
  let fi = 0; let mi = 0;
  for (const c of cast || []) {
    const g = c.isLead ? (artist?.gender || c.gender) : c.gender;
    map[c.id] = isMale(g) ? MALE_VOICES[mi++ % MALE_VOICES.length] : FEMALE_VOICES[fi++ % FEMALE_VOICES.length];
  }
  map.__narrator = 'Chelsie';   // 旁白固定
  return map;
}

export function estimateEpisodeCost(episode, tier) {
  const n = (episode?.scenes || []).length;
  return tier === 'high' ? +(n * I2V_USD_PER_SCENE).toFixed(2) : 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/drama.test.js`
Expected: PASS（4 测试）。

- [ ] **Step 5: 全量校验**

Run: `npm run check && npm test`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/studio/drama.js test/drama.test.js
git commit -m "feat: 短剧纯函数（剧本提示词/解析、配音分配、成本估算）"
```

---

## Task 3: `drama-store.js` 持久化（多集 + 版本）+ 接线 + 单测

**Files:**
- Create: `src/studio/drama-store.js`
- Modify: `src/lib/paths.js`（加 `DRAMA_DIR`）、`src/bootstrap.js`（调 `initDrama`）
- Test: `test/drama-store.test.js`

- [ ] **Step 1: 写失败测试**

Create `test/drama-store.test.js`：

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {
  initDrama, createDrama, getDrama, listDramas, updateScene, addFrameVersion, setFrameCurrent,
} from '../src/studio/drama-store.js';

before(() => initDrama(fs.mkdtempSync(path.join(os.tmpdir(), 'drtest_'))));

const parsed = {
  cast: [{ name: '反派', role: '反派', appearance: '黑衣', gender: '男' }],
  episodes: [{ title: '第一集', scenes: [{ setting: 's', action: 'a', characters: ['凛'], lines: [{ character: '凛', text: 't', emotion: 'e' }] }] }],
};

test('createDrama 生成主演+配角 cast 与分集结构', () => {
  const d = createDrama('art_1', { name: '凛', gender: '女', visualIdentity: '银发', portraits: [{ url: '/generated/p.png' }] },
    { theme: 't', durationSec: 90 }, parsed, { voiceMap: { c_lead: 'Cherry', c_1: 'Ethan', __narrator: 'Chelsie' }, consistencyMode: 'description' });
  assert.ok(d.id.startsWith('dr_'));
  assert.equal(d.cast[0].isLead, true);
  assert.equal(d.cast[0].portrait.versions[0].url, '/generated/p.png');   // 主演引用一致性包
  assert.equal(d.episodes[0].scenes[0].clip.status, 'none');
});

test('listDramas 按 artistId 过滤', () => {
  const d = createDrama('art_2', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  assert.ok(listDramas('art_2').some((x) => x.id === d.id));
  assert.ok(!listDramas('art_1').some((x) => x.id === d.id));
});

test('版本：addFrameVersion 追加并可切换 current', () => {
  const d = createDrama('art_3', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  const eid = d.episodes[0].id; const sid = d.episodes[0].scenes[0].id;
  addFrameVersion(d.id, eid, sid, { url: '/generated/f1.png', prompt: 'p1' });
  addFrameVersion(d.id, eid, sid, { url: '/generated/f2.png', prompt: 'p2' });
  let g = getDrama(d.id); const sc = g.episodes[0].scenes[0];
  assert.equal(sc.frame.versions.length, 2);
  assert.equal(sc.frame.current, 1);                 // 默认指向最新
  setFrameCurrent(d.id, eid, sid, 0);
  assert.equal(getDrama(d.id).episodes[0].scenes[0].frame.current, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/drama-store.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/studio/drama-store.js`**（沿用 `assets.js` 的 per-file + 原子写 + `SAFE_ID`）

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let dramaDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const newId = (p) => `${p}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

export function initDrama(dir) {
  dramaDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f)); } catch {}
}

const fileFor = (id) => path.join(dramaDir, `${id}.json`);

export function getDrama(id) {
  if (!dramaDir || !SAFE_ID.test(id)) return null;
  const f = fileFor(id);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function write(d) {
  d.updatedAt = new Date().toISOString();
  const f = fileFor(d.id);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, f);
  return d;
}

export function listDramas(artistId) {
  if (!dramaDir) return [];
  const out = [];
  for (const f of fs.readdirSync(dramaDir)) {
    if (!f.endsWith('.json')) continue;
    try { const d = JSON.parse(fs.readFileSync(path.join(dramaDir, f), 'utf8')); if (d.artistId === artistId) out.push(d); } catch {}
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function createDrama(artistId, artist, brief, parsed, { voiceMap, consistencyMode }) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const now = new Date().toISOString();
  const lead = {
    id: 'c_lead', name: artist?.name || '主演', role: '主演', isLead: true,
    appearance: artist?.visualIdentity || '', gender: artist?.gender || '',
    voice: voiceMap?.c_lead || 'Cherry',
    portrait: { current: 0, versions: artist?.portraits?.[0]?.url
      ? [{ url: artist.portraits[0].url, prompt: '一致性参考包', createdAt: now }] : [] },
  };
  const cast = [lead, ...(parsed.cast || []).map((c, i) => ({
    id: `c_${i + 1}`, name: c.name, role: c.role, isLead: false, appearance: c.appearance, gender: c.gender,
    voice: voiceMap?.[`c_${i + 1}`] || 'Ethan', portrait: { current: -1, versions: [] },
  }))];
  const episodes = (parsed.episodes || []).map((e, ei) => ({
    id: `ep_${ei + 1}`, index: ei + 1, title: e.title, tier: 'high', durationSec: null, episodeUrl: null,
    scenes: (e.scenes || []).map((sc, si) => ({
      id: `s_${si + 1}`, index: si + 1, setting: sc.setting, action: sc.action,
      characters: sc.characters || [], lines: sc.lines || [],
      frame: { current: -1, versions: [] },
      clip: { url: null, jobId: null, status: 'none' },
    })),
  }));
  const d = {
    id: newId('dr'), artistId, schemaVersion: 1, createdAt: now, updatedAt: now,
    title: brief?.title || `${artist?.name || ''}的短剧`, theme: brief?.theme || '', logline: brief?.logline || '',
    status: 'drafting', consistencyMode: consistencyMode || 'description',
    cast, episodes, collectionUrl: null,
  };
  return write(d);
}

export function updateDrama(id, patch) {
  const d = getDrama(id); if (!d) return null;
  Object.assign(d, patch); return write(d);
}

function findScene(d, eid, sid) {
  const ep = d.episodes.find((e) => e.id === eid); if (!ep) return null;
  const sc = ep.scenes.find((s) => s.id === sid); return sc ? { ep, sc } : null;
}

export function updateScene(id, eid, sid, patch) {
  const d = getDrama(id); if (!d) return null;
  const f = findScene(d, eid, sid); if (!f) return null;
  Object.assign(f.sc, patch); return write(d);
}

export function addFrameVersion(id, eid, sid, version) {
  const d = getDrama(id); if (!d) return null;
  const f = findScene(d, eid, sid); if (!f) return null;
  f.sc.frame.versions.push({ url: version.url, prompt: version.prompt || '', createdAt: new Date().toISOString() });
  f.sc.frame.current = f.sc.frame.versions.length - 1;
  return write(d);
}

export function setFrameCurrent(id, eid, sid, idx) {
  const d = getDrama(id); if (!d) return null;
  const f = findScene(d, eid, sid); if (!f) return null;
  if (idx < 0 || idx >= f.sc.frame.versions.length) return d;
  f.sc.frame.current = idx; return write(d);
}

export function addPortraitVersion(id, castId, version) {
  const d = getDrama(id); if (!d) return null;
  const c = d.cast.find((x) => x.id === castId); if (!c) return null;
  c.portrait.versions.push({ url: version.url, prompt: version.prompt || '', createdAt: new Date().toISOString() });
  c.portrait.current = c.portrait.versions.length - 1;
  return write(d);
}

export function curFrameUrl(scene) {
  const v = scene?.frame?.versions; const i = scene?.frame?.current;
  return (v && i >= 0 && v[i]) ? v[i].url : null;
}
```

- [ ] **Step 4: 接线 paths + bootstrap**

`src/lib/paths.js`：仿照已有 `GENERATED_DIR`/assets 目录定义，导出 `DRAMA_DIR`（如 `path.join(DATA_DIR, 'dramas')`，对照文件中既有目录常量命名）。

`src/bootstrap.js`：在初始化 assets 处旁边 `import { initDrama } from './studio/drama-store.js';` 与 `import { DRAMA_DIR } from './lib/paths.js';`，并调用 `initDrama(DRAMA_DIR);`。

- [ ] **Step 5: 跑测试确认通过 + 全量**

Run: `node --test test/drama-store.test.js` → PASS（3 测试）
Run: `npm run check && npm test` → 全绿

- [ ] **Step 6: Commit**

```bash
git add src/studio/drama-store.js test/drama-store.test.js src/lib/paths.js src/bootstrap.js
git commit -m "feat: 短剧持久化（多集+版本，per-file 原子写）+ paths/bootstrap 接线"
```

---

## Task 4: 端点 — script / 列表 / 详情 / PUT 编辑

**Files:**
- Modify: `src/api/routes.js`（import + 4 端点）

- [ ] **Step 1: 加 import**（文件顶部，与既有 studio import 同区）

```js
import { buildScriptMessages, extractScript, assignVoices, estimateEpisodeCost } from '../studio/drama.js';
import {
  createDrama, getDrama, listDramas, updateDrama, updateScene,
  addFrameVersion, setFrameCurrent, addPortraitVersion, curFrameUrl,
} from '../studio/drama-store.js';
import { buildCastPortraitPrompt, buildScenePrompt, buildI2vPrompt } from '../studio/drama.js';
```

- [ ] **Step 2: 加 script 端点**（艺人守卫与既有 interview 端点一致）

```js
  route('POST /api/artist/:id/drama/script', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    try {
      const { system, messages } = buildScriptMessages(artist, body.brief || {});
      const r = await execute('content', { system, messages, maxTokens: 3000 });
      let parsed; try { parsed = extractScript(r.text, artist); }
      catch (e) { return jsonError(res, 'provider_error', `剧本解析失败：${e.message}`); }
      // 先建临时 cast（带 id）以便分配音色
      const tmpCast = [{ id: 'c_lead', isLead: true, gender: artist.gender },
        ...parsed.cast.map((c, i) => ({ id: `c_${i + 1}`, isLead: false, gender: c.gender }))];
      const voiceMap = assignVoices(tmpCast, artist);
      const drama = createDrama(params.id, artist, body.brief || {}, parsed, { voiceMap, consistencyMode: 'description' });
      json(res, { drama });
    } catch (e) { sendGatewayError(res, e); }
  });
```

注：`consistencyMode` 暂固定 `'description'`；Task 1 探针若可用，改为读取探测结论（实现时按 Task 1 结果填）。

- [ ] **Step 3: 加 列表/详情/PUT**

```js
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
```

- [ ] **Step 4: 手测**

Run（需服务器在跑，端口自定）：
```bash
PORT=3193 node server.js & sleep 2
AID=$(curl -s -X POST localhost:3193/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"剧测","gender":"女","visualIdentity":"银发"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
curl -s -X POST localhost:3193/api/artist/$AID/drama/script -H 'Content-Type: application/json' -d '{"brief":{"theme":"都市悬疑","episodeCount":1,"durationSec":60}}' | head -c 400
curl -s localhost:3193/api/artist/$AID/dramas | head -c 200
```
Expected: script 返回含 `drama.id`/`cast`/`episodes`；dramas 列表含该项。

- [ ] **Step 5: 全量 + Commit**

Run: `npm run check && npm test` → 全绿
```bash
git add src/api/routes.js
git commit -m "feat: 短剧端点（剧本生成/列表/详情/编辑）"
```

---

## Task 5: 端点 — cast 选角出图（成本闸门 + 版本）

**Files:**
- Modify: `src/api/routes.js`

- [ ] **Step 1: 加 cast 端点（SSE，逐配角出定妆照）**

```js
  route('POST /api/artist/:id/drama/:did/cast', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const todo = d.cast.filter((c) => !c.isLead && c.portrait.current < 0);   // 主演与已出图者跳过
    const estimate = { capability: 'image', count: todo.length, estimatedUsd: estimateFor('image', { count: todo.length }).estimatedUsd };
    if (body.confirm !== true) return json(res, { error: { code: 'confirm_required', message: '需确认选角出图成本', estimate } });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      for (let i = 0; i < todo.length; i++) {
        const c = todo[i];
        send('stage', { progress: Math.round(i / todo.length * 100), msg: `选角出图 ${i + 1}/${todo.length}：${c.name}` });
        const r = await execute('image', { prompt: buildCastPortraitPrompt(c), aspect: '9:16' });
        const url = r.files?.[0]?.url;
        if (!url) throw new Error('未返回定妆照');
        addPortraitVersion(params.did, c.id, { url, prompt: buildCastPortraitPrompt(c) });
        addAssets(params.id, [{ type: 'photo', url, prompt: `选角：${c.name}`, title: c.name }]);
      }
      updateDrama(params.did, { status: 'cast_ready' });
      send('done', { drama: getDrama(params.did) });
    } catch (e) {
      if (e instanceof GatewayError) send('error', e.toJSON());
      else { console.error('[drama] 选角失败', e.message); send('error', { code: 'internal', message: '选角出图失败，请重试' }); }
    } finally { res.end(); }
  });
```

注：`estimateFor('image', { count })` 已被支持——`costs.js` 的 `estimateRequest('image', …, {count})` 即 `perImage * count`（wan2.2-t2i-flash perImage=0.03）。无需改 costs.js。

- [ ] **Step 2: 手测**（confirm 闸门 + 真实出图，配角 ≤1 控成本）

```bash
# 用 Task4 的 $AID/$DID；先不带 confirm 看闸门，再带 confirm 真跑
curl -s -X POST localhost:3193/api/artist/$AID/drama/$DID/cast -H 'Content-Type: application/json' -d '{}' | head -c 200
curl -s -N -X POST localhost:3193/api/artist/$AID/drama/$DID/cast -H 'Content-Type: application/json' -d '{"confirm":true}' | head -c 400
```
Expected: 无 confirm→`confirm_required`+estimate；confirm→SSE `stage...done`，配角 portrait 有版本，画廊新增 photo。

- [ ] **Step 3: 全量 + Commit**

Run: `npm run check && npm test` → 全绿
```bash
git add src/api/routes.js
git commit -m "feat: 短剧选角出图端点（成本闸门+定妆照版本+入画廊）"
```

---

## Task 6: 端点 — storyboard 分镜出图（成本闸门 + 版本）+ scene reframe

**Files:**
- Modify: `src/api/routes.js`

- [ ] **Step 1: 加 storyboard 端点**

```js
  route('POST /api/artist/:id/drama/:did/episode/:eid/storyboard', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const ep = d.episodes.find((e) => e.id === params.eid);
    if (!ep) return jsonError(res, 'not_found', '无此分集');
    const todo = ep.scenes.filter((s) => s.frame.current < 0);
    const estimate = { capability: 'image', count: todo.length, estimatedUsd: estimateFor('image', { count: todo.length }).estimatedUsd };
    if (body.confirm !== true) return json(res, { error: { code: 'confirm_required', message: '需确认分镜出图成本', estimate } });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      for (let i = 0; i < todo.length; i++) {
        const sc = todo[i];
        send('stage', { progress: Math.round(i / todo.length * 100), msg: `分镜出图 ${i + 1}/${todo.length}` });
        const prompt = buildScenePrompt(artist, sc, d.cast, d.consistencyMode);
        // image_ref 模式下带出镜角色定妆照为参考（主演取一致性包，配角取定妆照当前版本）
        const refImages = d.consistencyMode === 'image_ref'
          ? sc.characters.map((n) => {
              const c = d.cast.find((x) => x.name === n);
              const v = c?.portrait?.versions?.[c.portrait.current];
              return v?.url;
            }).filter(Boolean) : [];
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
```

- [ ] **Step 2: 加 reframe 端点（单格重抽，追加版本）**

```js
  route('POST /api/artist/:id/drama/:did/episode/:eid/scene/:sid/reframe', async (req, res, { params }) => {
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const ep = d.episodes.find((e) => e.id === params.eid);
    const sc = ep?.scenes.find((s) => s.id === params.sid);
    if (!sc) return jsonError(res, 'not_found', '无此场景');
    try {
      const prompt = buildScenePrompt(artist, sc, d.cast, d.consistencyMode);
      const r = await execute('image', { prompt, aspect: '9:16' });
      const url = r.files?.[0]?.url;
      if (!url) return jsonError(res, 'provider_error', '未返回分镜图');
      const drama = addFrameVersion(params.did, params.eid, params.sid, { url, prompt });
      json(res, { drama });
    } catch (e) { sendGatewayError(res, e); }
  });
```

- [ ] **Step 3: 加版本切换端点**

```js
  route('POST /api/artist/:id/drama/:did/episode/:eid/scene/:sid/frame', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const d = getDrama(params.did);
    if (!d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const drama = setFrameCurrent(params.did, params.eid, params.sid, Number(body.index));
    drama ? json(res, { drama }) : jsonError(res, 'not_found', '无此场景');
  });
```

- [ ] **Step 4: 手测 + 全量 + Commit**

手测：confirm 闸门→SSE 出分镜；reframe 追加版本；frame 切 current。
Run: `npm run check && npm test` → 全绿
```bash
git add src/api/routes.js
git commit -m "feat: 短剧分镜出图（成本闸门+版本）+ 单格重抽 + 版本切换"
```

---

## Task 7: 端点 — compose 成片 SSE（两档）+ 入画廊

**Files:**
- Modify: `src/api/routes.js`

复用 S5 compose 的：`os.tmpdir()` 临时目录、`buildSrt` 一次性烧字幕、ffmpeg concat 重编码、stderr 不外泄。新增：两档片段生成（高质量 i2v job / 低成本 zoompan）。

- [ ] **Step 1: 加 compose 端点**

```js
  route('POST /api/artist/:id/drama/:did/episode/:eid/compose', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    const ep = d.episodes.find((e) => e.id === params.eid);
    if (!ep) return jsonError(res, 'not_found', '无此分集');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg，请安装后重启服务');
    const tier = body.tier === 'low' ? 'low' : 'high';
    const scenes = ep.scenes;
    if (!scenes.length) return jsonError(res, 'bad_request', '本集无场景');
    if (scenes.some((s) => curFrameUrl(s) === null)) return jsonError(res, 'bad_request', '存在未出分镜图的场景，请先完成分镜');
    if (tier === 'high') {
      const estimate = estimateEpisodeCost(ep, 'high');
      if (body.confirm !== true) return json(res, { error: { code: 'confirm_required', message: '需确认整集 i2v 出片成本', estimate: { capability: 'video', count: scenes.length, estimatedUsd: estimate } } });
    }
    const voiceFor = (charName) => {
      if (charName === '旁白') return 'Chelsie';
      const c = d.cast.find((x) => x.name === charName);
      return c?.voice || (artist.gender?.match(/男|male/i) ? 'Ethan' : 'Cherry');
    };

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr_'));
    try {
      const sceneClips = [];          // 各场景最终片段（含音轨）
      const srtSegs = [];             // 整集字幕（累计时间）
      for (let si = 0; si < scenes.length; si++) {
        const sc = scenes[si];
        send('stage', { stage: 'scene', progress: Math.round(si / scenes.length * 80), msg: `场景 ${si + 1}/${scenes.length}` });
        // 1) 本场景逐行配音 → 拼成本场景音轨 + 收集字幕
        const lineFiles = [];
        for (const line of sc.lines) {
          const r = await execute('tts', { text: line.text, voice: voiceFor(line.character) });
          const u = r.files?.[0]?.url; if (!u) throw new Error('TTS 未返回音频');
          const abs = path.join(GENERATED_DIR, u.replace('/generated/', ''));
          lineFiles.push({ file: abs, text: line.text, durationSec: probeDurationSec(abs) });
        }
        const sceneAudio = path.join(tmp, `a_${si}.mp3`);
        const alist = path.join(tmp, `al_${si}.txt`);
        fs.writeFileSync(alist, lineFiles.map((l) => `file '${l.file.replace(/\\/g, '/')}'`).join('\n'));
        runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', alist, '-c:a', 'libmp3lame', '-ar', '44100', sceneAudio]);
        const sceneDur = lineFiles.reduce((a, l) => a + l.durationSec, 0);
        // 累计字幕
        let base = srtSegs.reduce((a, s) => a + s.durationSec, 0);
        for (const l of lineFiles) { srtSegs.push({ text: l.text, durationSec: l.durationSec }); }
        // 2) 本场景画面
        const frameAbs = path.join(GENERATED_DIR, curFrameUrl(sc).replace('/generated/', ''));
        const clip = path.join(tmp, `c_${si}.mp4`);
        if (tier === 'high') {
          // 高质量：分镜图首帧 → i2v job（base64 dataUrl）
          // 注意：请求里【不放】artistId —— 否则 bootstrap 的 galleryExecutor 会把每个中间 i2v 片段当 video 资产塞进画廊（污染）。只让最终成片入库。
          send('stage', { stage: 'scene', progress: Math.round(si / scenes.length * 80) + 2, msg: `场景 ${si + 1} 生成视频中` });
          const dataUrl = generatedUrlToDataUrl(GENERATED_DIR, curFrameUrl(sc));
          const job = submitJob('video', { imageRef: dataUrl, prompt: buildI2vPrompt(sc), durationSec: 5, aspect: '9:16' });
          const vurl = await waitJob(job.id);    // 见 Step 2 辅助函数
          const vAbs = path.join(GENERATED_DIR, vurl.replace('/generated/', ''));
          // i2v 片段贴上本场景音轨（视频时长以 i2v 为准，音频 -shortest）
          runFfmpeg(['-y', '-i', vAbs, '-i', sceneAudio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', '-c:a', 'aac', '-shortest', clip], 300000);
        } else {
          // 低成本：静帧 Ken-Burns，时长=本场景配音
          runFfmpeg(['-y', '-loop', '1', '-i', frameAbs, '-i', sceneAudio,
            '-vf', `scale=900:1600,zoompan=z='min(zoom+0.0008,1.15)':d=${Math.max(1, Math.round(sceneDur * 25))}:s=720x1280,format=yuv420p`,
            '-c:v', 'libx264', '-tune', 'stillimage', '-c:a', 'aac', '-shortest', clip], 300000);
        }
        sceneClips.push(clip);
      }
      // 3) 拼接全场景
      send('stage', { stage: 'concat', progress: 84, msg: '拼接全集' });
      const clipList = path.join(tmp, 'clips.txt');
      fs.writeFileSync(clipList, sceneClips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
      const merged = path.join(tmp, 'merged.mp4');
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', clipList, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', merged], 300000);
      // 4) 一次性烧字幕
      send('stage', { stage: 'subtitle', progress: 92, msg: '烧录字幕' });
      const srtFile = path.join(tmp, 'sub.srt');
      fs.writeFileSync(srtFile, buildSrt(srtSegs));
      const name = `dr_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      const srtEsc = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
      runFfmpeg(['-y', '-i', merged, '-vf', `subtitles='${srtEsc}'`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', outAbs], 300000);
      const totalSec = srtSegs.reduce((a, s) => a + s.durationSec, 0);
      addAssets(params.id, [{ type: 'drama', url: `/generated/${name}`, durationSec: Math.round(totalSec), title: `${d.title} · ${ep.title}` }]);
      // 写回该集成片（整体重写 episodes 数组）
      const dd = getDrama(params.did);
      const e2 = dd.episodes.find((e) => e.id === params.eid);
      e2.episodeUrl = `/generated/${name}`; e2.durationSec = Math.round(totalSec); e2.tier = tier;
      updateDrama(params.did, { episodes: dd.episodes, status: 'episode_in_progress' });
      send('done', { url: `/generated/${name}`, durationSec: Math.round(totalSec) });
    } catch (e) {
      if (e instanceof GatewayError) send('error', e.toJSON());
      else { console.error('[drama] 成片失败', e.message); send('error', { code: 'internal', message: '成片失败，请重试' }); }
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      res.end();
    }
  });
```

- [ ] **Step 2: 加 job 等待辅助函数**（文件内，compose 之上）

```js
// 轮询等待一个 media job 完成，返回首个产物 url；失败抛错。
// 字段名按 src/gateway/jobs.js：status ∈ queued|running|done|failed|interrupted；result.files[0].url；error.message。
async function waitJob(jobId, timeoutMs = 8 * 60 * 1000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const job = getJob(jobId);
    if (!job) throw new Error('job 丢失');
    if (job.status === 'done') {
      const url = job.result?.files?.[0]?.url;
      if (!url) throw new Error('job 完成但无产物');
      return url;
    }
    if (job.status === 'failed' || job.status === 'interrupted') throw new Error(job.error?.message || 'job 失败');
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('job 等待超时');
}
```

`getJob` 已在文件顶部从 `../gateway/jobs.js` 导入（既有 jobs 端点用过）；`submitJob` 同源，确认已在 import 列表。

- [ ] **Step 3: 端到端实测（控成本：1 集 3 场景，先低成本档，再高质量档）**

```bash
# 低成本档（不烧 i2v 钱，先验脊柱）
curl -s -N -X POST localhost:3193/api/artist/$AID/drama/$DID/episode/ep_1/compose -H 'Content-Type: application/json' -d '{"tier":"low"}'
# 高质量档（真烧 i2v，确认闸门后）
curl -s -X POST localhost:3193/api/artist/$AID/drama/$DID/episode/ep_1/compose -H 'Content-Type: application/json' -d '{"tier":"high"}' | head -c 200   # 看 confirm_required
curl -s -N -X POST localhost:3193/api/artist/$AID/drama/$DID/episode/ep_1/compose -H 'Content-Type: application/json' -d '{"tier":"high","confirm":true}'
```
Expected: 低成本→SSE 直接出片；高质量→先 `confirm_required`，确认后逐场景 i2v job + 拼接 + 烧字幕 → `done` 带 url。产物 MP4 存在且可播，入画廊 `type:'drama'`。

- [ ] **Step 4: 全量 + Commit**

Run: `npm run check && npm test` → 全绿
```bash
git add src/api/routes.js
git commit -m "feat: 短剧成片 compose SSE（高质量 i2v / 低成本静帧两档，多角色配音+一次性字幕，入画廊）"
```

---

## Task 8: 端点 — collection 连播合集

**Files:**
- Modify: `src/api/routes.js`

- [ ] **Step 1: 加 collection 端点**

```js
  route('POST /api/artist/:id/drama/:did/collection', async (req, res, { params }) => {
    const d = getDrama(params.did);
    if (!d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg');
    const done = d.episodes.filter((e) => e.episodeUrl);
    if (done.length < 1) return jsonError(res, 'bad_request', '尚无已成片的分集');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drc_'));
    try {
      const list = path.join(tmp, 'eps.txt');
      fs.writeFileSync(list, done.map((e) => `file '${path.join(GENERATED_DIR, e.episodeUrl.replace('/generated/', '')).replace(/\\/g, '/')}'`).join('\n'));
      const name = `drc_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outAbs], 600000);
      const totalSec = done.reduce((a, e) => a + (e.durationSec || 0), 0);
      addAssets(params.id, [{ type: 'drama', url: `/generated/${name}`, durationSec: totalSec, title: `${d.title} · 连播合集` }]);
      const drama = updateDrama(params.did, { collectionUrl: `/generated/${name}`, status: 'done' });
      json(res, { url: `/generated/${name}`, drama });
    } catch (e) {
      console.error('[drama] 连播失败', e.message);
      jsonError(res, 'internal', '连播合集生成失败');
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  });
```

- [ ] **Step 2: 手测 + 全量 + Commit**

手测：先成片 2 集，再 `POST .../collection` → 返回合集 url，画廊新增 drama 合集。
Run: `npm run check && npm test` → 全绿
```bash
git add src/api/routes.js
git commit -m "feat: 短剧连播合集端点（ffmpeg concat 全集→入画廊）"
```

---

## Task 9: 前端短剧工坊 + 画廊 drama 瓦片

**Files:**
- Modify: `prototype/index.html`、`prototype/app.js`、`prototype/styles.css`

参照既有「访谈工作室」实现（`initInterviewStudio` + 5 阶段 stepper + SSE reader）。短剧为 7 阶段：立项→剧本→选角→分镜→出片→成片→连播。

- [ ] **Step 1: index.html 加短剧视图容器**

在既有视图区（与访谈视图同级）加 `<section id="view-drama" class="view" hidden>`，含：stepper 容器、立项表单、剧本编辑区、选角卡片区、分镜网格、出片档位选择 + 成本确认、成片播放器、分集列表 + 连播按钮。左导航加「短剧工坊」入口（对照既有导航项写法）。

- [ ] **Step 2: app.js 加 `initDramaStudio()`**

实现要点（对照 `initInterviewStudio` 的 fetch + SSE 模式）：
- 立项表单 → `POST /api/artist/:id/drama/script` → 渲染 cast/episodes。
- 选角按钮 → 先 `POST .../cast`（无 confirm）取 estimate 弹确认 → 确认后带 `confirm:true` 读 SSE 进度。
- 分镜按钮 → `POST .../episode/:eid/storyboard` 同样 confirm + SSE；单格「重抽」→ `POST .../scene/:sid/reframe`；版本切换 → `POST .../scene/:sid/frame {index}`。
- 出片：选档位（high/low）→ high 先取 `confirm_required` 弹整集成本确认 → SSE 进度（场景/拼接/字幕）→ 完成放播放器。
- 连播：`POST .../collection` → 放合集。
SSE reader 复用访谈的 `ReadableStream`/`event:`/`data:` 解析逻辑。

- [ ] **Step 3: styles.css 加短剧样式**

cast 卡片网格、分镜网格（缩略图 + 重抽/版本角标）、档位切换按钮、成本确认条——复用既有设计 tokens（紫 #7c5cff / 青 #26d6c4），对照访谈/写真已有类名扩展。

- [ ] **Step 4: 画廊 drama 瓦片**

在 app.js 画廊渲染处，为 `asset.type === 'drama'` 渲染竖屏 `<video>` 瓦片（复用 video 瓦片样式）。

- [ ] **Step 5: 预览验证**

用 preview 工具：重启服务器 → 打开短剧工坊 → 截图确认布局；控制台无报错。

- [ ] **Step 6: Commit**

```bash
git add prototype/index.html prototype/app.js prototype/styles.css
git commit -m "feat: 短剧工坊前端（7 阶段管线 + 选角/分镜版本 + 两档出片 + 连播）+ 画廊 drama 瓦片"
```

---

## Task 10: 冒烟守卫 + 端到端实测 + 验收合并

**Files:**
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: 加冒烟守卫**（沿用既有 `call`/`ok` 写法，放在删除艺人之前、用既有 `created.data.id`）

```js
  const drMissArtist = await call('/api/artist/nope_x/drama/script', { brief: {} });
  ok('短剧剧本未知艺人→not_found', drMissArtist.status === 200 && drMissArtist.data.error?.code === 'not_found', drMissArtist.data.error?.code);

  const drList = await call(`/api/artist/${created.data.id}/dramas`);
  ok('短剧列表可读', drList.status === 200 && Array.isArray(drList.data.dramas));

  const drGetMiss = await call(`/api/artist/${created.data.id}/drama/nope_x`);
  ok('短剧详情未知→not_found', drGetMiss.status === 200 && drGetMiss.data.error?.code === 'not_found', drGetMiss.data.error?.code);
```

（compose/collection 守卫需先有 drama，冒烟不真出图；上面三条覆盖路由守卫即可，避免冒烟烧钱/依赖 ffmpeg。）

- [ ] **Step 2: 跑冒烟**

Run: `npm run smoke`
Expected: 全部通过（新增 3 条）。

- [ ] **Step 3: 端到端实测（本机真实能力，控成本小规模）**

依次：建艺人→出 1 张写真（作主演一致性包）→`drama/script`（1 集 3 场景 + 1 配角）→`cast`（confirm 真出 1 配角定妆照）→`storyboard`（confirm 真出 3 分镜）→`compose tier=low`（验脊柱）→`compose tier=high`（confirm 真出 3 镜 i2v，得单集 MP4）→ 第二集同样成片 →`collection`（连播）。逐项确认：产物 MP4 可播、入画廊、版本回退可用、断点续作（改一行台词后重 compose）可用。记录一致性探针结论与成本。

- [ ] **Step 4: 全量绿线**

Run: `npm run check && npm test && npm run smoke`
Expected: 全绿。

- [ ] **Step 5: 合并到 master**

```bash
git checkout master
git merge --no-ff s6-drama-studio -m "merge: S6 短剧工坊（完整选角+逐镜 i2v 高质量/低成本两档+多集连播+版本管理）"
npm run check && npm test && npm run smoke
git branch -d s6-drama-studio
```

- [ ] **Step 6: 收尾**

更新记忆（S6 完成、五条生产线全交付、一致性探针结论）；重启 preview 服务器；向用户汇报。

---

## 自检（spec 覆盖）

- 多集 + 连播 → Task 3(数据模型 episodes[])/7(逐集 compose)/8(collection)。✓
- 两档出片 PS-4 → Task 7(tier high/low) + Task 2(estimateEpisodeCost)。✓
- 一致性 PS-1 + 探针 → Task 1(探针+invokeImage refImages) + Task 6(storyboard 带 refImages)。✓
- 资产版本 PS-3 → Task 3(frame/portrait versions) + Task 6(reframe/版本切换)。✓
- 异步进度 PS-5 → Task 7(i2v job 队列 + waitJob + SSE)。✓
- 成本闸门 → Task 5/6(出图 confirm) + Task 7(整集 i2v confirm)。✓
- 多角色配音 → Task 2(assignVoices) + Task 7(voiceFor)。✓
- 选角 → Task 2(剧本生成 cast) + Task 5(定妆照)。✓
- 前端 7 阶段 → Task 9。✓
- 测试 → Task 2/3(单测) + Task 10(冒烟 + 端到端)。✓

类型一致性核对：`curFrameUrl`(Task3 定义→Task6/7 用)、`waitJob`(Task7 定义+用)、`consistencyMode`(Task3 存→Task6 读)、`tier`(Task2 估算→Task7 用)。已核实的既有 API：job 字段 `status/result.files[].url/error.message`（jobs.js）、`submitJob(cap, request, {estimate})`（artistId 放 request 才会自动入画廊——故中间 i2v 不放）、`estimateRequest('image',{count})`=perImage×count（costs.js，无需改）、`generatedUrlToDataUrl(GENERATED_DIR, url)`（files.js）、galleryExecutor 按 capability→type 入画廊（bootstrap.js）。
