import { listProviders } from './registry.js';
import { makeCtx } from './gateway.js';
import { currentEnv } from '../lib/request-context.js';

const state = new Map();
let started = false;

function withTimeout(promise, ms) {
  let timer;
  promise.catch(() => {}); // 超时先发生时，迟到的 probe rejection 不能变成 unhandled rejection
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`探测超时(${ms}ms)`)), ms); timer.unref(); }),
  ]);
}

async function doRefresh() {
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

let inflight = null;
export function refreshHealth() {
  if (!inflight) inflight = doRefresh().finally(() => { inflight = null; });
  return inflight;
}

export function getHealthSnapshot() {
  return listProviders().map((p) => ({
    id: p.id, label: p.label, capabilities: p.capabilities,
    ...(state.get(p.id) || { state: 'unknown' }),
  }));
}

// 多租户：按「当前请求用户」的私有 key 现场探测（带 30s 每用户缓存，避免频繁打探针）。
// 必须在请求的 AsyncLocalStorage 上下文内调用，makeCtx/isConfigured 才能读到该用户的 env。
const userCache = new Map(); // `${uid}:${pid}` -> { ts, v }
export async function userHealthSnapshot(uid, { refresh = false } = {}) {
  const env = currentEnv();
  return Promise.all(listProviders().map(async (p) => {
    const base = { id: p.id, label: p.label, capabilities: p.capabilities };
    if (!p.isConfigured(env)) return { ...base, state: 'unconfigured' };
    const ck = `${uid}:${p.id}`;
    const cached = userCache.get(ck);
    if (!refresh && cached && Date.now() - cached.ts < 30000) return { ...base, ...cached.v };
    const t = Date.now();
    let v;
    try {
      await withTimeout(p.probe(makeCtx(p.id)), 5000);
      v = { state: 'online', latencyMs: Date.now() - t, lastCheck: new Date().toISOString() };
    } catch (e) {
      v = { state: 'error', detail: e.message, lastCheck: new Date().toISOString() };
    }
    userCache.set(ck, { ts: Date.now(), v });
    return { ...base, ...v };
  }));
}

export function startHealthLoop(intervalMs = 60000) {
  if (started) return;
  started = true;
  refreshHealth();
  setInterval(() => refreshHealth(), intervalMs).unref();
}
