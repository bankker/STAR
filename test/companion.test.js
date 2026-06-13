import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatSystemPrompt, buildChatMessages, shouldSummarize, buildSummarizeMessages,
  updateEmotion, RECENT_KEEP, SUMMARIZE_AT,
} from '../src/studio/companion.js';

const artist = { name: '星野眠', persona: '慵懒治愈', positioning: 'City Pop歌手',
  personality: ['慢热', '细腻'], speakingStyle: '轻声细语', backstory: '音乐世家出身' };

test('系统提示词注入档案且要求不出戏', () => {
  const s = buildChatSystemPrompt(artist, '聊过爵士乐', { mood: '愉悦', affinity: 60 });
  assert.match(s, /星野眠/);
  assert.match(s, /不能承认自己是 AI|不出戏|身份/);
  assert.match(s, /慵懒治愈/);
  assert.match(s, /聊过爵士乐/);
  assert.match(s, /60/);
});

test('buildChatMessages 带近期原文 + 本轮', () => {
  const conv = { memory: 'm', state: { mood: '平静', affinity: 50 },
    messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' + i })) };
  const { system, messages } = buildChatMessages(artist, conv, '在吗');
  assert.match(system, /星野眠/);
  assert.equal(messages.length, RECENT_KEEP + 1);
  assert.equal(messages[messages.length - 1].content, '在吗');
});

test('shouldSummarize 阈值', () => {
  assert.equal(shouldSummarize({ messages: new Array(SUMMARIZE_AT - 1) }), false);
  assert.equal(shouldSummarize({ messages: new Array(SUMMARIZE_AT) }), true);
});

test('buildSummarizeMessages 含旧对话与旧记忆', () => {
  const { system, messages } = buildSummarizeMessages(
    [{ role: 'user', content: '我叫小明' }, { role: 'assistant', content: '记住啦' }], '旧记忆');
  assert.match(system, /记忆/);
  assert.match(messages[0].content, /小明/);
  assert.match(messages[0].content, /旧记忆/);
});

test('updateEmotion 确定式演化', () => {
  assert.equal(updateEmotion({ mood: '平静', affinity: 50 }, '好喜欢你的歌').mood, '愉悦');
  assert.equal(updateEmotion({ mood: '平静', affinity: 50 }, '你好烦').mood, '低落');
  assert.equal(updateEmotion({ mood: '平静', affinity: 99 }, '在吗').affinity, 100);
  assert.equal(updateEmotion({ mood: '平静', affinity: 50 }, '在吗').mood, '平静');
});
