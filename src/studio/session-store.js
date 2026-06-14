import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let dir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function initSessions(d) { dir = d; fs.mkdirSync(d, { recursive: true }); try { for (const f of fs.readdirSync(d)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(d, f)); } catch {} }

const fileFor = (id) => path.join(dir, `${id}.json`);

function write(s) {
  s.updatedAt = new Date().toISOString();
  const f = fileFor(s.id);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, f);
  return s;
}

export function getSession(id) {
  if (!dir || !SAFE_ID.test(id)) return null;
  const f = fileFor(id);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

export function listSessions(artistId) {
  if (!dir || !SAFE_ID.test(artistId)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (s.artistId === artistId) out.push(s); } catch {}
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function createSession(artistId, guestId, outline) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const now = new Date().toISOString();
  const s = {
    id: `itv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    artistId,
    guestId,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    status: 'interviewing',
    outline: outline || { opening: '', questions: [] },
    cursor: 0,
    turns: [],
    recordUrl: null,
    videoUrl: null,
  };
  return write(s);
}

export function appendTurn(id, turn) {
  const s = getSession(id); if (!s) return null;
  s.turns.push({
    id: `t_${s.turns.length + 1}_${crypto.randomBytes(2).toString('hex')}`,
    speaker: turn.speaker === 'guest' ? 'guest' : 'host',
    text: String(turn.text || ''),
    audioUrl: turn.audioUrl || null,
    lipsyncUrl: turn.lipsyncUrl || null,
  });
  return write(s);
}

export function updateSession(id, patch) {
  const s = getSession(id); if (!s) return null;
  Object.assign(s, patch);
  return write(s);
}

export function setTurnMedia(id, turnId, patch) {
  const s = getSession(id); if (!s) return null;
  const t = s.turns.find((x) => x.id === turnId); if (!t) return null;
  Object.assign(t, patch);
  return write(s);
}
