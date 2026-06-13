import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSSE } from '../src/lib/http-fetch.js';

test('splitSSE 解析完整 data 行，保留半行', () => {
  const r1 = splitSSE('data: a\ndata: b\ndata: ');
  assert.deepEqual(r1.datas, ['a', 'b']);
  assert.equal(r1.rest, 'data: ');
  const r2 = splitSSE(r1.rest + 'c\n');
  assert.deepEqual(r2.datas, ['c']);
  assert.equal(r2.rest, '');
});

test('splitSSE 忽略非 data 行与空 data', () => {
  const r = splitSSE(': comment\nevent: x\ndata:\ndata: ok\n');
  assert.deepEqual(r.datas, ['ok']);
});
