import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initAssets, getGallery, addAssets, toggleFavorite, removeAsset } from '../src/studio/assets.js';
import { buildPhotoPrompt } from '../src/studio/artist-create.js';

beforeEach(() => initAssets(fs.mkdtempSync(path.join(os.tmpdir(), 'ssas-'))));

test('空画廊返回骨架', () => {
  assert.deepEqual(getGallery('art_1').assets, []);
});

test('addAssets 追加并带 id', () => {
  const g = addAssets('art_1', [{ type: 'photo', url: '/generated/a.png', prompt: 'p', shot: '近景', aspect: '3:4' }]);
  assert.equal(g.assets.length, 1);
  assert.match(g.assets[0].id, /^as_/);
  assert.equal(g.assets[0].favorite, false);
  assert.ok(g.assets[0].createdAt);
});

test('toggleFavorite 与 removeAsset', () => {
  const g = addAssets('art_1', [{ type: 'photo', url: '/x.png' }]);
  const id = g.assets[0].id;
  assert.equal(toggleFavorite('art_1', id).assets[0].favorite, true);
  assert.equal(toggleFavorite('art_1', id).assets[0].favorite, false);
  assert.equal(removeAsset('art_1', id).assets.length, 0);
  assert.equal(toggleFavorite('art_1', 'nope'), null);
});

test('非法 artistId 抛错', () => {
  assert.throws(() => addAssets('../evil', [{ url: '/x' }]), /非法/);
});

test('buildPhotoPrompt 注入视觉档案与景别', () => {
  const { prompt: p } = buildPhotoPrompt({ visualIdentity: '银发冷色调' }, { shot: '近景', stylePrompt: '霓虹' });
  assert.match(p, /银发冷色调/);
  assert.match(p, /近景|特写/);
  assert.match(p, /霓虹/);
  assert.match(p, /SFW/);
});

test('buildPhotoPrompt 外形里的「不要X」进负向、不进正向（修复总出扇子）', () => {
  const { prompt, negative } = buildPhotoPrompt({ visualIdentity: '邻家女孩，不要带扇子', persona: '清新', positioning: '歌手' });
  assert.doesNotMatch(prompt, /扇子/);   // 正向不再出现被否定物
  assert.match(prompt, /邻家女孩/);       // 非否定部分保留
  assert.match(negative, /扇子/);         // 否定物进负向
});
