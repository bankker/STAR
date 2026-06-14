import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let assetsDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function initAssets(dir) {
  assetsDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f)); } catch {}
}

function empty(artistId) { return { artistId, schemaVersion: 1, assets: [], updatedAt: null }; }
const fileFor = (artistId) => path.join(assetsDir, `${artistId}.json`);

export function getGallery(artistId) {
  const base = empty(artistId);
  if (!assetsDir || !SAFE_ID.test(artistId)) return base;
  const f = fileFor(artistId);
  if (!fs.existsSync(f)) return base;
  try {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...base, ...c, assets: Array.isArray(c.assets) ? c.assets : [] };
  } catch { return base; }
}

function write(g) {
  g.updatedAt = new Date().toISOString();
  const f = fileFor(g.artistId);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(g, null, 2));
  fs.renameSync(tmp, f);
}

export function addAssets(artistId, items) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const g = getGallery(artistId);
  const now = new Date().toISOString();
  for (const it of items || []) {
    g.assets.unshift({
      id: `as_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      type: it.type || 'photo', url: it.url,
      prompt: String(it.prompt || ''), shot: it.shot || '', aspect: it.aspect || '',
      durationSec: it.durationSec || null,
      title: it.title || '',
      style: it.style || '',
      favorite: false, createdAt: now,
    });
  }
  write(g);
  return g;
}

export function toggleFavorite(artistId, assetId) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const g = getGallery(artistId);
  const a = g.assets.find((x) => x.id === assetId);
  if (!a) return null;
  a.favorite = !a.favorite;
  write(g);
  return g;
}

export function removeAsset(artistId, assetId) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const g = getGallery(artistId);
  const before = g.assets.length;
  g.assets = g.assets.filter((x) => x.id !== assetId);
  if (g.assets.length === before) return g;
  write(g);
  return g;
}
