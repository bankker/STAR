import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOutline, assignGuestVoice, hostVoice, ttsClean, buildClosingMessages, buildOutlineMessages, buildNextQuestionMessages, clampSharpness, sharpnessDirective, MAX_QUESTIONS, MAX_TURNS } from '../src/studio/interview2.js';

test('ttsClean 剥离括号舞台提示，保留正文', () => {
  assert.equal(ttsClean('（若有所思地说）我开始创业。【停顿】不容易。'), '我开始创业。不容易。');
  assert.equal(ttsClean('大家好(微笑)，欢迎。'), '大家好，欢迎。');
  assert.equal(ttsClean('没有括号的正常句子'), '没有括号的正常句子');
});

test('extractOutline 解析并裁剪问题上限', () => {
  const raw = '```json\n' + JSON.stringify({ opening: '欢迎来到节目', questions: Array.from({ length: 15 }, (_, i) => `问题${i}`) }) + '\n```';
  const o = extractOutline(raw);
  assert.equal(o.opening, '欢迎来到节目');
  assert.equal(o.questions.length, MAX_QUESTIONS);
});

test('extractOutline 无 JSON 抛错', () => {
  assert.throws(() => extractOutline('没有'), /未在响应中找到/);
});

test('clampSharpness 限定 1-5，非法回退 3', () => {
  assert.equal(clampSharpness(5), 5);
  assert.equal(clampSharpness(1), 1);
  assert.equal(clampSharpness(0), 3);
  assert.equal(clampSharpness(9), 3);
  assert.equal(clampSharpness('x'), 3);
  assert.equal(clampSharpness(undefined), 3);
});

test('sharpnessDirective 随档位变化并注入提纲/追问提示', () => {
  assert.match(sharpnessDirective(1), /温和/);
  assert.match(sharpnessDirective(5), /尖锐/);
  const a = { name: '晓彤' }, g = { name: '王启明' };
  assert.match(buildOutlineMessages(a, g, 5).system, /尖锐/);
  assert.match(buildNextQuestionMessages(a, g, { questions: [] }, [], 0, 4).system, /犀利/);
});

test('buildClosingMessages 含主持人/嘉宾且要求不再提问', () => {
  const { system, messages } = buildClosingMessages({ name: '晓彤' }, { name: '王启明' }, [{ speaker: 'guest', text: '谢谢' }]);
  assert.match(system, /晓彤/);
  assert.match(system, /王启明/);
  assert.match(system, /不要再提问/);
  assert.equal(messages[0].role, 'user');
});

test('assignGuestVoice 按性别且避开主持音色；hostVoice 按艺人', () => {
  assert.equal(hostVoice({ gender: '男' }), 'Ethan');
  assert.equal(hostVoice({ gender: '女' }), 'Cherry');
  const v = assignGuestVoice({ persona: '男企业家' }, { gender: '男' });   // 主持男=Ethan → 嘉宾男避开 Ethan
  assert.notEqual(v, 'Ethan');
});

assert.ok(MAX_TURNS > 0);
