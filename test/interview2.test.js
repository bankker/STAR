import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOutline, assignGuestVoice, hostVoice, MAX_QUESTIONS, MAX_TURNS } from '../src/studio/interview2.js';

test('extractOutline 解析并裁剪问题上限', () => {
  const raw = '```json\n' + JSON.stringify({ opening: '欢迎来到节目', questions: Array.from({ length: 15 }, (_, i) => `问题${i}`) }) + '\n```';
  const o = extractOutline(raw);
  assert.equal(o.opening, '欢迎来到节目');
  assert.equal(o.questions.length, MAX_QUESTIONS);
});

test('extractOutline 无 JSON 抛错', () => {
  assert.throws(() => extractOutline('没有'), /未在响应中找到/);
});

test('assignGuestVoice 按性别且避开主持音色；hostVoice 按艺人', () => {
  assert.equal(hostVoice({ gender: '男' }), 'Ethan');
  assert.equal(hostVoice({ gender: '女' }), 'Cherry');
  const v = assignGuestVoice({ persona: '男企业家' }, { gender: '男' });   // 主持男=Ethan → 嘉宾男避开 Ethan
  assert.notEqual(v, 'Ethan');
});

assert.ok(MAX_TURNS > 0);
