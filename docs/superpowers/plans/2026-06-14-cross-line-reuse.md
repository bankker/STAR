# 跨线复用打通 + 走查打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把音乐工坊的歌接成短剧逐集可选主题曲（背景混音），把写真库的图接成短剧配角/主演定妆照（零成本复用），并就近打磨跨线粗糙点。

**Architecture:** episode 数据模型加可空 `themeSongUrl`；drama-store 加 `setEpisodeTheme`；routes 加 2 端点（theme / cast portrait，均带画廊校验）并在 compose 拼接后插入 ffmpeg `amix` 背景混音；前端加一个可复用画廊选择器（song/photo）驱动「选主题曲」「从写真库选」。

**Tech Stack:** Node ≥18 原生 http（ESM，零依赖）、ffmpeg（amix 混音）、DashScope 画廊资产、node:test。

参照 spec：`docs/superpowers/specs/2026-06-14-cross-line-reuse-design.md`。

复用既有：`getGallery(artistId)`（assets.js，已在 routes.js 导入）、`addPortraitVersion`（drama-store，已导入 routes.js）、compose SSE 脊柱（routes.js）、画廊瓦片样式（app.js）。

---

## Task 1: drama-store 加 themeSongUrl + setEpisodeTheme + 单测

**Files:**
- Modify: `src/studio/drama-store.js`
- Test: `test/drama-store.test.js`

- [ ] **Step 1: 写失败测试**（追加到 test/drama-store.test.js 末尾，import 里加 `setEpisodeTheme`）

在文件顶部 import 行加入 `setEpisodeTheme`：
```js
import {
  initDrama, createDrama, getDrama, listDramas, updateScene, addFrameVersion, setFrameCurrent, addPortraitVersion, setEpisodeTheme,
} from '../src/studio/drama-store.js';
```
末尾追加：
```js
test('createDrama 每集 themeSongUrl 默认 null', () => {
  const d = createDrama('art_t1', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  assert.equal(d.episodes[0].themeSongUrl, null);
});

test('setEpisodeTheme 设置与清除主题曲', () => {
  const d = createDrama('art_t2', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  const eid = d.episodes[0].id;
  setEpisodeTheme(d.id, eid, '/generated/song.mp3');
  assert.equal(getDrama(d.id).episodes[0].themeSongUrl, '/generated/song.mp3');
  setEpisodeTheme(d.id, eid, null);
  assert.equal(getDrama(d.id).episodes[0].themeSongUrl, null);
});

test('setEpisodeTheme 未知 episode 返回 null', () => {
  const d = createDrama('art_t3', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  assert.equal(setEpisodeTheme(d.id, 'ep_99', '/generated/s.mp3'), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/drama-store.test.js`
Expected: FAIL（`setEpisodeTheme` 未导出 / themeSongUrl 未定义）。

- [ ] **Step 3: 实现**

在 `createDrama` 的 `episodes` 构造里给每集对象加 `themeSongUrl: null`（与 `tier: 'high'` 同级）：
```js
  const episodes = (parsed.episodes || []).map((e, ei) => ({
    id: `ep_${ei + 1}`, index: ei + 1, title: e.title, tier: 'high', themeSongUrl: null, durationSec: null, episodeUrl: null,
    scenes: (e.scenes || []).map((sc, si) => ({
      // …不变…
    })),
  }));
```

在文件中（紧邻 `setFrameCurrent` 等方法）加：
```js
export function setEpisodeTheme(id, eid, songUrl) {
  const d = getDrama(id); if (!d) return null;
  const ep = d.episodes.find((e) => e.id === eid); if (!ep) return null;
  ep.themeSongUrl = songUrl || null;
  return write(d);
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `node --test test/drama-store.test.js` → PASS（新增 3 测试）
Run: `npm run check && npm test` → 全绿

- [ ] **Step 5: Commit**

```bash
git add src/studio/drama-store.js test/drama-store.test.js
git commit -m "feat: episode 加可空 themeSongUrl + setEpisodeTheme（主题曲数据层）"
```

---

## Task 2: 端点 theme（挂主题曲）+ cast/:cid/portrait（写真库复用）

**Files:**
- Modify: `src/api/routes.js`

- [ ] **Step 1: 加 import**

把 `setEpisodeTheme` 加入既有 drama-store import 行：
```js
import { createDrama, getDrama, listDramas, updateDrama, addPortraitVersion, addFrameVersion, setFrameCurrent, curFrameUrl, setEpisodeTheme } from '../studio/drama-store.js';
```
（`getGallery` 已从 assets.js 导入；`addPortraitVersion` 已导入。）

- [ ] **Step 2: 加 theme 端点**（放在 collection 端点之后）

```js
  route('POST /api/artist/:id/drama/:did/episode/:eid/theme', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    if (!d.episodes.find((e) => e.id === params.eid)) return jsonError(res, 'not_found', '无此分集');
    const songUrl = body.songUrl || null;
    if (songUrl) {
      const ok = getGallery(params.id).assets.some((a) => a.type === 'song' && a.url === songUrl);
      if (!ok) return jsonError(res, 'bad_request', '主题曲必须来自该艺人作品库');
    }
    json(res, { drama: setEpisodeTheme(params.did, params.eid, songUrl) });
  });
```

- [ ] **Step 3: 加 cast portrait 复用端点**

```js
  route('POST /api/artist/:id/drama/:did/cast/:cid/portrait', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    const d = getDrama(params.did);
    if (!artist || !d || d.artistId !== params.id) return jsonError(res, 'not_found', '无此短剧');
    if (!d.cast.find((c) => c.id === params.cid)) return jsonError(res, 'not_found', '无此角色');
    const url = body.url;
    if (!url || !getGallery(params.id).assets.some((a) => a.type === 'photo' && a.url === url)) {
      return jsonError(res, 'bad_request', '定妆照必须来自该艺人写真库');
    }
    json(res, { drama: addPortraitVersion(params.did, params.cid, { url, prompt: '写真库复用' }) });
  });
```

- [ ] **Step 4: 手测**

```bash
cd "F:/projects/Starstudio"
for pid in $(powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3185 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { \$_.OwningProcess }" 2>/dev/null | tr -d '\r'); do taskkill //PID $pid //F >/dev/null 2>&1; done
PORT=3185 node server.js > /tmp/xlt2.log 2>&1 & sleep 2.5
AID=$(curl -s -X POST localhost:3185/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"复用测","gender":"女","visualIdentity":"银发"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
DID=$(curl -s -X POST localhost:3185/api/artist/$AID/drama/script -H 'Content-Type: application/json' -d '{"brief":{"theme":"短","episodeCount":1,"durationSec":20}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).drama.id))')
echo "--- theme 非画廊歌→bad_request ---"; curl -s -X POST localhost:3185/api/artist/$AID/drama/$DID/episode/ep_1/theme -H 'Content-Type: application/json' -d '{"songUrl":"/generated/nope.mp3"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).error?.code))'
echo "--- theme 清除(null)→ok ---"; curl -s -X POST localhost:3185/api/artist/$AID/drama/$DID/episode/ep_1/theme -H 'Content-Type: application/json' -d '{"songUrl":null}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("theme",j.drama?.episodes?.[0]?.themeSongUrl, "err",j.error?.code||"")})'
echo "--- portrait 非画廊图→bad_request ---"; curl -s -X POST localhost:3185/api/artist/$AID/drama/$DID/cast/c_lead/portrait -H 'Content-Type: application/json' -d '{"url":"/generated/nope.png"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).error?.code))'
echo "--- portrait 未知角色→not_found ---"; curl -s -X POST localhost:3185/api/artist/$AID/drama/$DID/cast/c_zzz/portrait -H 'Content-Type: application/json' -d '{"url":"/generated/x.png"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).error?.code))'
for pid in $(powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3185 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { \$_.OwningProcess }" 2>/dev/null | tr -d '\r'); do taskkill //PID $pid //F >/dev/null 2>&1; done
node -e "const fs=require('fs');for(const p of ['F:/projects/Starstudio/data/dramas','F:/projects/Starstudio/data/artists.json']){try{fs.rmSync(p,{recursive:true,force:true})}catch{}}"
```
Expected: theme 非画廊歌→bad_request；theme null→themeSongUrl=null 无 err；portrait 非画廊图→bad_request；portrait 未知角色→not_found。

- [ ] **Step 5: 全量 + Commit**

Run: `npm run check && npm test` → 全绿
```bash
git add src/api/routes.js
git commit -m "feat: 短剧端点——挂主题曲(画廊校验) + 配角/主演从写真库选定妆照(画廊校验)"
```

---

## Task 3: compose 背景混音改造（amix）

**Files:**
- Modify: `src/api/routes.js`（compose 路由的 concat→烧字幕段）

- [ ] **Step 1: 改造**

在 compose 路由里，定位 concat 出 `merged` 之后、烧字幕之前（`const merged = path.join(tmp, 'merged.mp4'); runFfmpeg([... concat ...], merged);` 与 `runFfmpeg(['-y', '-i', merged, '-vf', subtitles...], outAbs)` 之间）。把烧字幕的输入从固定 `merged` 改为 `subInput`，并在中间插入条件混音：

将这段：
```js
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', clipList, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', merged], 300000);
      // 4) 一次性烧字幕（整集累计时间）
      send('stage', { stage: 'subtitle', progress: 92, msg: '烧录字幕' });
      const srtFile = path.join(tmp, 'sub.srt');
      fs.writeFileSync(srtFile, buildSrt(srtSegs));
      const name = `dr_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      const srtEsc = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
      runFfmpeg(['-y', '-i', merged, '-vf', `subtitles='${srtEsc}'`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', outAbs], 300000);
```
改为：
```js
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', clipList, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', merged], 300000);
      // 3.5) 主题曲背景混音（若该集挂了主题曲且文件可读）：BGM 压低 + 循环垫到对白长
      let subInput = merged;
      if (ep.themeSongUrl) {
        try {
          const bgmAbs = path.join(GENERATED_DIR, ep.themeSongUrl.replace('/generated/', ''));
          if (fs.existsSync(bgmAbs)) {
            send('stage', { stage: 'bgm', progress: 90, msg: '混入主题曲' });
            const mixed = path.join(tmp, 'mixed.mp4');
            runFfmpeg(['-y', '-i', merged, '-stream_loop', '-1', '-i', bgmAbs,
              '-filter_complex', '[1:a]volume=0.18[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]',
              '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', mixed], 300000);
            subInput = mixed;
          } else { console.warn('[drama] 主题曲文件不存在，跳过混音', ep.themeSongUrl); }
        } catch (e) { console.error('[drama] 主题曲混音失败，跳过', e.message); subInput = merged; }
      }
      // 4) 一次性烧字幕（整集累计时间）
      send('stage', { stage: 'subtitle', progress: 92, msg: '烧录字幕' });
      const srtFile = path.join(tmp, 'sub.srt');
      fs.writeFileSync(srtFile, buildSrt(srtSegs));
      const name = `dr_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      const srtEsc = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
      runFfmpeg(['-y', '-i', subInput, '-vf', `subtitles='${srtEsc}'`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', outAbs], 300000);
```

- [ ] **Step 2: 验证（含真实混音）**

`npm run check && npm test` → 全绿。
然后真跑一集低成本 compose，先给 ep_1 挂一首 stand-in 主题曲（用一段 TTS 当 song 入画廊），混音后 ffprobe 确认成片有音轨且时长正常：
```bash
cd "F:/projects/Starstudio"
for pid in $(powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3184 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { \$_.OwningProcess }" 2>/dev/null | tr -d '\r'); do taskkill //PID $pid //F >/dev/null 2>&1; done
PORT=3184 node server.js > /tmp/xlt3.log 2>&1 & sleep 2.5
AID=$(curl -s -X POST localhost:3184/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"混音测","gender":"女","visualIdentity":"银发"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
# 造一个 stand-in song：用 TTS 生成一段音频并手动入画廊为 song
SONG=$(curl -s -X POST localhost:3184/api/ai/tts -H 'Content-Type: application/json' -d '{"text":"啦啦啦啦啦啦啦啦啦啦啦啦啦啦啦"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.files?.[0]?.url||"")}')
echo "SONG=$SONG"
# 注：若无 /api/ai/tts 直出端点，则用任意已有 /generated 音频；并通过 addAssets 间接入画廊——
# 简化：直接把 song 作为 gallery song 资产需要一条入库路径；若无，跳过真实混音、只验证 npm 绿 + 端点守卫已在 Task2 覆盖，并在报告里说明用既有 song 资产验证。
DID=$(curl -s -X POST localhost:3184/api/artist/$AID/drama/script -H 'Content-Type: application/json' -d '{"brief":{"theme":"两人对话短剧2-3场景","episodeCount":1,"durationSec":20}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).drama.id))')
curl -s -N -X POST localhost:3184/api/artist/$AID/drama/$DID/episode/ep_1/storyboard -H 'Content-Type: application/json' -d '{"confirm":true}' | tail -1
# 若拿到 SONG，挂主题曲
[ -n "$SONG" ] && curl -s -X POST localhost:3184/api/artist/$AID/drama/$DID/episode/ep_1/theme -H 'Content-Type: application/json' -d "{\"songUrl\":\"$SONG\"}" >/dev/null
echo "--- low compose（含混音）---"; curl -s -N -X POST localhost:3184/api/artist/$AID/drama/$DID/episode/ep_1/compose -H 'Content-Type: application/json' -d '{"tier":"low"}' | tail -2
for pid in $(powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3184 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { \$_.OwningProcess }" 2>/dev/null | tr -d '\r'); do taskkill //PID $pid //F >/dev/null 2>&1; done
node -e "const fs=require('fs');for(const p of ['F:/projects/Starstudio/data/dramas','F:/projects/Starstudio/data/artists.json']){try{fs.rmSync(p,{recursive:true,force:true})}catch{}}"
```
注：`/api/ai/tts` 不一定把产物登记为 gallery song（theme 端点要求 song 在画廊）。若 stand-in 入库困难，可：(a) 用 Task 5 端到端时由前端/真实 song 验证；(b) 本步至少确认未挂主题曲时 compose 仍正常出片（回归）+ npm 绿。**关键：themeSongUrl 为空时 compose 行为与改造前完全一致（subInput=merged）。** 报告里说明混音真验放到哪一步。

- [ ] **Step 3: Commit**

```bash
git add src/api/routes.js
git commit -m "feat: compose 背景混音——挂了主题曲则 amix 压低循环垫底，未挂保持原样"
```

---

## Task 4: 前端——可复用画廊选择器 + 选角「从写真库选」+ 出片「主题曲」

**Files:**
- Modify: `prototype/app.js`、`prototype/index.html`、`prototype/styles.css`

- [ ] **Step 1: 可复用画廊选择器**（app.js，drama 区内）

新增一个函数：拉 `GET /api/artist/:id/gallery`、按类型筛选、渲染一个轻量浮层网格、点选回调、点遮罩/取消关闭。签名约定：
```js
// 打开画廊选择器：kind='song'|'photo'；onPick(asset) 选中回调。复用既有 gallery 接口与瓦片样式。
async function openGalleryPicker(kind, onPick) { /* GET /gallery → 过滤 type===kind → 渲染浮层 → 点选调 onPick(asset) 并关闭 */ }
```
浮层 DOM 可在 index.html 加一个隐藏容器 `#gallery-picker`（遮罩 + 网格 + 标题 + 关闭按钮），song 显示标题/时长 + `<audio controls>` 试听，photo 显示缩略图。空态提示「作品库还没有歌/写真」。

- [ ] **Step 2: 选角卡「从写真库选」**（renderDramaCast）

每张 cast 卡（含主演）加一个按钮 `从写真库选`，点击 `openGalleryPicker('photo', async (asset) => { await api(\`${dramaBase()}/${dramaState.drama.id}/cast/${c.id}/portrait\`, { url: asset.url }); renderDrama(刷新) })`。主演卡保留「⬡ 一致性」标识但不再纯只读。出图按钮（配角）与「从写真库选」并列。

- [ ] **Step 3: 出片「主题曲」行**（出片 stage 每集）

每集 tier 切换旁加一行：显示 `主题曲：<曲名 或 无>` + 「选主题曲」按钮 + （已挂时）「清除」。
- 选主题曲：`openGalleryPicker('song', async (asset) => { await api(\`${dramaBase()}/${dramaState.drama.id}/episode/${ep.id}/theme\`, { songUrl: asset.url }); 刷新 })`。
- 清除：`await api(.../theme, { songUrl: null })`。
曲名取该 song 资产的 `title || url` 末段。需要时把画廊 song 列表缓存或在渲染时按 url 匹配出标题。

- [ ] **Step 4: 样式**（styles.css）

加 `#gallery-picker` 遮罩 + 网格 + 卡片样式、`.drama-theme-row` 行样式、选角卡按钮并排。复用 tokens（紫/青）与既有瓦片类。

- [ ] **Step 5: 验证**

`npm run check`（含 prototype/app.js 语法）→ 通过；`npm test` → 100 绿。
起服务器载入页面，确认无 console 报错；用 preview 工具或 curl 确认 app.js `node --check` 通过、页面含「从写真库选」「主题曲」文案。深度交互留给 Task 5 端到端。

- [ ] **Step 6: Commit**

```bash
git add prototype/app.js prototype/index.html prototype/styles.css
git commit -m "feat: 画廊选择器(歌/图) + 选角从写真库选定妆照 + 出片挂主题曲"
```

---

## Task 5: 冒烟守卫 + 端到端实测 + 走查打磨收尾 + 合并

**Files:**
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: 加冒烟守卫**（沿用 `call`/`ok`，放在短剧守卫之后，用既有 `created.data.id`）

```js
  const themeMiss = await call('/api/artist/nope_x/drama/nope/episode/ep_1/theme', { songUrl: null });
  ok('主题曲未知艺人→not_found', themeMiss.status === 200 && themeMiss.data.error?.code === 'not_found', themeMiss.data.error?.code);

  const portMiss = await call('/api/artist/nope_x/drama/nope/cast/c_lead/portrait', { url: '/generated/x.png' });
  ok('定妆照复用未知艺人→not_found', portMiss.status === 200 && portMiss.data.error?.code === 'not_found', portMiss.data.error?.code);
```

- [ ] **Step 2: 跑冒烟**

Run: `npm run smoke`
Expected: 全过（含新增 2 条）。

- [ ] **Step 3: 端到端实测（本机真实）**

建艺人 → 出 1 张写真（作 photo 资产）→ 建短剧、选角 → 用「从写真库选」把那张写真设为某配角定妆照，确认 portrait 版本写入且**成本账本无新增 image**（GET /api/usage 前后对比，或确认未调用 image）。若作品库有 song（或用既有 song 资产），挂为 ep_1 主题曲 → 低成本 compose → 下载成片 ffprobe 确认含混音音轨。前端走查：选择器开合、选角换图、出片挂/清主题曲、画廊试听。记录结果。

- [ ] **Step 4: 走查打磨收尾**

跑 `/code-review`（或人工）扫一遍本特性 diff，把发现的小粗糙（空态文案、错误提示、选择器可访问性、命名）就近修；不做无关重构。修完 `npm run check && npm test && npm run smoke` 全绿。

- [ ] **Step 5: 合并到 master**

```bash
git checkout master
git merge --no-ff xl-cross-line-reuse -m "merge: 跨线复用打通（主题曲接音乐库 + 定妆照接写真库）+ 走查打磨"
npm run check && npm test && npm run smoke
git branch -d xl-cross-line-reuse
```

- [ ] **Step 6: 收尾**

更新记忆（跨线复用已交付）；重启 preview 服务器；向用户汇报。

---

## 自检（spec 覆盖）
- 主题曲逐集可选 → Task 1(themeSongUrl/setEpisodeTheme) + Task 2(theme 端点) + Task 4(出片 UI)。✓
- 主题曲背景混音 → Task 3(amix)。✓
- 定妆照配角+主演从写真库选 → Task 2(cast/:cid/portrait) + Task 4(选角 UI)。✓
- 画廊校验防越权 → Task 2(getGallery 校验)。✓
- 混音健壮跳过 → Task 3(try/exists 跳过)。✓
- 走查打磨 → Task 4(主演可换/选择器复用) + Task 5(code-review 收尾)。✓
- 测试 → Task 1(单测) + Task 5(冒烟 + 端到端 + 零成本复用验证)。✓

类型一致性：`setEpisodeTheme(id,eid,songUrl)`(Task1 定义→Task2 用)、`addPortraitVersion`(既有→Task2 复用)、`themeSongUrl`(Task1 存→Task3 compose 读→Task4 UI 显)、`openGalleryPicker(kind,onPick)`(Task4 内部一致)。已核实 compose 插入点（concat 出 merged 后、烧字幕前，把烧字幕输入改 subInput）。
