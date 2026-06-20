import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initStory, createStory, getStory, listStories, addCast, updateStory } from '../src/studio/story-store.js';
import { newStory } from '../src/studio/story.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storystore-'));
initStory(tmp);

test('建局 → 读 → 列', () => {
  const s = createStory(newStory({ name: '杨威利', faction: '自由同盟' }));
  assert.match(s.id, /^st_/);
  assert.equal(getStory(s.id).player.name, '杨威利');
  assert.ok(listStories().find((x) => x.id === s.id));
});

test('加艺人入局（带评定数值）+ 去重', () => {
  const s = createStory(newStory({ name: 'X' }));
  addCast(s.id, { artistId: 'art1', name: '林深', role: '副官', stats: { 统率: 72, 谋略: 60, 政务: 40, 魅力: 80, 忠诚: 65 } });
  addCast(s.id, { artistId: 'art1', name: '林深' }); // 重复应被忽略
  const s2 = getStory(s.id);
  assert.equal(s2.cast.length, 1);
  assert.equal(s2.cast[0].stats.魅力, 80);
  assert.equal(s2.cast[0].affinity, 0);
});

test('更新 + 持久化（重新 init 模拟重启后读回）', () => {
  const s = createStory(newStory({ name: 'Y' }));
  updateStory(s.id, { turn: 5 });
  initStory(tmp); // 模拟重启：重新加载目录
  assert.equal(getStory(s.id).turn, 5);
});

test('非法 id 安全返回 null', () => {
  assert.equal(getStory('../etc/passwd'), null);
  fs.rmSync(tmp, { recursive: true, force: true }); // 清理临时目录
});
