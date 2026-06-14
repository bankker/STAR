import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let dramaDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const newId = (p) => `${p}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

export function initDrama(dir) {
  dramaDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f)); } catch {}
}

const fileFor = (id) => path.join(dramaDir, `${id}.json`);

export function getDrama(id) {
  if (!dramaDir || !SAFE_ID.test(id)) return null;
  const f = fileFor(id);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function write(d) {
  d.updatedAt = new Date().toISOString();
  const f = fileFor(d.id);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, f);
  return d;
}

export function listDramas(artistId) {
  if (!dramaDir || !SAFE_ID.test(artistId)) return [];
  const out = [];
  for (const f of fs.readdirSync(dramaDir)) {
    if (!f.endsWith('.json')) continue;
    try { const d = JSON.parse(fs.readFileSync(path.join(dramaDir, f), 'utf8')); if (d.artistId === artistId) out.push(d); } catch {}
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function createDrama(artistId, artist, brief, parsed, { voiceMap, consistencyMode }) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const now = new Date().toISOString();
  const lead = {
    id: 'c_lead', name: artist?.name || '主演', role: '主演', isLead: true,
    appearance: artist?.visualIdentity || '', gender: artist?.gender || '',
    voice: voiceMap?.c_lead || 'Cherry',
    // 主演定妆照取一致性参考包首图；无图时 current=-1 与空 versions 保持一致（避免悬空指针）。
    portrait: { current: artist?.portraits?.[0]?.url ? 0 : -1, versions: artist?.portraits?.[0]?.url
      ? [{ url: artist.portraits[0].url, prompt: '一致性参考包', createdAt: now }] : [] },
  };
  const cast = [lead, ...(parsed.cast || []).map((c, i) => ({
    id: `c_${i + 1}`, name: c.name, role: c.role, isLead: false, appearance: c.appearance, gender: c.gender,
    voice: voiceMap?.[`c_${i + 1}`] || 'Ethan', portrait: { current: -1, versions: [] },
  }))];
  const episodes = (parsed.episodes || []).map((e, ei) => ({
    id: `ep_${ei + 1}`, index: ei + 1, title: e.title, tier: 'high', durationSec: null, episodeUrl: null, themeSongUrl: null,
    scenes: (e.scenes || []).map((sc, si) => ({
      id: `s_${si + 1}`, index: si + 1, setting: sc.setting, action: sc.action,
      characters: sc.characters || [], lines: sc.lines || [],
      frame: { current: -1, versions: [] },
      clip: { url: null, jobId: null, status: 'none' },
    })),
  }));
  const d = {
    id: newId('dr'), artistId, schemaVersion: 1, createdAt: now, updatedAt: now,
    title: brief?.title || `${artist?.name || ''}的短剧`, theme: brief?.theme || '', logline: brief?.logline || '',
    status: 'drafting', consistencyMode: consistencyMode || 'description',
    cast, episodes, collectionUrl: null,
  };
  return write(d);
}

export function updateDrama(id, patch) {
  const d = getDrama(id); if (!d) return null;
  Object.assign(d, patch); return write(d);
}

function findScene(d, eid, sid) {
  const ep = d.episodes.find((e) => e.id === eid); if (!ep) return null;
  const sc = ep.scenes.find((s) => s.id === sid); return sc ? { ep, sc } : null;
}

export function updateScene(id, eid, sid, patch) {
  const d = getDrama(id); if (!d) return null;
  const f = findScene(d, eid, sid); if (!f) return null;
  Object.assign(f.sc, patch); return write(d);
}

export function addFrameVersion(id, eid, sid, version) {
  const d = getDrama(id); if (!d) return null;
  const f = findScene(d, eid, sid); if (!f) return null;
  f.sc.frame.versions.push({ url: version.url, prompt: version.prompt || '', createdAt: new Date().toISOString() });
  f.sc.frame.current = f.sc.frame.versions.length - 1;
  return write(d);
}

export function setFrameCurrent(id, eid, sid, idx) {
  const d = getDrama(id); if (!d) return null;
  const f = findScene(d, eid, sid); if (!f) return null;
  if (idx < 0 || idx >= f.sc.frame.versions.length) return d;
  f.sc.frame.current = idx; return write(d);
}

export function setEpisodeTheme(id, eid, songUrl) {
  const d = getDrama(id); if (!d) return null;
  const ep = d.episodes.find((e) => e.id === eid); if (!ep) return null;
  ep.themeSongUrl = songUrl || null;
  return write(d);
}

export function addPortraitVersion(id, castId, version) {
  const d = getDrama(id); if (!d) return null;
  const c = d.cast.find((x) => x.id === castId); if (!c) return null;
  c.portrait.versions.push({ url: version.url, prompt: version.prompt || '', createdAt: new Date().toISOString() });
  c.portrait.current = c.portrait.versions.length - 1;
  return write(d);
}

export function curFrameUrl(scene) {
  const v = scene?.frame?.versions; const i = scene?.frame?.current;
  return (v && i >= 0 && v[i]) ? v[i].url : null;
}
