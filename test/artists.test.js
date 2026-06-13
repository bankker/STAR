import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initArtists, validateProfile, createArtist, listArtists,
  getArtist, updateArtist, deleteArtist, addPortrait,
} from '../src/studio/artists.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssart-')), 'artists.json');
}

beforeEach(() => initArtists(tmpFile()));

test('validateProfile 要求非空艺名，补全默认字段', () => {
  assert.throws(() => validateProfile({ name: '   ' }), /艺名/);
  assert.throws(() => validateProfile(null), /对象/);
  const v = validateProfile({ name: 'LUMI', personality: ['冷', 123], portraits: [{ url: '/x.png' }, { nope: 1 }] });
  assert.equal(v.name, 'LUMI');
  assert.equal(v.schemaVersion, 1);
  assert.deepEqual(v.personality, ['冷']);
  assert.equal(v.portraits.length, 1);
  assert.equal(v.voiceProfile.ttsVoice, null);
  assert.equal(v.visualIdentity, '');
});

test('CRUD 走通并持久化', () => {
  const a = createArtist({ name: 'NOVA', persona: '元气' });
  assert.match(a.id, /^art_/);
  assert.ok(a.createdAt && a.updatedAt);
  assert.equal(listArtists().length, 1);
  assert.equal(getArtist(a.id).persona, '元气');

  const u = updateArtist(a.id, { persona: '元气少女', visualIdentity: '银发' });
  assert.equal(u.persona, '元气少女');
  assert.equal(u.visualIdentity, '银发');
  assert.equal(u.id, a.id);
  assert.equal(u.createdAt, a.createdAt);

  assert.equal(updateArtist('nope', {}), null);
  assert.equal(deleteArtist(a.id), true);
  assert.equal(deleteArtist(a.id), false);
  assert.equal(listArtists().length, 0);
});

test('addPortrait 追加定妆照', () => {
  const a = createArtist({ name: 'IRIS' });
  const r = addPortrait(a.id, { url: '/generated/p1.png', prompt: '知性' });
  assert.equal(r.portraits.length, 1);
  assert.equal(r.portraits[0].url, '/generated/p1.png');
  assert.ok(r.portraits[0].createdAt);
  assert.equal(addPortrait('nope', { url: '/x' }), null);
});

test('坏存档文件不崩，按空数组处理', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ broken');
  initArtists(f);
  assert.deepEqual(listArtists(), []);
  const a = createArtist({ name: 'RAY' });
  assert.equal(listArtists().length, 1);
  assert.ok(getArtist(a.id));
});
