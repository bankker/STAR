import fs from 'node:fs';
import path from 'node:path';

let convDir = null;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function initConversations(dir) {
  convDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f));
    }
  } catch {}
}

function emptyConv(artistId) {
  return { artistId, schemaVersion: 1, messages: [], memory: '', state: { mood: '平静', affinity: 50 }, updatedAt: null };
}

const fileFor = (artistId) => path.join(convDir, `${artistId}.json`);

export function getConversation(artistId) {
  const base = emptyConv(artistId);
  if (!convDir || !SAFE_ID.test(artistId)) return base;
  const f = fileFor(artistId);
  if (!fs.existsSync(f)) return base;
  try {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...base, ...c, state: { ...base.state, ...(c.state || {}) }, messages: Array.isArray(c.messages) ? c.messages : [] };
  } catch { return base; }
}

function write(conv) {
  conv.updatedAt = new Date().toISOString();
  const f = fileFor(conv.artistId);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(conv, null, 2));
  fs.renameSync(tmp, f);
}

export function appendTurn(artistId, userContent, aiContent, state) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const conv = getConversation(artistId);
  const ts = new Date().toISOString();
  conv.messages.push({ role: 'user', content: String(userContent ?? ''), ts });
  conv.messages.push({ role: 'assistant', content: String(aiContent ?? ''), ts });
  if (state) conv.state = { mood: state.mood, affinity: state.affinity };
  write(conv);
  return conv;
}

export function setMemory(artistId, memory) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const conv = getConversation(artistId);
  conv.memory = String(memory ?? '');
  write(conv);
  return conv;
}

export function trimToRecent(artistId, keep) {
  if (!SAFE_ID.test(artistId)) throw new Error('非法 artistId');
  const conv = getConversation(artistId);
  if (conv.messages.length > keep) conv.messages = conv.messages.slice(-keep);
  write(conv);
  return conv;
}

export function resetConversation(artistId) {
  if (!convDir || !SAFE_ID.test(artistId)) return;
  const f = fileFor(artistId);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
