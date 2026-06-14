import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlueprintMessages, extractBlueprint, blueprintToRenderReq } from '../src/studio/music.js';

const artist = { name: '霓夜', persona: '赛博国风', musicStyle: '暗黑电子', gender: '女', voiceProfile: { description: '清冷气声' } };

test('buildBlueprintMessages 注入艺人音乐风格与诉求', () => {
  const r = buildBlueprintMessages(artist, '想要一首关于深夜城市的歌');
  assert.match(r.system, /作曲|蓝图|JSON/);
  assert.match(r.messages[0].content, /深夜城市/);
  assert.match(r.messages[0].content, /暗黑电子|霓夜/);
});

test('extractBlueprint 容忍围栏与多余文字', () => {
  assert.deepEqual(extractBlueprint('```json\n{"title":"霓虹","lyrics":"歌词"}\n```'), { title: '霓虹', lyrics: '歌词' });
  assert.deepEqual(extractBlueprint('好的：\n{"title":"夜"}\n完成'), { title: '夜' });
  assert.throws(() => extractBlueprint('没有 JSON'), /JSON/);
});

test('blueprintToRenderReq 映射歌词+性别', () => {
  const req = blueprintToRenderReq({ title: '霓虹', lyrics: '霓虹灯下', style: '电子' }, artist);
  assert.equal(req.lyrics, '霓虹灯下');
  assert.equal(req.gender, 'female');
  assert.equal(req.style, '电子');
  const male = blueprintToRenderReq({ lyrics: 'x' }, { gender: '男' });
  assert.equal(male.gender, 'male');
});
