import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let dir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STR = (v) => (typeof v === 'string' ? v : '');

export function initGuests(d) { dir = d; fs.mkdirSync(d, { recursive: true }); try { for (const f of fs.readdirSync(d)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(d, f)); } catch {} }

const fileFor = (id) => path.join(dir, `${id}.json`);

function write(g) {
  g.updatedAt = new Date().toISOString();
  const f = fileFor(g.id);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(g, null, 2));
  fs.renameSync(tmp, f);
  return g;
}

export function getGuest(id) {
  if (!dir || !SAFE_ID.test(id)) return null;
  const f = fileFor(id);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

export function listGuests(artistId) {
  if (!dir || !SAFE_ID.test(artistId)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (g.artistId === artistId) out.push(g); } catch {}
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function createGuest(artistId, profile) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const now = new Date().toISOString();
  const g = {
    id: `gst_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    artistId,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    name: STR(profile?.name) || '嘉宾',
    title: STR(profile?.title),
    company: STR(profile?.company),
    persona: STR(profile?.persona),
    voice: STR(profile?.voice) || 'Ethan',
    portrait: { current: -1, versions: [] },
  };
  return write(g);
}

export function updateGuest(id, patch) {
  const g = getGuest(id); if (!g) return null;
  for (const k of ['name', 'title', 'company', 'persona', 'voice']) if (k in (patch || {})) g[k] = STR(patch[k]);
  return write(g);
}

export function addGuestPortrait(id, version) {
  const g = getGuest(id); if (!g) return null;
  g.portrait.versions.push({ url: version.url, prompt: version.prompt || '', createdAt: new Date().toISOString() });
  g.portrait.current = g.portrait.versions.length - 1;
  return write(g);
}

export function deleteGuest(id) {
  if (!dir || !SAFE_ID.test(id)) return false;
  const f = fileFor(id);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}

export function curGuestPortrait(guest) {
  const v = guest?.portrait?.versions;
  const i = guest?.portrait?.current;
  return (v && i >= 0 && v[i]) ? v[i].url : null;
}
