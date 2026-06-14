import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { initSessions, createSession, getSession, listSessions, appendTurn, updateSession, setTurnMedia } from '../src/studio/session-store.js';

before(() => initSessions(fs.mkdtempSync(path.join(os.tmpdir(), 'itv_'))));

const outline = { opening: '欢迎', questions: ['Q1', 'Q2'] };

test('createSession + appendTurn + cursor', () => {
  const s = createSession('art_1', 'gst_1', outline);
  assert.ok(s.id.startsWith('itv_'));
  assert.equal(s.status, 'interviewing');
  assert.equal(s.cursor, 0);
  appendTurn(s.id, { speaker: 'host', text: '欢迎', audioUrl: '/generated/h.wav' });
  appendTurn(s.id, { speaker: 'guest', text: '谢谢', audioUrl: '/generated/g.wav' });
  const s2 = getSession(s.id);
  assert.equal(s2.turns.length, 2);
  assert.ok(s2.turns[0].id);
  assert.equal(s2.turns[1].speaker, 'guest');
});

test('setTurnMedia 写回某轮媒体', () => {
  const s = createSession('art_1', 'gst_1', outline);
  appendTurn(s.id, { speaker: 'host', text: 'Q' });
  const tid = getSession(s.id).turns[0].id;
  setTurnMedia(s.id, tid, { lipsyncUrl: '/generated/lp.mp4' });
  assert.equal(getSession(s.id).turns[0].lipsyncUrl, '/generated/lp.mp4');
});

test('listSessions 过滤 + updateSession', () => {
  const s = createSession('art_9', 'gst_1', outline);
  assert.ok(listSessions('art_9').some((x) => x.id === s.id));
  assert.equal(updateSession(s.id, { status: 'done' }).status, 'done');
});
