# S2 艺人对话室（陪伴）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每位艺人一个 Character.AI 级的陪伴对话：永不出戏、跨会话记忆（近期原文 + 滚动摘要）、情绪/亲密度演化、SSE 流式输出。

**Architecture:** 在 M1 网关 + S1 艺人档案之上，新增 `src/studio/conversations.js`（每艺人一份对话存档，原子写）、`src/studio/companion.js`（in-character 提示词 / 记忆摘要 / 情绪），网关加 `executeStream` + openrouter `invokeStream` + http-fetch `fetchStream`，新增 `/api/artist/:id/chat`（整段）与 `/api/artist/:id/chat/stream`（SSE）端点，前端艺人详情加聊天视图。零 npm 依赖、Node ≥18 ESM。

**Tech Stack:** Node 18+ ESM、node:test、原生 `http` SSE、原生 fetch streaming（ReadableStream reader）、JSON 文件存档、原生 JS 前端（fetch-reader 解析 SSE）。

**通用约定：** 应用层错误 HTTP 200 + `{error:{code,message}}`（SSE 端点在 writeHead 前才能这样返回，之后用 `event: error`）；测试 `npm test`；检查 `npm run check`；冒烟 `npm run smoke`；工作目录 `F:\projects\Starstudio`；提交以 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 结尾；不 push；前端动态串用 `esc()`。区域约束：chat 经 DeepSeek 兜底可用。

---

## 文件总览

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/studio/conversations.js` | 每艺人对话存档（messages/memory/state）原子读写 | 1 |
| `test/conversations.test.js` | 单测 | 1 |
| `src/studio/companion.js` | in-character 提示词、记忆摘要触发、情绪演化 | 2 |
| `test/companion.test.js` | 单测 | 2 |
| `src/lib/http-fetch.js` | 加 `fetchStream` + 纯函数 `splitSSE` | 3 |
| `test/http-stream.test.js` | splitSSE 单测 | 3 |
| `src/providers/openrouter.js` | 加 `invokeStream` | 4 |
| `src/gateway/gateway.js` | 加 `executeStream`；makeCtx 加 `fetchStream` | 4 |
| `test/gateway-stream.test.js` | executeStream 单测（fake provider） | 4 |
| `src/api/routes.js` + `src/bootstrap.js` | chat / chat-stream 端点 + 接线 | 5 |
| `prototype/{index.html,app.js,styles.css}` | 艺人详情聊天视图（流式渲染） | 6 |
| `scripts/smoke.mjs` | 冒烟覆盖 chat 链路 | 7 |

---

### Task 1: 对话存档（src/studio/conversations.js）

**Files:** Create `src/studio/conversations.js`, `test/conversations.test.js`

- [ ] **Step 1: 写失败测试** — `test/conversations.test.js`：

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initConversations, getConversation, appendTurn, setMemory, trimToRecent, resetConversation,
} from '../src/studio/conversations.js';

beforeEach(() => initConversations(fs.mkdtempSync(path.join(os.tmpdir(), 'sscv-'))));

test('空会话返回骨架', () => {
  const c = getConversation('art_1');
  assert.deepEqual(c.messages, []);
  assert.equal(c.memory, '');
  assert.equal(c.state.affinity, 50);
  assert.equal(c.state.mood, '平静');
});

test('appendTurn 持久化两条消息与 state', () => {
  appendTurn('art_1', '你好', '嗨~', { mood: '愉悦', affinity: 52 });
  const c = getConversation('art_1');
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[0].role, 'user');
  assert.equal(c.messages[1].content, '嗨~');
  assert.equal(c.state.affinity, 52);
  assert.ok(c.messages[0].ts);
});

test('setMemory 与 trimToRecent', () => {
  for (let i = 0; i < 6; i++) appendTurn('art_1', `u${i}`, `a${i}`);
  setMemory('art_1', '我们聊过音乐');
  trimToRecent('art_1', 4);
  const c = getConversation('art_1');
  assert.equal(c.memory, '我们聊过音乐');
  assert.equal(c.messages.length, 4);
  assert.equal(c.messages[0].content, 'u4');   // 只留最近 4 条
});

test('非法 artistId 不写盘、reset 安全', () => {
  assert.throws(() => appendTurn('../evil', 'x', 'y'), /非法/);
  assert.deepEqual(getConversation('../evil').messages, []);
  resetConversation('art_1');   // 不存在也不抛
});

test('坏存档不崩，按空骨架', () => {
  appendTurn('art_1', 'a', 'b');
  const dir = getConversation('art_1');   // 确保已建
  resetConversation('art_1');
  assert.deepEqual(getConversation('art_1').messages, []);
});
```

- [ ] **Step 2: 运行确认失败** — `npm test` → conversations 测试 FAIL。

- [ ] **Step 3: 实现** — `src/studio/conversations.js`：

```js
import fs from 'node:fs';
import path from 'node:path';

let convDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function initConversations(dir) {
  convDir = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function emptyConv(artistId) {
  return { artistId, schemaVersion: 1, messages: [], memory: '', state: { mood: '平静', affinity: 50 }, updatedAt: null };
}

const fileFor = (artistId) => path.join(convDir, `${artistId}.json`);

export function getConversation(artistId) {
  const base = emptyConv(artistId);
  if (!convDir || !SAFE_ID.test(artistId)) return base;
  const f = fileFor(artistId);
  if (!fs.existsSync(f)) return base;
  try {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...base, ...c, state: { ...base.state, ...(c.state || {}) }, messages: Array.isArray(c.messages) ? c.messages : [] };
  } catch { return base; }
}

function write(conv) {
  conv.updatedAt = new Date().toISOString();
  const f = fileFor(conv.artistId);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(conv, null, 2));
  fs.renameSync(tmp, f);
}

export function appendTurn(artistId, userContent, aiContent, state) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const conv = getConversation(artistId);
  const ts = new Date().toISOString();
  conv.messages.push({ role: 'user', content: String(userContent ?? ''), ts });
  conv.messages.push({ role: 'assistant', content: String(aiContent ?? ''), ts });
  if (state) conv.state = { mood: state.mood, affinity: state.affinity };
  write(conv);
  return conv;
}

export function setMemory(artistId, memory) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const conv = getConversation(artistId);
  conv.memory = String(memory ?? '');
  write(conv);
  return conv;
}

export function trimToRecent(artistId, keep) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const conv = getConversation(artistId);
  if (conv.messages.length > keep) conv.messages = conv.messages.slice(-keep);
  write(conv);
  return conv;
}

export function resetConversation(artistId) {
  if (!convDir || !SAFE_ID.test(artistId)) return;
  const f = fileFor(artistId);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
```

- [ ] **Step 4: 通过** — `npm test`（全过）+ `npm run check`。
- [ ] **Step 5: Commit** — `git add src/studio/conversations.js test/conversations.test.js && git commit -m "feat: 艺人对话存档（messages/memory/state 原子读写）` + 换行 + 署名行。

---

### Task 2: 陪伴提示词与记忆/情绪（src/studio/companion.js）

**Files:** Create `src/studio/companion.js`, `test/companion.test.js`

- [ ] **Step 1: 写失败测试** — `test/companion.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatSystemPrompt, buildChatMessages, shouldSummarize, buildSummarizeMessages,
  updateEmotion, RECENT_KEEP, SUMMARIZE_AT,
} from '../src/studio/companion.js';

const artist = { name: '星野眠', persona: '慵懒治愈', positioning: 'City Pop歌手',
  personality: ['慢热', '细腻'], speakingStyle: '轻声细语', backstory: '音乐世家出身' };

test('系统提示词注入档案且要求不出戏', () => {
  const s = buildChatSystemPrompt(artist, '聊过爵士乐', { mood: '愉悦', affinity: 60 });
  assert.match(s, /星野眠/);
  assert.match(s, /不能承认自己是 AI|不出戏|身份/);
  assert.match(s, /慵懒治愈/);
  assert.match(s, /聊过爵士乐/);     // 记忆注入
  assert.match(s, /60/);             // 亲密度注入
});

test('buildChatMessages 带近期原文 + 本轮', () => {
  const conv = { memory: 'm', state: { mood: '平静', affinity: 50 },
    messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' + i })) };
  const { system, messages } = buildChatMessages(artist, conv, '在吗');
  assert.match(system, /星野眠/);
  assert.equal(messages.length, RECENT_KEEP + 1);          // 近期 + 本轮
  assert.equal(messages[messages.length - 1].content, '在吗');
});

test('shouldSummarize 阈值', () => {
  assert.equal(shouldSummarize({ messages: new Array(SUMMARIZE_AT - 1) }), false);
  assert.equal(shouldSummarize({ messages: new Array(SUMMARIZE_AT) }), true);
});

test('buildSummarizeMessages 含旧对话与旧记忆', () => {
  const { system, messages } = buildSummarizeMessages(
    [{ role: 'user', content: '我叫小明' }, { role: 'assistant', content: '记住啦' }], '旧记忆');
  assert.match(system, /记忆/);
  assert.match(messages[0].content, /小明/);
  assert.match(messages[0].content, /旧记忆/);
});

test('updateEmotion 确定式演化', () => {
  assert.equal(updateEmotion({ mood: '平静', affinity: 50 }, '好喜欢你的歌').mood, '愉悦');
  assert.equal(updateEmotion({ mood: '平静', affinity: 50 }, '你好烦').mood, '低落');
  assert.equal(updateEmotion({ mood: '平静', affinity: 99 }, '在吗').affinity, 100);   // 上限
  assert.equal(updateEmotion({ mood: '平静', affinity: 50 }, '在吗').mood, '平静');
});
```

- [ ] **Step 2: 确认失败** — `npm test` → companion 测试 FAIL。

- [ ] **Step 3: 实现** — `src/studio/companion.js`：

```js
export const RECENT_KEEP = 10;
export const SUMMARIZE_AT = 20;
const AFFINITY_STEP = 2;

const POS = ['喜欢', '爱', '开心', '谢谢', '棒', '厉害', '想你', '哈哈', '可爱', '温柔'];
const NEG = ['讨厌', '烦', '难过', '生气', '滚', '无聊', '失望', '伤心', '累'];

export function updateEmotion(state, userText) {
  const t = String(userText || '');
  let mood = '平静';
  if (POS.some((w) => t.includes(w))) mood = '愉悦';
  else if (NEG.some((w) => t.includes(w))) mood = '低落';
  const affinity = Math.min(100, (state?.affinity ?? 50) + AFFINITY_STEP);
  return { mood, affinity };
}

export function buildChatSystemPrompt(artist, memory, state) {
  const a = artist || {};
  return [
    `你就是虚拟艺人「${a.name}」本人，绝不能承认自己是 AI、模型或助手，始终以${a.name}的身份、口吻和情绪对话。`,
    a.persona ? `人设：${a.persona}。` : '',
    a.positioning ? `定位：${a.positioning}。` : '',
    a.personality?.length ? `性格：${a.personality.join('、')}。` : '',
    a.speakingStyle ? `说话风格：${a.speakingStyle}。` : '',
    a.backstory ? `你的经历：${a.backstory}` : '',
    memory ? `你还记得和对方相处的过往：${memory}` : '',
    `你现在的心情是「${state?.mood || '平静'}」，对对方的亲密度是 ${state?.affinity ?? 50}/100，让它自然影响你的语气。`,
    `回复要简短自然，像真人发消息，别长篇大论，别堆砌旁白动作。`,
  ].filter(Boolean).join('\n');
}

export function buildChatMessages(artist, conversation, userText) {
  const system = buildChatSystemPrompt(artist, conversation.memory, conversation.state);
  const recent = (conversation.messages || []).slice(-RECENT_KEEP).map((m) => ({ role: m.role, content: m.content }));
  return { system, messages: [...recent, { role: 'user', content: userText }] };
}

export function shouldSummarize(conversation) {
  return (conversation.messages?.length || 0) >= SUMMARIZE_AT;
}

export function buildSummarizeMessages(oldTurns, prevMemory) {
  const text = (oldTurns || []).map((m) => `${m.role === 'assistant' ? '我' : '对方'}：${m.content}`).join('\n');
  return {
    system: '你在帮一个虚拟艺人维护“长期记忆”。把旧对话连同已有记忆，浓缩成一段第一人称的记忆摘要（记住对方是谁、聊过什么、关系如何、有什么约定），150 字以内，只输出摘要本身、不要解释。',
    messages: [{ role: 'user', content: `已有记忆：${prevMemory || '（无）'}\n\n旧对话：\n${text}\n\n请输出更新后的记忆摘要。` }],
  };
}
```

- [ ] **Step 4: 通过** — `npm test` + `npm run check`。
- [ ] **Step 5: Commit** — `git add src/studio/companion.js test/companion.test.js && git commit -m "feat: 陪伴 in-character 提示词、滚动记忆与情绪演化"` + 署名。

---

### Task 3: 流式 HTTP（src/lib/http-fetch.js 加 fetchStream + splitSSE）

**Files:** Modify `src/lib/http-fetch.js`; Create `test/http-stream.test.js`

- [ ] **Step 1: 写 splitSSE 失败测试** — `test/http-stream.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSSE } from '../src/lib/http-fetch.js';

test('splitSSE 解析完整 data 行，保留半行', () => {
  const r1 = splitSSE('data: a\ndata: b\ndata: ');
  assert.deepEqual(r1.datas, ['a', 'b']);
  assert.equal(r1.rest, 'data: ');                 // 半行留到下次
  const r2 = splitSSE(r1.rest + 'c\n');
  assert.deepEqual(r2.datas, ['c']);
  assert.equal(r2.rest, '');
});

test('splitSSE 忽略非 data 行与空 data', () => {
  const r = splitSSE(': comment\nevent: x\ndata:\ndata: ok\n');
  assert.deepEqual(r.datas, ['ok']);
});
```

- [ ] **Step 2: 确认失败** — `npm test` → `splitSSE` 未导出，FAIL。

- [ ] **Step 3: 实现** — 编辑 `src/lib/http-fetch.js`：

(a) 文件末尾追加 `splitSSE` 与 `fetchStream`（`normalizeOpts`、`fromHttpStatus`、`gatewayError` 已在文件内）：

```js
export function splitSSE(buf) {
  const datas = [];
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim();
      if (d) datas.push(d);
    }
  }
  return { datas, rest: buf };
}

// 流式读取（SSE/分块）。每个 data: 负载字符串回调 onChunk。代理隧道暂不支持流式。
export async function fetchStream(url, opts, onChunk) {
  const o = normalizeOpts(url, opts);
  if (o.proxy) throw gatewayError('bad_request', '流式暂不支持代理隧道', { providerId: o.providerId });
  let res;
  try {
    res = await fetch(url, { method: o.method, headers: o.headers, body: o.body, signal: AbortSignal.timeout(o.timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw gatewayError('timeout', `请求超时（${o.timeoutMs}ms）: ${url}`, { providerId: o.providerId });
    throw gatewayError('network', `网络错误: ${err.cause?.code || err.message}`, { providerId: o.providerId, cause: err });
  }
  if (res.status < 200 || res.status >= 300) throw fromHttpStatus(res.status, await res.text(), o.providerId);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const { datas, rest } = splitSSE(carry);
    carry = rest;
    for (const d of datas) onChunk(d);
  }
}
```

- [ ] **Step 4: 通过** — `npm test`（splitSSE 过；既有 http-fetch 测试不回归）+ `npm run check`。
- [ ] **Step 5: Commit** — `git add src/lib/http-fetch.js test/http-stream.test.js && git commit -m "feat: http-fetch 流式读取 fetchStream 与 SSE 行解析 splitSSE"` + 署名。

---

### Task 4: 网关流式（openrouter invokeStream + gateway executeStream）

**Files:** Modify `src/providers/openrouter.js`, `src/gateway/gateway.js`; Create `test/gateway-stream.test.js`

- [ ] **Step 1: 写 executeStream 失败测试** — `test/gateway-stream.test.js`：

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerProvider, initConfig, _resetProviders } from '../src/gateway/registry.js';
import { initLedger } from '../src/gateway/ledger.js';
import { executeStream } from '../src/gateway/gateway.js';
import { gatewayError } from '../src/gateway/errors.js';

function setup(adapters, config) {
  _resetProviders();
  adapters.forEach(registerProvider);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssgs-'));
  const file = path.join(dir, 'cfg.json');
  fs.writeFileSync(file, JSON.stringify(config));
  initConfig(file);
  initLedger(path.join(dir, 'u.jsonl'));
}

const streamer = (id, toks) => ({
  id, label: id, capabilities: ['chat'], envKeys: [], isConfigured: () => true,
  probe: async () => ({ ok: true }), invoke: async () => ({ text: toks.join('') }),
  invokeStream: async (cap, req, ctx, onToken) => { for (const t of toks) onToken(t); return { text: toks.join(''), usage: {} }; },
});

const nonStreamer = (id, text) => ({
  id, label: id, capabilities: ['chat'], envKeys: [], isConfigured: () => true,
  probe: async () => ({ ok: true }), invoke: async () => ({ text, usage: {} }),
});

beforeEach(() => _resetProviders());

test('executeStream 逐 token 回调并返回全文', async () => {
  setup([streamer('a', ['你', '好', '呀'])], { chat: { provider: 'a', model: 'm' } });
  const got = [];
  const r = await executeStream('chat', { messages: [] }, { onToken: (t) => got.push(t) });
  assert.deepEqual(got, ['你', '好', '呀']);
  assert.equal(r.text, '你好呀');
  assert.equal(r.provider, 'a');
});

test('无 invokeStream 的适配器优雅降级为整段 emit', async () => {
  setup([nonStreamer('a', '整段回复')], { chat: { provider: 'a', model: 'm' } });
  const got = [];
  const r = await executeStream('chat', { messages: [] }, { onToken: (t) => got.push(t) });
  assert.deepEqual(got, ['整段回复']);
  assert.equal(r.text, '整段回复');
});

test('首 token 前失败可降级到下一个 provider', async () => {
  const failFast = { id: 'a', label: 'a', capabilities: ['chat'], envKeys: [], isConfigured: () => true,
    probe: async () => ({ ok: true }), invoke: async () => { throw gatewayError('timeout', 'x'); },
    invokeStream: async () => { throw gatewayError('timeout', 'a 超时'); } };
  setup([failFast, streamer('b', ['B'])], { chat: { provider: 'a', model: 'm', fallback: [{ provider: 'b', model: 'm' }] } });
  const got = [];
  const r = await executeStream('chat', { messages: [] }, { onToken: (t) => got.push(t) });
  assert.equal(r.provider, 'b');
  assert.deepEqual(got, ['B']);
});

test('token 已流出后失败不再切 provider', async () => {
  const midFail = { id: 'a', label: 'a', capabilities: ['chat'], envKeys: [], isConfigured: () => true,
    probe: async () => ({ ok: true }), invoke: async () => ({ text: 'x' }),
    invokeStream: async (cap, req, ctx, onToken) => { onToken('半'); throw gatewayError('network', '断了'); } };
  setup([midFail, streamer('b', ['B'])], { chat: { provider: 'a', model: 'm', fallback: [{ provider: 'b', model: 'm' }] } });
  const got = [];
  await assert.rejects(() => executeStream('chat', { messages: [] }, { onToken: (t) => got.push(t) }),
    (e) => e.code === 'network' && e.attempts.length === 1);
  assert.deepEqual(got, ['半']);   // 已流出的 token 不回滚，但不切 b
});
```

- [ ] **Step 2: 确认失败** — `npm test` → `executeStream` 未导出，FAIL。

- [ ] **Step 3a: gateway.js 加 executeStream + makeCtx.fetchStream** — 编辑 `src/gateway/gateway.js`：

顶部 import 改为同时引入 `fetchStream`：
```js
import { fetchJson, fetchBuffer, fetchStream } from '../lib/http-fetch.js';
```
`makeCtx` 的返回对象里、`fetchBuffer` 那行之后加：
```js
    fetchStream: (url, opts = {}, onChunk) => fetchStream(url, { ...base, ...opts }, onChunk),
```
文件末尾（`aggregate` 函数之后）追加：
```js
export async function executeStream(capability, request, { onToken } = {}) {
  const { configured } = resolveRoute(capability);
  if (!configured.length) {
    throw gatewayError('unconfigured', `能力 ${capability} 没有已接入的 Provider`, { hint: '在工作台设置页录入对应平台的 API key' });
  }
  const attempts = [];
  for (const entry of configured) {
    const providerId = entry.provider.id;
    const started = Date.now();
    let emitted = false;
    const emit = (t) => { emitted = true; onToken?.(t); };
    const req = { ...request, model: entry.model, params: entry.params };
    try {
      const ctx = makeCtx(providerId);
      let result;
      if (typeof entry.provider.invokeStream === 'function') {
        result = await entry.provider.invokeStream(capability, req, ctx, emit);
      } else {
        result = await entry.provider.invoke(capability, req, ctx);   // 优雅降级
        if (result.text) emit(result.text);
      }
      recordUsage({
        capability, provider: providerId, model: entry.model,
        durationMs: Date.now() - started, usage: result.usage || {},
        estUsd: costOfUsage(providerId, entry.model, result.usage || {}), ok: true,
      });
      return { ...result, provider: providerId, model: entry.model };
    } catch (err) {
      const ge = err instanceof GatewayError ? err : gatewayError('provider_error', err.message, { providerId, cause: err });
      recordUsage({ capability, provider: providerId, model: entry.model, durationMs: Date.now() - started, estUsd: 0, ok: false, errorCode: ge.code });
      attempts.push({ provider: providerId, code: ge.code, message: ge.message, hint: ge.hint });
      console.error(`[gateway] ${capability}/${providerId} 流式失败(${ge.code}): ${ge.message}`);
      if (emitted || !ge.retriable) throw aggregate(capability, attempts, ge);   // token 已流出则不再切 provider
    }
  }
  throw aggregate(capability, attempts);
}
```

- [ ] **Step 3b: openrouter.js 加 invokeStream** — 编辑 `src/providers/openrouter.js`，在 `const adapter = {...}` 定义之后、`export default adapter;` 之前追加：
```js
adapter.invokeStream = async (capability, request, ctx, onToken) => {
  if (!TEXT_CAPS.has(capability)) throw gatewayError('bad_request', `openrouter 流式不支持能力 ${capability}`, { providerId: 'openrouter' });
  const messages = request.system ? [{ role: 'system', content: request.system }, ...request.messages] : request.messages;
  let full = '';
  await ctx.fetchStream(`${API}/chat/completions`, {
    headers: auth(ctx.env),
    body: { model: request.model, messages, max_tokens: request.maxTokens || 1024, stream: true },
  }, (data) => {
    if (data === '[DONE]') return;
    let j; try { j = JSON.parse(data); } catch { return; }
    const tok = j.choices?.[0]?.delta?.content || '';
    if (tok) { full += tok; onToken(tok); }
  });
  if (!full) throw gatewayError('provider_error', 'OpenRouter 流式返回空内容', { providerId: 'openrouter' });
  return { text: full, usage: { outputTokens: 0 } };
};
```

- [ ] **Step 4: 通过** — `npm test`（gateway-stream 4 测试过；既有网关测试不回归）+ `npm run check`。
- [ ] **Step 5: Commit** — `git add src/gateway/gateway.js src/providers/openrouter.js test/gateway-stream.test.js && git commit -m "feat: 网关流式 executeStream + openrouter invokeStream（首token前可降级）"` + 署名。

---

### Task 5: chat 端点与接线

**Files:** Modify `src/api/routes.js`, `src/bootstrap.js`

- [ ] **Step 1: bootstrap 接线** — `src/bootstrap.js`：加 `import { initConversations } from './studio/conversations.js';`；在 `initArtists(...)` 那行之后加 `initConversations(path.join(DATA_DIR, 'conversations'));`。

- [ ] **Step 2: routes.js import** — 顶部追加：
```js
import { getConversation, appendTurn, setMemory, trimToRecent } from '../studio/conversations.js';
import {
  buildChatMessages, shouldSummarize, buildSummarizeMessages, updateEmotion, RECENT_KEEP,
} from '../studio/companion.js';
import { execute, executeStream } from '../gateway/gateway.js';
```
注意：原本 `import { execute, resolveRoute } from '../gateway/gateway.js';` 已存在——把它合并为 `import { execute, resolveRoute, executeStream } from '../gateway/gateway.js';`，不要重复 import `execute`。

- [ ] **Step 3: 端点** — 在 `registerRoutes(route)` 内，artist portrait 端点之后追加。先加一个模块级 helper（放在 `registerRoutes` 函数外、文件顶层）：
```js
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
```
`registerRoutes` 内追加两个端点：
```js
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
```

- [ ] **Step 4: 验证** — `npm run check` + `npm test`（不回归）。启动服务器（已配 OPENROUTER_API_KEY，chat→DeepSeek 兜底），用 bash + curl，需用已存在的艺人 id（先 `GET /api/artists` 取一个，或创建一个）：
```bash
cd "F:/projects/Starstudio" && PORT=3196 node server.js & SRV=$!
sleep 2
AID=$(curl -s -X POST localhost:3196/api/artist -H 'Content-Type: application/json' -d '{"profile":{"name":"ChatTest","persona":"元气","speakingStyle":"活泼"}}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo "--- 整段 chat ---"
curl -s -X POST "localhost:3196/api/artist/$AID/chat" -H 'Content-Type: application/json' -d '{"message":"你好呀，今天开心吗"}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("reply:",(j.reply||JSON.stringify(j.error)).slice(0,60));console.log("state:",JSON.stringify(j.state))})'
echo "--- 历史持久化 ---"
curl -s "localhost:3196/api/artist/$AID/chat" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log("messages:",JSON.parse(d).messages.length))'
echo "--- SSE 流式（取前若干 event）---"
curl -sN -X POST "localhost:3196/api/artist/$AID/chat/stream" -H 'Content-Type: application/json' -d '{"message":"给我讲讲你自己"}' | head -c 400
echo; echo "--- 缺 message → bad_request ---"
curl -s -X POST "localhost:3196/api/artist/$AID/chat" -H 'Content-Type: application/json' -d '{}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).error?.code))'
kill $SRV 2>/dev/null; rm -rf "F:/projects/Starstudio/data/artists.json" "F:/projects/Starstudio/data/conversations"
```
期望：整段 chat 返回 reply（DeepSeek，扮演 ChatTest 不出戏）+ state.affinity=52；历史 messages=2；SSE 输出含 `event: token` 行与 `event: done`；缺 message → bad_request。若 SSE 无输出，排查 executeStream/invokeStream 根因，不弱化。

- [ ] **Step 5: Commit** — `git add src/api/routes.js src/bootstrap.js && git commit -m "feat: 艺人 chat / chat-stream(SSE) 端点 + 记忆摘要接线"` + 署名。

---

### Task 6: 前端聊天视图

**Files:** Modify `prototype/index.html`, `prototype/app.js`, `prototype/styles.css`

- [ ] **Step 1: index.html 加聊天容器** — 在 `#artist-detail` 之后、`#artist-studio` 的 `</section>` 之前加：
```html
  <div id="chat-view" class="chat-view hidden">
    <div class="panel-head"><h3 id="chat-title"></h3><button id="chat-close">返回</button></div>
    <div id="chat-state" class="ps"></div>
    <div id="chat-log" class="interview-log"></div>
    <div class="row">
      <input id="chat-msg" placeholder="对 ta 说点什么…">
      <button id="chat-send2">发送</button>
    </div>
  </div>
```

- [ ] **Step 2: styles.css 追加**：
```css
.chat-view { margin-top:14px; border-top:1px solid var(--line); padding-top:10px; }
#chat-log { max-height:340px; }
```

- [ ] **Step 3: app.js 加聊天逻辑** — 在 `showArtistDetail` 渲染的按钮区把入口加上：在该函数模板字符串里 `<button id="del-artist"...>` 之前插入 `<button id="open-chat" data-id="${esc(a.id)}">💬 聊天</button> `，并在该函数末尾（绑定 gen-portrait/del-artist 之后）加：
```js
  $('#open-chat').addEventListener('click', (e) => openChat(e.target.dataset.id, a.name));
```
文件末尾追加：
```js
let chatArtistId = null;

function chatBubble(role, content) {
  return `<div class="bubble ${role === 'user' ? 'me' : 'ai'}">${esc(content)}</div>`;
}

async function openChat(id, name) {
  chatArtistId = id;
  $('#chat-view').classList.remove('hidden');
  $('#chat-title').textContent = `与 ${name} 聊天`;
  const data = await api(`/api/artist/${encodeURIComponent(id)}/chat`);
  if (!data.error) {
    $('#chat-log').innerHTML = (data.messages || []).map((m) => chatBubble(m.role, m.content)).join('');
    renderChatState(data.state);
  }
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
}

function renderChatState(s) {
  if (s) $('#chat-state').textContent = `心情：${esc(s.mood)} · 亲密度 ${esc(s.affinity)}/100`;
}

async function sendChat() {
  const text = $('#chat-msg').value.trim();
  if (!text || !chatArtistId) return;
  $('#chat-msg').value = '';
  $('#chat-log').insertAdjacentHTML('beforeend', chatBubble('user', text));
  const aiBubbleId = `b${Date.now()}`;
  $('#chat-log').insertAdjacentHTML('beforeend', `<div class="bubble ai" id="${aiBubbleId}"></div>`);
  const aiEl = document.getElementById(aiBubbleId);
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  try {
    const res = await fetch(`/api/artist/${encodeURIComponent(chatArtistId)}/chat/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let carry = '', acc = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      let i;
      while ((i = carry.indexOf('\n\n')) >= 0) {
        const block = carry.slice(0, i); carry = carry.slice(i + 2);
        const ev = (block.match(/^event: (.*)$/m) || [])[1];
        const dataLine = (block.match(/^data: (.*)$/m) || [])[1];
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine);
        if (ev === 'token') { acc += payload.t; aiEl.textContent = acc; $('#chat-log').scrollTop = $('#chat-log').scrollHeight; }
        else if (ev === 'done') { aiEl.textContent = payload.reply || acc; renderChatState(payload.state); }
        else if (ev === 'error') { aiEl.textContent = errText(payload); }
      }
    }
    if (!acc && !aiEl.textContent) aiEl.textContent = '（无回复）';
  } catch (e) {
    aiEl.textContent = `连接失败：${e.message}`;
  }
}

function initChatView() {
  $('#chat-send2').addEventListener('click', sendChat);
  $('#chat-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  $('#chat-close').addEventListener('click', () => { $('#chat-view').classList.add('hidden'); chatArtistId = null; });
}
```
并在 `boot()` 里加 `initChatView();`。

- [ ] **Step 4: 验证** — `npm run check`。启动 `node server.js`，浏览器 http://127.0.0.1:3100：进一个艺人详情 → 点「💬 聊天」→ 发消息，回复**逐字流式**出现、顶部亲密度上涨、刷新页面后历史还在；控制台零报错。（grep 验证：`curl -s localhost:3100/ | grep -c chat-view` = 1；`curl -s localhost:3100/app.js | grep -c initChatView` = 2。）

- [ ] **Step 5: Commit** — `git add prototype/index.html prototype/app.js prototype/styles.css && git commit -m "feat: 艺人聊天视图（SSE 逐字流式 + 心情亲密度 + 历史）"` + 署名。

---

### Task 7: 冒烟扩展与 S2 验收

**Files:** Modify `scripts/smoke.mjs`

- [ ] **Step 1: 扩冒烟** — 在 `scripts/smoke.mjs` 的 artist 删除检查之前（或 artist 块内、删除前），用已创建的 `created.data.id` 加 chat 断言：
```js

  const chatList0 = await call(`/api/artist/${created.data.id}/chat`);
  ok('chat 历史初始为空', chatList0.status === 200 && Array.isArray(chatList0.data.messages) && chatList0.data.messages.length === 0);

  const chat = await call(`/api/artist/${created.data.id}/chat`, { message: '你好呀' });
  const chatOk = chat.status === 200 && (Boolean(chat.data.reply) || chat.data.error);
  ok('chat 路由可用', chatOk, chat.data.error?.code || (chat.data.reply || '').slice(0, 20));
  // 配 key 时应有 reply + 亲密度上升；无 key 时 unconfigured（仍判路由可用）
  if (chat.data.reply) ok('chat 亲密度上升', chat.data.state?.affinity === 52, String(chat.data.state?.affinity));

  const badChat = await call(`/api/artist/${created.data.id}/chat`, {});
  ok('chat 缺 message → bad_request', badChat.status === 200 && badChat.data.error?.code === 'bad_request', badChat.data.error?.code);
```
（这些必须放在 `artist 删除` 那条之前，因为删除会移除该艺人。）

- [ ] **Step 2: 跑冒烟** — `npm run smoke`，新增约 4 项 chat 断言全 ✓、退出 0（配 key 时 chat 真实调用、亲密度 52；无 key 时 unconfigured 仍判可用）。失败则查根因不弱化。

- [ ] **Step 3: 全量回归与验收** — 记录：`npm run check` 通过；`npm test` 全过（M1 60 + S1 + S2 新增）；`npm run smoke` 全 ✓ 退出 0；`node server.js` 起来后艺人详情可进聊天、逐字流式、亲密度演化、历史持久化、控制台零报错。

- [ ] **Step 4: Commit** — `git add scripts/smoke.mjs && git commit -m "feat: 冒烟覆盖艺人 chat 链路（S2 收口）"` + 署名。

---

## 自检记录（writing-plans Self-Review）

- **Spec 覆盖**（对照 §6.S2）：6.S2-1 会话持久化 → Task 1；6.S2-2 提示词/记忆/情绪 → Task 2 + Task 5 的 maybeSummarize 接线；6.S2-3 流式 → Task 3（fetchStream/splitSSE）+ Task 4（invokeStream/executeStream）+ Task 5（SSE 端点）；6.S2-4 前端 → Task 6；6.S2-5 测试 → Task 1/2/3/4 单测 + Task 7 冒烟。
- **占位符**：无 TBD；提交命令为节省篇幅写成「+ 署名」，执行时补 `\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- **类型一致性**：`getConversation/appendTurn/setMemory/trimToRecent`、`buildChatMessages/buildChatSystemPrompt/shouldSummarize/buildSummarizeMessages/updateEmotion/RECENT_KEEP/SUMMARIZE_AT`、`splitSSE/fetchStream`、`executeStream/invokeStream`、ctx.fetchStream、端点契约（chat→{reply,state}、stream→event token/done/error、GET chat→{messages,state}）跨 Task 1→2→3→4→5→6 命名核对一致。conversation.state={mood,affinity}、updateEmotion 返回同形。
- **范围**：单一里程碑（陪伴对话），装得进一个计划；流式作为其中 2 个任务（3/4）而非独立里程碑。
- **歧义**：流式失败语义明确（首 token 前可降级、已 emit 则不切 provider 并抛聚合错误，Task 4 测试锁定）；记忆摘要失败不影响对话（maybeSummarize try/catch）。

