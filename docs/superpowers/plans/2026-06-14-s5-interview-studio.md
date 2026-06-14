# S5 访谈成片工作室（MVP）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** 给艺人一条访谈成片生产线：AI 策划访谈企划 → AI 编剧记者×艺人对话 → 多角色 TTS 配音 → SRT 字幕 → ffmpeg 合成（艺人肖像静态画面 + 配音 + 烧录字幕）→ 真实可播放 MP4 入画廊。

**MVP 简化（诚实标注）：** 不做实时浏览器录音/ASR（改 AI 编剧对话）；不做全 i2v 双人画面（用静态肖像 talking-head + 字幕）。这两项为后续增强。

**Architecture:** 新增 `src/lib/ffmpeg.js`（ffmpeg/ffprobe 路径探测 env→PATH→WinGet + 运行助手）；`src/studio/interview.js`（策划/脚本/SRT 纯函数）；策划+脚本走 `content` 能力（同步）；合成阶段是**多能力编排**（逐句 tts + ffmpeg），不走 gateway 单能力 job——用 **SSE 端点**逐阶段推进度；成片入艺人画廊（type 'interview'）。前端访谈工作室（5 阶段 stepper）。零 npm 依赖。ffmpeg 为本机 CPU 工具（CL-3）。

**通用约定：** 错误 HTTP 200 + `{error}`；测试 `npm test`；检查 `npm run check`；冒烟 `npm run smoke`；署名 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；不 push；前端 `esc()`。**DASHSCOPE_API_KEY（tts/content via DeepSeek）+ ffmpeg 已就绪**，可真实出片验收。

---

## 文件总览
| 文件 | 职责 | 任务 |
|---|---|---|
| `src/lib/ffmpeg.js` + `test/ffmpeg.test.js` | ffmpeg/ffprobe 路径探测 + 运行 + 时长 | 1 |
| `src/studio/interview.js` + `test/interview.test.js` | 策划/脚本提示词、对话解析、SRT 生成（纯函数） | 2 |
| `src/api/routes.js` `src/bootstrap.js` | 策划/脚本端点 + 合成 SSE 端点（TTS+ffmpeg 编排） | 3 |
| `prototype/{index.html,app.js,styles.css}` | 访谈工作室（5 阶段 stepper + 成片） | 4 |
| `scripts/smoke.mjs` | 冒烟覆盖访谈守卫 | 5 |

---

### Task 1: ffmpeg 助手（src/lib/ffmpeg.js）

**Files:** Create `src/lib/ffmpeg.js`, `test/ffmpeg.test.js`

- [ ] **Step 1: 失败测试** — `test/ffmpeg.test.js`（只测纯逻辑：路径解析优先级、srt 时间格式；真实 ffmpeg 运行在 Task 3 联调）：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { srtTime, buildSrt } from '../src/lib/ffmpeg.js';

test('srtTime 格式 HH:MM:SS,mmm', () => {
  assert.equal(srtTime(0), '00:00:00,000');
  assert.equal(srtTime(1.5), '00:00:01,500');
  assert.equal(srtTime(3661.25), '01:01:01,250');
});

test('buildSrt 逐段累加时间轴', () => {
  const srt = buildSrt([
    { text: '你好', durationSec: 1 },
    { text: '欢迎', durationSec: 2 },
  ]);
  assert.match(srt, /1\n00:00:00,000 --> 00:00:01,000\n你好/);
  assert.match(srt, /2\n00:00:01,000 --> 00:00:03,000\n欢迎/);
});
```

- [ ] **Step 2: 确认失败** — `npm test` → FAIL。

- [ ] **Step 3: 实现** — `src/lib/ffmpeg.js`：
```js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

let cachedFfmpeg = null;
let cachedFfprobe = null;

function findOnPath(cmd) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(which, [cmd], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    return out && fs.existsSync(out) ? out : null;
  } catch { return null; }
}

function findInWinget(exe) {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(base)) return null;
  try {
    for (const d of fs.readdirSync(base)) {
      if (!/ffmpeg/i.test(d)) continue;
      // glob: <base>/<pkg>/ffmpeg-*-full_build/bin/<exe>
      const pkg = path.join(base, d);
      for (const sub of fs.readdirSync(pkg)) {
        const cand = path.join(pkg, sub, 'bin', exe);
        if (fs.existsSync(cand)) return cand;
      }
    }
  } catch {}
  return null;
}

export function resolveFfmpeg() {
  if (cachedFfmpeg) return cachedFfmpeg;
  cachedFfmpeg = process.env.FFMPEG_PATH || findOnPath('ffmpeg') || findInWinget('ffmpeg.exe') || null;
  return cachedFfmpeg;
}

export function resolveFfprobe() {
  if (cachedFfprobe) return cachedFfprobe;
  cachedFfprobe = process.env.FFPROBE_PATH || findOnPath('ffprobe') || findInWinget('ffprobe.exe') || null;
  return cachedFfprobe;
}

export function ffmpegAvailable() { return Boolean(resolveFfmpeg() && resolveFfprobe()); }

export function runFfmpeg(args, timeoutMs = 300000) {
  const bin = resolveFfmpeg();
  if (!bin) throw new Error('未找到 ffmpeg，请安装并加入 PATH 或设置 FFMPEG_PATH');
  const r = spawnSync(bin, args, { timeout: timeoutMs, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${(r.stderr || '').slice(-400)}`);
}

export function probeDurationSec(file) {
  const bin = resolveFfprobe();
  if (!bin) return 0;
  try {
    const out = execFileSync(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    return parseFloat(out.trim()) || 0;
  } catch { return 0; }
}

export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(mmm, 3)}`;
}

export function buildSrt(segments) {
  let t = 0, out = '';
  segments.forEach((seg, i) => {
    const start = t; t += seg.durationSec || 0;
    out += `${i + 1}\n${srtTime(start)} --> ${srtTime(t)}\n${seg.text}\n\n`;
  });
  return out;
}
```

- [ ] **Step 4: 通过** — `npm test` + `npm run check`。**确认本机 ffmpeg 可探测**：`node -e "import('./src/lib/ffmpeg.js').then(m=>console.log('ffmpeg:',m.resolveFfmpeg(),'ffprobe:',m.resolveFfprobe(),'avail:',m.ffmpegAvailable()))"` —— 应打印真实路径 + avail:true。
- [ ] **Step 5: Commit** — `git add src/lib/ffmpeg.js test/ffmpeg.test.js && git commit -m "feat: ffmpeg 路径探测与 SRT/运行助手（本机 CPU 工具）"` + 署名。

---

### Task 2: 访谈编排纯函数（src/studio/interview.js）

**Files:** Create `src/studio/interview.js`, `test/interview.test.js`

- [ ] **Step 1: 失败测试** — `test/interview.test.js`：
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanMessages, buildScriptMessages, extractDialogue } from '../src/studio/interview.js';

const artist = { name: '霓夜', persona: '赛博国风', positioning: '合成歌姬', backstory: '旧唱片行长大' };

test('buildPlanMessages 注入艺人与主题', () => {
  const r = buildPlanMessages(artist, '新专辑幕后');
  assert.match(r.system, /访谈|企划|JSON/);
  assert.match(r.messages[0].content, /新专辑幕后/);
  assert.match(r.messages[0].content, /霓夜/);
});

test('buildScriptMessages 要求记者×艺人对话 JSON', () => {
  const r = buildScriptMessages(artist, { questions: ['你怎么开始音乐的？'] });
  assert.match(r.system, /记者|对话|speaker|JSON/);
  assert.match(r.messages[0].content, /你怎么开始音乐的/);
});

test('extractDialogue 解析对话数组', () => {
  const d = extractDialogue('```json\n{"dialogue":[{"speaker":"记者","text":"你好"},{"speaker":"霓夜","text":"嗨"}]}\n```');
  assert.equal(d.length, 2);
  assert.equal(d[0].speaker, '记者');
  assert.equal(d[1].text, '嗨');
  assert.throws(() => extractDialogue('无'), /对话|JSON/);
});
```

- [ ] **Step 2: 确认失败** — `npm test` → FAIL。

- [ ] **Step 3: 实现** — `src/studio/interview.js`：
```js
const JSON_ONLY = '只输出一个 JSON 对象，不要额外文字、不要 markdown 围栏。';

export function buildPlanMessages(artist, topic) {
  const a = artist || {};
  const system = [
    '你是一档人物访谈节目的策划。为下面这位虚拟艺人设计一期访谈企划。',
    `艺人：${a.name || ''}，人设：${a.persona || ''}，定位：${a.positioning || ''}，背景：${a.backstory || ''}。`,
    '企划含字段：guestProfile(嘉宾画像一段)、angle(切入角度)、questions(6-8 个有深度、贴合艺人的问题数组)。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `访谈主题：${topic || '围绕艺人的音乐与成长'}\n\n请输出访谈企划 JSON。` }] };
}

export function buildScriptMessages(artist, plan) {
  const a = artist || {};
  const qs = (plan?.questions || []).map((q, i) => `${i + 1}. ${q}`).join('\n');
  const system = [
    `你在写一档访谈节目的完整逐字稿，对话双方是"记者"和虚拟艺人"${a.name || ''}"。`,
    `艺人需全程 in-character（人设：${a.persona || ''}，说话风格贴合其背景：${a.backstory || ''}），回答有血肉、自然口语。`,
    '输出字段：dialogue —— 一个数组，每项 {speaker: "记者" 或艺人名, text: 一句话台词}，记者提问、艺人作答交替，约 10-16 轮。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `访谈问题：\n${qs || '自由发挥'}\n\n请输出完整对话 JSON。` }] };
}

export function extractDialogue(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('未在响应中找到对话 JSON');
  let obj; try { obj = JSON.parse(s.slice(a, b + 1)); } catch { throw new Error('对话 JSON 解析失败'); }
  const d = Array.isArray(obj.dialogue) ? obj.dialogue : (Array.isArray(obj) ? obj : null);
  if (!d || !d.length) throw new Error('对话为空');
  return d.filter((x) => x && x.text).map((x) => ({ speaker: String(x.speaker || '记者'), text: String(x.text) }));
}
```

- [ ] **Step 4: 通过** — `npm test` + `npm run check`。
- [ ] **Step 5: Commit** — `git add src/studio/interview.js test/interview.test.js && git commit -m "feat: 访谈策划/脚本提示词与对话解析"` + 署名。

---

### Task 3: 访谈端点（策划/脚本 + 合成 SSE）

**Files:** Modify `src/api/routes.js`, `src/bootstrap.js`

- [ ] **Step 1: bootstrap** — 健康面板可选展示 ffmpeg；最小改动：本任务不强制改 bootstrap，除非需要 initAssets 已在。**跳过**（addAssets/getGallery 已引入 routes）。

- [ ] **Step 2: routes import** — 加：
```js
import { buildPlanMessages, buildScriptMessages, extractDialogue } from '../studio/interview.js';
import { ffmpegAvailable, runFfmpeg, probeDurationSec, buildSrt } from '../lib/ffmpeg.js';
import fs from 'node:fs';
import path from 'node:path';
import { GENERATED_DIR } from '../lib/paths.js';   // 若已引入则合并
```
（`getArtist`/`execute`/`addAssets`/`json`/`jsonError`/`sendGatewayError` 已在。需要 dashscope tts：通过 `execute('tts', {text, voice})` 走能力网关。）

- [ ] **Step 3: 策划/脚本端点（同步）**：
```js
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
```
加模块级助手 `function stripFence(t){return String(t).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'');}`（放文件顶层；extractDialogue 内已自带，这里给 plan 用）。

- [ ] **Step 4: 合成 SSE 端点** — 逐句 TTS + ffmpeg 合成，SSE 推进度：
```js
  route('POST /api/artist/:id/interview/compose', async (req, res, { params, readJsonBody }) => {
    const body = await readJsonBody();
    const artist = getArtist(params.id);
    if (!artist) return jsonError(res, 'not_found', `无此艺人 ${params.id}`);
    const dialogue = Array.isArray(body.dialogue) ? body.dialogue : null;
    if (!dialogue || !dialogue.length) return jsonError(res, 'bad_request', 'dialogue 必填');
    if (!ffmpegAvailable()) return jsonError(res, 'bad_request', '未检测到 ffmpeg，请安装后重启服务');
    const frame = (getGallery(params.id).assets.find((a) => a.type === 'photo')?.url) || artist.portraits?.[0]?.url;
    if (!frame) return jsonError(res, 'bad_request', '请先为该艺人生成一张写真作为画面');

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const tmp = fs.mkdtempSync(path.join(GENERATED_DIR, 'iv_'));
    try {
      // 1) 逐句 TTS（记者用 Ethan，艺人按性别用 Cherry/Ethan）
      send('stage', { stage: 'audio', progress: 5, msg: '配音中' });
      const artistVoice = (artist.gender || '').match(/男|male/i) ? 'Ethan' : 'Cherry';
      const segs = [];
      for (let i = 0; i < dialogue.length; i++) {
        const line = dialogue[i];
        const voice = line.speaker === '记者' ? 'Chelsie' : artistVoice;
        const r = await execute('tts', { text: line.text, voice });
        const url = r.files?.[0]?.url;
        const abs = path.join(GENERATED_DIR, url.replace('/generated/', ''));
        const dur = probeDurationSec(abs);
        segs.push({ text: line.text, file: abs, durationSec: dur });
        send('stage', { stage: 'audio', progress: 5 + Math.round((i + 1) / dialogue.length * 60), msg: `配音 ${i + 1}/${dialogue.length}` });
      }
      // 2) 拼接音频
      send('stage', { stage: 'subtitle', progress: 68, msg: '生成字幕与音轨' });
      const listFile = path.join(tmp, 'list.txt');
      fs.writeFileSync(listFile, segs.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'));
      const audioOut = path.join(tmp, 'audio.mp3');
      runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', audioOut]);
      // 3) SRT
      const srt = buildSrt(segs);
      const srtFile = path.join(tmp, 'sub.srt');
      fs.writeFileSync(srtFile, srt);
      // 4) 合成 MP4（肖像静帧 + 音轨 + 烧录字幕）
      send('stage', { stage: 'final', progress: 80, msg: '合成成片' });
      const frameAbs = path.join(GENERATED_DIR, frame.replace('/generated/', ''));
      const name = `iv_${Date.now()}.mp4`;
      const outAbs = path.join(GENERATED_DIR, name);
      const srtEsc = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
      runFfmpeg(['-y', '-loop', '1', '-i', frameAbs, '-i', audioOut,
        '-vf', `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,subtitles='${srtEsc}'`,
        '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', outAbs], 300000);
      const url = `/generated/${name}`;
      const totalSec = segs.reduce((a, s) => a + s.durationSec, 0);
      addAssets(params.id, [{ type: 'interview', url, prompt: '访谈成片', durationSec: Math.round(totalSec), title: '访谈节目' }]);
      send('done', { url, durationSec: Math.round(totalSec) });
    } catch (e) {
      send('error', e instanceof GatewayError ? e.toJSON() : { code: 'internal', message: e.message });
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      res.end();
    }
  });
```
注：tts 逐句产物落 GENERATED_DIR（可服务）；中间文件落临时子目录用完即删；成片 9:16 静帧+字幕。`GatewayError` 已在 routes 引入。

- [ ] **Step 5: 验证 + 真实出片** — `npm run check` + `npm test`。真实联调（已配 key + ffmpeg）：
```bash
cd "F:/projects/Starstudio" && PORT=3192 node server.js & SRV=$!
sleep 2
AID=$(curl -s -X POST localhost:3192/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"IvTest","gender":"女","persona":"知性","positioning":"歌手","backstory":"音乐世家"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
curl -s -X POST "localhost:3192/api/artist/$AID/photo" -H 'Content-Type: application/json' -d '{"shot":"近景","aspect":"3:4","count":1}' >/dev/null
echo "plan:"; PLAN=$(curl -s -X POST "localhost:3192/api/artist/$AID/interview/plan" -H 'Content-Type: application/json' -d '{"topic":"音乐与成长"}'); echo "$PLAN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.plan?("OK q="+(j.plan.questions||[]).length):JSON.stringify(j.error))})'
echo "script:"; SCRIPT=$(curl -s -X POST "localhost:3192/api/artist/$AID/interview/script" -H 'Content-Type: application/json' -d "{\"plan\":$(echo "$PLAN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(d).plan)))')}"); echo "$SCRIPT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.dialogue?("OK lines="+j.dialogue.length):JSON.stringify(j.error))})'
echo "compose (SSE, real TTS+ffmpeg, ~1-3min):"; curl -sN -X POST "localhost:3192/api/artist/$AID/interview/compose" -H 'Content-Type: application/json' -d "{\"dialogue\":$(echo "$SCRIPT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(d).dialogue.slice(0,4))))')}" | grep -E 'event: (stage|done|error)' | tail -8
echo "gallery interview:"; curl -s "localhost:3192/api/artist/$AID/gallery" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).assets;console.log("interview:",a.filter(x=>x.type==="interview").length, a.filter(x=>x.type==="interview")[0]&&a.filter(x=>x.type==="interview")[0].url)}'
kill $SRV 2>/dev/null; rm -rf "F:/projects/Starstudio/data/artists.json" "F:/projects/Starstudio/data/assets"; ls "F:/projects/Starstudio/prototype/generated/"/iv_*.mp4 2>/dev/null
echo done</bash>
```
（脚本取前 4 句加速验收。）期望：plan OK + questions；script OK + lines；compose SSE 出 stage→done，gallery interview≥1，真实 .mp4 生成可播放。若 ffmpeg 命令失败，读 stderr 修 ffmpeg 参数（字幕路径转义在 Windows 是常见坑）。

- [ ] **Step 6: Commit** — `git add src/api/routes.js && git commit -m "feat: 访谈策划/脚本/合成(SSE+TTS+ffmpeg)端点"` + 署名。

---

### Task 4: 前端访谈工作室

**Files:** Modify `prototype/{index.html,app.js,styles.css}`

- [ ] **Step 1**: 把访谈成片占位页换成 5 阶段流程：主题输入 +「生成企划」→ 企划卡（angle + questions 可看）→「生成脚本」→ 对话逐字稿（可编辑/删行）→「合成成片」（需先有写真）→ stepper（script/audio/subtitle/final 进度，SSE 驱动）→ 成片 `<video>` 播放 + 入画廊。
- [ ] **Step 2: app.js** — `initInterviewStudio()`（boot 调用）：plan=`POST /interview/plan`；script=`POST /interview/script {plan}`→渲染可编辑对话；compose=fetch `/interview/compose` 读 SSE（复用 chat-stream 的 reader 解析）逐阶段更新 stepper，done 展示 video、刷画廊。需当前艺人 + 至少一张写真。esc() 全部。
- [ ] **Step 3: styles.css** — stepper（done/cur/pending 三态）、对话行、成片播放器样式（tokens）。
- [ ] **Step 4: 验证** — `npm run check`；浏览器：访谈页选艺人→出写真→生成企划→生成脚本→合成（看阶段进度）→成片可播放；控制台零报错。grep `initInterviewStudio`=2。
- [ ] **Step 5: Commit** — `git add prototype/index.html prototype/app.js prototype/styles.css && git commit -m "feat: 访谈工作室前端——5 阶段管线 + 成片"` + 署名。

---

### Task 5: 冒烟与 S5 验收合并

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1**: artist 块（删除前）加：
```js

  const planMiss = await call('/api/artist/nope_x/interview/plan', { topic: 'x' });
  ok('企划未知艺人→not_found', planMiss.status === 200 && planMiss.data.error?.code === 'not_found', planMiss.data.error?.code);

  const composeEmpty = await call(`/api/artist/${created.data.id}/interview/compose`, {});
  ok('合成无对话→bad_request', composeEmpty.status === 200 && composeEmpty.data.error?.code === 'bad_request', composeEmpty.data.error?.code);
```
（真实成片在 Task 3 联调验过；冒烟不跑 ffmpeg。）

- [ ] **Step 2**: `npm run smoke` 全 ✓ 退出 0。
- [ ] **Step 3: 全量回归** — check/test/smoke 全绿；浏览器五阶段出片；控制台零报错。
- [ ] **Step 4: Commit + 合并** — commit smoke；终审子代理整体评审 S5；通过合并回 master、删分支、master 复跑。

---

## 自检（writing-plans Self-Review）
- **Spec 覆盖**（brief §3 访谈成片 5 阶段 + §4 一致性）：策划→Task 2/3；脚本（记者×艺人 in-character）→Task 2/3；配音（多角色 TTS）→Task 3 compose；字幕 SRT→Task 1 buildSrt + Task 3；ffmpeg 合成→Task 1 runFfmpeg + Task 3；5 阶段进度→Task 4 stepper（SSE）；入画廊→Task 3 addAssets type interview。简化（无录音/ASR、静帧非 i2v 双人）已在顶部标注。
- **占位符**：无 TBD；ffmpeg 参数（尤其 Windows 字幕路径转义）在 Task 3 Step 5 真实联调校准。
- **类型一致性**：resolveFfmpeg/ffmpegAvailable/runFfmpeg/probeDurationSec/srtTime/buildSrt、buildPlanMessages/buildScriptMessages/extractDialogue、端点契约（plan→{plan}、script→{dialogue}、compose→SSE stage/done/error）、asset type 'interview'、execute('tts',{text,voice}) 跨 Task 1→2→3→4 一致。
- **范围**：单一里程碑（访谈成片 MVP）。
- **歧义**：合成是多能力编排（非 gateway 单能力 job），用 SSE 端点逐阶段；ffmpeg 为本机工具，探测不到则 bad_request 友好提示。
