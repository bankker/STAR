import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {
  initDrama, createDrama, getDrama, listDramas, updateScene, addFrameVersion, setFrameCurrent,
} from '../src/studio/drama-store.js';

before(() => initDrama(fs.mkdtempSync(path.join(os.tmpdir(), 'drtest_'))));

const parsed = {
  cast: [{ name: '反派', role: '反派', appearance: '黑衣', gender: '男' }],
  episodes: [{ title: '第一集', scenes: [{ setting: 's', action: 'a', characters: ['凛'], lines: [{ character: '凛', text: 't', emotion: 'e' }] }] }],
};

test('createDrama 生成主演+配角 cast 与分集结构', () => {
  const d = createDrama('art_1', { name: '凛', gender: '女', visualIdentity: '银发', portraits: [{ url: '/generated/p.png' }] },
    { theme: 't', durationSec: 90 }, parsed, { voiceMap: { c_lead: 'Cherry', c_1: 'Ethan', __narrator: 'Chelsie' }, consistencyMode: 'description' });
  assert.ok(d.id.startsWith('dr_'));
  assert.equal(d.cast[0].isLead, true);
  assert.equal(d.cast[0].portrait.versions[0].url, '/generated/p.png');
  assert.equal(d.episodes[0].scenes[0].clip.status, 'none');
});

test('listDramas 按 artistId 过滤', () => {
  const d = createDrama('art_2', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  assert.ok(listDramas('art_2').some((x) => x.id === d.id));
  assert.ok(!listDramas('art_1').some((x) => x.id === d.id));
});

test('版本：addFrameVersion 追加并可切换 current', () => {
  const d = createDrama('art_3', { name: 'x' }, {}, parsed, { voiceMap: {}, consistencyMode: 'description' });
  const eid = d.episodes[0].id; const sid = d.episodes[0].scenes[0].id;
  addFrameVersion(d.id, eid, sid, { url: '/generated/f1.png', prompt: 'p1' });
  addFrameVersion(d.id, eid, sid, { url: '/generated/f2.png', prompt: 'p2' });
  let g = getDrama(d.id); const sc = g.episodes[0].scenes[0];
  assert.equal(sc.frame.versions.length, 2);
  assert.equal(sc.frame.current, 1);
  setFrameCurrent(d.id, eid, sid, 0);
  assert.equal(getDrama(d.id).episodes[0].scenes[0].frame.current, 0);
});
