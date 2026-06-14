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

export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mmm = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(mmm, 3)}`;
}

export function buildSrt(segments) {
  let t = 0, out = '';
  segments.forEach((seg, i) => {
    const start = t; t += seg.durationSec || 0;
    out += `${i + 1}\n${srtTime(start)} --> ${srtTime(t)}\n${seg.text}\n\n`;
  });
  return out;
}
