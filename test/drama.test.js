import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractScript, assignVoices, estimateEpisodeCost,
  MAX_CAST, MAX_SCENES, MAX_LINES_PER_SCENE,
} from '../src/studio/drama.js';

const artist = { name: '凛', gender: '女', persona: '冷艳电子歌手', visualIdentity: '银发红瞳' };

test('extractScript 解析围栏 JSON 并裁剪上限', () => {
  const raw = '```json\n' + JSON.stringify({
    cast: Array.from({ length: 5 }, (_, i) => ({ name: `配${i}`, role: '配角', appearance: 'x', gender: '男' })),
    episodes: [{ title: '第一集', scenes: Array.from({ length: 12 }, (_, i) => ({
      setting: `场景${i}`, action: 'a',
      lines: Array.from({ length: 9 }, () => ({ character: '凛', text: 't', emotion: 'e' })),
    })) }],
  }) + '\n```';
  const s = extractScript(raw, artist);
  assert.ok(s.cast.length <= MAX_CAST);
  assert.equal(s.episodes[0].scenes.length, MAX_SCENES);
  assert.ok(s.episodes[0].scenes[0].lines.length <= MAX_LINES_PER_SCENE);
});

test('extractScript 无 JSON 抛错', () => {
  assert.throws(() => extractScript('没有对象', artist), /未在响应中找到/);
});

test('assignVoices 主演按性别、配角去重', () => {
  const cast = [
    { id: 'c_lead', isLead: true, gender: '女' },
    { id: 'c_1', isLead: false, gender: '男' },
    { id: 'c_2', isLead: false, gender: '男' },
  ];
  const m = assignVoices(cast, artist);
  assert.equal(m.c_lead, 'Cherry');
  assert.notEqual(m.c_1, m.c_2);
  assert.ok(m.__narrator);
});

test('estimateEpisodeCost 两档', () => {
  const ep = { scenes: [{}, {}, {}] };
  assert.ok(estimateEpisodeCost(ep, 'high') > 0);
  assert.equal(estimateEpisodeCost(ep, 'low'), 0);
});
