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
