import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

let cachedFfmpeg = null;
let cachedFfprobe = null;

function findOnPath(cmd) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(which, [cmd], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    return out && fs.existsSync(out) ? out : null;
  } catch { return null; }
}

function findInWinget(exe) {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(base)) return null;
  try {
    for (const d of fs.readdirSync(base)) {
      if (!/ffmpeg/i.test(d)) continue;
      const pkg = path.join(base, d);
      for (const sub of fs.readdirSync(pkg)) {
        const cand = path.join(pkg, sub, 'bin', exe);
        if (fs.existsSync(cand)) return cand;
      }
    }
  } catch {}
  return null;
}

export function resolveFfmpeg() {
  if (cachedFfmpeg) return cachedFfmpeg;
  cachedFfmpeg = process.env.FFMPEG_PATH || findOnPath('ffmpeg') || findInWinget('ffmpeg.exe') || null;
  return cachedFfmpeg;
}

export function resolveFfprobe() {
  if (cachedFfprobe) return cachedFfprobe;
  cachedFfprobe = process.env.FFPROBE_PATH || findOnPath('ffprobe') || findInWinget('ffprobe.exe') || null;
  return cachedFfprobe;
}

export function ffmpegAvailable() { return Boolean(resolveFfmpeg() && resolveFfprobe()); }

export function runFfmpeg(args, timeoutMs = 300000) {
  const bin = resolveFfmpeg();
  if (!bin) throw new Error('未找到 ffmpeg，请安装并加入 PATH 或设置 FFMPEG_PATH');
  const r = spawnSync(bin, args, { timeout: timeoutMs, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${(r.stderr || '').slice(-400)}`);
}

export function probeDurationSec(file) {
  const bin = resolveFfprobe();
  if (!bin) return 0;
  try {
    const out = execFileSync(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    return parseFloat(out.trim()) || 0;
  } catch { return 0; }
}

export function probeImageSize(file) {
  const bin = resolveFfprobe();
  if (!bin) return null;
  try {
    const out = execFileSync(bin, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', file], { encoding: 'utf8' }).trim();
    const [w, h] = out.split('x').map((n) => parseInt(n, 10));
    return (w > 0 && h > 0) ? { w, h } : null;
  } catch { return null; }
}

// 万相图像参考要求基图宽/高均在 [512,4096]px——过小(如上传 447²)或过大的形象照会被直接拒。
// 按需等比缩放到合规范围并重编码 PNG，返回新的 base64 dataUrl；已合规 / 非 dataUrl / 无 ffmpeg 时原样返回。
export function ensureImageRefSize(dataUrl, { min = 512, max = 4096 } = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
  if (!ffmpegAvailable()) return dataUrl;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl;
  let buf;
  try { buf = Buffer.from(dataUrl.slice(comma + 1), 'base64'); } catch { return dataUrl; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imgref_'));
  try {
    const src = path.join(tmp, 'in');
    fs.writeFileSync(src, buf);
    const dim = probeImageSize(src);
    if (!dim) return dataUrl;
    const { w, h } = dim;
    const inRange = (v) => v >= min && v <= max;
    if (inRange(w) && inRange(h)) return dataUrl;   // 已合规，免转码
    const lo = Math.min(w, h), hi = Math.max(w, h);
    let scale = 1;
    if (lo < min) scale = 1024 / lo;                // 过小→放大到约 1024 短边（质量更稳）
    else if (hi > max) scale = max / hi;            // 过大→缩小到长边 = max
    if (hi * scale > max) scale = max / hi;          // 放大后仍不得超过 max
    let nw = Math.round(w * scale), nh = Math.round(h * scale);
    nw = Math.max(min, Math.min(max, nw - (nw % 2)));
    nh = Math.max(min, Math.min(max, nh - (nh % 2)));
    const out = path.join(tmp, 'out.png');
    runFfmpeg(['-y', '-i', src, '-vf', `scale=${nw}:${nh}:flags=lanczos`, out]);
    return 'data:image/png;base64,' + fs.readFileSync(out).toString('base64');
  } catch { return dataUrl; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(mmm, 3)}`;
}

// 任意音频（含浏览器 webm/opus）→ 16k 单声道 wav，供 ASR。
export function transcodeToWav(srcAbs, destAbs) {
  runFfmpeg(['-y', '-i', srcAbs, '-ar', '16000', '-ac', '1', destAbs]);
  return destAbs;
}

export function buildSrt(segments) {
  let t = 0, out = '';
  segments.forEach((seg, i) => {
    const start = t; t += seg.durationSec || 0;
    out += `${i + 1}\n${srtTime(start)} --> ${srtTime(t)}\n${seg.text}\n\n`;
  });
  return out;
}
