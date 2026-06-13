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
  assert.deepEqual(got, ['半']);
});
