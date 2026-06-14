import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function safeJoin(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const full = path.resolve(path.join(root, decoded));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export function saveBufferToGenerated(genDir, buf, ext) {
  fs.mkdirSync(genDir, { recursive: true });
  const name = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const filePath = path.join(genDir, name);
  fs.writeFileSync(filePath, buf);
  return { path: filePath, url: `/generated/${name}` };
}

export function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('无效的 dataUrl');
  return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
}

// base64 dataUrl 落盘到 GENERATED_DIR，按 mime 推断扩展名，返回 /generated/<name> url。
export function saveDataUrl(genDir, dataUrl) {
  const { mime, buf } = dataUrlToBuffer(dataUrl);
  const ext = mime.includes('webm') ? 'webm' : mime.includes('wav') ? 'wav'
    : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
    : (mime.includes('jpeg') || mime.includes('jpg')) ? 'jpg' : mime.includes('png') ? 'png' : 'bin';
  return saveBufferToGenerated(genDir, buf, ext).url;
}

export function generatedUrlToDataUrl(genDir, url) {
  const m = /^\/generated\/([A-Za-z0-9_.-]+)$/.exec(url || '');
  if (!m) return null;
  const full = path.join(genDir, m[1]);
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(full).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : (ext === 'mp4' ? 'video/mp4' : 'image/png');
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
}
