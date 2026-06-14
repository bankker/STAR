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
  for (const c of ['chat', 'content', 'world', 'plan', 'image', 'video', 'music', 'tts', 'asr', 'lipsync', 'drama-script', 'storyboard']) {
    assert.ok(CAPABILITIES.includes(c), c);
  }
});

test('loadConfig 校验失败不污染缓存', () => {
  registerProvider(fake('alpha', ['chat']));
  const file = tmpConfig({ chat: { provider: 'ghost', model: 'm' } });
  initConfig(file);
  assert.throws(() => loadConfig(), /未注册/);
  fs.writeFileSync(file, JSON.stringify({ chat: { provider: 'alpha', model: 'm1' } }));
  assert.equal(loadConfig().chat.provider, 'alpha');
});

test('fallback 非数组与路由非对象被拒绝', () => {
  registerProvider(fake('alpha', ['chat']));
  initConfig(tmpConfig({ chat: { provider: 'alpha', model: 'm', fallback: 'oops' } }));
  assert.throws(() => loadConfig(), /fallback 必须是数组/);
  initConfig(tmpConfig({ chat: null }));
  assert.throws(() => loadConfig(), /必须是对象/);
});

test('registerProvider 拒绝空 capabilities', () => {
  assert.throws(() => registerProvider(fake('empty', [])), /非空数组/);
});
