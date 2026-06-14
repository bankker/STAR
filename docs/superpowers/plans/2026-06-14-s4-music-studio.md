# S4 音乐工坊（通义 fun-music-v1）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** 接入阿里百炼 `fun-music-v1`（区域可用，同步出整首带人声歌曲）：两段式专业工作流——AI 作曲蓝图（歌名/曲风/分段歌词，可编辑）→ 确认成本后渲染整首歌 → 入艺人作品库（可播放）。声线性别取自艺人档案。

**Architecture:** 扩展 `dashscope.js` 加 `music` 能力（fun-music-v1 同步：POST → output.audio.url → 下载 mp3）；config 把 `music` 路由切 dashscope 主、suno 兜底；蓝图走 `content` 能力（结构化 JSON）；渲染走 M1 job 队列 + 成本闸门（复用 handleMediaSubmit + galleryExecutor 自动入画廊，type 'song'）；前端音乐工坊页（蓝图编辑 + 渲染 + 作品库音频瓦片）。零 npm 依赖。

**通用约定：** 错误 HTTP 200 + `{error}`；测试 `npm test`；检查 `npm run check`；冒烟 `npm run smoke`；署名 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；不 push；前端 `esc()`。**DASHSCOPE_API_KEY 已配在线**，可真实出歌验收（约 30-90s）。⚠️ 文档校准步骤先 WebFetch。

## fun-music-v1 已校准（接入时复核）
- 端点 `POST https://dashscope.aliyuncs.com/api/v1/services/audio/music/generation`，**同步**（非 task 轮询）。
- 头 `Authorization: Bearer`、`Content-Type: application/json`。
- body `{model:'fun-music-v1', input:{prompt, lyrics, gender:'male'|'female'}}`：lyrics/prompt 至少一个，二者都传时 lyrics 生效、prompt 忽略。
- 响应 `output.audio.url`（MP3，24h 有效）。整首男/女声中/英文歌。

---

## 文件总览
| 文件 | 职责 | 任务 |
|---|---|---|
| `src/providers/dashscope.js` | 加 `music`（fun-music-v1 同步） | 1 |
| `config/ai-providers.json` `src/gateway/costs.js` | music 路由切 dashscope + 单价 | 1 |
| `src/studio/music.js` + `test/music.test.js` | 作曲蓝图提示词 + 蓝图→歌词/性别提取 | 2 |
| `src/bootstrap.js` | galleryExecutor 把 music 产物记为 type 'song' | 3 |
| `src/api/routes.js` | 蓝图端点 + 渲染端点（job+闸门） | 3 |
| `prototype/{index.html,app.js,styles.css}` | 音乐工坊：蓝图编辑 + 渲染 + 作品库音频瓦片 | 4 |
| `scripts/smoke.mjs` | 冒烟覆盖蓝图/渲染守卫 | 5 |

---

### Task 1: fun-music-v1 适配器

**Files:** Modify `src/providers/dashscope.js`, `config/ai-providers.json`, `src/gateway/costs.js`

- [ ] **Step 1: ⚠️ 文档复核** — WebFetch `https://help.aliyun.com/zh/model-studio/fun-music`（或音乐生成 API 参考）确认上方 fun-music-v1 契约（端点/body 字段 prompt/lyrics/gender/响应 output.audio.url）。若有出入按文档修正。

- [ ] **Step 2: 扩展 dashscope.js** — capabilities 加 `'music'`；invoke 加 `if (capability === 'music') return invokeMusic(request, ctx);`；末尾加：
```js
const MUSIC_GEN = `${BASE}/api/v1/services/audio/music/generation`;

async function invokeMusic(request, ctx) {
  const input = {};
  if (request.lyrics) input.lyrics = request.lyrics;
  else input.prompt = request.prompt || request.style || '一首流行歌曲';
  if (request.gender === 'male' || request.gender === 'female') input.gender = request.gender;
  const data = await ctx.fetchJson(MUSIC_GEN, {
    headers: auth(ctx.env), timeoutMs: 180000,
    body: { model: request.model, input },
  });
  const url = data.output?.audio?.url;
  if (!url) throw gatewayError('provider_error', `fun-music 无音频 URL: ${JSON.stringify(data.output || {}).slice(0, 200)}`, { providerId: 'dashscope' });
  const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 180000 });
  return { files: [ctx.saveFile(buf, 'mp3')], usage: { songs: 1 } };
}
```
（同步调用，无轮询；fun-music 可能耗时 30-90s，timeoutMs 给足 180s。）

- [ ] **Step 3: config + costs** — `config/ai-providers.json` 把 `music` 改 dashscope 主、suno 兜底：
```json
  "music":   { "provider": "dashscope", "model": "fun-music-v1",
               "fallback": [{ "provider": "suno", "model": "V5" }] },
```
`src/gateway/costs.js` BASE_PRICES 加 `'dashscope:fun-music-v1': { perSong: 0.3 },`（id 与 config 一致）。

- [ ] **Step 4: 验证** — `npm run check` + `npm test`（83 不回归）+ `npm run smoke`（music 端点路由 dashscope，已配 key → confirm 流程仍通）。**真实出歌验收**：
```bash
cd "F:/projects/Starstudio" && PORT=3192 node server.js & SRV=$!
sleep 2
echo "song:"; curl -s -X POST localhost:3192/api/ai/music -H 'Content-Type: application/json' -d '{"lyrics":"霓虹灯下 我轻声歌唱\n城市的夜 温柔又漫长","confirm":true}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.jobId?("job "+j.jobId):(j.files?j.files[0].url:JSON.stringify(j.error)))})'
kill $SRV 2>/dev/null
echo done</bash>
```
注：/api/ai/music 走 handleMediaSubmit（confirm 闸门 + job），confirm:true 返回 jobId。真实出歌可在浏览器看 JobCard，或本任务先确认路由+编译；真实出歌端到端在 Task 3/4 联调验。若想此处直验，提交 jobId 后 poll /api/jobs/:id 至 done 看 result.files 有 mp3。

- [ ] **Step 5: Commit** — `git add src/providers/dashscope.js config/ai-providers.json src/gateway/costs.js && git commit -m "feat: 通义 fun-music-v1 音乐适配器（music 切区域可用 DashScope）"` + 署名。

---

### Task 2: 作曲蓝图（src/studio/music.js）

**Files:** Create `src/studio/music.js`, `test/music.test.js`

- [ ] **Step 1: 写失败测试** — `test/music.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlueprintMessages, extractBlueprint, blueprintToRenderReq } from '../src/studio/music.js';

const artist = { name: '霓夜', persona: '赛博国风', musicStyle: '暗黑电子', gender: '女', voiceProfile: { description: '清冷气声' } };

test('buildBlueprintMessages 注入艺人音乐风格与诉求', () => {
  const r = buildBlueprintMessages(artist, '想要一首关于深夜城市的歌');
  assert.match(r.system, /作曲|蓝图|JSON/);
  assert.match(r.messages[0].content, /深夜城市/);
  assert.match(r.messages[0].content, /暗黑电子|霓夜/);
});

test('extractBlueprint 容忍围栏与多余文字', () => {
  assert.deepEqual(extractBlueprint('```json\n{"title":"霓虹","lyrics":"歌词"}\n```'), { title: '霓虹', lyrics: '歌词' });
  assert.deepEqual(extractBlueprint('好的：\n{"title":"夜"}\n完成'), { title: '夜' });
  assert.throws(() => extractBlueprint('没有 JSON'), /JSON/);
});

test('blueprintToRenderReq 映射歌词+性别', () => {
  const req = blueprintToRenderReq({ title: '霓虹', lyrics: '霓虹灯下', style: '电子' }, artist);
  assert.equal(req.lyrics, '霓虹灯下');
  assert.equal(req.gender, 'female');   // 女→female
  assert.equal(req.style, '电子');
  const male = blueprintToRenderReq({ lyrics: 'x' }, { gender: '男' });
  assert.equal(male.gender, 'male');
});
```

- [ ] **Step 2: 确认失败** — `npm test` → FAIL。

- [ ] **Step 3: 实现** — `src/studio/music.js`：
```js
const FINALIZE_JSON = '只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码围栏。';

export function buildBlueprintMessages(artist, brief) {
  const a = artist || {};
  const system = [
    '你是一位专业作曲企划。根据艺人设定与创作诉求，产出一份"作曲蓝图"。',
    `艺人：${a.name || ''}，人设：${a.persona || ''}，音乐风格倾向：${a.musicStyle || ''}，声线：${a.voiceProfile?.description || ''}。`,
    '蓝图需包含字段：title(歌名)、style(曲风，含 BPM/调式建议)、structure(分段，如 主歌/副歌/桥段)、lyrics(完整分段歌词，中文 5-350 字)、productionNotes(制作建议)。',
    FINALIZE_JSON,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `创作诉求：${brief || '自由发挥，贴合艺人风格'}\n\n请输出作曲蓝图 JSON。` }] };
}

export function extractBlueprint(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('未在响应中找到 JSON');
  try { return JSON.parse(s.slice(a, b + 1)); }
  catch { throw new Error('蓝图 JSON 解析失败'); }
}

export function blueprintToRenderReq(blueprint, artist) {
  const bp = blueprint || {};
  const g = (artist?.gender || '').trim();
  const gender = g === '男' || /male/i.test(g) ? 'male' : (g === '女' || /female/i.test(g) ? 'female' : undefined);
  return {
    title: bp.title || '',
    lyrics: bp.lyrics || '',
    style: bp.style || artist?.musicStyle || '',
    gender,
  };
}
```

- [ ] **Step 4: 通过** — `npm test`（全过）+ `npm run check`。
- [ ] **Step 5: Commit** — `git add src/studio/music.js test/music.test.js && git commit -m "feat: 作曲蓝图提示词与蓝图→渲染参数映射"` + 署名。

---

### Task 3: 音乐端点 + galleryExecutor song 类型

**Files:** Modify `src/bootstrap.js`, `src/api/routes.js`

- [ ] **Step 1: bootstrap galleryExecutor 支持 song** — 当前 galleryExecutor 的 type 映射是 `capability === 'video' ? 'video' : 'photo'`。改为支持 music→song：
```js
            type: capability === 'video' ? 'video' : (capability === 'music' ? 'song' : 'photo'),
```

- [ ] **Step 2: routes import** — 加 `import { buildBlueprintMessages, extractBlueprint, blueprintToRenderReq } from '../studio/music.js';`（`getArtist`/`execute`/`handleMediaSubmit`/`getGallery` 已在）。

- [ ] **Step 3: 端点** — `registerRoutes` 内加：
```js
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
```
注：渲染走 handleMediaSubmit('music')→估算→confirm 闸门→submitJob('music', {artistId,...})→galleryExecutor 完成入画廊（type song）。/api/artist/:id/song body 含 blueprint（含歌词，可能较大但 < 1MB 文本），不进 MEDIA_BODY_PATHS 没问题。

- [ ] **Step 4: 验证** — `npm run check` + `npm test`。真实联调（已配 key，出歌 30-90s）：
```bash
cd "F:/projects/Starstudio" && PORT=3192 node server.js & SRV=$!
sleep 2
AID=$(curl -s -X POST localhost:3192/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"MusTest","gender":"女","musicStyle":"暗黑电子"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo "蓝图:"; BP=$(curl -s -X POST "localhost:3192/api/artist/$AID/song/blueprint" -H 'Content-Type: application/json' -d '{"brief":"深夜城市霓虹"}')
echo "$BP" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.blueprint?("OK title="+j.blueprint.title):JSON.stringify(j.error))})'
echo "渲染确认门:"; curl -s -X POST "localhost:3192/api/artist/$AID/song" -H 'Content-Type: application/json' -d '{"lyrics":"霓虹灯下我轻声歌唱"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).error?.code, "est="+JSON.parse(d).error?.estimate?.estimatedUsd))'
echo "渲染:"; JID=$(curl -s -X POST "localhost:3192/api/artist/$AID/song" -H 'Content-Type: application/json' -d '{"lyrics":"霓虹灯下我轻声歌唱","confirm":true}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).jobId||JSON.parse(d).error?.code))')
echo "jobId=$JID; poll:"; for i in $(seq 1 20); do sleep 10; ST=$(curl -s "localhost:3192/api/jobs/$JID" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d).job;console.log((j&&j.status))}'); echo " $i:$ST"; case "$ST" in done) break;; failed) break;; esac; done
echo "作品库:"; curl -s "localhost:3192/api/artist/$AID/gallery" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).assets;console.log("songs:",a.filter(x=>x.type==="song").length)}'
kill $SRV 2>/dev/null; rm -rf "F:/projects/Starstudio/data/artists.json" "F:/projects/Starstudio/data/assets" "F:/projects/Starstudio/data/jobs.json"
echo done</bash>
```
期望：蓝图 OK+title；渲染未确认→confirm_required+est；确认→jobId；poll 到 done；作品库 songs≥1（真实 mp3）。若 fun-music 真实失败，报告确切原因。

- [ ] **Step 5: Commit** — `git add src/bootstrap.js src/api/routes.js && git commit -m "feat: 作曲蓝图/渲染端点 + 歌曲入作品库（song 类型）"` + 署名。

---

### Task 4: 前端音乐工坊

**Files:** Modify `prototype/{index.html,app.js,styles.css}`

- [ ] **Step 1**: 把音乐工坊占位页换成两段式：创作诉求输入（brief textarea）+「✦ 生成作曲蓝图」→ 可编辑蓝图卡（title/style/structure/lyrics/productionNotes 字段，lyrics 大 textarea）+「✦ 确认渲染（成本闸门）」；下方「作品库」音频瓦片网格（`<audio controls>` + 歌名 + 曲风 + 收藏/删除）。需当前艺人。
- [ ] **Step 2: app.js** — `initMusicStudio()`（boot 调用）：生成蓝图=`POST /api/artist/:cur/song/blueprint {brief}`→填充蓝图卡；确认渲染=`submitWithConfirm('/api/artist/:cur/song', {blueprint})`（成本闸门→jobId→JobCard poll，复用 pollVideoJob 或类似→done 后刷作品库）；作品库=`GET /api/artist/:cur/gallery` 取 type==='song' 渲染 `<audio>`。画廊筛选 chip 加「音乐」。esc() 全部动态串。
- [ ] **Step 3: styles.css** — 音频瓦片、蓝图卡、作品库网格样式（沿用 tokens）。
- [ ] **Step 4: 验证** — `npm run check`；浏览器：音乐工坊选艺人→输诉求→生成蓝图→改歌词→确认渲染（成本闸门）→JobCard→歌曲入作品库可播放；控制台零报错。grep `initMusicStudio`=2。
- [ ] **Step 5: Commit** — `git add prototype/index.html prototype/app.js prototype/styles.css && git commit -m "feat: 音乐工坊前端——两段式蓝图+渲染+作品库"` + 署名。

---

### Task 5: 冒烟与 S4 验收合并

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1**: artist 块（删除前）加：
```js

  const bpMiss = await call('/api/artist/nope_x/song/blueprint', { brief: 'x' });
  ok('蓝图未知艺人→not_found', bpMiss.status === 200 && bpMiss.data.error?.code === 'not_found', bpMiss.data.error?.code);

  const songEmpty = await call(`/api/artist/${created.data.id}/song`, {});
  ok('渲染无蓝图→bad_request', songEmpty.status === 200 && songEmpty.data.error?.code === 'bad_request', songEmpty.data.error?.code);
```
（真实出歌在 Task 3 联调验过，冒烟不花钱不等。）

- [ ] **Step 2**: `npm run smoke` 全 ✓ 退出 0。
- [ ] **Step 3: 全量回归** — check/test/smoke 全绿；浏览器：蓝图→渲染→作品库可播放；控制台零报错。
- [ ] **Step 4: Commit + 合并** — commit smoke；终审子代理整体评审 S4；通过后合并回 master、删分支、master 复跑 check/test/smoke。

---

## 自检（writing-plans Self-Review）
- **Spec 覆盖**（brief §3 音乐工坊 两段式 + §4 成本闸门 + PS-1 声线匹配）：蓝图（确认前可编辑）→ Task 2/3；渲染走 music 能力 → Task 1；声线匹配（gender 取自档案）→ Task 2 blueprintToRenderReq；成本闸门 → Task 3 handleMediaSubmit；作品库可播放 → Task 4；入画廊 → Task 3 galleryExecutor song。
- **占位符**：无 TBD；fun-music-v1 契约已预校准，Task 1 Step 1 复核。
- **类型一致性**：invokeMusic({lyrics/prompt/gender})、buildBlueprintMessages/extractBlueprint/blueprintToRenderReq、galleryExecutor song 映射、端点契约（blueprint→{blueprint}、song→handleMediaSubmit {jobId,estimate}）、asset type 'song' 跨 Task 1→2→3→4 一致。
- **范围**：单一里程碑（音乐）。
- **歧义**：蓝图同步（content 快），渲染走 job（fun-music 同步但耗时，包进 job 拿成本闸门+进度+入画廊）；gender 从艺人 gender 字段映射 male/female。
