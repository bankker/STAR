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
