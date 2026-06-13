# P2 写真工作室（S3 image，通义万相）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 接入通义万相（DashScope，区域可用）文生图，给每位艺人一个专业写真工作室：可控生成（景别/比例/变体）+ 注入视觉档案锁脸 + 画廊式资产库（收藏/重抽/删除）。

**Architecture:** 扩展现有 `dashscope.js` 加 `image` 能力（万相异步 task：提交→轮询→下载，invoke 内部完成，对网关同步）；config 把 `image` 路由切 dashscope 主、gemini/openrouter 降为代理兜底；新增 `src/studio/assets.js`（每艺人画廊存档，镜像 conversations）；写真 REST 端点；前端把「写真/视频」占位页做成控制台+画廊（对齐设计 brief §3）。零 npm 依赖。

**通用约定：** 应用层错误 HTTP 200 + `{error}`；测试 `npm test`；检查 `npm run check`；冒烟 `npm run smoke`；工作目录 F:\projects\Starstudio；提交署名 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；不 push；前端 `esc()`。**DASHSCOPE_API_KEY 已配（在线）**，可真实验收出图。外部 API 字段标「⚠️ 文档校准」的先 WebFetch 核对再写。

---

## 文件总览
| 文件 | 职责 | 任务 |
|---|---|---|
| `src/providers/dashscope.js` | 加 `image`（万相文生图异步 task） | 1 |
| `config/ai-providers.json` `src/gateway/costs.js` | image 路由切 dashscope + 单价 | 1 |
| `src/studio/assets.js` + `test/assets.test.js` | 每艺人画廊存档原子读写 | 2 |
| `src/studio/artist-create.js` | 加 `buildPhotoPrompt`（景别/视觉档案/风格） | 2 |
| `src/api/routes.js` `src/bootstrap.js` | 写真端点 + 接线 | 3 |
| `prototype/{index.html,app.js,styles.css}` | 写真控制台 + 画廊视图 | 4 |
| `scripts/smoke.mjs` | 冒烟覆盖写真链路 | 5 |

---

### Task 1: 通义万相文生图适配器

**Files:** Modify `src/providers/dashscope.js`, `config/ai-providers.json`, `src/gateway/costs.js`

- [ ] **Step 1: ⚠️ 文档校准** — WebFetch 阿里云百炼万相文生图文档（`https://help.aliyun.com/zh/model-studio/text-to-image` 或 `tongyi-wanxiang`）。确认：提交端点 `POST /api/v1/services/aigc/text2image/image-synthesis`、异步头 `X-DashScope-Async: enable`、body `{model, input:{prompt}, parameters:{size, n}}`、提交响应 `output.task_id`、轮询端点 `GET /api/v1/tasks/{task_id}` 返回 `output.task_status`(PENDING/RUNNING/SUCCEEDED/FAILED) 与 `output.results[].url`、当前可用 model id（设计默认 `wan2.2-t2i-flash`，若文档显示别的当前 id 用文档的）与合法 size 取值。按结果修正下方代码与 config 的 model。

- [ ] **Step 2: 扩展 dashscope.js** — capabilities 加 `'image'`；`invoke` 的 dispatch 在 tts/asr 之后、throw 之前加：
```js
    if (capability === 'image') return invokeImage(request, ctx);
```
文件末尾（`export default` 前）加：
```js
const T2I_SUBMIT = `${BASE}/api/v1/services/aigc/text2image/image-synthesis`;
const TASKS = `${BASE}/api/v1/tasks`;
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 4 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 比例 → 万相合法 size（⚠️ 以文档为准）
const SIZE_BY_ASPECT = { '1:1': '1024*1024', '3:4': '768*1024', '9:16': '720*1280', '16:9': '1280*720' };

async function invokeImage(request, ctx) {
  const n = Math.min(4, Math.max(1, Number(request.count) || 1));
  const size = SIZE_BY_ASPECT[request.aspect] || '1024*1024';
  const submit = await ctx.fetchJson(T2I_SUBMIT, {
    headers: { ...auth(ctx.env), 'X-DashScope-Async': 'enable' }, timeoutMs: 30000,
    body: { model: request.model, input: { prompt: request.prompt }, parameters: { size, n } },
  });
  const taskId = submit.output?.task_id;
  if (!taskId) throw gatewayError('provider_error', `万相未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'dashscope' });

  const deadline = Date.now() + MAX_POLL_MS;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let st;
    try { st = await ctx.fetchJson(`${TASKS}/${taskId}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 }); pollErrors = 0; }
    catch (err) { if (++pollErrors >= 3) throw err; continue; }
    const status = st.output?.task_status;
    if (status === 'SUCCEEDED') {
      const urls = (st.output?.results || []).map((r) => r.url).filter(Boolean);
      if (!urls.length) throw gatewayError('provider_error', '万相成功但无图像 URL', { providerId: 'dashscope' });
      const files = [];
      for (const url of urls) {
        const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 120000 });
        files.push(ctx.saveFile(buf, /\.jpe?g(\?|$)/i.test(url) ? 'jpg' : 'png'));
      }
      return { files, usage: { images: files.length } };
    }
    if (status === 'FAILED') throw gatewayError('provider_error', `万相生成失败: ${st.output?.message || st.output?.code || '无详情'}`, { providerId: 'dashscope' });
  }
  throw gatewayError('timeout', `万相轮询超时（${MAX_POLL_MS / 60000} 分钟）`, { providerId: 'dashscope' });
}
```
（注：万相文生图 T2I 为纯文生图；锁脸靠在 prompt 注入 `visualIdentity`（Task 2 的 buildPhotoPrompt）。真·参考图锁脸（图生图）为后续增强，本任务先文生图。）

- [ ] **Step 3: config + costs** — `config/ai-providers.json` 把 `image` 路由改为 dashscope 主、原 gemini/openrouter 作兜底（区域内 dashscope 可用；代理用户走兜底）：
```json
  "image":   { "provider": "dashscope", "model": "wan2.2-t2i-flash",
               "fallback": [{ "provider": "gemini", "model": "gemini-3-pro-image" },
                            { "provider": "openrouter", "model": "google/gemini-3-pro-image-preview" }] },
```
（model id 用 Step 1 校准的。）`src/gateway/costs.js` 的 BASE_PRICES 加：`'dashscope:wan2.2-t2i-flash': { perImage: 0.03 },`（id 与 config 一致；万相单价以接入校准）。

- [ ] **Step 4: 验证** — `npm run check` + `npm test`（78 不回归）+ `npm run smoke`（全过；image 端点现路由 dashscope，已配 key → 真实出图或 confirm 流程仍通）。**真实验收**：启动服务器（已配 DASHSCOPE_API_KEY），curl 出一张图：
```bash
cd "F:/projects/Starstudio" && PORT=3192 node server.js & SRV=$!
sleep 2
echo "image gen:"; curl -s -X POST localhost:3192/api/ai/image -H 'Content-Type: application/json' -d '{"prompt":"一位银发冷色调虚拟歌手的定妆照，未来感，人像特写，SFW","aspect":"3:4"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.files?("OK "+j.files[0].url+" via "+j.provider):JSON.stringify(j.error))})'
kill $SRV 2>/dev/null
echo done</bash>
```
期望返回 `OK /generated/xxxx.png via dashscope`（约 20-60s）。若失败，看错误（区域/参数/model id）定位修复，不弱化。

- [ ] **Step 5: Commit** — `git add src/providers/dashscope.js config/ai-providers.json src/gateway/costs.js && git commit -m "feat: 通义万相文生图适配器（image 切区域可用 DashScope）"` + 署名。

---

### Task 2: 画廊资产存档 + 写真提示词

**Files:** Create `src/studio/assets.js`, `test/assets.test.js`; Modify `src/studio/artist-create.js`

- [ ] **Step 1: 写失败测试** — `test/assets.test.js`：
```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initAssets, getGallery, addAssets, toggleFavorite, removeAsset } from '../src/studio/assets.js';
import { buildPhotoPrompt } from '../src/studio/artist-create.js';

beforeEach(() => initAssets(fs.mkdtempSync(path.join(os.tmpdir(), 'ssas-'))));

test('空画廊返回骨架', () => {
  assert.deepEqual(getGallery('art_1').assets, []);
});

test('addAssets 追加并带 id', () => {
  const g = addAssets('art_1', [{ type: 'photo', url: '/generated/a.png', prompt: 'p', shot: '近景', aspect: '3:4' }]);
  assert.equal(g.assets.length, 1);
  assert.match(g.assets[0].id, /^as_/);
  assert.equal(g.assets[0].favorite, false);
  assert.ok(g.assets[0].createdAt);
});

test('toggleFavorite 与 removeAsset', () => {
  const g = addAssets('art_1', [{ type: 'photo', url: '/x.png' }]);
  const id = g.assets[0].id;
  assert.equal(toggleFavorite('art_1', id).assets[0].favorite, true);
  assert.equal(toggleFavorite('art_1', id).assets[0].favorite, false);
  assert.equal(removeAsset('art_1', id).assets.length, 0);
  assert.equal(toggleFavorite('art_1', 'nope'), null);
});

test('非法 artistId 抛错', () => {
  assert.throws(() => addAssets('../evil', [{ url: '/x' }]), /非法/);
});

test('buildPhotoPrompt 注入视觉档案与景别', () => {
  const p = buildPhotoPrompt({ visualIdentity: '银发冷色调' }, { shot: '近景', stylePrompt: '霓虹' });
  assert.match(p, /银发冷色调/);
  assert.match(p, /近景|特写/);
  assert.match(p, /霓虹/);
  assert.match(p, /SFW/);
});
```

- [ ] **Step 2: 确认失败** — `npm test` → FAIL。

- [ ] **Step 3: 实现** — `src/studio/assets.js`（镜像 conversations.js）：
```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let assetsDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function initAssets(dir) {
  assetsDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f)); } catch {}
}

function empty(artistId) { return { artistId, schemaVersion: 1, assets: [], updatedAt: null }; }
const fileFor = (artistId) => path.join(assetsDir, `${artistId}.json`);

export function getGallery(artistId) {
  const base = empty(artistId);
  if (!assetsDir || !SAFE_ID.test(artistId)) return base;
  const f = fileFor(artistId);
  if (!fs.existsSync(f)) return base;
  try {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...base, ...c, assets: Array.isArray(c.assets) ? c.assets : [] };
  } catch { return base; }
}

function write(g) {
  g.updatedAt = new Date().toISOString();
  const f = fileFor(g.artistId);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(g, null, 2));
  fs.renameSync(tmp, f);
}

export function addAssets(artistId, items) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const g = getGallery(artistId);
  const now = new Date().toISOString();
  for (const it of items || []) {
    g.assets.unshift({
      id: `as_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      type: it.type || 'photo', url: it.url,
      prompt: String(it.prompt || ''), shot: it.shot || '', aspect: it.aspect || '',
      favorite: false, createdAt: now,
    });
  }
  write(g);
  return g;
}

export function toggleFavorite(artistId, assetId) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const g = getGallery(artistId);
  const a = g.assets.find((x) => x.id === assetId);
  if (!a) return null;
  a.favorite = !a.favorite;
  write(g);
  return g;
}

export function removeAsset(artistId, assetId) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const g = getGallery(artistId);
  const before = g.assets.length;
  g.assets = g.assets.filter((x) => x.id !== assetId);
  if (g.assets.length === before) return g;
  write(g);
  return g;
}
```
`src/studio/artist-create.js` 末尾加：
```js
const SHOT_WORD = { 近景: '近景特写', 中景: '半身中景', 全景: '全身全景' };

export function buildPhotoPrompt(artist, opts = {}) {
  const base = (artist?.visualIdentity || '').trim() || `${artist?.persona || ''} ${artist?.positioning || ''} 虚拟艺人`.trim();
  const shot = SHOT_WORD[opts.shot] || opts.shot || '';
  const style = (opts.stylePrompt || '').trim();
  return [base, shot, style, '高质量写真，虚拟人物，SFW'].filter(Boolean).join('，');
}
```

- [ ] **Step 4: 通过** — `npm test`（全过）+ `npm run check`。
- [ ] **Step 5: Commit** — `git add src/studio/assets.js test/assets.test.js src/studio/artist-create.js && git commit -m "feat: 画廊资产存档与写真提示词构造"` + 署名。

---

### Task 3: 写真端点与接线

**Files:** Modify `src/api/routes.js`, `src/bootstrap.js`

- [ ] **Step 1: bootstrap** — 加 `import { initAssets } from './studio/assets.js';`；`initConversations(...)` 后加 `initAssets(path.join(DATA_DIR, 'assets'));`。

- [ ] **Step 2: routes import** — 加：
```js
import { getGallery, addAssets, toggleFavorite, removeAsset } from '../studio/assets.js';
import { buildPhotoPrompt } from '../studio/artist-create.js';
```
（`buildPortraitPrompt` 已从 artist-create 引入则合并；`getArtist`/`execute` 已在。）

- [ ] **Step 3: 端点** — `registerRoutes` 内追加：
```js
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

  route('POST /api/artist/:id/gallery/:assetId/favorite', async (req, res, { params }) => {
    const g = toggleFavorite(params.id, params.assetId);
    g ? json(res, { ok: true }) : jsonError(res, 'not_found', '无此资产');
  });

  route('DELETE /api/artist/:id/gallery/:assetId', async (req, res, { params }) => {
    removeAsset(params.id, params.assetId);
    json(res, { ok: true });
  });
```
注意：`/api/artist/:id/photo` 不入 MEDIA_BODY_PATHS（请求体小）。`:id/gallery/:assetId` 是 3 段动态，server.js 动态路由支持。

- [ ] **Step 4: 验证** — `npm run check` + `npm test`。真实出图端到端（已配 key）：
```bash
cd "F:/projects/Starstudio" && PORT=3192 node server.js & SRV=$!
sleep 2
AID=$(curl -s -X POST localhost:3192/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"PhotoTest","visualIdentity":"silver hair, cool tone, futuristic"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo "photo:"; curl -s -X POST "localhost:3192/api/artist/$AID/photo" -H 'Content-Type: application/json' -d '{"shot":"近景","aspect":"3:4","count":1}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.assets?("OK "+j.assets[0].url):JSON.stringify(j.error))})'
echo "gallery:"; curl -s "localhost:3192/api/artist/$AID/gallery" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log("count:",JSON.parse(d).assets.length))'
kill $SRV 2>/dev/null; rm -rf "F:/projects/Starstudio/data/artists.json" "F:/projects/Starstudio/data/assets"
echo done</bash>
```
期望 photo → `OK /generated/xxx.png`，gallery count 1。

- [ ] **Step 5: Commit** — `git add src/api/routes.js src/bootstrap.js && git commit -m "feat: 写真生成/画廊/收藏/删除端点 + 接线"` + 署名。

---

### Task 4: 前端写真控制台 + 画廊

**Files:** Modify `prototype/index.html`, `prototype/app.js`, `prototype/styles.css`

- [ ] **Step 1**: 把 `写真/视频` 的「即将到来」占位 view 替换为：左控制面板（当前艺人卡 + 锁脸基准提示 + 景别 近景/中景/全景 segmented + 比例 3:4/1:1/9:16 + 变体 1/2/4 + 风格 prompt textarea + 「生成写真」按钮）+ 右画廊（筛选 chips 全部/收藏；MediaTile 3:4 网格，青色锁脸 badge、收藏★/重抽↻/删除 悬浮操作、生成中 spinner 占位）。结构与类名沿用设计 brief §2 的 MediaTile/Chip/Button。需当前艺人（无则提示先去创设）。

- [ ] **Step 2: app.js** — 加 `initPhotoStudio()`（boot 调用），调用：`POST /api/artist/:id/photo`（生成，按钮 disabled+spinner 占位，完成后刷画廊）、`GET /api/artist/:id/gallery`（渲染）、`POST .../gallery/:assetId/favorite`、`DELETE .../gallery/:assetId`、重抽=用同 shot/aspect/style 再 POST photo count:1。切换当前艺人时重载画廊。所有动态串 `esc()`，图片 `<img>`。筛选「收藏」只显示 favorite。

- [ ] **Step 3: styles.css** — 补 MediaTile 3:4 网格、锁脸 badge（青 --accent）、悬浮操作条、spinner 占位的样式（沿用 tokens）。

- [ ] **Step 4: 验证** — `npm run check`；启动 `node server.js`（已配 key），浏览器进「写真/视频」：选当前艺人 → 设景别/比例 → 生成 → **真实出图入画廊**、收藏/重抽/删除可用、控制台零报错。grep：`curl -s localhost:3100/ | grep -c '写真'` ≥1、`curl -s localhost:3100/app.js | grep -c initPhotoStudio` =2。

- [ ] **Step 5: Commit** — `git add prototype/index.html prototype/app.js prototype/styles.css && git commit -m "feat: 写真工作室前端——控制台 + 画廊（锁脸/收藏/重抽）"` + 署名。

---

### Task 5: 冒烟与 P2 验收

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1**: 在 artist 块（删除前）加画廊断言（不触发真实出图，避免冒烟花钱/变慢——只验空画廊与 404 守卫）：
```js

  const gal = await call(`/api/artist/${created.data.id}/gallery`);
  ok('gallery 初始为空', gal.status === 200 && Array.isArray(gal.data.assets) && gal.data.assets.length === 0);

  const galMiss = await call('/api/artist/nope_x/gallery');
  ok('gallery 未知艺人 404', galMiss.status === 200 && galMiss.data.error?.code === 'not_found', galMiss.data.error?.code);
```
（写真真实出图的端到端验收在 Task 3/4 手动跑过，冒烟不重复花钱。）

- [ ] **Step 2**: `npm run smoke` 全 ✓ 退出 0。
- [ ] **Step 3: 全量回归** — `npm run check` / `npm test` / `npm run smoke` 全绿；浏览器：写真页选艺人→生成真实出图→收藏/重抽/删除→画廊持久化（重启留存）；控制台零报错。
- [ ] **Step 4: Commit** — `git add scripts/smoke.mjs && git commit -m "feat: 冒烟覆盖画廊（P2 收口）"` + 署名。

---

## 自检（writing-plans Self-Review）
- **Spec 覆盖**（brief §3 写真）：可控参数(景别/比例/变体) → Task 1 invokeImage + Task 4 控制台；锁脸（视觉档案注入）→ Task 2 buildPhotoPrompt；画廊筛选/收藏/重抽/删除 → Task 2 assets + Task 3 端点 + Task 4 UI；生成中态 → Task 4 spinner。视频(S3 video)按用户决策放 P2b，不在本计划。
- **占位符**：无 TBD；万相端点/model/size 以 Task 1 Step 1「⚠️ 文档校准」锁定，代码结构完整可改字段。提交命令「+ 署名」执行时补全署名行。
- **类型一致性**：`initAssets/getGallery/addAssets/toggleFavorite/removeAsset`、`buildPhotoPrompt`、asset {id,type,url,prompt,shot,aspect,favorite,createdAt}、端点契约（photo→{assets,provider,model}、gallery→{assets}、favorite/delete→{ok}）、execute('image',{prompt,aspect,count}) 跨 Task 1→2→3→4 一致。
- **范围**：单一里程碑（写真）；视频 P2b 独立。
- **歧义**：写真用同步 execute（万相 invoke 内部轮询），前端 spinner 等待；非 job 队列（job 留给 P2b 视频长任务）。
