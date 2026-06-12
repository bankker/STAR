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

test('坏行/缺字段/无效时间戳被跳过，零成本调用仍计数', () => {
  const file = tmpFile();
  initLedger(file);
  fs.appendFileSync(file, '{broken json\n');
  fs.appendFileSync(file, JSON.stringify({ capability: 'chat', provider: 'p', estUsd: 5 }) + '\n'); // 无 ts
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), provider: 'p', estUsd: 5 }) + '\n'); // 无 capability
  recordUsage({ capability: 'chat', provider: 'p', model: 'm', estUsd: 0, ok: true }); // 零成本
  const s = summarize({ sinceMs: Date.now() - 86400e3 });
  assert.equal(s.calls, 1);
  assert.equal(s.totalUsd, 0);
  assert.ok(!('undefined' in s.byCapability));
  assert.throws(() => summarize({}), /有限数字/);
});
