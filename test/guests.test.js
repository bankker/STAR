import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { initGuests, createGuest, getGuest, listGuests, updateGuest, addGuestPortrait, deleteGuest } from '../src/studio/guests.js';

before(() => initGuests(fs.mkdtempSync(path.join(os.tmpdir(), 'gst_'))));

test('createGuest + listGuests 过滤 artistId', () => {
  const g = createGuest('art_1', { name: '王总', title: 'CEO', company: 'X 公司', persona: '连续创业者', voice: 'Ethan' });
  assert.ok(g.id.startsWith('gst_'));
  assert.equal(g.portrait.current, -1);
  assert.ok(listGuests('art_1').some((x) => x.id === g.id));
  assert.ok(!listGuests('art_2').some((x) => x.id === g.id));
});

test('addGuestPortrait 追加版本并指向最新', () => {
  const g = createGuest('art_1', { name: 'x' });
  addGuestPortrait(g.id, { url: '/generated/p.png', prompt: 'p' });
  const g2 = getGuest(g.id);
  assert.equal(g2.portrait.versions[0].url, '/generated/p.png');
  assert.equal(g2.portrait.current, 0);
});

test('updateGuest / deleteGuest', () => {
  const g = createGuest('art_1', { name: '旧名' });
  assert.equal(updateGuest(g.id, { name: '新名' }).name, '新名');
  assert.equal(deleteGuest(g.id), true);
  assert.equal(getGuest(g.id), null);
});
