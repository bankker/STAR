import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanMessages, buildScriptMessages, extractDialogue } from '../src/studio/interview.js';

const artist = { name: '霓夜', persona: '赛博国风', positioning: '合成歌姬', backstory: '旧唱片行长大' };

test('buildPlanMessages 注入艺人与主题', () => {
  const r = buildPlanMessages(artist, '新专辑幕后');
  assert.match(r.system, /访谈|企划|JSON/);
  assert.match(r.messages[0].content, /新专辑幕后/);
  assert.match(r.messages[0].content, /霓夜/);
});

test('buildScriptMessages 要求记者×艺人对话 JSON', () => {
  const r = buildScriptMessages(artist, { questions: ['你怎么开始音乐的？'] });
  assert.match(r.system, /记者|对话|speaker|JSON/);
  assert.match(r.messages[0].content, /你怎么开始音乐的/);
});

test('extractDialogue 解析对话数组', () => {
  const d = extractDialogue('```json\n{"dialogue":[{"speaker":"记者","text":"你好"},{"speaker":"霓夜","text":"嗨"}]}\n```');
  assert.equal(d.length, 2);
  assert.equal(d[0].speaker, '记者');
  assert.equal(d[1].text, '嗨');
  assert.throws(() => extractDialogue('无'), /对话|JSON/);
});
