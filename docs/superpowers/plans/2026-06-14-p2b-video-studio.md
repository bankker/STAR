# P2b 视频工作室（S3 video，通义万相图生视频）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 接入通义万相图生视频（DashScope，区域可用）：以艺人的写真/定妆照为首帧出竖屏视频，走 M1 异步 job 队列 + 成本闸门，成片自动入该艺人画廊。

**Architecture:** 扩展 `dashscope.js` 加 `video` 能力（万相 i2v 异步 task，invoke 内部轮询+下载）；config 把 `video` 路由切 dashscope 主、kling 兜底；bootstrap 的 job executor 包一层「完成后按 artistId 入画廊」；新增 `POST /api/artist/:id/video`（成本闸门 + job + 定妆照首帧）；前端写真/视频页加视频控制 + JobCard 进度 + 画廊视频瓦片。零 npm 依赖。

**通用约定：** 错误 HTTP 200 + `{error}`；测试 `npm test`；检查 `npm run check`；冒烟 `npm run smoke`；署名 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；不 push；前端 `esc()`。**DASHSCOPE_API_KEY 已配在线**，可真实验收（视频较慢，2-5 分钟）。⚠️ 文档校准步骤先 WebFetch 再写。

---

## 文件总览
| 文件 | 职责 | 任务 |
|---|---|---|
| `src/providers/dashscope.js` | 加 `video`（万相 i2v 异步 task） | 1 |
| `config/ai-providers.json` `src/gateway/costs.js` | video 路由切 dashscope + 单价 | 1 |
| `src/gateway/jobs.js` 或 `src/bootstrap.js` | job 完成后按 artistId 入画廊（executor 包装） | 2 |
| `src/api/routes.js` `src/lib/files.js` | 视频端点 + 本地图读 base64 助手 | 3 |
| `prototype/{index.html,app.js,styles.css}` | 视频控制 + JobCard + 画廊视频瓦片 | 4 |
| `scripts/smoke.mjs` | 冒烟覆盖视频提交（confirm 闸门，不真实出片） | 5 |

---

### Task 1: 通义万相图生视频适配器

**Files:** Modify `src/providers/dashscope.js`, `config/ai-providers.json`, `src/gateway/costs.js`

- [ ] **Step 1: ⚠️ 文档校准** — WebFetch 阿里云百炼图生视频文档（`https://help.aliyun.com/zh/model-studio/image-to-video-api-reference` 或 `tongyi-wanxiang` 视频）。确认：提交端点（多为 `POST /api/v1/services/aigc/video-generation/video-synthesis`）、异步头 `X-DashScope-Async: enable`、body 形态（`{model, input:{prompt, img_url}, parameters:{...}}`——**重点确认 img 入参是 `img_url` 公网 URL 还是支持 base64**）、提交响应 `output.task_id`、轮询 `GET /api/v1/tasks/{task_id}` → `output.task_status` 与视频结果字段（`output.video_url` 或 `output.results[].url`）、当前 i2v model id（如 `wan2.2-i2v-flash`/`wanx2.1-i2v-turbo`，用文档当前 id）。**关键决策**：本机 `/generated/*` 图为 localhost 不可被万相访问——若 i2v 仅接受公网 URL，则改为把首帧图读成 base64 传入（若平台支持）；若两者都不行，报告 BLOCKED 并说明（可能需先上传图到 OSS，超本任务范围）。按校准结果实现下方代码。

- [ ] **Step 2: 扩展 dashscope.js** — capabilities 加 `'video'`；invoke 加 `if (capability === 'video') return invokeVideo(request, ctx);`；末尾加（字段按 Step 1 校准；下面以「base64 优先、img_url 兜底」示例）：
```js
const I2V_SUBMIT = `${BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const VID_POLL_MS = 10000;
const VID_MAX_MS = 8 * 60 * 1000;
const vidSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function invokeVideo(request, ctx) {
  // request.imageRef: base64 dataUrl（端点已把首帧本地图读成 dataUrl）。万相若要公网 URL 见 Step 1 校准。
  const img = request.imageRef;
  if (!img) throw gatewayError('bad_request', '图生视频需要首帧图（artist 需先有写真/定妆照）', { providerId: 'dashscope' });
  const submit = await ctx.fetchJson(I2V_SUBMIT, {
    headers: { ...auth(ctx.env), 'X-DashScope-Async': 'enable' }, timeoutMs: 30000,
    body: { model: request.model, input: { prompt: request.prompt || '', img_url: img }, parameters: {} },
  });
  const taskId = submit.output?.task_id;
  if (!taskId) throw gatewayError('provider_error', `万相视频未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'dashscope' });
  const deadline = Date.now() + VID_MAX_MS;
  let lastPct = 5, pollErrors = 0;
  while (Date.now() < deadline) {
    await vidSleep(VID_POLL_MS);
    let st;
    try { st = await ctx.fetchJson(`${BASE}/api/v1/tasks/${taskId}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 }); pollErrors = 0; }
    catch (err) { if (++pollErrors >= 3) throw err; ctx.onProgress('万相视频: 轮询重试', lastPct); continue; }
    const status = st.output?.task_status;
    lastPct = Math.max(lastPct, status === 'RUNNING' ? 50 : 20);
    ctx.onProgress(`万相视频: ${status || '排队'}`, lastPct);
    if (status === 'SUCCEEDED') {
      const url = st.output?.video_url || st.output?.results?.[0]?.url;
      if (!url) throw gatewayError('provider_error', '万相视频成功但无 URL', { providerId: 'dashscope' });
      ctx.onProgress('下载视频', 90);
      const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 300000 });
      return { files: [ctx.saveFile(buf, 'mp4')], durationSec: request.durationSec || 5, usage: { seconds: request.durationSec || 5 } };
    }
    if (status === 'FAILED') throw gatewayError('provider_error', `万相视频失败: ${st.output?.message || st.output?.code || '无详情'}`, { providerId: 'dashscope' });
  }
  throw gatewayError('timeout', `万相视频轮询超时（${VID_MAX_MS / 60000} 分钟）`, { providerId: 'dashscope' });
}
```

- [ ] **Step 3: config + costs** — `config/ai-providers.json` 把 `video` 改 dashscope 主、kling 兜底：
```json
  "video":   { "provider": "dashscope", "model": "wan2.2-i2v-flash",
               "fallback": [{ "provider": "kling", "model": "kling-v2-6" }] },
```
（model id 用 Step 1 校准的。）`costs.js` BASE_PRICES 加 `'dashscope:wan2.2-i2v-flash': { perSecond: 0.1 },`（id 与 config 一致）。

- [ ] **Step 4: 验证** — `npm run check` + `npm test`（83 不回归）+ `npm run smoke`。真实出片验收较慢（2-5 分钟），可选：用一张已存在的写真做首帧测 i2v（见 Task 3 联调）。本任务先确认编译 + 路由 + 单测不回归即可。
- [ ] **Step 5: Commit** — `git add src/providers/dashscope.js config/ai-providers.json src/gateway/costs.js && git commit -m "feat: 通义万相图生视频适配器（video 切区域可用 DashScope）"` + 署名。

---

### Task 2: job 完成后入画廊（executor 包装）

**Files:** Modify `src/bootstrap.js`

- [ ] **Step 1: 包装 executor** — 当前 bootstrap：`initJobs({ file: path.join(DATA_DIR, 'jobs.json'), executeFn: execute });`。改为传一个包装函数：job 完成且 `request.artistId` 存在、有 `files` 时，按能力把产物加入该艺人画廊。

  bootstrap.js 顶部加：`import { addAssets } from './studio/assets.js';`（assets 已 initAssets 接线）。
  把 initJobs 那行替换为：
```js
    const galleryExecutor = async (capability, request, opts) => {
      const r = await execute(capability, request, opts);
      if (request.artistId && Array.isArray(r.files) && r.files.length) {
        try {
          addAssets(request.artistId, r.files.map((f) => ({
            type: capability === 'video' ? 'video' : 'photo',
            url: f.url, prompt: request.prompt || '', aspect: request.aspect || '',
          })));
        } catch (e) { console.error('[jobs] 入画廊失败（忽略）', e.message); }
      }
      return r;
    };
    initJobs({ file: path.join(DATA_DIR, 'jobs.json'), executeFn: galleryExecutor });
```
  注意：泛用 `/api/ai/video`（无 artistId）不受影响（不入画廊）。

- [ ] **Step 2: 验证** — `npm run check` + `npm test`（83，jobs 测试用 fake executor 不受影响）。
- [ ] **Step 3: Commit** — `git add src/bootstrap.js && git commit -m "feat: job 完成后按 artistId 自动入画廊"` + 署名。

---

### Task 3: 视频端点 + 首帧 base64 助手

**Files:** Modify `src/lib/files.js`, `src/api/routes.js`

- [ ] **Step 1: files.js 助手** — 加「把 /generated url 读成 base64 dataUrl」：
```js
export function generatedUrlToDataUrl(genDir, url) {
  const m = /^\/generated\/([A-Za-z0-9_.-]+)$/.exec(url || '');
  if (!m) return null;
  const full = path.join(genDir, m[1]);
  if (full !== path.join(genDir, m[1]) || !fs.existsSync(full)) return null; // 防穿越 + 存在
  const ext = path.extname(full).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'mp4' ? 'video/mp4' : 'image/png');
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
}
```
（`fs`/`path` 已在 files.js 顶部 import。文件名正则即防穿越。）

- [ ] **Step 2: routes.js** — 加 import `import { generatedUrlToDataUrl } from '../lib/files.js';` 与 `import { GENERATED_DIR } from '../lib/paths.js';`（若未引入）、`import { getGallery } from '../studio/assets.js';`（已引入则合并）。`registerRoutes` 内加：
```js
  route('POST /api/artist/:id/video', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    await handleMediaSubmit('video', res, body, (b) => {
      // 首帧：优先 body 指定的画廊图，否则用该艺人最新写真/定妆照
      const gallery = getGallery(params.id).assets.filter((a) => a.type === 'photo');
      const frameUrl = b.frameUrl || gallery[0]?.url || artist.portraits?.[0]?.url;
      if (!frameUrl) throw new Error('请先为该艺人生成一张写真作为视频首帧');
      const imageRef = generatedUrlToDataUrl(GENERATED_DIR, frameUrl);
      if (!imageRef) throw new Error('首帧图读取失败');
      return { artistId: params.id, imageRef, prompt: b.prompt || '', durationSec: Number(b.durationSec) || 5, aspect: '9:16' };
    });
  });
```
  注：`handleMediaSubmit` 走估算→confirm 闸门→submitJob('video', request)，request 含 artistId → Task 2 的包装在 job 完成时入画廊。`/api/artist/:id/video` 需加入 `MEDIA_BODY_PATHS`（imageRef base64 可能较大）：在 routes.js 的 `MEDIA_BODY_PATHS` Set 里加 `'/api/artist/:id/video'`？——不行，MEDIA_BODY_PATHS 是精确路径匹配，动态 id 无法精确匹配。**改为**：在 server.js 的 readJsonBody 调用处按前缀判断，或简单起见把视频端点的 body 上限单独放宽。最稳妥：保持端点 body 小——首帧不由前端上传 base64，而是后端从画廊读（如上 buildRequest 所做，前端只传 frameUrl 字符串 + prompt + durationSec），**所以 body 实际很小**，无需进 MEDIA_BODY_PATHS。确认 buildRequest 不接收前端 base64。

- [ ] **Step 3: 验证** — `npm run check` + `npm test`。真实联调（已配 key，视频慢 2-5 分钟，可选跑一次）：
```bash
cd "F:/projects/Starstudio" && PORT=3192 node server.js & SRV=$!
sleep 2
AID=$(curl -s -X POST localhost:3192/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"VidTest","visualIdentity":"silver hair idol"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo "先出首帧写真:"; curl -s -X POST "localhost:3192/api/artist/$AID/photo" -H 'Content-Type: application/json' -d '{"shot":"近景","aspect":"3:4","count":1}' >/dev/null
echo "视频未确认→confirm_required:"; curl -s -X POST "localhost:3192/api/artist/$AID/video" -H 'Content-Type: application/json' -d '{"prompt":"轻轻转头微笑"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).error?.code||JSON.parse(d).jobId))'
echo "确认→jobId:"; JID=$(curl -s -X POST "localhost:3192/api/artist/$AID/video" -H 'Content-Type: application/json' -d '{"prompt":"轻轻转头微笑","confirm":true}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).jobId||JSON.parse(d).error?.code)))')
echo "jobId=$JID"
kill $SRV 2>/dev/null; rm -rf "F:/projects/Starstudio/data/artists.json" "F:/projects/Starstudio/data/assets" "F:/projects/Starstudio/data/jobs.json"
echo done</bash>
```
期望：confirm_required（首次）→ 确认返回 jobId。（真实出片可在浏览器看 JobCard 进度，2-5 分钟入画廊；命令行可不等。）

- [ ] **Step 4: Commit** — `git add src/lib/files.js src/api/routes.js && git commit -m "feat: 艺人视频端点（万相 i2v，定妆照首帧，job+成本闸门）"` + 署名。

---

### Task 4: 前端视频控制 + JobCard + 画廊视频瓦片

**Files:** Modify `prototype/{index.html,app.js,styles.css}`

- [ ] **Step 1**: 在写真/视频页的控制面板加一个「📹 视频」子区（或 tab 切换 写真↔视频）：首帧来源（默认「最新写真」/可选画廊某图）+ 运镜 prompt textarea + 时长档（5s/10s）+「✦ 生成视频」按钮（点击走 submitWithConfirm 成本闸门）。视频用 9:16。
- [ ] **Step 2: app.js** — `initVideoStudio()`（boot 调用）：生成视频 = `submitWithConfirm('/api/artist/:cur/video', {prompt,durationSec})`（复用已有 confirm 弹窗 + jobs 轮询），提交后提示「见任务进度」，job 完成后画廊自动出现视频瓦片（轮询 gallery 或 jobs done 后 reload gallery）。画廊瓦片：video 类型用 9:16，`<video controls>`，青色锁脸 badge，收藏/删除（重抽对视频可选略过）。筛选 chips 加「视频」。需当前艺人 + 至少一张写真（否则提示先出写真）。
- [ ] **Step 3: styles.css** — 视频瓦片 9:16、video 元素样式、子区/tab 切换样式，沿用 tokens。
- [ ] **Step 4: 验证** — `npm run check`；浏览器：写真页选艺人→先出写真→切视频→生成（confirm 闸门弹出预估成本→确认）→任务进度 JobCard→（2-5 分钟）视频入画廊可播放；控制台零报错。grep：`curl -s localhost:3100/app.js | grep -c initVideoStudio` =2。
- [ ] **Step 5: Commit** — `git add prototype/index.html prototype/app.js prototype/styles.css && git commit -m "feat: 视频工作室前端——i2v 控制 + 成本闸门 + 画廊视频瓦片"` + 署名。

---

### Task 5: 冒烟与 P2b 验收合并

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1**: 加视频端点冒烟（不真实出片——只验 confirm 闸门与守卫）。在 artist 块（删除前、且该艺人无写真时）：
```js

  const vidNoFrame = await call(`/api/artist/${created.data.id}/video`, { prompt: 'x' });
  ok('视频无首帧→bad_request', vidNoFrame.status === 200 && vidNoFrame.data.error?.code === 'bad_request', vidNoFrame.data.error?.code);

  const vidMiss = await call('/api/artist/nope_x/video', { prompt: 'x' });
  ok('视频未知艺人→not_found', vidMiss.status === 200 && vidMiss.data.error?.code === 'not_found', vidMiss.data.error?.code);
```
（该 SMOKE 艺人无写真 → buildRequest 抛「请先生成写真」→ bad_request。真实 i2v 出片在 Task 3 手动联调验过，冒烟不花钱不等几分钟。）

- [ ] **Step 2**: `npm run smoke` 全 ✓ 退出 0。
- [ ] **Step 3: 全量回归** — check/test/smoke 全绿；浏览器：写真→视频成本闸门→JobCard→视频入画廊可播放；控制台零报错。
- [ ] **Step 4: Commit + 合并** — commit smoke；然后终审子代理整体评审 P2b；通过后合并回 master、删分支、master 复跑 check/test/smoke。

---

## 自检（writing-plans Self-Review）
- **Spec 覆盖**（brief §3 写真/视频 video 部分 + §4 成本闸门）：i2v 定妆照首帧 → Task 1 invokeVideo + Task 3 首帧 base64；成本闸门 → Task 3 handleMediaSubmit；异步 job + 进度 → M1 job 队列 + Task 4 JobCard；成片入画廊 → Task 2 包装；视频瓦片 9:16 → Task 4。
- **占位符**：无 TBD；万相 i2v 端点/model/img 入参以 Task 1「⚠️ 文档校准」锁定（含 base64-vs-URL 关键决策，若都不支持则 BLOCKED 上报）。
- **类型一致性**：execute('video',{artistId,imageRef,prompt,durationSec,aspect})、galleryExecutor 入画廊、generatedUrlToDataUrl、端点契约（video→{jobId,estimate} 经 handleMediaSubmit）、asset type 'video' 跨 Task 1→2→3→4 一致。
- **范围**：单一里程碑（视频）；写真已在 P2。
- **歧义**：视频走 job（长任务）非同步；首帧由后端从画廊/portraits 读本地图转 base64（前端只传 frameUrl 字符串，body 小，无需 MEDIA_BODY_PATHS）。万相 i2v 若仅接受公网 URL 是最大风险，Task 1 Step 1 显式校准。
