# S1 艺人创设 + 档案 + 一致性参考包 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付「对话式访谈捣人 → 生成完整虚拟艺人档案 → 定妆照（一致性参考包雏形）」的端到端能力，作为艺人创作工作室的地基。

**Architecture:** 在已合并的 M1 能力网关之上，新增 `src/studio/` 模块（艺人档案的 schema/原子读写 + 访谈/结构化抽取提示词），通过 `execute('content')` 跑访谈与档案生成、`execute('image')` 出定妆照，新增 artist REST 端点，前端工作台加「艺人」主区。零 npm 依赖、Node ≥18 ESM，沿用 M1 全部约定。

**Tech Stack:** Node 18+ ESM、node:test、原生 `http`、JSON 文件存档（`data/artists.json`，原子写）、原生 JS 前端。

**通用约定（所有任务遵守）：**
- 应用层错误一律 HTTP 200 + `{ "error": { "code", "message" } }`；400 仅 JSON 解析失败/请求体过大，404 未知路由。
- 测试命令：`npm test`（= `node --test`，发现 `test/*.test.js`）；语法检查：`npm run check`；冒烟：`npm run smoke`。工作目录 `F:\projects\Starstudio`。
- 提交信息以 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 结尾。不要 push。
- 所有前端动态字符串用既有 `esc()` 转义；media 用既有 `mediaHtml`。
- artist 相关端点 body 小（文本/dataUrl 缩略），**不**加入 `MEDIA_BODY_PATHS`（保持 1MB 上限即可）。

---

## 文件总览

| 文件 | 职责 | 引入任务 |
|---|---|---|
| `src/studio/artists.js` | 艺人档案 schema 校验 + `data/artists.json` 原子读写 + CRUD + 定妆照追加 | 1 |
| `test/artists.test.js` | artists.js 单测 | 1 |
| `src/studio/artist-create.js` | 访谈/结构化抽取提示词构造 + AI 文本中提取档案 JSON + 定妆照提示词 | 2 |
| `test/artist-create.test.js` | artist-create.js 单测 | 2 |
| `src/api/routes.js` | 追加 artist 端点（interview/finalize/CRUD/portrait） | 3 |
| `src/bootstrap.js` | 启动时 `initArtists` | 3 |
| `prototype/{index.html,app.js,styles.css}` | 「艺人」主区（创设对话 + 档案编辑 + 定妆照 + 列表） | 4 |
| `scripts/smoke.mjs` | 扩冒烟：artist CRUD + 无 key 降级 | 5 |

---

### Task 1: 艺人档案 schema 与原子读写（src/studio/artists.js）

**Files:**
- Create: `src/studio/artists.js`
- Test: `test/artists.test.js`

- [ ] **Step 1: 写失败测试** — `test/artists.test.js`：

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initArtists, validateProfile, createArtist, listArtists,
  getArtist, updateArtist, deleteArtist, addPortrait,
} from '../src/studio/artists.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssart-')), 'artists.json');
}

beforeEach(() => initArtists(tmpFile()));

test('validateProfile 要求非空艺名，补全默认字段', () => {
  assert.throws(() => validateProfile({ name: '   ' }), /艺名/);
  assert.throws(() => validateProfile(null), /对象/);
  const v = validateProfile({ name: 'LUMI', personality: ['冷', 123], portraits: [{ url: '/x.png' }, { nope: 1 }] });
  assert.equal(v.name, 'LUMI');
  assert.equal(v.schemaVersion, 1);
  assert.deepEqual(v.personality, ['冷']);              // 非字符串被过滤
  assert.equal(v.portraits.length, 1);                  // 无 url 的被过滤
  assert.equal(v.voiceProfile.ttsVoice, null);
  assert.equal(v.visualIdentity, '');                    // 缺字段补空串
});

test('CRUD 走通并持久化', () => {
  const a = createArtist({ name: 'NOVA', persona: '元气' });
  assert.match(a.id, /^art_/);
  assert.ok(a.createdAt && a.updatedAt);
  assert.equal(listArtists().length, 1);
  assert.equal(getArtist(a.id).persona, '元气');

  const u = updateArtist(a.id, { persona: '元气少女', visualIdentity: '银发' });
  assert.equal(u.persona, '元气少女');
  assert.equal(u.visualIdentity, '银发');
  assert.equal(u.id, a.id);                              // id 不变
  assert.equal(u.createdAt, a.createdAt);                // createdAt 不变

  assert.equal(updateArtist('nope', {}), null);
  assert.equal(deleteArtist(a.id), true);
  assert.equal(deleteArtist(a.id), false);
  assert.equal(listArtists().length, 0);
});

test('addPortrait 追加定妆照', () => {
  const a = createArtist({ name: 'IRIS' });
  const r = addPortrait(a.id, { url: '/generated/p1.png', prompt: '知性' });
  assert.equal(r.portraits.length, 1);
  assert.equal(r.portraits[0].url, '/generated/p1.png');
  assert.ok(r.portraits[0].createdAt);
  assert.equal(addPortrait('nope', { url: '/x' }), null);
});

test('坏存档文件不崩，按空数组处理', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ broken');
  initArtists(f);
  assert.deepEqual(listArtists(), []);
  const a = createArtist({ name: 'RAY' });               // 仍可写入
  assert.equal(listArtists().length, 1);
  assert.ok(getArtist(a.id));
});
```

- [ ] **Step 2: 运行确认失败** — `npm test` → artists 测试 FAIL（模块不存在）。

- [ ] **Step 3: 实现** — `src/studio/artists.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let artistsFile = null;

export function initArtists(file) {
  artistsFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

const STR = (v) => (typeof v === 'string' ? v : '');

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('档案必须是对象');
  const name = STR(profile.name).trim();
  if (!name) throw new Error('艺名（name）必填');
  return {
    schemaVersion: 1,
    name,
    gender: STR(profile.gender),
    persona: STR(profile.persona),
    positioning: STR(profile.positioning),
    backstory: STR(profile.backstory),
    personality: Array.isArray(profile.personality) ? profile.personality.filter((x) => typeof x === 'string') : [],
    coreAppeal: STR(profile.coreAppeal),
    speakingStyle: STR(profile.speakingStyle),
    voiceProfile: {
      description: STR(profile.voiceProfile?.description),
      ttsVoice: profile.voiceProfile?.ttsVoice ?? null,
    },
    visualIdentity: STR(profile.visualIdentity),
    musicStyle: STR(profile.musicStyle),
    portraits: Array.isArray(profile.portraits)
      ? profile.portraits.filter((p) => p && typeof p.url === 'string')
          .map((p) => ({ url: p.url, prompt: STR(p.prompt), createdAt: p.createdAt || new Date().toISOString() }))
      : [],
  };
}

export function readArtists() {
  if (!artistsFile || !fs.existsSync(artistsFile)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(artistsFile, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeArtists(arr) {
  const tmp = `${artistsFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, artistsFile);     // 原子替换，避免半写损坏
}

export function listArtists() { return readArtists(); }
export function getArtist(id) { return readArtists().find((a) => a.id === id) || null; }

export function createArtist(profile) {
  const v = validateProfile(profile);
  const now = new Date().toISOString();
  const artist = { id: `art_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, ...v, createdAt: now, updatedAt: now };
  const arr = readArtists();
  arr.push(artist);
  writeArtists(arr);
  return artist;
}

export function updateArtist(id, profile) {
  const arr = readArtists();
  const i = arr.findIndex((a) => a.id === id);
  if (i === -1) return null;
  const v = validateProfile({ ...arr[i], ...profile });
  arr[i] = { ...v, id, createdAt: arr[i].createdAt, updatedAt: new Date().toISOString() };
  writeArtists(arr);
  return arr[i];
}

export function deleteArtist(id) {
  const arr = readArtists();
  const next = arr.filter((a) => a.id !== id);
  if (next.length === arr.length) return false;
  writeArtists(next);
  return true;
}

export function addPortrait(id, portrait) {
  const arr = readArtists();
  const i = arr.findIndex((a) => a.id === id);
  if (i === -1) return null;
  arr[i].portraits = arr[i].portraits || [];
  arr[i].portraits.push({ url: portrait.url, prompt: STR(portrait.prompt), createdAt: new Date().toISOString() });
  arr[i].updatedAt = new Date().toISOString();
  writeArtists(arr);
  return arr[i];
}
```

- [ ] **Step 4: 运行通过** — `npm test`（artists 测试全过）+ `npm run check`。

- [ ] **Step 5: Commit**

```bash
git add src/studio/artists.js test/artists.test.js
git commit -m "feat: 艺人档案 schema 与 data/artists.json 原子读写（PS-1 地基）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 访谈与结构化抽取提示词（src/studio/artist-create.js）

**Files:**
- Create: `src/studio/artist-create.js`
- Test: `test/artist-create.test.js`

- [ ] **Step 1: 写失败测试** — `test/artist-create.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInterviewMessages, buildFinalizeMessages, extractProfileJson, buildPortraitPrompt,
} from '../src/studio/artist-create.js';

test('buildInterviewMessages 注入访谈系统提示词并透传历史', () => {
  const r = buildInterviewMessages([{ role: 'user', content: '我想要个冷艳的歌手' }]);
  assert.match(r.system, /虚拟艺人/);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].content, '我想要个冷艳的歌手');
  const empty = buildInterviewMessages(undefined);
  assert.deepEqual(empty.messages, []);
});

test('buildFinalizeMessages 把对话历史格式化进 user 消息', () => {
  const r = buildFinalizeMessages([
    { role: 'assistant', content: '你想要怎样的艺人？' },
    { role: 'user', content: '冷艳电子歌手' },
  ]);
  assert.match(r.system, /JSON/);
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].content, /冷艳电子歌手/);
  assert.match(r.messages[0].content, /企划|玩家/);
  // 也接受纯字符串 transcript
  const s = buildFinalizeMessages('我要个元气少女');
  assert.match(s.messages[0].content, /元气少女/);
});

test('extractProfileJson 容忍围栏与多余文字', () => {
  assert.deepEqual(extractProfileJson('{"name":"LUMI"}'), { name: 'LUMI' });
  assert.deepEqual(extractProfileJson('```json\n{"name":"NOVA"}\n```'), { name: 'NOVA' });
  assert.deepEqual(
    extractProfileJson('好的，这是档案：\n{"name":"IRIS","persona":"知性"}\n希望满意'),
    { name: 'IRIS', persona: '知性' },
  );
  assert.throws(() => extractProfileJson('完全没有 JSON'), /JSON/);
  assert.throws(() => extractProfileJson(null), /文本/);
});

test('buildPortraitPrompt 以视觉档案为主，追加风格与安全词', () => {
  const p = buildPortraitPrompt({ visualIdentity: '银发冷色调，未来感' }, '霓虹背景');
  assert.match(p, /银发冷色调/);
  assert.match(p, /霓虹背景/);
  assert.match(p, /SFW/);
  // 无 visualIdentity 时回退到 persona/positioning
  const p2 = buildPortraitPrompt({ persona: '元气', positioning: '综艺偶像' }, '');
  assert.match(p2, /元气|综艺偶像/);
});
```

- [ ] **Step 2: 运行确认失败** — `npm test` → artist-create 测试 FAIL。

- [ ] **Step 3: 实现** — `src/studio/artist-create.js`：

```js
const INTERVIEW_SYSTEM = `你是一位资深的虚拟艺人企划（星探/经纪人）。你正在通过对话帮玩家"捏"出一个虚拟艺人。
规则：
- 一次只问一个问题，循序渐进了解：想要的气质与人设、性别、音乐与内容风格、外貌气质、艺名想法、背景设定偏好。
- 语气专业、有亲和力，像真正的星探。
- 不要罗列要点，不要输出 JSON 或档案；自然对话即可。
- 当你判断已收集到足够信息时，提示玩家"可以点【生成档案】了"，但不要自己输出档案内容。`;

const FINALIZE_SYSTEM = `你是虚拟艺人档案生成器。根据访谈记录，生成一个完整、真实可信的虚拟艺人档案。
访谈未覆盖的字段你要发挥专业判断自动补全，使艺人像一个真实存在的人——尤其 backstory 要有血肉、有细节。
全部内容必须 SFW、虚构人物，不得影射真实公众人物。
只输出一个 JSON 对象，不要任何额外文字，不要 markdown 代码围栏。字段：
{
  "name": "中文或中英艺名",
  "gender": "性别",
  "persona": "人设关键词，如 冷艳/元气/知性",
  "positioning": "定位，如 电子歌手",
  "backstory": "200字以内的成长经历/出身/转折，有真实感",
  "personality": ["性格特质", "..."],
  "coreAppeal": "核心吸引力一句话",
  "speakingStyle": "说话风格描述",
  "voiceProfile": { "description": "声线描述" },
  "visualIdentity": "外貌/造型/气质的视觉描述，用于图像生成",
  "musicStyle": "音乐风格倾向"
}`;

export function buildInterviewMessages(history) {
  const messages = Array.isArray(history) ? history : [];
  return { system: INTERVIEW_SYSTEM, messages };
}

export function buildFinalizeMessages(transcript) {
  const text = typeof transcript === 'string'
    ? transcript
    : (Array.isArray(transcript)
        ? transcript.map((m) => `${m.role === 'assistant' ? '企划' : '玩家'}：${m.content}`).join('\n')
        : '');
  return {
    system: FINALIZE_SYSTEM,
    messages: [{ role: 'user', content: `访谈记录：\n${text}\n\n请只输出档案 JSON。` }],
  };
}

export function extractProfileJson(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('未在响应中找到 JSON');
  return JSON.parse(s.slice(a, b + 1));
}

export function buildPortraitPrompt(artist, stylePrompt) {
  const base = (artist.visualIdentity || '').trim()
    || `${artist.persona || ''} ${artist.positioning || ''} 虚拟艺人`.trim();
  const style = (stylePrompt || '').trim();
  return [base, style, '高质量定妆照，人像特写，虚拟人物，SFW'].filter(Boolean).join('，');
}
```

- [ ] **Step 4: 运行通过** — `npm test` + `npm run check`。

- [ ] **Step 5: Commit**

```bash
git add src/studio/artist-create.js test/artist-create.test.js
git commit -m "feat: 访谈/档案抽取提示词与定妆照提示词构造

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: artist API 端点与启动接线

**Files:**
- Modify: `src/api/routes.js`, `src/bootstrap.js`

- [ ] **Step 1: bootstrap 接线** — 读 `src/bootstrap.js`，在已有 `initLedger`/`initJobs` 旁加 artist 初始化。具体改动：

  顶部 import 块加：
  ```js
  import { initArtists } from './studio/artists.js';
  ```
  在 try 块内（`initJobs(...)` 之后、`startHealthLoop()` 之前）加一行：
  ```js
    initArtists(path.join(DATA_DIR, 'artists.json'));
  ```
  （`path` 与 `DATA_DIR` 已在 bootstrap.js 现有 import 中；若 `DATA_DIR` 未导入则从 `./lib/paths.js` 补入。）

- [ ] **Step 2: routes.js import** — 在 `src/api/routes.js` 顶部 import 块追加：

```js
import {
  createArtist, listArtists, getArtist, updateArtist, deleteArtist, addPortrait,
} from '../studio/artists.js';
import {
  buildInterviewMessages, buildFinalizeMessages, extractProfileJson, buildPortraitPrompt,
} from '../studio/artist-create.js';
```

- [ ] **Step 3: 注册 artist 端点** — 在 `registerRoutes(route)` 函数体内（`POST /api/config/keys` 之后、函数闭合 `}` 之前）追加：

```js
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
    if (!body.transcript) return jsonError(res, 'bad_request', 'transcript 必填');
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
    json(res, { ok: deleteArtist(params.id) });
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
```

  注意：`DELETE` 与 `PUT` 方法需被路由分发支持。M1 的 server.js 路由分发按 `METHOD /path` 精确匹配 + 动态 `/:id` 段匹配，方法名取自 `req.method`，DELETE/PUT 天然支持，无需改 server.js。

- [ ] **Step 4: 验证** — `npm run check` + `npm test`（既有 49+ 测试不回归）。启动服务器（无 .env）跑端到端：

```powershell
$p = Start-Process node -ArgumentList "server.js" -PassThru -WindowStyle Hidden -Environment @{PORT='3100'}
Start-Sleep 2
try {
  # 无 key：访谈/生成 → unconfigured
  (Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/artist/interview -ContentType 'application/json' -Body '{"messages":[{"role":"user","content":"冷艳歌手"}]}').error.code   # unconfigured
  (Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/artist/finalize -ContentType 'application/json' -Body '{"transcript":"冷艳电子歌手"}').error.code              # unconfigured
  # CRUD 不依赖 key：直接存档草稿
  $a = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/artist -ContentType 'application/json' -Body '{"profile":{"name":"测试LUMI","persona":"冷艳"}}'
  $a.id
  (Invoke-RestMethod http://127.0.0.1:3100/api/artists).artists.Count        # 1
  (Invoke-RestMethod "http://127.0.0.1:3100/api/artist/$($a.id)").artist.persona   # 冷艳
  Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:3100/api/artist/$($a.id)" -ContentType 'application/json' -Body '{"profile":{"name":"测试LUMI","persona":"更冷"}}' | Out-Null
  (Invoke-RestMethod "http://127.0.0.1:3100/api/artist/$($a.id)").artist.persona   # 更冷
  (Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/artist -ContentType 'application/json' -Body '{"profile":{"name":""}}').error.code  # bad_request
  (Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:3100/api/artist/$($a.id)").ok                                  # True
} finally { Stop-Process -Id $p.Id -Force }
```

  若 `Start-Process ... -Environment` 在该 PowerShell 版本不支持，改用 `$env:PORT='3100'; $p = Start-Process node -ArgumentList "server.js" -PassThru -WindowStyle Hidden`。清理：测试结束删除生成的 `data/artists.json`（`Remove-Item F:\projects\Starstudio\data\artists.json -ErrorAction SilentlyContinue`），保持仓库无脏存档（`data/` 已 gitignore，不会误提交）。

- [ ] **Step 5: Commit**

```bash
git add src/api/routes.js src/bootstrap.js
git commit -m "feat: 艺人 REST 端点（访谈/生成档案/CRUD/定妆照）与启动接线

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 前端「艺人」主区（创设对话 + 档案编辑 + 定妆照 + 列表）

**Files:**
- Modify: `prototype/index.html`, `prototype/app.js`, `prototype/styles.css`

- [ ] **Step 1: index.html 加「艺人」主区，能力测试卡折叠** — 在 `<main class="cards">…</main>`（M1 的六能力卡）**之前**插入艺人主区；并把现有 `<main class="cards">…</main>` 整体用 `<details class="debug"><summary>能力调试台（M1）</summary> … </details>` 包裹。插入的艺人主区：

```html
<section id="artist-studio" class="panel">
  <div class="panel-head"><h2>艺人工作室</h2><button id="artist-new">+ 创设新艺人</button></div>
  <div id="artist-list" class="artist-list"></div>

  <div id="artist-create" class="create-flow hidden">
    <h3>对话式访谈捣人</h3>
    <div id="interview-log" class="interview-log"></div>
    <div class="row">
      <input id="interview-input" placeholder="回答企划的问题，或描述你想要的艺人…">
      <button id="interview-send">发送</button>
    </div>
    <button id="interview-finalize">根据对话生成档案</button>

    <div id="draft-box" class="draft-box hidden">
      <h3>艺人档案草稿（可改）</h3>
      <label>艺名 <input data-f="name"></label>
      <label>性别 <input data-f="gender"></label>
      <label>人设 <input data-f="persona"></label>
      <label>定位 <input data-f="positioning"></label>
      <label>核心吸引力 <input data-f="coreAppeal"></label>
      <label>说话风格 <input data-f="speakingStyle"></label>
      <label>声线描述 <input data-f="voiceDescription"></label>
      <label>音乐风格 <input data-f="musicStyle"></label>
      <label>性格（逗号分隔） <input data-f="personality"></label>
      <label>背景故事 <textarea data-f="backstory" rows="3"></textarea></label>
      <label>视觉档案（图像提示词） <textarea data-f="visualIdentity" rows="2"></textarea></label>
      <button id="artist-save">确认创建</button>
      <span id="create-msg" class="msg"></span>
    </div>
  </div>

  <div id="artist-detail" class="detail hidden"></div>
</section>
```

- [ ] **Step 2: styles.css 追加** — 文件末尾追加：

```css
.artist-list { display:flex; flex-wrap:wrap; gap:12px; }
.artist-card { background:#0d1115; border:1px solid var(--line); border-radius:10px; padding:10px; width:160px; cursor:pointer; }
.artist-card img { width:100%; height:180px; object-fit:cover; border-radius:8px; background:#1a2027; }
.artist-card .nm { font-weight:600; margin-top:6px; } .artist-card .ps { color:var(--dim); font-size:12px; }
.create-flow, .detail { margin-top:14px; }
.interview-log { max-height:260px; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:8px 0; }
.bubble { padding:8px 12px; border-radius:10px; max-width:80%; white-space:pre-wrap; }
.bubble.me { align-self:flex-end; background:#2563eb; }
.bubble.ai { align-self:flex-start; background:#1a2027; border:1px solid var(--line); }
.row { display:flex; gap:8px; } .row input { flex:1; }
.draft-box label { display:block; margin:6px 0; color:var(--dim); font-size:13px; }
.draft-box input, .draft-box textarea { width:100%; }
.detail .portraits { display:flex; flex-wrap:wrap; gap:8px; } .detail .portraits img { width:140px; border-radius:8px; }
.msg { color:var(--ok); margin-left:8px; }
details.debug { margin-top:14px; } details.debug summary { cursor:pointer; color:var(--dim); padding:8px 0; }
.hidden { display:none; }
```

- [ ] **Step 3: app.js 追加艺人逻辑** — 文件末尾追加，并在 `boot()` 里加一行 `initArtistStudio();`：

```js
let interviewHistory = [];

function artistCardHtml(a) {
  const cover = a.portraits?.[0]?.url;
  return `<div class="artist-card" data-id="${esc(a.id)}">
    ${cover ? `<img src="${esc(cover)}" alt="">` : '<img alt="">'}
    <div class="nm">${esc(a.name)}</div><div class="ps">${esc(a.persona || '')} ${esc(a.positioning || '')}</div>
  </div>`;
}

async function renderArtists() {
  const data = await api('/api/artists');
  if (data.error || !Array.isArray(data.artists)) return;
  $('#artist-list').innerHTML = data.artists.map(artistCardHtml).join('') || '<div class="ps">还没有艺人，点右上角创设一个。</div>';
  document.querySelectorAll('#artist-list .artist-card').forEach((el) =>
    el.addEventListener('click', () => showArtistDetail(el.dataset.id)));
}

function renderInterview() {
  $('#interview-log').innerHTML = interviewHistory.map((m) =>
    `<div class="bubble ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}</div>`).join('');
  $('#interview-log').scrollTop = $('#interview-log').scrollHeight;
}

async function sendInterview() {
  const text = $('#interview-input').value.trim();
  if (!text) return;
  interviewHistory.push({ role: 'user', content: text });
  $('#interview-input').value = ''; renderInterview();
  const r = await api('/api/artist/interview', { messages: interviewHistory });
  interviewHistory.push({ role: 'assistant', content: r.error ? errText(r.error) : r.reply });
  renderInterview();
}

function fillDraft(d) {
  const set = (f, v) => { const el = document.querySelector(`#draft-box [data-f="${f}"]`); if (el) el.value = v ?? ''; };
  set('name', d.name); set('gender', d.gender); set('persona', d.persona); set('positioning', d.positioning);
  set('coreAppeal', d.coreAppeal); set('speakingStyle', d.speakingStyle);
  set('voiceDescription', d.voiceProfile?.description); set('musicStyle', d.musicStyle);
  set('personality', Array.isArray(d.personality) ? d.personality.join('，') : '');
  set('backstory', d.backstory); set('visualIdentity', d.visualIdentity);
  $('#draft-box').classList.remove('hidden');
}

function readDraft() {
  const g = (f) => document.querySelector(`#draft-box [data-f="${f}"]`).value.trim();
  return {
    name: g('name'), gender: g('gender'), persona: g('persona'), positioning: g('positioning'),
    coreAppeal: g('coreAppeal'), speakingStyle: g('speakingStyle'),
    voiceProfile: { description: g('voiceDescription') }, musicStyle: g('musicStyle'),
    personality: g('personality') ? g('personality').split(/[，,]/).map((s) => s.trim()).filter(Boolean) : [],
    backstory: g('backstory'), visualIdentity: g('visualIdentity'),
  };
}

async function finalizeInterview() {
  if (!interviewHistory.length) return;
  $('#create-msg').textContent = '';
  const btn = $('#interview-finalize'); btn.disabled = true; btn.textContent = '生成中…';
  const r = await api('/api/artist/finalize', { transcript: interviewHistory });
  btn.disabled = false; btn.textContent = '根据对话生成档案';
  if (r.error) { $('#interview-log').insertAdjacentHTML('beforeend', `<div class="bubble ai">${esc(errText(r.error))}</div>`); return; }
  fillDraft(r.draft);
}

async function saveArtist() {
  const profile = readDraft();
  if (!profile.name) { $('#create-msg').textContent = '艺名必填'; $('#create-msg').style.color = 'var(--err)'; return; }
  const r = await api('/api/artist', { profile });
  if (r.error) { $('#create-msg').textContent = errText(r.error); $('#create-msg').style.color = 'var(--err)'; return; }
  $('#create-msg').style.color = 'var(--ok)'; $('#create-msg').textContent = `已创建 ${r.artist.name}`;
  $('#artist-create').classList.add('hidden');
  renderArtists();
  showArtistDetail(r.id);
}

async function showArtistDetail(id) {
  const r = await api(`/api/artist/${encodeURIComponent(id)}`);
  if (r.error) return;
  const a = r.artist;
  $('#artist-detail').classList.remove('hidden');
  $('#artist-detail').innerHTML = `
    <h3>${esc(a.name)} <span class="ps">${esc(a.persona)} · ${esc(a.positioning)}</span></h3>
    <div class="ps">${esc(a.backstory)}</div>
    <div class="ps">声线：${esc(a.voiceProfile?.description || '')}　音乐：${esc(a.musicStyle || '')}</div>
    <div class="ps">视觉：${esc(a.visualIdentity || '')}</div>
    <div class="portraits">${(a.portraits || []).map((p) => `<img src="${esc(p.url)}" alt="">`).join('')}</div>
    <button id="gen-portrait" data-id="${esc(a.id)}">出定妆照</button>
    <button id="del-artist" data-id="${esc(a.id)}">删除艺人</button>
    <span id="portrait-msg" class="ps"></span>`;
  $('#gen-portrait').addEventListener('click', async (e) => {
    const btn = e.target; btn.disabled = true; $('#portrait-msg').textContent = '生成中…（目标 ≤60s）';
    const pr = await api(`/api/artist/${encodeURIComponent(btn.dataset.id)}/portrait`, {});
    btn.disabled = false;
    $('#portrait-msg').textContent = pr.error ? errText(pr.error) : '已生成';
    if (!pr.error) { showArtistDetail(btn.dataset.id); renderArtists(); }
  });
  $('#del-artist').addEventListener('click', async (e) => {
    if (!confirm('确认删除该艺人？')) return;
    await api(`/api/artist/${encodeURIComponent(e.target.dataset.id)}`, undefined, 'DELETE');
    $('#artist-detail').classList.add('hidden');
    renderArtists();
  });
}

function initArtistStudio() {
  renderArtists();
  $('#artist-new').addEventListener('click', () => {
    interviewHistory = []; renderInterview();
    $('#draft-box').classList.add('hidden'); $('#create-msg').textContent = '';
    $('#artist-create').classList.remove('hidden'); $('#artist-detail').classList.add('hidden');
  });
  $('#interview-send').addEventListener('click', sendInterview);
  $('#interview-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendInterview(); });
  $('#interview-finalize').addEventListener('click', finalizeInterview);
  $('#artist-save').addEventListener('click', saveArtist);
}
```

- [ ] **Step 4: 验证** — `npm run check`。启动 `node server.js`，浏览器开 http://127.0.0.1:3100：
  1. 「艺人工作室」是首屏；M1 六能力卡收进「能力调试台」折叠区；控制台零报错。
  2. 点「+ 创设新艺人」→ 出现访谈框；发消息（无 key 时 AI 气泡显示 `[unconfigured]…`，属预期）。
  3. 手动在草稿区填 `艺名=测试NOVA`、`视觉档案=银发未来感` → 点「确认创建」→ 列表出现该卡片、自动展开详情。
  4. 详情点「删除艺人」→ 卡片消失。
  5. 关服务器，删 `data/artists.json`。

- [ ] **Step 5: Commit**

```bash
git add prototype/index.html prototype/app.js prototype/styles.css
git commit -m "feat: 工作台艺人主区——创设对话/档案编辑/定妆照/列表（首屏）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 冒烟扩展与 S1 验收

**Files:**
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: 扩冒烟** — 在 `scripts/smoke.mjs` 的 `try { … } finally` 块内，已有断言之后、`catch` 之前，追加艺人链路断言（沿用文件已有的 `call`/`ok` 辅助函数）：

```js
  // —— 艺人创设（S1）——
  const interview = await call('/api/ai-artist-interview-probe'); // 占位，下行才是真实调用
  const iv = await call('/api/artist/interview', { messages: [{ role: 'user', content: '冷艳电子歌手' }] });
  ok('artist interview 路由可用', iv.status === 200 && (Boolean(iv.data.reply) || Boolean(iv.data.error)), iv.data.error?.code || 'ok');

  const fin = await call('/api/artist/finalize', { transcript: '冷艳电子歌手' });
  ok('artist finalize 路由可用', fin.status === 200 && (Boolean(fin.data.draft) || Boolean(fin.data.error)), fin.data.error?.code || 'ok');

  const created = await call('/api/artist', { profile: { name: 'SMOKE艺人', persona: '冷艳', visualIdentity: '银发' } });
  ok('artist 创建', created.status === 200 && created.data.id?.startsWith('art_'), created.data.id);

  const listed = await call('/api/artists');
  ok('artist 列表含新建', listed.status === 200 && listed.data.artists.some((a) => a.id === created.data.id));

  const got = await call(`/api/artist/${created.data.id}`);
  ok('artist 详情', got.status === 200 && got.data.artist?.persona === '冷艳');

  const badCreate = await call('/api/artist', { profile: { name: '' } });
  ok('空艺名被拒', badCreate.status === 200 && badCreate.data.error?.code === 'bad_request', badCreate.data.error?.code);

  const del = await call(`/api/artist/${created.data.id}`, undefined, 'DELETE');
  ok('artist 删除', del.status === 200 && del.data.ok === true);
```

  注意：删掉上面的占位行 `const interview = await call('/api/ai-artist-interview-probe');`——它仅用于说明，实际代码不要保留该行。冒烟服务器用 PORT 3199，独立的 `data/artists.json`（冒烟跑完该文件残留无妨，`data/` 已 gitignore；可在 finally 里不处理）。

- [ ] **Step 2: 跑冒烟** — `npm run smoke`，确认新增 7 项 artist 断言全 ✓、退出码 0（无 key 环境：interview/finalize 走 `unconfigured` 分支仍判为路由可用；CRUD 不依赖 key 全过）。若失败排查根因，不弱化断言。

- [ ] **Step 3: 全量回归与验收清单** — 逐项执行并记录：
  1. `npm run check` → 通过
  2. `npm test` → 全部通过（M1 的 49 + 本里程碑新增）
  3. `npm run smoke` → 全部 ✓ 退出 0
  4. `node server.js` 启动 → 艺人工作室为首屏、控制台零报错（继承基线 NFR-4）
  5. 配 `ANTHROPIC_API_KEY` 后（在设置页录入）：访谈能多轮对话、「生成档案」产出可信草稿；配 `GEMINI_API_KEY` 后「出定妆照」生成图片并入库（验收 PS-1 一致性参考包雏形）
  6. 杀进程重启 → `data/artists.json` 中艺人保留（持久化 PS-3）

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "feat: 冒烟覆盖艺人创设链路（S1 收口）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 自检记录（writing-plans Self-Review）

- **Spec 覆盖**（对照 §5 S1 详细设计）：5.1 档案数据模型 → Task 1（schema/CRUD/原子写）；5.2 访谈捣人流程 → Task 2（提示词/JSON 抽取）+ Task 3（interview/finalize 端点）+ Task 4（创设对话 UI/草稿编辑/确认创建）；定妆照（一致性包雏形 PS-1）→ Task 3（portrait 端点）+ Task 4（出定妆照按钮）；5.3 API → Task 3（全部 8 端点）；5.4 前端首屏改艺人主区、M1 卡折叠 → Task 4；5.5 持久化原子写 + schemaVersion → Task 1；5.6 测试 → Task 1/2 单测 + Task 5 冒烟。
- **占位符扫描**：无 TBD/TODO；Task 5 Step 1 的「占位行」已显式标注要删除，非残留。
- **类型一致性**：`initArtists/createArtist/listArtists/getArtist/updateArtist/deleteArtist/addPortrait`、`buildInterviewMessages/buildFinalizeMessages/extractProfileJson/buildPortraitPrompt`、档案字段（name/gender/persona/positioning/backstory/personality/coreAppeal/speakingStyle/voiceProfile.description/visualIdentity/musicStyle/portraits）跨 Task 1→3→4 命名逐一核对一致；端点契约（interview→{reply}、finalize→{draft}、create→{id,artist}、portrait→{portrait,artist}）前后端一致。
- **范围**：单一里程碑（艺人创设），装得进一个计划；S2~S6 各自独立。
- **歧义**：访谈（自由对话，`/interview`）与结构化抽取（`/finalize` 出 JSON 草稿）分两端点，消除「AI 何时算捏完」歧义；草稿先编辑再 `POST /api/artist` 落库，创建与微调路径清晰。

