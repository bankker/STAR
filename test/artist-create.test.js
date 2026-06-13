import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInterviewMessages, buildFinalizeMessages, extractProfileJson, buildPortraitPrompt,
} from '../src/studio/artist-create.js';

test('buildInterviewMessages 注入访谈系统提示词并透传历史', () => {
  const r = buildInterviewMessages([{ role: 'user', content: '我想要个冷艳的歌手' }]);
  assert.match(r.system, /虚拟艺人/);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].content, '我想要个冷艳的歌手');
  const empty = buildInterviewMessages(undefined);
  assert.deepEqual(empty.messages, []);
});

test('buildFinalizeMessages 把对话历史格式化进 user 消息', () => {
  const r = buildFinalizeMessages([
    { role: 'assistant', content: '你想要怎样的艺人？' },
    { role: 'user', content: '冷艳电子歌手' },
  ]);
  assert.match(r.system, /JSON/);
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].content, /冷艳电子歌手/);
  assert.match(r.messages[0].content, /企划|玩家/);
  const s = buildFinalizeMessages('我要个元气少女');
  assert.match(s.messages[0].content, /元气少女/);
});

test('extractProfileJson 容忍围栏与多余文字', () => {
  assert.deepEqual(extractProfileJson('{"name":"LUMI"}'), { name: 'LUMI' });
  assert.deepEqual(extractProfileJson('```json\n{"name":"NOVA"}\n```'), { name: 'NOVA' });
  assert.deepEqual(
    extractProfileJson('好的，这是档案：\n{"name":"IRIS","persona":"知性"}\n希望满意'),
    { name: 'IRIS', persona: '知性' },
  );
  assert.throws(() => extractProfileJson('完全没有 JSON'), /JSON/);
  assert.throws(() => extractProfileJson(null), /文本/);
});

test('buildPortraitPrompt 以视觉档案为主，追加风格与安全词', () => {
  const p = buildPortraitPrompt({ visualIdentity: '银发冷色调，未来感' }, '霓虹背景');
  assert.match(p, /银发冷色调/);
  assert.match(p, /霓虹背景/);
  assert.match(p, /SFW/);
  const p2 = buildPortraitPrompt({ persona: '元气', positioning: '综艺偶像' }, '');
  assert.match(p2, /元气|综艺偶像/);
});

test('extractProfileJson 尾部含 } 的 prose 抛友好错误', () => {
  assert.throws(() => extractProfileJson('{"name":"X"} 注：见 {schema} 说明'), /JSON 解析失败/);
});

test('buildFinalizeMessages 容忍缺 content 的轮次', () => {
  const r = buildFinalizeMessages([{ role: 'user' }, { role: 'assistant', content: '好的' }]);
  assert.ok(!/undefined/.test(r.messages[0].content));
});
