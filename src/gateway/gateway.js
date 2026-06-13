import { loadConfig, getProvider } from './registry.js';
import { gatewayError, GatewayError } from './errors.js';
import { recordUsage } from './ledger.js';
import { costOfUsage } from './costs.js';
import { fetchJson, fetchBuffer, fetchStream } from '../lib/http-fetch.js';
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
  // 每次调用读取最新配置（热更新生效）；与 resolveRoute 的快照可能存在极短窗口差异，属有意为之
  const settings = (loadConfig().providers || {})[providerId] || {};
  const base = { providerId, proxy: settings.proxy, timeoutMs: settings.timeoutMs || 120000 };
  return {
    env: process.env,
    fetchJson: (url, opts = {}) => fetchJson(url, { ...base, ...opts }),
    fetchBuffer: (url, opts = {}) => fetchBuffer(url, { ...base, ...opts }),
    fetchStream: (url, opts = {}, onChunk) => fetchStream(url, { ...base, ...opts }, onChunk),
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
        result = await entry.provider.invoke(capability, req, ctx);
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
      if (emitted || !ge.retriable) throw aggregate(capability, attempts, ge);
    }
  }
  throw aggregate(capability, attempts);
}

function aggregate(capability, attempts, last = null) {
  const tail = attempts[attempts.length - 1] || {};
  const e = gatewayError(
    last?.code || tail.code || 'provider_error',
    `能力 ${capability} 调用失败（尝试 ${attempts.length} 个 Provider）`,
    {
      providerId: tail.provider || null,
      hint: last?.hint || tail.hint || '查看各环节原因，修复 key/配额后重试',
      retriable: last ? last.retriable : undefined, // 保留触发方的 retriable 覆盖；undefined → 按错误码自动判定
    },
  );
  e.attempts = Object.freeze([...attempts]);
  e.toJSON = () => ({
    code: e.code, message: e.message, providerId: e.providerId,
    retriable: e.retriable, ...(e.hint ? { hint: e.hint } : {}), attempts: e.attempts,
  });
  return e;
}
