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
    assert.ok(JSON.parse(JSON.stringify(e)).attempts);
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

test('适配器抛非 GatewayError 时归一为 provider_error 并可降级', async () => {
  const bad = { ...fake('a'), invoke: async () => { throw new TypeError('boom'); } };
  setup([bad, fake('b')], CHAIN);
  const r = await execute('chat', { messages: [] });
  assert.equal(r.provider, 'b');
});
