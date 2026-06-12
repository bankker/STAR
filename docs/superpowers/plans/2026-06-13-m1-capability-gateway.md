# AI Star Studio v3 — M1 能力网关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全新实现 AI Star Studio v3 的 M1 平台地基——能力网关、6 个云端 Provider 适配器、异步 job 队列、成本账本、健康面板与验证工作台。

**Architecture:** Node ≥18 原生 `http` 服务器（端口 3100）+ 静态 `prototype/` 工作台，零 npm 依赖。`src/gateway/` 承载路由/降级链/队列/账本，`src/providers/` 一平台一适配器，`config/ai-providers.json` 配置驱动。上游设计：`docs/superpowers/specs/2026-06-13-m1-capability-gateway-design.md`（下称「设计」）。

**Tech Stack:** Node 18+ ESM、node:test、原生 fetch（代理走 node:http CONNECT 隧道）、原生 JS 前端。

**通用约定（所有任务遵守）：**
- 应用层错误一律 HTTP 200 + `{ "error": { "code", "message", ... } }`；400 仅用于 JSON 解析失败，404 未知路由，500 仅未捕获异常。
- 外部平台的 URL/模型 ID/字段名以**执行当日官方文档为准**：任务内标注「⚠️ 文档校准」的步骤必须先用 WebFetch 核对再写实现，常量统一放适配器文件顶部。
- 测试命令：`node --test test/`；语法检查：`npm run check`。工作目录均为 `F:\projects\Starstudio`。

---

## 文件总览

| 文件 | 职责 | 引入任务 |
|---|---|---|
| `package.json` `start_all.bat` `.env.example` | 工程骨架 | 1 |
| `server.js` | 薄入口：HTTP 监听、路由分发、静态服务 | 1 |
| `scripts/check.mjs` | 全量 `node --check` | 1 |
| `src/lib/paths.js` | 目录常量 | 1 |
| `src/lib/env.js` | .env 读取/写入 | 1 |
| `src/lib/files.js` | 路径防穿越、generated/ 落盘、dataUrl 解析 | 1 |
| `src/api/routes.js` | 全部 API 处理器（逐任务追加） | 1 |
| `src/gateway/errors.js` | GatewayError 与 HTTP 状态归一化 | 2 |
| `src/gateway/registry.js` | Provider 注册表、config 读写校验 | 3 |
| `config/ai-providers.json` | 默认路由 | 3 |
| `src/gateway/costs.js` | 单价表、estimateRequest/costOfUsage | 4 |
| `src/gateway/ledger.js` | ai-usage.jsonl 追加与周聚合 | 5 |
| `src/lib/http-fetch.js` | fetchJson/fetchBuffer：超时、错误归一、CONNECT 代理 | 6 |
| `src/gateway/gateway.js` | resolveRoute、execute 降级链、ctx 注入 | 7 |
| `src/providers/{anthropic,dashscope,openrouter}.js` + `index.js` | 文本适配器 | 8 |
| `src/gateway/health.js` | 三态健康探测与缓存 | 9 |
| `prototype/{index.html,app.js,styles.css}` | 工作台（健康+聊天 v1，后续任务扩卡片） | 9 |
| `src/gateway/jobs.js` | 异步 job 队列 | 10 |
| `src/providers/gemini.js` | 图像（预留文本/Veo） | 12 |
| `src/providers/kling.js` | 视频 | 13 |
| `src/providers/suno.js` | 音乐 | 14 |
| `scripts/smoke.mjs` `README.md` | 冒烟与文档 | 17 |

---

### Task 1: 工程骨架、静态服务与安全文件工具

**Files:**
- Create: `package.json`, `start_all.bat`, `.env.example`, `server.js`, `scripts/check.mjs`, `src/lib/paths.js`, `src/lib/env.js`, `src/lib/files.js`, `src/api/routes.js`, `prototype/index.html`(占位), `prototype/styles.css`(空), `prototype/app.js`(空)
- Test: `test/files.test.js`

- [ ] **Step 1: 写 safeJoin/dataUrl 的失败测试**

`test/files.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { safeJoin, dataUrlToBuffer } from '../src/lib/files.js';

const root = path.resolve('prototype');

test('safeJoin 正常路径', () => {
  assert.equal(safeJoin(root, '/index.html'), path.join(root, 'index.html'));
});

test('safeJoin 阻止路径穿越', () => {
  assert.equal(safeJoin(root, '/../server.js'), null);
  assert.equal(safeJoin(root, '/..%2f..%2f.env'), null);
  assert.equal(safeJoin(root, '/a/../../.env'), null);
});

test('dataUrlToBuffer 解析与拒绝', () => {
  const { mime, buf } = dataUrlToBuffer('data:image/png;base64,' + Buffer.from('hi').toString('base64'));
  assert.equal(mime, 'image/png');
  assert.equal(buf.toString(), 'hi');
  assert.throws(() => dataUrlToBuffer('not-a-data-url'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/`
Expected: FAIL（`Cannot find module ... files.js`）

- [ ] **Step 3: 实现骨架文件**

`package.json`：

```json
{
  "name": "ai-star-studio",
  "version": "3.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "dev": "node server.js",
    "start": "node server.js",
    "check": "node scripts/check.mjs",
    "test": "node --test test/",
    "smoke": "node scripts/smoke.mjs"
  }
}
```

`src/lib/paths.js`：

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROTOTYPE_DIR = path.join(ROOT_DIR, 'prototype');
export const GENERATED_DIR = path.join(PROTOTYPE_DIR, 'generated');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const CONFIG_FILE = path.join(ROOT_DIR, 'config', 'ai-providers.json');
export const ENV_FILE = path.join(ROOT_DIR, '.env');
```

`src/lib/env.js`：

```js
import fs from 'node:fs';

export function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export function setEnvKey(file, key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`非法环境变量名: ${key}`);
  if (/[\r\n]/.test(value)) throw new Error('值不能包含换行');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(text)) text = text.replace(re, line);
  else text = text + (text === '' || text.endsWith('\n') ? '' : '\n') + line + '\n';
  fs.writeFileSync(file, text);
  process.env[key] = value;
}
```

`src/lib/files.js`：

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function safeJoin(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const clean = path.normalize(decoded).replace(/^[/\\]+/, '');
  const full = path.resolve(root, clean);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export function saveBufferToGenerated(genDir, buf, ext) {
  fs.mkdirSync(genDir, { recursive: true });
  const name = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const filePath = path.join(genDir, name);
  fs.writeFileSync(filePath, buf);
  return { path: filePath, url: `/generated/${name}` };
}

export function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('无效的 dataUrl');
  return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
}
```

`src/api/routes.js`（v1，后续任务在此追加处理器）：

```js
const MAX_BODY = 1 * 1024 * 1024;
const MAX_MEDIA_BODY = 32 * 1024 * 1024;
const MEDIA_BODY_PATHS = new Set(['/api/ai/asr', '/api/ai/image', '/api/ai/video']);

export function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function jsonError(res, code, message, extra = {}) {
  json(res, { error: { code, message, ...extra } });
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

export function registerRoutes(route) {
  route('GET /api/ping', async (req, res) => json(res, { ok: true, ts: Date.now() }));
}
```

`server.js`：

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './src/lib/env.js';
import { safeJoin } from './src/lib/files.js';
import { ROOT_DIR, PROTOTYPE_DIR, GENERATED_DIR, ENV_FILE } from './src/lib/paths.js';
import { registerRoutes, json, jsonError, readJsonBody } from './src/api/routes.js';

loadEnv(ENV_FILE);
const PORT = Number(process.env.PORT || 3100);

const exact = new Map();
const dynamic = []; // { method, segments:['api','jobs',':id'], handler }
function route(key, handler) {
  const [method, p] = key.split(' ');
  if (p.includes('/:')) dynamic.push({ method, segments: p.split('/').filter(Boolean), handler });
  else exact.set(key, handler);
}
function matchDynamic(method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of dynamic) {
    if (r.method !== method || r.segments.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.segments.forEach((s, i) => {
      if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(segs[i]);
      else if (s !== segs[i]) ok = false;
    });
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8',
};

function serveStatic(res, pathname) {
  const root = pathname.startsWith('/generated/') ? GENERATED_DIR : PROTOTYPE_DIR;
  const rel = pathname.startsWith('/generated/') ? pathname.slice('/generated/'.length) : (pathname === '/' ? 'index.html' : pathname);
  const full = safeJoin(root, rel);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

registerRoutes(route);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    const handler = exact.get(`${req.method} ${pathname}`);
    if (handler) return await handler(req, res, { url, readJsonBody: () => readJsonBody(req, pathname) });
    const dyn = matchDynamic(req.method, pathname);
    if (dyn) return await dyn.handler(req, res, { url, params: dyn.params, readJsonBody: () => readJsonBody(req, pathname) });
    if (pathname.startsWith('/api/')) return jsonError(res, 'not_found', `未知端点: ${pathname}`);
    if (req.method === 'GET') return serveStatic(res, pathname);
    res.writeHead(405).end();
  } catch (err) {
    if (err.message === 'JSON 解析失败' || err.message === '请求体过大') return json(res, { error: { code: 'bad_request', message: err.message } }, 400);
    console.error('[server] 未捕获异常', err);
    json(res, { error: { code: 'internal', message: '服务器内部错误' } }, 500);
  }
});

server.listen(PORT, () => console.log(`AI Star Studio v3 → http://127.0.0.1:${PORT} （根目录 ${ROOT_DIR}）`));
```

`scripts/check.mjs`：

```js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'generated', 'logs', 'data']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
  }
})(process.cwd());

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (err) { failed++; console.error(`✗ ${f}\n${err.stderr}`); }
}
console.log(`check: ${files.length - failed}/${files.length} 通过`);
process.exit(failed ? 1 : 0);
```

`start_all.bat`：

```bat
@echo off
cd /d %~dp0
start "AI Star Studio Server" cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3100
```

`.env.example`：

```
# 每个 Provider 独立 key，全部仅存服务端（GW-5）。未配置的平台健康面板显示「未接入」。
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DASHSCOPE_API_KEY=
OPENROUTER_API_KEY=
SUNO_API_KEY=
KLING_ACCESS_KEY=
KLING_SECRET_KEY=
# PORT=3100
# JOBS_CONCURRENCY=2
```

`prototype/index.html`（占位，Task 9 替换为完整工作台）：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>AI Star Studio v3</title><link rel="stylesheet" href="/styles.css"></head>
<body><h1>AI Star Studio v3 — M1 工作台（建设中）</h1><script src="/app.js"></script></body>
</html>
```

`prototype/app.js` 与 `prototype/styles.css` 先创建为空文件。

- [ ] **Step 4: 运行测试与检查确认通过**

Run: `node --test test/` → 全部 PASS；`npm run check` → 全部通过。

- [ ] **Step 5: 手动验证服务器**

Run: `node server.js`（后台），然后 `curl http://127.0.0.1:3100/api/ping` → `{"ok":true,...}`；`curl http://127.0.0.1:3100/` → 占位 HTML；`curl "http://127.0.0.1:3100/..%2f.env"` → 404。验证后停止服务器。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: M1 工程骨架——静态服务、路由分发、env/文件安全工具"
```

---

### Task 2: GatewayError 与错误归一化

**Files:**
- Create: `src/gateway/errors.js`
- Test: `test/errors.test.js`

- [ ] **Step 1: 写失败测试**

`test/errors.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayError, gatewayError, fromHttpStatus } from '../src/gateway/errors.js';

test('retriable 按错误码自动判定', () => {
  assert.equal(gatewayError('quota', 'x').retriable, true);
  assert.equal(gatewayError('timeout', 'x').retriable, true);
  assert.equal(gatewayError('network', 'x').retriable, true);
  assert.equal(gatewayError('provider_error', 'x').retriable, true);
  assert.equal(gatewayError('auth', 'x').retriable, false);
  assert.equal(gatewayError('bad_request', 'x').retriable, false);
  assert.equal(gatewayError('safety', 'x').retriable, false);
  assert.equal(gatewayError('unconfigured', 'x').retriable, false);
});

test('fromHttpStatus 映射', () => {
  assert.equal(fromHttpStatus(401, '', 'p').code, 'auth');
  assert.equal(fromHttpStatus(403, '', 'p').code, 'auth');
  assert.equal(fromHttpStatus(429, '', 'p').code, 'quota');
  assert.equal(fromHttpStatus(500, '', 'p').code, 'provider_error');
  assert.equal(fromHttpStatus(400, 'bad', 'p').code, 'bad_request');
  assert.equal(fromHttpStatus(400, '', 'p').providerId, 'p');
});

test('toJSON 不泄漏 cause', () => {
  const e = gatewayError('auth', 'm', { providerId: 'p', hint: 'h', cause: new Error('secret') });
  const j = JSON.parse(JSON.stringify(e));
  assert.deepEqual(j, { code: 'auth', message: 'm', providerId: 'p', hint: 'h' });
  assert.ok(e instanceof GatewayError);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → errors 用例 FAIL（模块不存在）。

- [ ] **Step 3: 实现 errors.js**

```js
export const RETRIABLE_CODES = new Set(['quota', 'timeout', 'network', 'provider_error']);

export class GatewayError extends Error {
  constructor(code, message, { providerId = null, retriable = null, hint = '', cause = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.providerId = providerId;
    this.retriable = retriable === null ? RETRIABLE_CODES.has(code) : retriable;
    this.hint = hint;
    this.cause = cause;
  }
  toJSON() {
    return { code: this.code, message: this.message, providerId: this.providerId, hint: this.hint };
  }
}

export function gatewayError(code, message, opts = {}) {
  return new GatewayError(code, message, opts);
}

export function fromHttpStatus(status, bodyText, providerId) {
  const snippet = String(bodyText || '').slice(0, 300);
  if (status === 401 || status === 403) return gatewayError('auth', `HTTP ${status}`, { providerId, hint: '检查该平台 API key 是否有效' });
  if (status === 429) return gatewayError('quota', 'HTTP 429 限流', { providerId, hint: '稍后重试或检查平台配额/余额' });
  if (status >= 500) return gatewayError('provider_error', `HTTP ${status}: ${snippet}`, { providerId });
  return gatewayError('bad_request', `HTTP ${status}: ${snippet}`, { providerId });
}
```

- [ ] **Step 4: 测试通过后 Commit**

Run: `node --test test/` → PASS。

```bash
git add src/gateway/errors.js test/errors.test.js
git commit -m "feat: GatewayError 错误模型与 HTTP 状态归一化"
```

---

### Task 3: Provider 注册表与配置（registry + 默认路由）

**Files:**
- Create: `src/gateway/registry.js`, `config/ai-providers.json`
- Test: `test/registry.test.js`

- [ ] **Step 1: 写失败测试**

`test/registry.test.js`：

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  registerProvider, getProvider, listProviders, _resetProviders,
  initConfig, loadConfig, updateConfig, CAPABILITIES,
} from '../src/gateway/registry.js';

const fake = (id, caps) => ({
  id, label: id, capabilities: caps, envKeys: [`${id.toUpperCase()}_KEY`],
  isConfigured: (env) => Boolean(env[`${id.toUpperCase()}_KEY`]),
  probe: async () => ({ ok: true }), invoke: async () => ({ text: 'x' }),
});

function tmpConfig(obj) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sscfg-')), 'ai-providers.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

beforeEach(() => _resetProviders());

test('注册与查询', () => {
  registerProvider(fake('alpha', ['chat']));
  assert.equal(getProvider('alpha').id, 'alpha');
  assert.equal(listProviders().length, 1);
  assert.throws(() => registerProvider(fake('alpha', ['chat'])), /重复/);
  assert.throws(() => registerProvider(fake('bad', ['no-such-cap'])), /未知能力/);
});

test('loadConfig 校验 provider 与能力', () => {
  registerProvider(fake('alpha', ['chat']));
  initConfig(tmpConfig({ chat: { provider: 'alpha', model: 'm1' } }));
  assert.equal(loadConfig().chat.provider, 'alpha');
  initConfig(tmpConfig({ chat: { provider: 'ghost', model: 'm' } }));
  assert.throws(() => loadConfig(), /未注册/);
  initConfig(tmpConfig({ 'not-a-cap': { provider: 'alpha', model: 'm' } }));
  assert.throws(() => loadConfig(), /未知能力/);
});

test('updateConfig 写盘并热生效', () => {
  registerProvider(fake('alpha', ['chat']));
  registerProvider(fake('beta', ['chat']));
  const file = tmpConfig({ chat: { provider: 'alpha', model: 'm1' } });
  initConfig(file);
  loadConfig();
  updateConfig({ chat: { provider: 'beta', model: 'm2', fallback: [{ provider: 'alpha', model: 'm1' }] } });
  assert.equal(loadConfig().chat.provider, 'beta');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).chat.model, 'm2');
});

test('CAPABILITIES 含 M2 预留', () => {
  for (const c of ['chat', 'content', 'world', 'plan', 'image', 'video', 'music', 'tts', 'asr', 'drama-script', 'storyboard']) {
    assert.ok(CAPABILITIES.includes(c), c);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → registry 用例 FAIL。

- [ ] **Step 3: 实现 registry.js**

```js
import fs from 'node:fs';

export const CAPABILITIES = [
  'chat', 'content', 'world', 'plan', 'image', 'video', 'music', 'tts', 'asr',
  'drama-script', 'storyboard',
];

const providers = new Map();
let configFile = null;
let configCache = null;

export function registerProvider(adapter) {
  for (const f of ['id', 'label', 'capabilities', 'envKeys', 'isConfigured', 'probe', 'invoke']) {
    if (!adapter[f]) throw new Error(`适配器缺少 ${f}: ${adapter.id || '(无 id)'}`);
  }
  if (providers.has(adapter.id)) throw new Error(`重复注册 provider: ${adapter.id}`);
  for (const c of adapter.capabilities) {
    if (!CAPABILITIES.includes(c)) throw new Error(`适配器 ${adapter.id} 声明了未知能力: ${c}`);
  }
  providers.set(adapter.id, adapter);
}

export function getProvider(id) { return providers.get(id) || null; }
export function listProviders() { return [...providers.values()]; }
export function _resetProviders() { providers.clear(); configCache = null; }

export function initConfig(file) { configFile = file; configCache = null; }

export function validateConfig(cfg) {
  for (const [cap, entry] of Object.entries(cfg)) {
    if (cap === 'providers' || cap === 'costs') continue; // per-provider 设置与单价覆盖
    if (!CAPABILITIES.includes(cap)) throw new Error(`配置含未知能力: ${cap}`);
    for (const e of [entry, ...(entry.fallback || [])]) {
      if (!e.provider || !e.model) throw new Error(`能力 ${cap} 的路由缺少 provider/model`);
      if (!providers.has(e.provider)) throw new Error(`能力 ${cap} 引用了未注册 provider: ${e.provider}`);
      if (!providers.get(e.provider).capabilities.includes(cap)) {
        throw new Error(`provider ${e.provider} 不支持能力 ${cap}`);
      }
    }
  }
}

export function loadConfig() {
  if (!configCache) {
    configCache = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    validateConfig(configCache);
  }
  return configCache;
}

export function updateConfig(next) {
  validateConfig(next);
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
  configCache = next;
}
```

`config/ai-providers.json`（默认路由，设计 §2；模型 ID 接入时按各平台现行文档校准）：

```json
{
  "chat":    { "provider": "anthropic",  "model": "claude-sonnet-4-6" },
  "content": { "provider": "anthropic",  "model": "claude-sonnet-4-6",
               "fallback": [{ "provider": "openrouter", "model": "anthropic/claude-sonnet-4-6" }] },
  "world":   { "provider": "dashscope",  "model": "qwen-flash" },
  "plan":    { "provider": "dashscope",  "model": "qwen-flash" },
  "image":   { "provider": "gemini",     "model": "gemini-3-pro-image-preview",
               "fallback": [{ "provider": "openrouter", "model": "google/gemini-3-pro-image-preview" }] },
  "video":   { "provider": "kling",      "model": "kling-v3-std",
               "fallback": [{ "provider": "openrouter", "model": "kwaivgi/kling-v3.0-std" }] },
  "music":   { "provider": "suno",       "model": "v5" },
  "tts":     { "provider": "dashscope",  "model": "qwen-tts" },
  "asr":     { "provider": "dashscope",  "model": "qwen3-asr-flash" },
  "providers": {}
}
```

注意：`image/video/music/tts/asr` 路由引用的适配器在 Task 12–15 才注册。**本任务的测试用 fake provider，不加载这份默认配置**；服务器要到 Task 8（注册首批适配器后）才 `initConfig`。Task 8 接入时先把 `image/video/music/tts/asr` 五行从默认配置中暂时移除，随 Task 12–15 逐步加回（每个适配器任务的步骤里有明确指令）。

- [ ] **Step 4: 测试通过后 Commit**

Run: `node --test test/` → PASS。

```bash
git add src/gateway/registry.js config/ai-providers.json test/registry.test.js
git commit -m "feat: Provider 注册表与配置驱动路由（GW-2/GW-3）"
```

---

### Task 4: 成本估算（costs.js）

**Files:**
- Create: `src/gateway/costs.js`
- Test: `test/costs.test.js`

- [ ] **Step 1: 写失败测试**

`test/costs.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateRequest, costOfUsage, setPriceOverrides } from '../src/gateway/costs.js';

test('文本估算按 token 单价', () => {
  setPriceOverrides({ 'fake:m': { inputPerMTok: 3, outputPerMTok: 15 } });
  const usd = estimateRequest('chat', 'fake', 'm', { messages: [{ role: 'user', content: 'x'.repeat(3000) }], maxTokens: 1000 });
  // 输入约 3000/3=1000 tok → $0.003；输出 1000 tok → $0.015
  assert.ok(usd > 0.015 && usd < 0.03, String(usd));
});

test('视频按秒、音乐按首、图像按张', () => {
  setPriceOverrides({ 'v:m': { perSecond: 0.1 }, 's:m': { perSong: 0.4 }, 'i:m': { perImage: 0.12 } });
  assert.equal(estimateRequest('video', 'v', 'm', { durationSec: 10 }), 1);
  assert.equal(estimateRequest('music', 's', 'm', {}), 0.4);
  assert.equal(estimateRequest('image', 'i', 'm', {}), 0.12);
});

test('costOfUsage 按实际用量', () => {
  setPriceOverrides({ 'fake:m': { inputPerMTok: 3, outputPerMTok: 15, perImage: 0.1, perSecond: 0.2 } });
  assert.equal(costOfUsage('fake', 'm', { inputTokens: 1_000_000 }), 3);
  assert.equal(costOfUsage('fake', 'm', { outputTokens: 100_000 }), 1.5);
  assert.equal(costOfUsage('fake', 'm', { images: 2 }), 0.2);
  assert.equal(costOfUsage('fake', 'm', { seconds: 5 }), 1);
  assert.equal(costOfUsage('unknown', 'm', {}), 0);
});

test('通配符回退 provider:*', () => {
  setPriceOverrides({ 'agg:*': { perImage: 0.2 } });
  assert.equal(costOfUsage('agg', 'whatever-model', { images: 1 }), 0.2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → costs 用例 FAIL。

- [ ] **Step 3: 实现 costs.js**

单价为占位量级（CL-6 要求接入时校准；可被 config 的 `costs` 段或 setPriceOverrides 覆盖）：

```js
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan', 'drama-script', 'storyboard']);

const BASE_PRICES = {
  'anthropic:claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'dashscope:qwen-flash': { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  'dashscope:qwen-tts': { perKChar: 0.03 },
  'dashscope:qwen3-asr-flash': { perMinute: 0.01 },
  'gemini:gemini-3-pro-image-preview': { perImage: 0.12 },
  'kling:kling-v3-std': { perSecond: 0.07 },
  'suno:v5': { perSong: 0.4 },
  'openrouter:*': { inputPerMTok: 5, outputPerMTok: 15, perImage: 0.15, perSecond: 0.1 },
};

let overrides = {};
export function setPriceOverrides(map) { overrides = map || {}; }

function price(providerId, model) {
  const merged = { ...BASE_PRICES, ...overrides };
  return merged[`${providerId}:${model}`] || merged[`${providerId}:*`] || {};
}

const round = (n) => Math.round(n * 10000) / 10000;

export function estimateRequest(capability, providerId, model, request = {}) {
  const p = price(providerId, model);
  if (TEXT_CAPS.has(capability)) {
    const chars = JSON.stringify(request.messages || request.prompt || '').length;
    const inTok = Math.ceil(chars / 3);
    const outTok = request.maxTokens || 1024;
    return round(((p.inputPerMTok || 0) * inTok + (p.outputPerMTok || 0) * outTok) / 1e6);
  }
  if (capability === 'image') return round((p.perImage || 0.1) * (request.count || 1));
  if (capability === 'video') return round((p.perSecond || 0.1) * (request.durationSec || 5));
  if (capability === 'music') return round(p.perSong ?? 0.5);
  if (capability === 'tts') return round((p.perKChar || 0.05) * (String(request.text || '').length / 1000));
  if (capability === 'asr') return round((p.perMinute || 0.02) * ((request.durationSec || 60) / 60));
  return 0;
}

export function costOfUsage(providerId, model, usage = {}) {
  const p = price(providerId, model);
  let usd = 0;
  if (usage.inputTokens) usd += (p.inputPerMTok || 0) * usage.inputTokens / 1e6;
  if (usage.outputTokens) usd += (p.outputPerMTok || 0) * usage.outputTokens / 1e6;
  if (usage.images) usd += (p.perImage || 0) * usage.images;
  if (usage.seconds) usd += (p.perSecond || 0) * usage.seconds;
  if (usage.songs) usd += (p.perSong || 0) * usage.songs;
  if (usage.chars) usd += (p.perKChar || 0) * usage.chars / 1000;
  if (usage.minutes) usd += (p.perMinute || 0) * usage.minutes;
  return round(usd);
}
```

- [ ] **Step 4: 测试通过后 Commit**

```bash
git add src/gateway/costs.js test/costs.test.js
git commit -m "feat: 成本单价表与估算（CL-6）"
```

---

### Task 5: 用量账本（ledger.js）

**Files:**
- Create: `src/gateway/ledger.js`
- Test: `test/ledger.test.js`

- [ ] **Step 1: 写失败测试**

`test/ledger.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initLedger, recordUsage, summarize } from '../src/gateway/ledger.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssled-')), 'ai-usage.jsonl');
}

test('recordUsage 逐行追加 jsonl', () => {
  const file = tmpFile();
  initLedger(file);
  recordUsage({ capability: 'chat', provider: 'p', model: 'm', durationMs: 10, estUsd: 0.01, ok: true });
  recordUsage({ capability: 'video', provider: 'v', model: 'm', durationMs: 20, estUsd: 0.5, ok: false, errorCode: 'timeout' });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].ts);
  assert.equal(lines[1].errorCode, 'timeout');
});

test('summarize 按周窗口聚合并单独累计文本成本', () => {
  const file = tmpFile();
  initLedger(file);
  const old = JSON.stringify({ ts: new Date(Date.now() - 8 * 86400e3).toISOString(), capability: 'chat', provider: 'p', model: 'm', estUsd: 9, ok: true });
  fs.appendFileSync(file, old + '\n');
  recordUsage({ capability: 'chat', provider: 'p', model: 'm', estUsd: 0.5, ok: true });
  recordUsage({ capability: 'world', provider: 'q', model: 'm', estUsd: 0.25, ok: true });
  recordUsage({ capability: 'video', provider: 'v', model: 'm', estUsd: 1, ok: true });
  const s = summarize({ sinceMs: Date.now() - 7 * 86400e3 });
  assert.equal(s.totalUsd, 1.75);          // 8 天前的不计入
  assert.equal(s.textUsd, 0.75);           // chat+world
  assert.equal(s.byCapability.video.calls, 1);
  assert.equal(s.byProvider.p.usd, 0.5);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → ledger 用例 FAIL。

- [ ] **Step 3: 实现 ledger.js**

```js
import fs from 'node:fs';
import path from 'node:path';

const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan', 'drama-script', 'storyboard']);
let ledgerFile = null;

export function initLedger(file) {
  ledgerFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function recordUsage(entry) {
  if (!ledgerFile) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try { fs.appendFileSync(ledgerFile, line + '\n'); }
  catch (err) { console.error('[ledger] 写入失败', err.message); }
}

const round = (n) => Math.round(n * 10000) / 10000;

export function summarize({ sinceMs }) {
  const out = { totalUsd: 0, textUsd: 0, calls: 0, byCapability: {}, byProvider: {} };
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return out;
  for (const line of fs.readFileSync(ledgerFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (new Date(e.ts).getTime() < sinceMs) continue;
    const usd = e.estUsd || 0;
    out.totalUsd += usd;
    out.calls += 1;
    if (TEXT_CAPS.has(e.capability)) out.textUsd += usd;
    const cap = (out.byCapability[e.capability] ||= { usd: 0, calls: 0 });
    cap.usd = round(cap.usd + usd); cap.calls += 1;
    const prov = (out.byProvider[e.provider] ||= { usd: 0, calls: 0 });
    prov.usd = round(prov.usd + usd); prov.calls += 1;
  }
  out.totalUsd = round(out.totalUsd);
  out.textUsd = round(out.textUsd);
  return out;
}
```

- [ ] **Step 4: 测试通过后 Commit**

```bash
git add src/gateway/ledger.js test/ledger.test.js
git commit -m "feat: ai-usage.jsonl 用量账本与周聚合（GW-7）"
```

---

### Task 6: HTTP 客户端（http-fetch.js：超时、错误归一、CONNECT 代理）

**Files:**
- Create: `src/lib/http-fetch.js`
- Test: `test/http-fetch.test.js`

- [ ] **Step 1: 写失败测试（超时与错误归一；代理隧道用本地 mock 代理验证 CONNECT 发起）**

`test/http-fetch.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { fetchJson } from '../src/lib/http-fetch.js';

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

test('成功请求返回解析后的 JSON', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"hello":"world"}');
  });
  const port = await listen(server);
  const data = await fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET' });
  assert.equal(data.hello, 'world');
  server.close();
});

test('非 2xx 抛 GatewayError（429→quota）', async () => {
  const server = http.createServer((req, res) => { res.writeHead(429); res.end('slow down'); });
  const port = await listen(server);
  await assert.rejects(
    () => fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET', providerId: 'p' }),
    (e) => e.code === 'quota' && e.providerId === 'p',
  );
  server.close();
});

test('超时抛 timeout', async () => {
  const server = http.createServer(() => { /* 永不响应 */ });
  const port = await listen(server);
  await assert.rejects(
    () => fetchJson(`http://127.0.0.1:${port}/x`, { method: 'GET', timeoutMs: 200 }),
    (e) => e.code === 'timeout',
  );
  server.close();
});

test('连接拒绝抛 network', async () => {
  await assert.rejects(
    () => fetchJson('http://127.0.0.1:9/x', { method: 'GET', timeoutMs: 1000 }),
    (e) => e.code === 'network',
  );
});

test('配置 proxy 时向代理发起 CONNECT', async () => {
  let sawConnect = '';
  const proxy = net.createServer((socket) => {
    socket.once('data', (buf) => { sawConnect = buf.toString().split('\r\n')[0]; socket.destroy(); });
  });
  const port = await listen(proxy);
  await assert.rejects(
    () => fetchJson('https://example.com/api', { method: 'GET', proxy: `http://127.0.0.1:${port}`, timeoutMs: 1000 }),
  );
  assert.match(sawConnect, /^CONNECT example\.com:443/);
  proxy.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → http-fetch 用例 FAIL。

- [ ] **Step 3: 实现 http-fetch.js**

无代理时用原生 fetch；配了 `proxy` 时走 `http.request CONNECT` 拿到隧道 socket，再用 `https.request({ createConnection })` 复用 Node 自带的 HTTP 解析（不手写解析器）：

```js
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { gatewayError, fromHttpStatus, GatewayError } from '../gateway/errors.js';

export async function fetchJson(url, opts = {}) {
  const { status, text } = await rawFetch(url, normalizeOpts(url, opts));
  if (status < 200 || status >= 300) throw fromHttpStatus(status, text, opts.providerId);
  try { return text ? JSON.parse(text) : {}; }
  catch { throw gatewayError('provider_error', `响应不是合法 JSON: ${text.slice(0, 200)}`, { providerId: opts.providerId }); }
}

export async function fetchBuffer(url, opts = {}) {
  const { status, buffer } = await rawFetch(url, { ...normalizeOpts(url, opts), wantBuffer: true });
  if (status < 200 || status >= 300) throw fromHttpStatus(status, buffer.toString('utf8'), opts.providerId);
  return buffer;
}

function normalizeOpts(url, opts) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const body = opts.body === undefined ? undefined
    : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  return { method: opts.method || 'POST', headers, body, timeoutMs: opts.timeoutMs || 120000, proxy: opts.proxy, providerId: opts.providerId };
}

async function rawFetch(url, o) {
  if (o.proxy) return proxyFetch(url, o);
  let res;
  try {
    res = await fetch(url, { method: o.method, headers: o.headers, body: o.body, signal: AbortSignal.timeout(o.timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw gatewayError('timeout', `请求超时（${o.timeoutMs}ms）: ${url}`, { providerId: o.providerId });
    }
    throw gatewayError('network', `网络错误: ${err.cause?.code || err.message}`, { providerId: o.providerId, cause: err });
  }
  if (o.wantBuffer) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, text: await res.text() };
}

function proxyFetch(url, o) {
  const target = new URL(url);
  const p = new URL(o.proxy);
  if (target.protocol !== 'https:') {
    return Promise.reject(gatewayError('bad_request', '代理模式仅支持 https 目标', { providerId: o.providerId }));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(gatewayError('timeout', `代理请求超时（${o.timeoutMs}ms）: ${url}`, { providerId: o.providerId }));
      connectReq.destroy();
    }, o.timeoutMs);
    const fail = (code, msg, cause) => { clearTimeout(timer); reject(cause instanceof GatewayError ? cause : gatewayError(code, msg, { providerId: o.providerId, cause })); };

    const connectReq = http.request({
      host: p.hostname, port: Number(p.port) || 80, method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return fail('network', `代理 CONNECT 失败: HTTP ${res.statusCode}`);
      const req = https.request({
        host: target.hostname,
        path: target.pathname + target.search,
        method: o.method,
        headers: { ...o.headers, host: target.hostname },
        createConnection: () => tls.connect({ socket, servername: target.hostname }),
      }, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          clearTimeout(timer);
          const buffer = Buffer.concat(chunks);
          resolve(o.wantBuffer ? { status: resp.statusCode, buffer } : { status: resp.statusCode, text: buffer.toString('utf8') });
        });
      });
      req.on('error', (e) => fail('network', `代理隧道请求失败: ${e.message}`, e));
      if (o.body) req.write(o.body);
      req.end();
    });
    connectReq.on('error', (e) => fail('network', `代理连接失败: ${e.message}`, e));
    connectReq.end();
  });
}
```

- [ ] **Step 4: 测试通过后 Commit**

Run: `node --test test/` → PASS（CONNECT 用例只断言代理收到 `CONNECT example.com:443`，请求本身预期被拒绝）。

```bash
git add src/lib/http-fetch.js test/http-fetch.test.js
git commit -m "feat: 统一 HTTP 客户端——超时/错误归一/可选 CONNECT 代理（OR-2）"
```

---

### Task 7: 网关核心（resolveRoute + execute 降级链）

**Files:**
- Create: `src/gateway/gateway.js`
- Test: `test/gateway.test.js`

- [ ] **Step 1: 写失败测试**

`test/gateway.test.js`：

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerProvider, initConfig, _resetProviders } from '../src/gateway/registry.js';
import { initLedger } from '../src/gateway/ledger.js';
import { execute, resolveRoute } from '../src/gateway/gateway.js';
import { gatewayError } from '../src/gateway/errors.js';

function fake(id, { fail = null, env = true } = {}) {
  return {
    id, label: id, capabilities: ['chat'], envKeys: [],
    isConfigured: () => env,
    probe: async () => ({ ok: true }),
    invoke: async () => {
      if (fail) throw gatewayError(fail, `${id} 故障`, { providerId: id });
      return { text: `来自 ${id}`, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

function setup(adapters, config) {
  _resetProviders();
  adapters.forEach(registerProvider);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssgw-'));
  const file = path.join(dir, 'cfg.json');
  fs.writeFileSync(file, JSON.stringify(config));
  initConfig(file);
  const ledger = path.join(dir, 'usage.jsonl');
  initLedger(ledger);
  return ledger;
}

const CHAIN = { chat: { provider: 'a', model: 'm1', fallback: [{ provider: 'b', model: 'm2' }] } };

beforeEach(() => _resetProviders());

test('首选成功直接返回并带 provider/model', async () => {
  setup([fake('a'), fake('b')], CHAIN);
  const r = await execute('chat', { messages: [] });
  assert.equal(r.text, '来自 a');
  assert.equal(r.provider, 'a');
  assert.equal(r.model, 'm1');
});

test('retriable 错误降级到 fallback（GW-4）', async () => {
  setup([fake('a', { fail: 'timeout' }), fake('b')], CHAIN);
  const r = await execute('chat', { messages: [] });
  assert.equal(r.provider, 'b');
});

test('非 retriable 错误（auth）不降级', async () => {
  setup([fake('a', { fail: 'auth' }), fake('b')], CHAIN);
  await assert.rejects(() => execute('chat', { messages: [] }), (e) => e.code === 'auth' && e.attempts.length === 1);
});

test('未配 key 的 provider 被跳过；全部未配 → unconfigured', async () => {
  setup([fake('a', { env: false }), fake('b')], CHAIN);
  const r = await execute('chat', { messages: [] });
  assert.equal(r.provider, 'b');
  setup([fake('a', { env: false }), fake('b', { env: false })], CHAIN);
  await assert.rejects(() => execute('chat', { messages: [] }), (e) => e.code === 'unconfigured');
});

test('全链失败返回聚合错误（AI-4）', async () => {
  setup([fake('a', { fail: 'timeout' }), fake('b', { fail: 'quota' })], CHAIN);
  await assert.rejects(() => execute('chat', { messages: [] }), (e) => {
    assert.equal(e.attempts.length, 2);
    assert.equal(e.attempts[0].provider, 'a');
    assert.equal(e.attempts[1].code, 'quota');
    return true;
  });
});

test('每次尝试都写账本（GW-7）', async () => {
  const ledger = setup([fake('a', { fail: 'timeout' }), fake('b')], CHAIN);
  await execute('chat', { messages: [] });
  const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].ok, false);
  assert.equal(lines[0].errorCode, 'timeout');
  assert.equal(lines[1].ok, true);
  assert.ok(lines[1].estUsd >= 0);
});

test('resolveRoute 暴露链路与已配置子集', () => {
  setup([fake('a', { env: false }), fake('b')], CHAIN);
  const { chain, configured } = resolveRoute('chat');
  assert.equal(chain.length, 2);
  assert.equal(configured.length, 1);
  assert.equal(configured[0].provider.id, 'b');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → gateway 用例 FAIL。

- [ ] **Step 3: 实现 gateway.js**

```js
import { loadConfig, getProvider } from './registry.js';
import { gatewayError, GatewayError } from './errors.js';
import { recordUsage } from './ledger.js';
import { costOfUsage } from './costs.js';
import { fetchJson, fetchBuffer } from '../lib/http-fetch.js';
import { saveBufferToGenerated } from '../lib/files.js';
import { GENERATED_DIR } from '../lib/paths.js';

export function resolveRoute(capability) {
  const cfg = loadConfig()[capability];
  if (!cfg) throw gatewayError('bad_request', `能力 ${capability} 未配置路由`);
  const chain = [cfg, ...(cfg.fallback || [])]
    .map((e) => ({ provider: getProvider(e.provider), model: e.model, params: e.params || {} }))
    .filter((e) => e.provider);
  return { chain, configured: chain.filter((e) => e.provider.isConfigured(process.env)) };
}

export function makeCtx(providerId, onProgress) {
  const settings = (loadConfig().providers || {})[providerId] || {};
  const base = { providerId, proxy: settings.proxy, timeoutMs: settings.timeoutMs || 120000 };
  return {
    env: process.env,
    fetchJson: (url, opts = {}) => fetchJson(url, { ...base, ...opts }),
    fetchBuffer: (url, opts = {}) => fetchBuffer(url, { ...base, ...opts }),
    saveFile: (buf, ext) => saveBufferToGenerated(GENERATED_DIR, buf, ext),
    onProgress: onProgress || (() => {}),
  };
}

export async function execute(capability, request, { onProgress } = {}) {
  const { configured } = resolveRoute(capability);
  if (!configured.length) {
    throw gatewayError('unconfigured', `能力 ${capability} 没有已接入的 Provider`, {
      hint: '在工作台设置页录入对应平台的 API key',
    });
  }
  const attempts = [];
  for (const entry of configured) {
    const providerId = entry.provider.id;
    const started = Date.now();
    try {
      const result = await entry.provider.invoke(
        capability,
        { ...request, model: entry.model, params: entry.params },
        makeCtx(providerId, onProgress),
      );
      recordUsage({
        capability, provider: providerId, model: entry.model,
        durationMs: Date.now() - started, usage: result.usage || {},
        estUsd: costOfUsage(providerId, entry.model, result.usage || {}), ok: true,
      });
      return { ...result, provider: providerId, model: entry.model };
    } catch (err) {
      const ge = err instanceof GatewayError
        ? err
        : gatewayError('provider_error', err.message, { providerId, cause: err });
      recordUsage({
        capability, provider: providerId, model: entry.model,
        durationMs: Date.now() - started, estUsd: 0, ok: false, errorCode: ge.code,
      });
      attempts.push({ provider: providerId, code: ge.code, message: ge.message, hint: ge.hint });
      console.error(`[gateway] ${capability}/${providerId} 失败(${ge.code}): ${ge.message}`);
      if (!ge.retriable) throw aggregate(capability, attempts, ge);
    }
  }
  throw aggregate(capability, attempts);
}

function aggregate(capability, attempts, last = null) {
  const e = gatewayError(
    last?.code || attempts[attempts.length - 1]?.code || 'provider_error',
    `能力 ${capability} 调用失败（尝试 ${attempts.length} 个 Provider）`,
    { providerId: attempts[attempts.length - 1]?.provider, hint: last?.hint || attempts[attempts.length - 1]?.hint || '查看各环节原因，修复 key/配额后重试' },
  );
  e.attempts = attempts;
  e.toJSON = () => ({ code: e.code, message: e.message, hint: e.hint, attempts });
  return e;
}
```

- [ ] **Step 4: 测试通过后 Commit**

Run: `node --test test/` → PASS；`npm run check` → 通过。

```bash
git add src/gateway/gateway.js test/gateway.test.js
git commit -m "feat: 网关核心——能力路由、跨平台降级链、账本挂钩（GW-1/GW-4）"
```

---

### Task 8: 文本适配器（anthropic / dashscope / openrouter）与文本端点

**Files:**
- Create: `src/providers/anthropic.js`, `src/providers/dashscope.js`, `src/providers/openrouter.js`, `src/providers/index.js`, `src/bootstrap.js`
- Modify: `server.js`（加 2 行）, `src/api/routes.js`, `config/ai-providers.json`（暂时移除未注册路由）

适配器是纯网络封装，单测靠 Task 7 的 fake provider 已覆盖网关行为；本任务用「未配 key → unconfigured」+ 真实 key 手动调用来验证（smoke 在 Task 17 固化）。

- [ ] **Step 1: ⚠️ 文档校准**

用 WebFetch 核对三家现行 API（路径/头/字段，写进各适配器顶部常量）：
- Anthropic Messages API：`https://docs.claude.com/en/api/messages`（`POST /v1/messages`、`x-api-key` + `anthropic-version`）
- DashScope OpenAI 兼容模式：`https://help.aliyun.com/zh/model-studio/`（`POST /compatible-mode/v1/chat/completions`；probe 用的 `GET /compatible-mode/v1/models` 若不存在则 probe 改为对 chat 端点发 `max_tokens:1` 的最小请求）
- OpenRouter：`https://openrouter.ai/docs`（`POST /api/v1/chat/completions`；probe 用 `GET /api/v1/key`）

- [ ] **Step 2: 实现三个适配器**

`src/providers/anthropic.js`：

```js
import { gatewayError } from '../gateway/errors.js';

const API = 'https://api.anthropic.com/v1';
const headers = (env) => ({ 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' });

export default {
  id: 'anthropic',
  label: 'Anthropic 直连',
  capabilities: ['chat', 'content', 'drama-script'],
  envKeys: ['ANTHROPIC_API_KEY'],
  isConfigured: (env) => Boolean(env.ANTHROPIC_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${API}/models?limit=1`, { method: 'GET', headers: headers(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    const data = await ctx.fetchJson(`${API}/messages`, {
      headers: headers(ctx.env),
      body: {
        model: request.model,
        max_tokens: request.maxTokens || 2048,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages,
      },
    });
    const text = (data.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
    if (!text) throw gatewayError('provider_error', 'Anthropic 返回空内容', { providerId: 'anthropic' });
    return { text, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } };
  },
};
```

`src/providers/dashscope.js`（本任务仅文本；tts/asr 的 `invokeTts/invokeAsr` 在 Task 15 补）：

```js
import { gatewayError } from '../gateway/errors.js';

const BASE = 'https://dashscope.aliyuncs.com';
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan']);
const auth = (env) => ({ authorization: `Bearer ${env.DASHSCOPE_API_KEY}` });

const adapter = {
  id: 'dashscope',
  label: '阿里云百炼',
  capabilities: ['chat', 'content', 'world', 'plan', 'tts', 'asr'],
  envKeys: ['DASHSCOPE_API_KEY'],
  isConfigured: (env) => Boolean(env.DASHSCOPE_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${BASE}/compatible-mode/v1/models`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (TEXT_CAPS.has(capability)) return invokeText(request, ctx);
    throw gatewayError('bad_request', `dashscope 暂未实现能力 ${capability}`, { providerId: 'dashscope' });
  },
};

async function invokeText(request, ctx) {
  const messages = request.system ? [{ role: 'system', content: request.system }, ...request.messages] : request.messages;
  const data = await ctx.fetchJson(`${BASE}/compatible-mode/v1/chat/completions`, {
    headers: auth(ctx.env),
    body: { model: request.model, messages, max_tokens: request.maxTokens || 2048 },
  });
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw gatewayError('provider_error', 'DashScope 返回空内容', { providerId: 'dashscope' });
  return { text, usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 } };
}

export default adapter;
```

`src/providers/openrouter.js`（本任务仅文本；image/video 的 `invokeImage/invokeVideo` 在 Task 12/13 补）：

```js
import { gatewayError } from '../gateway/errors.js';

const API = 'https://openrouter.ai/api/v1';
const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan']);
const auth = (env) => ({ authorization: `Bearer ${env.OPENROUTER_API_KEY}` });

const adapter = {
  id: 'openrouter',
  label: 'OpenRouter 聚合兜底',
  capabilities: ['chat', 'content', 'world', 'plan', 'image', 'video'],
  envKeys: ['OPENROUTER_API_KEY'],
  isConfigured: (env) => Boolean(env.OPENROUTER_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${API}/key`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (TEXT_CAPS.has(capability)) return invokeText(request, ctx);
    throw gatewayError('bad_request', `openrouter 暂未实现能力 ${capability}`, { providerId: 'openrouter' });
  },
};

async function invokeText(request, ctx) {
  const messages = request.system ? [{ role: 'system', content: request.system }, ...request.messages] : request.messages;
  const data = await ctx.fetchJson(`${API}/chat/completions`, {
    headers: auth(ctx.env),
    body: { model: request.model, messages, max_tokens: request.maxTokens || 2048 },
  });
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw gatewayError('provider_error', 'OpenRouter 返回空内容', { providerId: 'openrouter' });
  return { text, usage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0 } };
}

export default adapter;
```

`src/providers/index.js`（后续适配器任务在此追加 import 与数组项）：

```js
import anthropic from './anthropic.js';
import dashscope from './dashscope.js';
import openrouter from './openrouter.js';

const ADAPTERS = [anthropic, dashscope, openrouter];

export function registerAll(registerProvider) {
  ADAPTERS.forEach(registerProvider);
}
```

- [ ] **Step 3: bootstrap 与端点接线**

`src/bootstrap.js`：

```js
import path from 'node:path';
import { registerProvider, initConfig, loadConfig } from './gateway/registry.js';
import { initLedger } from './gateway/ledger.js';
import { setPriceOverrides } from './gateway/costs.js';
import { registerAll } from './providers/index.js';
import { CONFIG_FILE, LOGS_DIR } from './lib/paths.js';

export function bootstrap() {
  registerAll(registerProvider);
  initConfig(CONFIG_FILE);
  initLedger(path.join(LOGS_DIR, 'ai-usage.jsonl'));
  const cfg = loadConfig();
  if (cfg.costs) setPriceOverrides(cfg.costs);
}
```

`server.js` 在 `loadEnv(ENV_FILE);` 之后加：

```js
import { bootstrap } from './src/bootstrap.js';
bootstrap();
```

（import 语句放到文件顶部 import 区，`bootstrap()` 调用放 `loadEnv` 之后、`registerRoutes(route)` 之前。）

`config/ai-providers.json`：删除 `image/video/music/tts/asr` 五行（Task 12–15 逐个加回），保留 `chat/content/world/plan` 与 `"providers": {}`。

`src/api/routes.js` 顶部加 import，`registerRoutes` 内追加文本端点：

```js
import { execute } from '../gateway/gateway.js';
import { GatewayError } from '../gateway/errors.js';

export function sendGatewayError(res, e) {
  if (e instanceof GatewayError) return json(res, { error: e.toJSON() });
  console.error('[api] 未预期错误', e);
  json(res, { error: { code: 'internal', message: e.message } }, 500);
}

// registerRoutes 内追加：
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
```

- [ ] **Step 4: 验证**

Run: `node --test test/` 与 `npm run check` → PASS。启动 `node server.js`：

```powershell
# 未配 key 时必须得到结构化 unconfigured（绝不 500）：
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/ai/chat -ContentType 'application/json' -Body '{"messages":[{"role":"user","content":"你好"}]}'
# → error.code = "unconfigured"

# 在 .env 配 ANTHROPIC_API_KEY（或 DASHSCOPE_API_KEY 验证 world 端点）后重启：
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/ai/chat -ContentType 'application/json' -Body '{"messages":[{"role":"user","content":"用一句话自我介绍"}],"maxTokens":64}'
# → 返回 text + provider/model/usage；logs/ai-usage.jsonl 多一行
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 文本三适配器与 chat/content/world/plan 端点（M1 文本链路贯通）"
```

---

### Task 9: 健康探测（三态）与工作台 v1（健康面板 + 聊天卡）

**Files:**
- Create: `src/gateway/health.js`
- Modify: `src/bootstrap.js`, `src/api/routes.js`
- Replace: `prototype/index.html`, `prototype/app.js`, `prototype/styles.css`

- [ ] **Step 1: 实现 health.js**

```js
import { listProviders } from './registry.js';
import { makeCtx } from './gateway.js';

const state = new Map();
let started = false;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`探测超时(${ms}ms)`)), ms); timer.unref(); }),
  ]);
}

export async function refreshHealth() {
  await Promise.all(listProviders().map(async (p) => {
    if (!p.isConfigured(process.env)) { state.set(p.id, { state: 'unconfigured' }); return; }
    const t = Date.now();
    try {
      await withTimeout(p.probe(makeCtx(p.id)), 5000);
      state.set(p.id, { state: 'online', latencyMs: Date.now() - t, lastCheck: new Date().toISOString() });
    } catch (e) {
      state.set(p.id, { state: 'error', detail: e.message, lastCheck: new Date().toISOString() });
    }
  }));
}

export function getHealthSnapshot() {
  return listProviders().map((p) => ({
    id: p.id, label: p.label, capabilities: p.capabilities,
    ...(state.get(p.id) || { state: 'unknown' }),
  }));
}

export function startHealthLoop(intervalMs = 60000) {
  if (started) return;
  started = true;
  refreshHealth();
  setInterval(() => refreshHealth(), intervalMs).unref();
}
```

`src/bootstrap.js`：顶部加 `import { startHealthLoop } from './gateway/health.js';`，`bootstrap()` 末尾加 `startHealthLoop();`。

`src/api/routes.js`：顶部加 `import { refreshHealth, getHealthSnapshot } from '../gateway/health.js';`，`registerRoutes` 内追加：

```js
route('GET /api/health', async (req, res, { url }) => {
  if (url.searchParams.get('refresh') === '1') await refreshHealth();
  json(res, { providers: getHealthSnapshot() });
});
```

- [ ] **Step 2: 工作台 v1**

`prototype/index.html`（完整替换；含全部卡片骨架，后续任务只加 JS）：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Star Studio v3 — M1 工作台</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header>
  <h1>AI Star Studio v3 <span class="sub">M1 能力网关工作台</span></h1>
  <div id="usage-summary" class="usage">本周成本 —</div>
</header>

<section id="health" class="panel">
  <div class="panel-head"><h2>Provider 健康</h2><button id="health-refresh">重新探测</button></div>
  <div id="health-grid" class="health-grid"></div>
</section>

<main class="cards">
  <section class="card" id="card-chat">
    <h2>聊天 <span class="route" data-cap="chat"></span></h2>
    <textarea id="chat-input" rows="3" placeholder="对艺人说点什么…"></textarea>
    <button id="chat-send">发送</button>
    <div id="chat-out" class="out"></div>
  </section>

  <section class="card" id="card-image">
    <h2>图像 <span class="route" data-cap="image"></span></h2>
    <textarea id="image-prompt" rows="2" placeholder="写真描述…"></textarea>
    <input type="file" id="image-ref" accept="image/*">
    <button id="image-send">生成图像</button>
    <div id="image-out" class="out"></div>
  </section>

  <section class="card" id="card-music">
    <h2>音乐 <span class="route" data-cap="music"></span></h2>
    <input id="music-title" placeholder="歌名">
    <input id="music-style" placeholder="曲风，如：国风流行，女声，105BPM">
    <textarea id="music-lyrics" rows="3" placeholder="歌词（可空，交给平台作词）"></textarea>
    <button id="music-send">生成歌曲</button>
    <div id="music-out" class="out"></div>
  </section>

  <section class="card" id="card-video">
    <h2>视频 <span class="route" data-cap="video"></span></h2>
    <input type="file" id="video-ref" accept="image/*">
    <textarea id="video-prompt" rows="2" placeholder="运镜与动作描述…"></textarea>
    <select id="video-duration"><option value="5">5 秒</option><option value="10">10 秒</option></select>
    <button id="video-send">生成视频（竖屏）</button>
    <div id="video-out" class="out"></div>
  </section>

  <section class="card" id="card-tts">
    <h2>配音 TTS <span class="route" data-cap="tts"></span></h2>
    <textarea id="tts-text" rows="2" maxlength="1000" placeholder="台词（≤1000 字）"></textarea>
    <input id="tts-voice" placeholder="音色（按平台文档，可空）">
    <button id="tts-send">合成语音</button>
    <div id="tts-out" class="out"></div>
  </section>

  <section class="card" id="card-asr">
    <h2>转写 ASR <span class="route" data-cap="asr"></span></h2>
    <input type="file" id="asr-file" accept="audio/*">
    <button id="asr-send">转写</button>
    <div id="asr-out" class="out"></div>
  </section>
</main>

<section id="jobs" class="panel">
  <div class="panel-head"><h2>生成任务</h2></div>
  <div id="jobs-list"></div>
</section>

<section id="settings" class="panel">
  <div class="panel-head"><h2>设置</h2></div>
  <h3>能力路由（JSON，保存即热生效）</h3>
  <textarea id="config-editor" rows="14" spellcheck="false"></textarea>
  <button id="config-save">保存路由</button>
  <div id="config-msg" class="out"></div>
  <h3>API Key（仅写入服务端 .env，不回显）</h3>
  <div id="keys-list"></div>
</section>

<div id="confirm-modal" class="modal hidden">
  <div class="modal-box">
    <h3>生成成本确认</h3>
    <p id="confirm-text"></p>
    <button id="confirm-ok">确认生成</button>
    <button id="confirm-cancel">取消</button>
  </div>
</div>

<script src="/app.js"></script>
</body>
</html>
```

`prototype/styles.css`：

```css
:root { --bg:#101418; --panel:#1a2027; --line:#2c3640; --text:#e8edf2; --dim:#8a98a6; --ok:#3ecf8e; --err:#ff6b6b; --warn:#f7c948; }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.6 system-ui, "Microsoft YaHei", sans-serif; background:var(--bg); color:var(--text); padding:16px; }
header { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; }
h1 { font-size:20px; } h1 .sub { font-size:13px; color:var(--dim); margin-left:8px; }
h2 { font-size:15px; margin:0 0 8px; } h3 { font-size:13px; color:var(--dim); }
.usage { color:var(--warn); }
.panel, .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; margin-top:14px; }
.panel-head { display:flex; justify-content:space-between; align-items:center; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:14px; }
.health-grid { display:flex; flex-wrap:wrap; gap:10px; }
.badge { padding:6px 10px; border-radius:8px; border:1px solid var(--line); font-size:13px; }
.badge .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
.badge.online .dot { background:var(--ok); } .badge.error .dot { background:var(--err); }
.badge.unconfigured .dot, .badge.unknown .dot { background:var(--dim); }
.route { font-size:12px; color:var(--dim); font-weight:normal; }
textarea, input, select { width:100%; margin:4px 0; background:#0d1115; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; }
button { background:#2563eb; color:#fff; border:0; border-radius:6px; padding:8px 14px; margin-top:6px; cursor:pointer; }
button:disabled { opacity:.5; cursor:wait; }
.out { margin-top:8px; white-space:pre-wrap; color:var(--dim); word-break:break-all; }
.out img, .out video { max-width:100%; border-radius:8px; margin-top:6px; }
.job { border-top:1px solid var(--line); padding:8px 0; }
.job .bar { height:6px; background:#0d1115; border-radius:3px; overflow:hidden; }
.job .bar i { display:block; height:100%; background:#2563eb; }
.modal { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; }
.modal.hidden { display:none; }
.modal-box { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px; max-width:420px; }
.key-row { display:flex; gap:8px; align-items:center; margin:4px 0; }
.key-row label { flex:0 0 220px; color:var(--dim); font-size:13px; }
```

`prototype/app.js`（v1：公共工具 + 健康 + 聊天；后续任务在文件末尾追加 init 函数并在 `boot()` 里调用）：

```js
const $ = (sel) => document.querySelector(sel);

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => ({ error: { code: 'bad_response', message: `HTTP ${res.status}` } }));
}

function errText(err) {
  let s = `[${err.code}] ${err.message}`;
  if (err.hint) s += `（${err.hint}）`;
  if (err.attempts) s += '\n' + err.attempts.map((a) => `· ${a.provider}: [${a.code}] ${a.message}`).join('\n');
  return s;
}

const STATE_LABEL = { online: '在线', error: '故障', unconfigured: '未接入', unknown: '探测中' };

async function renderHealth(refresh) {
  const data = await api('/api/health' + (refresh ? '?refresh=1' : ''));
  if (data.error) return;
  $('#health-grid').innerHTML = data.providers.map((p) =>
    `<span class="badge ${p.state}" title="${p.detail || ''} ${p.capabilities.join('/')}">` +
    `<i class="dot"></i>${p.label} · ${STATE_LABEL[p.state] || p.state}` +
    (p.latencyMs ? ` · ${p.latencyMs}ms` : '') + '</span>').join('');
}

async function renderRoutes() {
  const cfg = await api('/api/config');
  if (cfg.error) return;
  document.querySelectorAll('.route').forEach((el) => {
    const r = cfg[el.dataset.cap];
    el.textContent = r ? `→ ${r.provider}/${r.model}` : '→ 未配置路由';
  });
  const editor = $('#config-editor');
  if (editor && !editor.value) editor.value = JSON.stringify(cfg, null, 2);
}

function initChat() {
  $('#chat-send').addEventListener('click', async () => {
    const content = $('#chat-input').value.trim();
    if (!content) return;
    const btn = $('#chat-send'); btn.disabled = true;
    $('#chat-out').textContent = '生成中…';
    const r = await api('/api/ai/chat', { messages: [{ role: 'user', content }], maxTokens: 512 });
    btn.disabled = false;
    $('#chat-out').textContent = r.error ? errText(r.error) : `${r.text}\n—— ${r.provider}/${r.model}`;
  });
}

function boot() {
  renderHealth();
  setInterval(() => renderHealth(), 10000);
  renderRoutes();
  initChat();
  $('#health-refresh').addEventListener('click', () => renderHealth(true));
}
window.addEventListener('DOMContentLoaded', boot);
```

注意：`renderRoutes` 依赖 `GET /api/config`（Task 16 实现）。在那之前路由标注显示「未配置路由」、设置区不可用——可接受，不要为此提前实现。

- [ ] **Step 3: 验证**

`npm run check` → PASS。启动服务器，浏览器开 `http://127.0.0.1:3100`：健康面板显示 anthropic/dashscope/openrouter 三态徽标（未配 key 的显示「未接入」）；聊天卡可用（无 key 时显示结构化错误文案）。`curl "http://127.0.0.1:3100/api/health"` → providers 数组含 state 字段。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 三态健康探测与工作台 v1（CL-5/NFR-2）"
```

---

### Task 10: 异步 job 队列（GW-6）

**Files:**
- Create: `src/gateway/jobs.js`
- Modify: `src/bootstrap.js`, `src/api/routes.js`, `prototype/app.js`
- Test: `test/jobs.test.js`

- [ ] **Step 1: 写失败测试**

`test/jobs.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initJobs, submitJob, getJob, listJobs } from '../src/gateway/jobs.js';
import { gatewayError } from '../src/gateway/errors.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssjob-')), 'jobs.json');

async function waitFor(jobId, status, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (getJob(jobId)?.status === status) return getJob(jobId);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待 ${status} 超时，当前 ${getJob(jobId)?.status}`);
}

test('submit→running→done，进度可见', async () => {
  initJobs({
    file: tmpFile(), concurrency: 2,
    executeFn: async (cap, req, { onProgress }) => {
      onProgress('提交平台', 30);
      await new Promise((r) => setTimeout(r, 50));
      onProgress('下载产物', 90);
      return { files: [{ url: '/generated/x.mp4' }], provider: 'p', model: 'm', usage: { seconds: 5 } };
    },
  });
  const { id } = submitJob('video', { prompt: 'x' }, { estimate: { estimatedUsd: 0.5 } });
  const done = await waitFor(id, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.result.files[0].url, '/generated/x.mp4');
  assert.equal(done.costEstimate.estimatedUsd, 0.5);
});

test('失败落 error 并可序列化', async () => {
  initJobs({ file: tmpFile(), executeFn: async () => { throw gatewayError('quota', '配额用尽', { providerId: 'p' }); } });
  const { id } = submitJob('music', {}, {});
  const failed = await waitFor(id, 'failed');
  assert.equal(failed.error.code, 'quota');
});

test('并发上限排队', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  initJobs({ file: tmpFile(), concurrency: 1, executeFn: async () => { await gate; return { files: [] }; } });
  const a = submitJob('video', {}, {});
  const b = submitJob('video', {}, {});
  await waitFor(a.id, 'running');
  assert.equal(getJob(b.id).status, 'queued');
  release();
  await waitFor(b.id, 'done');
});

test('重启恢复：running → interrupted', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify([{ id: 'job_x', capability: 'video', status: 'running', request: {}, createdAt: new Date().toISOString() }]));
  initJobs({ file, executeFn: async () => ({ files: [] }) });
  assert.equal(getJob('job_x').status, 'interrupted');
  assert.equal(listJobs()[0].id, 'job_x');
});

test('长字符串请求字段持久化时被截断', async () => {
  const file = tmpFile();
  initJobs({ file, executeFn: async () => ({ files: [] }) });
  const { id } = submitJob('video', { imageRef: 'data:image/png;base64,' + 'A'.repeat(50000) }, {});
  await waitFor(id, 'done');
  await new Promise((r) => setTimeout(r, 1100)); // 等待节流写盘
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(JSON.stringify(persisted).length < 20000);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/` → jobs 用例 FAIL。

- [ ] **Step 3: 实现 jobs.js**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { costOfUsage } from './costs.js';

let jobsFile = null;
let executor = null;
let maxConcurrency = 2;
const jobs = new Map();
const queue = [];
let running = 0;
let persistTimer = null;

export function initJobs({ file, executeFn, concurrency }) {
  jobsFile = file;
  executor = executeFn;
  maxConcurrency = concurrency || Number(process.env.JOBS_CONCURRENCY || 2);
  jobs.clear(); queue.length = 0; running = 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try {
      for (const j of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        if (j.status === 'running' || j.status === 'queued') { j.status = 'interrupted'; j.requestIntact = false; }
        jobs.set(j.id, j);
      }
    } catch (err) { console.error('[jobs] 持久化文件损坏，忽略', err.message); }
  }
}

export function submitJob(capability, request, { estimate = null } = {}) {
  const job = {
    id: `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    capability, request, requestIntact: true,
    status: 'queued', stage: '排队中', progress: 0,
    costEstimate: estimate, costActual: null, result: null, error: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  persistSoon();
  pump();
  return job;
}

export function getJob(id) { return jobs.get(id) || null; }

export function listJobs(limit = 50) {
  return [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(sanitize);
}

export function retryJob(id) {
  const job = jobs.get(id);
  if (!job) return { error: { code: 'not_found', message: `无此任务 ${id}` } };
  if (job.status !== 'failed' && job.status !== 'interrupted') return { error: { code: 'bad_request', message: '仅失败/中断任务可重试' } };
  if (!job.requestIntact) return { error: { code: 'retry_unavailable', message: '重启后原始请求已不完整，请在卡片重新提交' } };
  job.status = 'queued'; job.stage = '排队中'; job.progress = 0; job.error = null;
  queue.push(job);
  persistSoon();
  pump();
  return { ok: true };
}

function pump() {
  while (running < maxConcurrency && queue.length) runJob(queue.shift());
}

async function runJob(job) {
  running += 1;
  job.status = 'running'; job.stage = '执行中';
  touch(job);
  try {
    const result = await executor(job.capability, job.request, {
      onProgress: (stage, progress) => { job.stage = stage; if (progress != null) job.progress = progress; touch(job); },
    });
    job.status = 'done'; job.progress = 100;
    job.result = { files: result.files || [], provider: result.provider, model: result.model, durationSec: result.durationSec };
    if (result.provider) job.costActual = costOfUsage(result.provider, result.model, result.usage || {});
  } catch (e) {
    job.status = 'failed';
    job.error = e.toJSON ? e.toJSON() : { code: 'internal', message: e.message };
    if (e.attempts) job.error.attempts = e.attempts;
  } finally {
    running -= 1;
    touch(job, true);
    pump();
  }
}

function touch(job, immediate = false) {
  job.updatedAt = new Date().toISOString();
  persistSoon(immediate);
}

function sanitize(job) {
  const { request, ...rest } = job;
  return { ...rest, request: JSON.parse(JSON.stringify(request || {}, (k, v) =>
    typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 100)}…(${v.length} chars)` : v)) };
}

function persistSoon(immediate = false) {
  if (immediate) return persist();
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 1000);
  persistTimer.unref?.();
}

function persist() {
  if (!jobsFile) return;
  try { fs.writeFileSync(jobsFile, JSON.stringify([...jobs.values()].map(sanitize), null, 2)); }
  catch (err) { console.error('[jobs] 持久化失败', err.message); }
}
```

- [ ] **Step 4: 接线与前端任务列表**

`src/bootstrap.js`：加 import（`initJobs`、`execute`、`DATA_DIR`、`path` 已有），`bootstrap()` 内 `startHealthLoop();` 之前加：

```js
initJobs({ file: path.join(DATA_DIR, 'jobs.json'), executeFn: execute });
```

（顶部对应加 `import { initJobs } from './gateway/jobs.js';`、`import { execute } from './gateway/gateway.js';`，`DATA_DIR` 并入 paths import。）

`src/api/routes.js`：顶部加 `import { listJobs, getJob, retryJob } from '../gateway/jobs.js';`，`registerRoutes` 内追加：

```js
route('GET /api/jobs', async (req, res) => json(res, { jobs: listJobs() }));
route('GET /api/jobs/:id', async (req, res, { params }) => {
  const job = getJob(params.id);
  job ? json(res, { job: listJobs(9999).find((j) => j.id === params.id) }) : jsonError(res, 'not_found', `无此任务 ${params.id}`);
});
route('POST /api/jobs/:id/retry', async (req, res, { params }) => json(res, retryJob(params.id)));
```

`prototype/app.js` 末尾追加，并在 `boot()` 内加 `renderJobs(); setInterval(renderJobs, 3000);`：

```js
const JOB_STATE = { queued: '排队', running: '生成中', done: '完成', failed: '失败', interrupted: '已中断' };

function mediaHtml(f) {
  if (/\.(png|jpe?g|webp)$/i.test(f.url)) return `<img src="${f.url}" alt="">`;
  if (/\.mp4$/i.test(f.url)) return `<video controls src="${f.url}"></video>`;
  if (/\.(mp3|wav)$/i.test(f.url)) return `<audio controls src="${f.url}"></audio>`;
  return `<a href="${f.url}" target="_blank">${f.url}</a>`;
}

async function renderJobs() {
  const data = await api('/api/jobs');
  if (data.error) return;
  $('#jobs-list').innerHTML = data.jobs.map((j) => `
    <div class="job">
      <div>${j.capability} · ${JOB_STATE[j.status] || j.status} · ${j.stage || ''}
        ${j.costEstimate ? `· 预估 $${j.costEstimate.estimatedUsd}` : ''}
        ${j.costActual != null ? `· 实际 $${j.costActual}` : ''}</div>
      <div class="bar"><i style="width:${j.progress || 0}%"></i></div>
      ${j.status === 'done' && j.result ? j.result.files.map(mediaHtml).join('') : ''}
      ${j.status === 'failed' && j.error ? `<div class="out">${errText(j.error)}</div>` : ''}
      ${(j.status === 'failed' || j.status === 'interrupted') ? `<button onclick="retryJobClick('${j.id}')">重试</button>` : ''}
    </div>`).join('') || '<div class="out">暂无任务</div>';
}

window.retryJobClick = async (id) => {
  const r = await api(`/api/jobs/${id}/retry`, {}, 'POST');
  if (r.error) alert(errText(r.error));
  renderJobs();
};
```

- [ ] **Step 5: 测试通过后 Commit**

Run: `node --test test/` 与 `npm run check` → PASS。

```bash
git add -A
git commit -m "feat: 统一异步 job 队列——持久化/恢复/并发上限（GW-6）"
```

---

### Task 11: 成本闸门与账本端点（estimate / usage / confirm）

**Files:**
- Modify: `src/api/routes.js`, `prototype/app.js`

- [ ] **Step 1: 实现端点与媒体提交辅助函数**

`src/api/routes.js`：顶部加 import：

```js
import { estimateRequest } from '../gateway/costs.js';
import { resolveRoute } from '../gateway/gateway.js';
import { summarize } from '../gateway/ledger.js';
import { submitJob } from '../gateway/jobs.js'; // 并入已有 jobs import
import { gatewayError } from '../gateway/errors.js'; // 并入已有 errors import
```

模块级函数（`registerRoutes` 之外）：

```js
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
```

`registerRoutes` 内追加：

```js
route('POST /api/estimate', async (req, res, { readJsonBody }) => {
  const { capability, request = {} } = await readJsonBody();
  if (!capability) return jsonError(res, 'bad_request', 'capability 必填');
  try { json(res, estimateFor(capability, request)); } catch (e) { sendGatewayError(res, e); }
});

route('GET /api/usage', async (req, res) => {
  const s = summarize({ sinceMs: Date.now() - 7 * 86400e3 });
  json(res, { ...s, textBudgetUsd: 2, textWarn: s.textUsd >= 1.6 });
});
```

- [ ] **Step 2: 前端成本面板与确认弹窗**

`prototype/app.js` 末尾追加，并在 `boot()` 内加 `renderUsage(); setInterval(renderUsage, 30000);`：

```js
async function renderUsage() {
  const u = await api('/api/usage');
  if (u.error) return;
  $('#usage-summary').textContent =
    `本周 AI 成本 $${u.totalUsd}（文本 $${u.textUsd} / 红线 $${u.textBudgetUsd}）${u.textWarn ? ' ⚠️ 接近红线' : ''}`;
}

function confirmCost(estimate) {
  return new Promise((resolve) => {
    $('#confirm-text').textContent =
      `将由 ${estimate.provider}/${estimate.model} 生成 ${estimate.capability}，预估成本 $${estimate.estimatedUsd}。继续？`;
    $('#confirm-modal').classList.remove('hidden');
    const ok = $('#confirm-ok'); const cancel = $('#confirm-cancel');
    const done = (v) => {
      $('#confirm-modal').classList.add('hidden');
      ok.removeEventListener('click', yes); cancel.removeEventListener('click', no);
      resolve(v);
    };
    const yes = () => done(true); const no = () => done(false);
    ok.addEventListener('click', yes); cancel.addEventListener('click', no);
  });
}

// 重媒体卡片公用：先拿 confirm_required 的报价 → 弹窗确认 → 带 confirm 重发
async function submitWithConfirm(path, payload, outEl) {
  outEl.textContent = '估算成本…';
  const first = await api(path, payload);
  if (first.error && first.error.code === 'confirm_required') {
    if (!(await confirmCost(first.error.estimate))) { outEl.textContent = '已取消'; return null; }
    const second = await api(path, { ...payload, confirm: true });
    if (second.error) { outEl.textContent = errText(second.error); return null; }
    outEl.textContent = `已提交任务 ${second.jobId}，进度见下方任务列表`;
    renderJobs();
    return second;
  }
  if (first.error) { outEl.textContent = errText(first.error); return null; }
  return first;
}
```

- [ ] **Step 3: 验证**

`npm run check` → PASS。启动服务器：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/api/estimate -ContentType 'application/json' -Body '{"capability":"chat","request":{"messages":[{"role":"user","content":"hi"}]}}'
# → estimatedUsd 数值
Invoke-RestMethod -Uri http://127.0.0.1:3100/api/usage
# → totalUsd/textUsd/byCapability
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 成本预估/确认闸门与用量端点（CL-6/AI-3）"
```

---

### Task 12: 图像能力（gemini 适配器 + openrouter 图像兜底 + 图像卡）

**Files:**
- Create: `src/providers/gemini.js`
- Modify: `src/providers/index.js`, `src/providers/openrouter.js`, `src/api/routes.js`, `config/ai-providers.json`, `prototype/app.js`

- [ ] **Step 1: ⚠️ 文档校准**

WebFetch `https://ai.google.dev/api`：确认 `generateContent` 图像生成的现行模型 ID（默认配置写的 `gemini-3-pro-image-preview`）与 `responseModalities` 字段；确认 OpenRouter 图像输出仍为 `choices[0].message.images[].image_url.url`（dataUrl）。按结果修正下方代码与 `config/ai-providers.json` 的模型 ID。

- [ ] **Step 2: 实现 gemini.js**

```js
import { gatewayError } from '../gateway/errors.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const headers = (env) => ({ 'x-goog-api-key': env.GEMINI_API_KEY });

const adapter = {
  id: 'gemini',
  label: 'Google Gemini 直连',
  capabilities: ['chat', 'content', 'image'],
  envKeys: ['GEMINI_API_KEY'],
  isConfigured: (env) => Boolean(env.GEMINI_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    await ctx.fetchJson(`${API}/models?pageSize=1`, { method: 'GET', headers: headers(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (capability === 'image') return invokeImage(request, ctx);
    if (capability === 'chat' || capability === 'content') return invokeText(request, ctx);
    throw gatewayError('bad_request', `gemini 暂未实现能力 ${capability}`, { providerId: 'gemini' });
  },
};

function checkSafety(data) {
  const block = data.promptFeedback?.blockReason || (data.candidates?.[0]?.finishReason === 'SAFETY' ? 'SAFETY' : null);
  if (block) throw gatewayError('safety', `Gemini 安全策略拦截: ${block}`, { providerId: 'gemini', hint: '调整提示词后重试' });
}

async function invokeText(request, ctx) {
  const contents = request.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const data = await ctx.fetchJson(`${API}/models/${request.model}:generateContent`, {
    headers: headers(ctx.env),
    body: {
      contents,
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      generationConfig: { maxOutputTokens: request.maxTokens || 2048 },
    },
  });
  checkSafety(data);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw gatewayError('provider_error', 'Gemini 返回空内容', { providerId: 'gemini' });
  return { text, usage: { inputTokens: data.usageMetadata?.promptTokenCount || 0, outputTokens: data.usageMetadata?.candidatesTokenCount || 0 } };
}

async function invokeImage(request, ctx) {
  const parts = [{ text: request.prompt }];
  for (const ref of request.refImages || []) {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(ref);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  const data = await ctx.fetchJson(`${API}/models/${request.model}:generateContent`, {
    headers: headers(ctx.env), timeoutMs: 120000,
    body: { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } },
  });
  checkSafety(data);
  const img = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
  if (!img) throw gatewayError('provider_error', 'Gemini 未返回图像', { providerId: 'gemini' });
  const ext = img.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const saved = ctx.saveFile(Buffer.from(img.inlineData.data, 'base64'), ext);
  return { files: [saved], usage: { images: 1 } };
}

export default adapter;
```

`src/providers/index.js`：加 `import gemini from './gemini.js';` 并把 `gemini` 加入 `ADAPTERS` 数组。

- [ ] **Step 3: openrouter 图像兜底**

`src/providers/openrouter.js`：顶部加 `import { dataUrlToBuffer } from '../lib/files.js';`；`invoke` 的 switch 在 `throw` 之前加：

```js
    if (capability === 'image') return invokeImage(request, ctx);
```

文件末尾加：

```js
async function invokeImage(request, ctx) {
  const data = await ctx.fetchJson(`${API}/chat/completions`, {
    headers: auth(ctx.env), timeoutMs: 180000,
    body: { model: request.model, messages: [{ role: 'user', content: request.prompt }], modalities: ['image', 'text'] },
  });
  const img = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!img) throw gatewayError('provider_error', 'OpenRouter 未返回图像', { providerId: 'openrouter' });
  const { mime, buf } = dataUrlToBuffer(img);
  return { files: [ctx.saveFile(buf, mime === 'image/jpeg' ? 'jpg' : 'png')], usage: { images: 1 } };
}
```

- [ ] **Step 4: 端点、配置、前端卡**

`config/ai-providers.json` 加回：

```json
  "image":   { "provider": "gemini", "model": "gemini-3-pro-image-preview",
               "fallback": [{ "provider": "openrouter", "model": "google/gemini-3-pro-image-preview" }] },
```

`src/api/routes.js` 的 `registerRoutes` 内追加（图像同步、低成本，不走 confirm 闸门）：

```js
route('POST /api/ai/image', async (req, res, { readJsonBody }) => {
  const body = await readJsonBody();
  if (!body.prompt) return jsonError(res, 'bad_request', 'prompt 必填');
  try {
    const r = await execute('image', { prompt: body.prompt, refImages: body.refImages || [], aspect: body.aspect });
    json(res, { files: r.files, provider: r.provider, model: r.model });
  } catch (e) { sendGatewayError(res, e); }
});
```

`prototype/app.js` 末尾追加，并在 `boot()` 加 `initImage();`：

```js
function fileToDataUrl(input) {
  return new Promise((resolve) => {
    const f = input.files && input.files[0];
    if (!f) return resolve(null);
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(f);
  });
}

function initImage() {
  $('#image-send').addEventListener('click', async () => {
    const prompt = $('#image-prompt').value.trim();
    if (!prompt) return;
    const btn = $('#image-send'); btn.disabled = true;
    $('#image-out').textContent = '生成中…（目标 ≤60s）';
    const ref = await fileToDataUrl($('#image-ref'));
    const r = await api('/api/ai/image', { prompt, refImages: ref ? [ref] : [] });
    btn.disabled = false;
    $('#image-out').innerHTML = r.error
      ? errText(r.error)
      : r.files.map(mediaHtml).join('') + `<div>—— ${r.provider}/${r.model}</div>`;
  });
}
```

- [ ] **Step 5: 验证与 Commit**

`node --test test/` 与 `npm run check` → PASS。配 `GEMINI_API_KEY` 后重启，工作台图像卡生成一张写真，产物落 `prototype/generated/`，`/api/usage` 中 image 计数 +1。

```bash
git add -A
git commit -m "feat: 图像能力——Gemini 直连 + OpenRouter 兜底（FR 写真链路）"
```

---

### Task 13: 视频能力（kling 适配器 + 视频卡）

**Files:**
- Create: `src/providers/kling.js`
- Modify: `src/providers/index.js`, `src/api/routes.js`, `config/ai-providers.json`, `prototype/app.js`

- [ ] **Step 1: ⚠️ 文档校准**

WebFetch Kling 官方 API 文档（`https://app.klingai.com/global/dev/document-api` 或现行入口）：确认 base URL（代码默认 `https://api-singapore.klingai.com`，可用 env `KLING_API_BASE` 覆盖）、JWT 鉴权（iss/exp/nbf + HS256）、`POST /v1/videos/image2video` 与 `text2video` 的字段（`model_name/duration/aspect_ratio/image`）、查询端点与 `task_status` 取值。按结果修正常量与字段。

- [ ] **Step 2: 实现 kling.js**

```js
import crypto from 'node:crypto';
import { gatewayError } from '../gateway/errors.js';

const BASE = (env) => env.KLING_API_BASE || 'https://api-singapore.klingai.com';
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 15 * 60 * 1000;

function jwtToken(ak, sk) {
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const payload = b64u({ iss: ak, exp: now + 1800, nbf: now - 5 });
  const sig = crypto.createHmac('sha256', sk).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

const authHeaders = (env) => ({ authorization: `Bearer ${jwtToken(env.KLING_ACCESS_KEY, env.KLING_SECRET_KEY)}` });
const stripDataUrl = (s) => { const m = /^data:[^;,]+;base64,(.+)$/.exec(s || ''); return m ? m[1] : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adapter = {
  id: 'kling',
  label: 'Kling 官方',
  capabilities: ['video'],
  envKeys: ['KLING_ACCESS_KEY', 'KLING_SECRET_KEY'],
  isConfigured: (env) => Boolean(env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY),

  async probe(ctx) {
    const t = Date.now();
    // 轻量鉴权探测：查询不存在任务应返回 4xx 业务错而非 401；401 会被 fetchJson 归一为 auth 抛出
    await ctx.fetchJson(`${BASE(ctx.env)}/v1/videos/image2video?pageNum=1&pageSize=1`, {
      method: 'GET', headers: authHeaders(ctx.env), timeoutMs: 5000,
    });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (capability !== 'video') throw gatewayError('bad_request', `kling 不支持能力 ${capability}`, { providerId: 'kling' });
    return invokeVideo(request, ctx);
  },
};

async function invokeVideo(request, ctx) {
  const isI2V = Boolean(request.imageRef);
  const submitPath = isI2V ? '/v1/videos/image2video' : '/v1/videos/text2video';
  const body = {
    model_name: request.model,
    prompt: request.prompt || '',
    mode: 'std',
    duration: String(request.durationSec === 10 ? 10 : 5),
    ...(isI2V ? { image: stripDataUrl(request.imageRef) } : { aspect_ratio: request.aspect || '9:16' }),
  };
  ctx.onProgress('提交 Kling 任务', 5);
  const submit = await ctx.fetchJson(`${BASE(ctx.env)}${submitPath}`, { headers: authHeaders(ctx.env), body, timeoutMs: 60000 });
  const taskId = submit.data?.task_id;
  if (!taskId) throw gatewayError('provider_error', `Kling 未返回 task_id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'kling' });

  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const st = await ctx.fetchJson(`${BASE(ctx.env)}${submitPath}/${taskId}`, { method: 'GET', headers: authHeaders(ctx.env), timeoutMs: 30000 });
    const status = st.data?.task_status;
    ctx.onProgress(`Kling: ${status || '排队中'}`, status === 'processing' ? 50 : 20);
    if (status === 'succeed') {
      const url = st.data?.task_result?.videos?.[0]?.url;
      if (!url) throw gatewayError('provider_error', 'Kling 成功但无视频 URL', { providerId: 'kling' });
      ctx.onProgress('下载视频', 90);
      const buf = await ctx.fetchBuffer(url, { method: 'GET', headers: {}, timeoutMs: 300000 });
      return {
        files: [ctx.saveFile(buf, 'mp4')],
        durationSec: request.durationSec || 5,
        usage: { seconds: request.durationSec || 5 },
      };
    }
    if (status === 'failed') {
      throw gatewayError('provider_error', `Kling 生成失败: ${st.data?.task_status_msg || '无详情'}`, { providerId: 'kling' });
    }
  }
  throw gatewayError('timeout', `Kling 轮询超时（${MAX_POLL_MS / 60000} 分钟）`, { providerId: 'kling' });
}

export default adapter;
```

`src/providers/index.js`：加 `import kling from './kling.js';` 并加入 `ADAPTERS`。

- [ ] **Step 3: 端点、配置、前端卡**

`config/ai-providers.json` 加回：

```json
  "video":   { "provider": "kling", "model": "kling-v3-std",
               "fallback": [{ "provider": "openrouter", "model": "kwaivgi/kling-v3.0-std" }] },
```

注：openrouter 适配器声明了 video 能力但 `invokeVideo` 留待需要时实现（其 videos API 仍为 alpha）；当前 fallback 命中会得到结构化 `bad_request`「暂未实现」，不影响主链。若 Step 1 校准时 OpenRouter videos API 已稳定，可一并实现（提交/轮询模式同 Kling）。

`src/api/routes.js` 的 `registerRoutes` 内追加（走 Task 11 的 `handleMediaSubmit` 确认闸门）：

```js
route('POST /api/ai/video', async (req, res, { readJsonBody }) => {
  const body = await readJsonBody();
  await handleMediaSubmit('video', res, body, (b) => {
    if (!b.prompt && !b.imageRef) throw new Error('prompt 与参考图至少填一项');
    return { prompt: b.prompt || '', imageRef: b.imageRef || null, durationSec: Number(b.durationSec) || 5, aspect: '9:16' };
  });
});
```

`prototype/app.js` 末尾追加，并在 `boot()` 加 `initVideo();`：

```js
function initVideo() {
  $('#video-send').addEventListener('click', async () => {
    const prompt = $('#video-prompt').value.trim();
    const imageRef = await fileToDataUrl($('#video-ref'));
    if (!prompt && !imageRef) return;
    const btn = $('#video-send'); btn.disabled = true;
    await submitWithConfirm('/api/ai/video', { prompt, imageRef, durationSec: Number($('#video-duration').value) }, $('#video-out'));
    btn.disabled = false;
  });
}
```

- [ ] **Step 4: 验证与 Commit**

`node --test test/` 与 `npm run check` → PASS。配 Kling key 后重启：视频卡上传一张图 → 弹出成本确认 → 提交后任务列表出现 job，阶段从「提交 Kling 任务」走到「下载视频」，完成后可内联播放 mp4。未确认时端点返回 `confirm_required`。

```bash
git add -A
git commit -m "feat: 视频能力——Kling 图生视频 job 链路（FR-402v3）"
```

---

### Task 14: 音乐能力（suno 适配器 + 音乐卡）

**Files:**
- Create: `src/providers/suno.js`
- Modify: `src/providers/index.js`, `src/api/routes.js`, `config/ai-providers.json`, `prototype/app.js`

- [ ] **Step 1: ⚠️ 文档校准（本任务必做，字段不可凭记忆）**

WebFetch Suno 官方 API 文档（suno.com 开发者入口；若官方 API 未对账号开放，按用户实际使用的兼容服务文档来，base 用 env `SUNO_API_BASE` 覆盖）。需确认：提交端点与字段（标题/风格/歌词/纯音乐开关/模型）、查询端点与完成状态、音频 URL 字段、鉴权头。**按文档逐一修正下方代码中 `SUBMIT_PATH`、`STATUS_PATH`、`buildBody`、`parseStatus` 四处。**

- [ ] **Step 2: 实现 suno.js（结构固定，常量与字段按 Step 1 校准）**

```js
import { gatewayError } from '../gateway/errors.js';

const BASE = (env) => env.SUNO_API_BASE || 'https://api.suno.com';
const SUBMIT_PATH = '/v1/songs';            // ⚠️ 按文档校准
const STATUS_PATH = (id) => `/v1/songs/${id}`; // ⚠️ 按文档校准
const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 10 * 60 * 1000;

const auth = (env) => ({ authorization: `Bearer ${env.SUNO_API_KEY}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ⚠️ 字段名按文档校准
function buildBody(request) {
  return {
    title: request.title || '未命名',
    tags: request.stylePrompt || '',
    prompt: request.lyrics || '',
    custom_mode: Boolean(request.lyrics),
    model: request.model,
  };
}

// ⚠️ 状态/URL 字段按文档校准；返回 { done, failed, audioUrl, detail }
function parseStatus(data) {
  const item = Array.isArray(data?.data) ? data.data[0] : (data?.data || data);
  const status = item?.status || item?.state;
  return {
    done: status === 'complete' || status === 'succeeded',
    failed: status === 'error' || status === 'failed',
    audioUrl: item?.audio_url || item?.audioUrl || null,
    detail: item?.error_message || status || '',
  };
}

const adapter = {
  id: 'suno',
  label: 'Suno 官方',
  capabilities: ['music'],
  envKeys: ['SUNO_API_KEY'],
  isConfigured: (env) => Boolean(env.SUNO_API_KEY),

  async probe(ctx) {
    const t = Date.now();
    // ⚠️ 按文档选最轻量的鉴权端点（如账户/额度查询）
    await ctx.fetchJson(`${BASE(ctx.env)}/v1/me`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 5000 });
    return { ok: true, latencyMs: Date.now() - t };
  },

  async invoke(capability, request, ctx) {
    if (capability !== 'music') throw gatewayError('bad_request', `suno 不支持能力 ${capability}`, { providerId: 'suno' });
    ctx.onProgress('提交 Suno 任务', 5);
    const submit = await ctx.fetchJson(`${BASE(ctx.env)}${SUBMIT_PATH}`, { headers: auth(ctx.env), body: buildBody(request), timeoutMs: 60000 });
    const taskId = submit.id || submit.data?.id || submit.data?.task_id;
    if (!taskId) throw gatewayError('provider_error', `Suno 未返回任务 id: ${JSON.stringify(submit).slice(0, 200)}`, { providerId: 'suno' });

    const deadline = Date.now() + MAX_POLL_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const st = await ctx.fetchJson(`${BASE(ctx.env)}${STATUS_PATH(taskId)}`, { method: 'GET', headers: auth(ctx.env), timeoutMs: 30000 });
      const s = parseStatus(st);
      ctx.onProgress(`Suno: ${s.detail || '生成中'}`, s.done ? 80 : 40);
      if (s.failed) throw gatewayError('provider_error', `Suno 生成失败: ${s.detail}`, { providerId: 'suno' });
      if (s.done && s.audioUrl) {
        ctx.onProgress('下载歌曲', 90);
        const buf = await ctx.fetchBuffer(s.audioUrl, { method: 'GET', headers: {}, timeoutMs: 300000 });
        return { files: [ctx.saveFile(buf, 'mp3')], usage: { songs: 1 } };
      }
    }
    throw gatewayError('timeout', `Suno 轮询超时（${MAX_POLL_MS / 60000} 分钟）`, { providerId: 'suno' });
  },
};

export default adapter;
```

`src/providers/index.js`：加 `import suno from './suno.js';` 并加入 `ADAPTERS`。

- [ ] **Step 3: 端点、配置、前端卡**

`config/ai-providers.json` 加回：

```json
  "music":   { "provider": "suno", "model": "v5" },
```

`src/api/routes.js` 的 `registerRoutes` 内追加：

```js
route('POST /api/ai/music', async (req, res, { readJsonBody }) => {
  const body = await readJsonBody();
  await handleMediaSubmit('music', res, body, (b) => {
    if (!b.title && !b.stylePrompt) throw new Error('歌名与曲风至少填一项');
    return { title: b.title || '', stylePrompt: b.stylePrompt || '', lyrics: b.lyrics || '' };
  });
});
```

`prototype/app.js` 末尾追加，并在 `boot()` 加 `initMusic();`：

```js
function initMusic() {
  $('#music-send').addEventListener('click', async () => {
    const payload = {
      title: $('#music-title').value.trim(),
      stylePrompt: $('#music-style').value.trim(),
      lyrics: $('#music-lyrics').value.trim(),
    };
    if (!payload.title && !payload.stylePrompt) return;
    const btn = $('#music-send'); btn.disabled = true;
    await submitWithConfirm('/api/ai/music', payload, $('#music-out'));
    btn.disabled = false;
  });
}
```

- [ ] **Step 4: 验证与 Commit**

`node --test test/` 与 `npm run check` → PASS。配 Suno key 后重启：音乐卡填歌名+曲风 → 成本确认 → job 完成后任务列表内联播放 mp3（完整带人声歌曲，FR-502v3）。

```bash
git add -A
git commit -m "feat: 音乐能力——Suno 完整歌曲 job 链路（FR-502v3）"
```

---

### Task 15: 语音能力（dashscope TTS / ASR + 卡片）

**Files:**
- Modify: `src/providers/dashscope.js`, `src/api/routes.js`, `config/ai-providers.json`, `prototype/app.js`

- [ ] **Step 1: ⚠️ 文档校准**

WebFetch 阿里云百炼语音文档（`https://help.aliyun.com/zh/model-studio/`）：确认同步 REST 形态的 TTS 模型（设计默认 `qwen-tts`，CosyVoice v3 若仅 WebSocket 则维持 qwen-tts 并在 config 注释说明）与 ASR 模型 `qwen3-asr-flash` 的请求/响应字段。按结果修正下方 `invokeTts/invokeAsr` 与默认音色。

- [ ] **Step 2: 扩展 dashscope.js**

`invoke` 的 switch 在 `throw` 之前加两行：

```js
    if (capability === 'tts') return invokeTts(request, ctx);
    if (capability === 'asr') return invokeAsr(request, ctx);
```

文件末尾加（多模态生成端点，字段按 Step 1 校准）：

```js
async function invokeTts(request, ctx) {
  const data = await ctx.fetchJson(`${BASE}/api/v1/services/aigc/multimodal-generation/generation`, {
    headers: auth(ctx.env), timeoutMs: 60000,
    body: {
      model: request.model,
      input: { text: request.text, voice: request.voice || 'Cherry' },
    },
  });
  const audioUrl = data.output?.audio?.url;
  if (!audioUrl) throw gatewayError('provider_error', `DashScope TTS 无音频 URL: ${JSON.stringify(data).slice(0, 200)}`, { providerId: 'dashscope' });
  const buf = await ctx.fetchBuffer(audioUrl, { method: 'GET', headers: {}, timeoutMs: 60000 });
  return { files: [ctx.saveFile(buf, 'wav')], usage: { chars: String(request.text || '').length } };
}

async function invokeAsr(request, ctx) {
  const data = await ctx.fetchJson(`${BASE}/api/v1/services/aigc/multimodal-generation/generation`, {
    headers: auth(ctx.env), timeoutMs: 120000,
    body: {
      model: request.model,
      input: { messages: [{ role: 'user', content: [{ audio: request.audio }] }] },
    },
  });
  const content = data.output?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text || '').join('') : (content || '');
  if (!text) throw gatewayError('provider_error', 'DashScope ASR 返回空文本', { providerId: 'dashscope' });
  return { text, usage: { minutes: 1 } };
}
```

- [ ] **Step 3: 端点、配置、前端卡**

`config/ai-providers.json` 加回：

```json
  "tts":     { "provider": "dashscope", "model": "qwen-tts" },
  "asr":     { "provider": "dashscope", "model": "qwen3-asr-flash" },
```

`src/api/routes.js` 的 `registerRoutes` 内追加（tts 同步、≤1000 字；asr 同步、音频走 dataUrl）：

```js
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
```

`prototype/app.js` 末尾追加，并在 `boot()` 加 `initTts(); initAsr();`：

```js
function initTts() {
  $('#tts-send').addEventListener('click', async () => {
    const text = $('#tts-text').value.trim();
    if (!text) return;
    const btn = $('#tts-send'); btn.disabled = true;
    $('#tts-out').textContent = '合成中…';
    const r = await api('/api/ai/tts', { text, voice: $('#tts-voice').value.trim() || undefined });
    btn.disabled = false;
    $('#tts-out').innerHTML = r.error ? errText(r.error) : r.files.map(mediaHtml).join('') + `<div>—— ${r.provider}/${r.model}</div>`;
  });
}

function initAsr() {
  $('#asr-send').addEventListener('click', async () => {
    const audio = await fileToDataUrl($('#asr-file'));
    if (!audio) return;
    const btn = $('#asr-send'); btn.disabled = true;
    $('#asr-out').textContent = '转写中…';
    const r = await api('/api/ai/asr', { audio });
    btn.disabled = false;
    $('#asr-out').textContent = r.error ? errText(r.error) : `${r.text}\n—— ${r.provider}/${r.model}`;
  });
}
```

- [ ] **Step 4: 验证与 Commit**

`node --test test/` 与 `npm run check` → PASS。配 `DASHSCOPE_API_KEY` 后：TTS 卡输入台词 → 可播放音频；ASR 卡上传刚才的音频 → 还原文本。

```bash
git add -A
git commit -m "feat: 语音能力——DashScope TTS/ASR 同步链路"
```

---

### Task 16: 设置页（路由热更新 + key 后台录入）

**Files:**
- Modify: `src/api/routes.js`, `prototype/app.js`

- [ ] **Step 1: 配置与 key 端点**

`src/api/routes.js`：顶部 import 并入 `loadConfig, updateConfig, listProviders`（来自 registry）、`setEnvKey`（来自 `../lib/env.js`）、`ENV_FILE`（来自 `../lib/paths.js`）、`refreshHealth`（已有）。`registerRoutes` 内追加：

```js
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
```

安全要点：两个端点都**永不返回完整 key**（GET 只给 `configured + 尾 4 位`，POST 只回 tail）；`setEnvKey` 写服务端 `.env` 并同步 `process.env`，录入后立即重探健康（设计 §7）。

- [ ] **Step 2: 设置页前端**

`prototype/app.js` 末尾追加，并在 `boot()` 加 `initSettings();`：

```js
async function renderKeys() {
  const data = await api('/api/config/keys');
  if (data.error) return;
  $('#keys-list').innerHTML = data.keys.map((k) => `
    <div class="key-row">
      <label>${k.provider} · ${k.key} ${k.configured ? `（已配 ****${k.tail}）` : '（未配）'}</label>
      <input type="password" data-key="${k.key}" placeholder="粘贴新 key 后回车提交">
    </div>`).join('');
  document.querySelectorAll('#keys-list input').forEach((input) => {
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      const r = await api('/api/config/keys', { key: input.dataset.key, value: input.value.trim() });
      if (r.error) return alert(errText(r.error));
      input.value = '';
      renderKeys(); renderHealth(); renderRoutes();
    });
  });
}

function initSettings() {
  renderKeys();
  $('#config-save').addEventListener('click', async () => {
    let next;
    try { next = JSON.parse($('#config-editor').value); }
    catch { $('#config-msg').textContent = 'JSON 格式错误'; return; }
    const r = await api('/api/config', next, 'PUT');
    $('#config-msg').textContent = r.error ? errText(r.error) : '已保存，路由即时生效';
    renderRoutes();
  });
}
```

- [ ] **Step 3: 验证与 Commit**

`npm run check` → PASS。浏览器验证：设置页录入一个 key（回车）→ 显示「已配 ****XXXX」、健康面板该平台从「未接入」变为探测结果、`.env` 出现该行；路由编辑器把 `chat` 的 provider 改成 `dashscope` 保存 → 聊天卡路由标注立即变化、对话走 qwen；改回 anthropic。GET `/api/config/keys` 响应中无完整 key。

```bash
git add -A
git commit -m "feat: 设置页——路由热更新与 key 后台录入（GW-3/GW-5）"
```

---

### Task 17: 冒烟测试、README 与最终验收

**Files:**
- Create: `scripts/smoke.mjs`, `README.md`
- Test: 全量回归

- [ ] **Step 1: 实现 smoke.mjs（OR-3）**

```js
import { spawn } from 'node:child_process';

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;

const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

async function call(path, body, method) {
  const res = await fetch(`${BASE}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function waitReady(ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`${BASE}/api/ping`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务器启动超时');
}

const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
try {
  await waitReady();

  const health = await call('/api/health');
  ok('health 返回 provider 三态', health.status === 200 && Array.isArray(health.data.providers)
    && health.data.providers.every((p) => ['online', 'error', 'unconfigured', 'unknown'].includes(p.state)),
    health.data.providers?.map((p) => `${p.id}:${p.state}`).join(' '));

  const cfg = await call('/api/config');
  ok('config 可读', cfg.status === 200 && cfg.data.chat?.provider);

  const onlineSet = new Set((health.data.providers || []).filter((p) => p.state === 'online').map((p) => p.id));
  for (const [path, cap] of [['/api/ai/chat', 'chat'], ['/api/ai/content', 'content'], ['/api/ai/world', 'world'], ['/api/ai/plan', 'plan']]) {
    const routed = [cfg.data[cap], ...(cfg.data[cap]?.fallback || [])].some((e) => e && onlineSet.has(e.provider));
    const r = await call(path, { messages: [{ role: 'user', content: '回复「OK」两个字母即可' }], maxTokens: 16 });
    if (routed) ok(`${cap} 真实调用`, r.status === 200 && Boolean(r.data.text), r.data.text?.slice(0, 40) || JSON.stringify(r.data.error));
    else ok(`${cap} 未接入时结构化降级`, r.status === 200 && r.data.error?.code === 'unconfigured', JSON.stringify(r.data.error));
  }

  const est = await call('/api/estimate', { capability: 'video', request: { durationSec: 10 } });
  ok('estimate 返回预估', est.status === 200 && typeof est.data.estimatedUsd === 'number');

  const noConfirm = await call('/api/ai/video', { prompt: 'smoke', durationSec: 5 });
  ok('video 未确认时 confirm_required 或 unconfigured', noConfirm.status === 200
    && ['confirm_required', 'unconfigured'].includes(noConfirm.data.error?.code), noConfirm.data.error?.code);

  const usage = await call('/api/usage');
  ok('usage 周聚合', usage.status === 200 && typeof usage.data.totalUsd === 'number');

  const jobs = await call('/api/jobs');
  ok('jobs 列表', jobs.status === 200 && Array.isArray(jobs.data.jobs));

  const keys = await call('/api/config/keys');
  ok('keys 不回显完整 key', keys.status === 200
    && keys.data.keys.every((k) => !k.value && (!k.tail || k.tail.length <= 4)));

  const home = await fetch(`${BASE}/`);
  ok('工作台首页', home.status === 200 && (await home.text()).includes('工作台'));

  const traversal = await fetch(`${BASE}/..%2f.env`);
  ok('路径穿越被拦截', traversal.status === 404);
} catch (e) {
  ok('smoke 执行', false, e.message);
} finally {
  server.kill();
}
console.log(failures ? `\nsmoke 失败 ${failures} 项` : '\nsmoke 全部通过');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: 写 README.md**

内容（按此结构成文，不必逐字）：项目一句话定位与 v3 规格链接；运行要求（Node ≥18，无 GPU）；快速开始（复制 `.env.example` → `.env`，或先零 key 启动再在设置页录入；双击 `start_all.bat`）；M1 工作台能做什么（六能力卡 + 健康 + 成本）；能力路由配置说明（`config/ai-providers.json` 结构、fallback、`providers.<id>.proxy`）；命令表（dev/check/test/smoke）；目录结构表；「新增一个 Provider = 新增一个适配器文件」的扩展指引（接口五要素：id/capabilities/envKeys/probe/invoke）。

- [ ] **Step 3: 全量回归与验收清单**

逐项执行并记录结果：

1. `npm run check` → 通过
2. `node --test test/` → 全部通过
3. `npm run smoke` → 全部通过（零 key 与配 key 两种环境各跑一次）
4. 双击 `start_all.bat` → 浏览器 3 秒内打开工作台（OR-1）
5. 配全 key 后六能力卡各出一次真实产物（验收：聊天 ≤8s、图像 ≤60s、视频 job 有进度且 ≤10min，NFR-1）
6. 杀进程重启 → 任务列表保留历史 job，running 变「已中断」可提示重提（GW-6)
7. 浏览器控制台零报错（继承基线）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 全量冒烟测试与 README（OR-3，M1 收口）"
```

---

## 自检记录（writing-plans Self-Review）

- **规格覆盖**：GW-1/3（Task 3、16）、GW-2（Task 8/12/13/14 适配器协议）、GW-4（Task 7）、GW-5（Task 1/16）、GW-6（Task 10）、GW-7（Task 5/11）、GW-8（Task 8/12 兜底）、CL-1/4（Task 1）、CL-5（Task 9）、CL-6（Task 11/13/14）、AI-3/4（Task 7/11）、NFR-2/3/4（Task 1/5/9）、OR-1/2/3（Task 1/6/17）。CL-2（local-acestep/local-comfyui 可选适配器）按用户「全新重写、不考虑旧代码」决策**有意不实现**——适配器协议已留好位置，有 GPU 的玩家需要时可按扩展指引自行补充；CL-3（ffmpeg 剪辑）属访谈/短剧管线，M2 引入。
- **类型一致性**：适配器五要素签名、`ctx.{fetchJson,fetchBuffer,saveFile,onProgress,env}`、归一化 `files:[{url,path}]`、`GatewayError.toJSON`、`handleMediaSubmit/estimateFor/submitWithConfirm` 等跨任务引用已逐一核对命名一致。
- **占位符**：无 TBD；外部 API 字段不确定处全部以「⚠️ 文档校准」步骤显式锁定（Suno 最重），代码结构完整可改字段即用。






