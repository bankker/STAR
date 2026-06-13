import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initConversations, getConversation, appendTurn, setMemory, trimToRecent, resetConversation,
} from '../src/studio/conversations.js';

beforeEach(() => initConversations(fs.mkdtempSync(path.join(os.tmpdir(), 'sscv-'))));

test('空会话返回骨架', () => {
  const c = getConversation('art_1');
  assert.deepEqual(c.messages, []);
  assert.equal(c.memory, '');
  assert.equal(c.state.affinity, 50);
  assert.equal(c.state.mood, '平静');
});

test('appendTurn 持久化两条消息与 state', () => {
  appendTurn('art_1', '你好', '嗨~', { mood: '愉悦', affinity: 52 });
  const c = getConversation('art_1');
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[0].role, 'user');
  assert.equal(c.messages[1].content, '嗨~');
  assert.equal(c.state.affinity, 52);
  assert.ok(c.messages[0].ts);
});

test('setMemory 与 trimToRecent', () => {
  for (let i = 0; i < 6; i++) appendTurn('art_1', `u${i}`, `a${i}`);
  setMemory('art_1', '我们聊过音乐');
  trimToRecent('art_1', 4);
  const c = getConversation('art_1');
  assert.equal(c.memory, '我们聊过音乐');
  assert.equal(c.messages.length, 4);
  assert.equal(c.messages[0].content, 'u4');
});

test('非法 artistId 不写盘、reset 安全', () => {
  assert.throws(() => appendTurn('../evil', 'x', 'y'), /非法/);
  assert.deepEqual(getConversation('../evil').messages, []);
  resetConversation('art_1');
});

test('坏存档不崩，按空骨架', () => {
  appendTurn('art_1', 'a', 'b');
  getConversation('art_1');
  resetConversation('art_1');
  assert.deepEqual(getConversation('art_1').messages, []);
});
