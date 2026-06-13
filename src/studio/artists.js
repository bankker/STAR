import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let artistsFile = null;

export function initArtists(file) {
  artistsFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} }
}

const STR = (v) => (typeof v === 'string' ? v : '');

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('档案必须是对象');
  const name = STR(profile.name).trim();
  if (!name) throw new Error('艺名（name）必填');
  return {
    schemaVersion: 1,
    name,
    gender: STR(profile.gender),
    persona: STR(profile.persona),
    positioning: STR(profile.positioning),
    backstory: STR(profile.backstory),
    personality: Array.isArray(profile.personality) ? profile.personality.filter((x) => typeof x === 'string') : [],
    coreAppeal: STR(profile.coreAppeal),
    speakingStyle: STR(profile.speakingStyle),
    voiceProfile: {
      description: STR(profile.voiceProfile?.description),
      ttsVoice: profile.voiceProfile?.ttsVoice ?? null,
    },
    visualIdentity: STR(profile.visualIdentity),
    musicStyle: STR(profile.musicStyle),
    portraits: Array.isArray(profile.portraits)
      ? profile.portraits.filter((p) => p && typeof p.url === 'string')
          .map((p) => ({ url: p.url, prompt: STR(p.prompt), createdAt: p.createdAt || new Date().toISOString() }))
      : [],
  };
}

export function readArtists() {
  if (!artistsFile || !fs.existsSync(artistsFile)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(artistsFile, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeArtists(arr) {
  const tmp = `${artistsFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, artistsFile);
}

export function listArtists() { return readArtists(); }
export function getArtist(id) { return readArtists().find((a) => a.id === id) || null; }

export function createArtist(profile) {
  const v = validateProfile(profile);
  const now = new Date().toISOString();
  const artist = { id: `art_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, ...v, createdAt: now, updatedAt: now };
  const arr = readArtists();
  arr.push(artist);
  writeArtists(arr);
  return artist;
}

export function updateArtist(id, profile) {
  const arr = readArtists();
  const i = arr.findIndex((a) => a.id === id);
  if (i === -1) return null;
  const merged = {
    ...arr[i],
    ...profile,
    voiceProfile: { ...arr[i].voiceProfile, ...profile.voiceProfile },
  };
  const v = validateProfile(merged);
  arr[i] = { ...v, id, createdAt: arr[i].createdAt, updatedAt: new Date().toISOString() };
  writeArtists(arr);
  return arr[i];
}

export function deleteArtist(id) {
  const arr = readArtists();
  const next = arr.filter((a) => a.id !== id);
  if (next.length === arr.length) return false;
  writeArtists(next);
  return true;
}

export function addPortrait(id, portrait) {
  const arr = readArtists();
  const i = arr.findIndex((a) => a.id === id);
  if (i === -1) return null;
  arr[i].portraits = arr[i].portraits || [];
  arr[i].portraits.push({ url: portrait.url, prompt: STR(portrait.prompt), createdAt: new Date().toISOString() });
  arr[i].updatedAt = new Date().toISOString();
  writeArtists(arr);
  return arr[i];
}
