import fs from 'node:fs';

export const CAPABILITIES = [
  'chat', 'content', 'world', 'plan', 'image', 'video', 'music', 'tts', 'asr',
  'lipsync', 'drama-script', 'storyboard',
];

const providers = new Map();
let configFile = null;
let configCache = null;

export function registerProvider(adapter) {
  for (const f of ['id', 'label', 'capabilities', 'envKeys', 'isConfigured', 'probe', 'invoke']) {
    if (adapter[f] == null) throw new Error(`适配器缺少 ${f}: ${adapter.id || '(无 id)'}`);
  }
  if (!adapter.id || !adapter.label) throw new Error('适配器 id/label 不能为空');
  if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
    throw new Error(`适配器 capabilities 必须是非空数组: ${adapter.id}`);
  }
  if (!Array.isArray(adapter.envKeys)) throw new Error(`适配器 envKeys 必须是数组: ${adapter.id}`);
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
    if (typeof entry !== 'object' || entry === null) throw new Error(`能力 ${cap} 的路由必须是对象`);
    if (entry.fallback !== undefined && !Array.isArray(entry.fallback)) {
      throw new Error(`能力 ${cap} 的 fallback 必须是数组`);
    }
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
  if (!configFile) throw new Error('loadConfig: 需先调用 initConfig()');
  if (!configCache) {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    validateConfig(parsed);
    configCache = parsed;
  }
  return configCache;
}

export function updateConfig(next) {
  validateConfig(next);
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
  configCache = next;
}
