import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeJoin, dataUrlToBuffer } from '../src/lib/files.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prototype');

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

test('dataUrlToBuffer 接受带 codecs 参数的 mime（浏览器 MediaRecorder 录音）', () => {
  const { mime, buf } = dataUrlToBuffer('data:audio/webm;codecs=opus;base64,' + Buffer.from('snd').toString('base64'));
  assert.equal(mime, 'audio/webm;codecs=opus');   // 参数保留，saveDataUrl 据此识别 webm 扩展名
  assert.equal(buf.toString(), 'snd');
});
