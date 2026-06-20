// 故事模式一局存档持久化（仿 drama-store）：原子写、init/get/list/create/save/update/addCast。
// 存 DATA_DIR/stories（已挂 GCS 卷）。一局存档结构见 src/studio/story.js newStory()。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let storyDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const newId = (p) => `${p}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

export function initStory(dir) {
  storyDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f)); } catch {}
}
const fileFor = (id) => path.join(storyDir, `${id}.json`);

export function getStory(id) {
  if (!storyDir || !SAFE_ID.test(id)) return null;
  const f = fileFor(id);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function write(s) {
  s.updatedAt = new Date().toISOString();
  const f = fileFor(s.id);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, f);
  return s;
}

export function listStories() {
  if (!storyDir) return [];
  const out = [];
  for (const f of fs.readdirSync(storyDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(storyDir, f), 'utf8'));
      out.push({ id: s.id, name: s.name, turn: s.turn, era: s.era, faction: s.player?.faction, castCount: (s.cast || []).length, createdAt: s.createdAt, updatedAt: s.updatedAt });
    } catch {}
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function createStory(story) {
  const now = new Date().toISOString();
  return write({ ...story, id: newId('st'), schemaVersion: 1, createdAt: now, updatedAt: now });
}

export function saveStory(story) {
  if (!story?.id || !SAFE_ID.test(story.id)) throw new Error('非法 story id');
  return write(story);
}

export function updateStory(id, patch) {
  const s = getStory(id); if (!s) return null;
  Object.assign(s, patch); return write(s);
}

export function addCast(id, member) {
  const s = getStory(id); if (!s) return null;
  if (!SAFE_ID.test(member?.artistId || '')) return null;
  s.cast = s.cast || [];
  if (s.cast.find((c) => c.artistId === member.artistId)) return s; // 去重
  s.cast.push({
    artistId: member.artistId, name: member.name || '', role: member.role || '参谋',
    faction: member.faction || s.player?.faction || '自由同盟',
    portraitUrl: member.portraitUrl || '',
    stats: member.stats || { 统率: 50, 谋略: 50, 政务: 50, 魅力: 50, 忠诚: 50 },
    affinity: member.affinity ?? 0, mood: '平静', routeProgress: 0,
  });
  return write(s);
}
