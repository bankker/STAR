// 把星舰底图的深空背景抠成透明（保留舰体内部暗部，去掉空背景与零星星点）
// 原理：ffmpeg 只做 PNG↔rawRGBA 编解码；抠图在纯 Node 里做：
//   ① 从四边对“暗像素”洪水填充 → 判为背景（舰体亮边会挡住，内部暗部被包住不会误删）
//   ② 剩余不透明像素取最大连通块 = 战船，其它小块（散落星点/星云碎块）清除
// 用法：node scripts/cutout-ships.mjs [--only=enemy-empire] [--dark=64] [--suffix=_cut]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveFfmpeg, probeImageSize } from '../src/lib/ffmpeg.js';
import { PROTOTYPE_DIR } from '../src/lib/paths.js';
import { SHIPS } from '../prototype/battle/ships.js';

const FF = resolveFfmpeg();
if (!FF) { console.error('未找到 ffmpeg（设置 FFMPEG_PATH 或装到 PATH）'); process.exit(1); }
const SHIPS_DIR = path.join(PROTOTYPE_DIR, 'battle', 'ships');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const DARK = parseInt(arg('dark', '64'), 10);     // 暗底：max(R,G,B) < DARK 视为背景
const LIGHT = parseInt(arg('light', '205'), 10);  // 亮底：min(R,G,B) > LIGHT 视为背景
const BGMODE = arg('bg', 'auto');                 // auto | dark | light（背景判定方式）
const only = arg('only', '');
const suffix = arg('suffix', '');                 // 非空则输出到 <id><suffix>.png（不覆盖原图，便于试）
const fileIn = arg('file', '');                   // 处理任意单文件（不走图鉴目录）
const fileOut = arg('out', '');                   // file 模式输出路径（默认覆盖原文件）
const NOKEY = process.argv.includes('--nokey');   // 已是透明图：沿用其 alpha，不重新抠
const TRIM = process.argv.includes('--trim');     // 裁掉四周透明边距（贴合舰体）
const CIRCLE = process.argv.includes('--circle'); // 圆形遮罩（行星：占满画面、圆内保留圆外透明，抗暗部误删）
const CR = parseFloat(arg('cr', '0.49'));         // 圆半径占 min(W,H) 比例
const MB = 1 << 28;

function cutout(srcFile, dstFile) {
  const dim = probeImageSize(srcFile);
  if (!dim) throw new Error('无法读取尺寸');
  const W = dim.w, H = dim.h;
  const raw = execFileSync(FF, ['-v', 'error', '-i', srcFile, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: MB });
  const N = W * H;
  const maxc = (i) => { const o = i * 4, r = raw[o], g = raw[o + 1], b = raw[o + 2]; return r > g ? (r > b ? r : b) : (g > b ? g : b); };
  const minc = (i) => { const o = i * 4, r = raw[o], g = raw[o + 1], b = raw[o + 2]; return r < g ? (r < b ? r : b) : (g < b ? g : b); };
  let mode = 'nokey', bestSize = 0;

  if (CIRCLE) {
    // 圆形遮罩：圆内保留、圆外透明（边缘 1.5px 羽化）
    mode = 'circle';
    const cx = (W - 1) / 2, cy = (H - 1) / 2, R = Math.min(W, H) * CR;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = Math.hypot(x - cx, y - cy);
      if (d <= R - 1.5) bestSize++;
      else if (d >= R + 0.5) raw[i * 4 + 3] = 0;
      else { raw[i * 4 + 3] = Math.round(255 * (R + 0.5 - d) / 2); bestSize++; }
    }
  } else if (NOKEY) {
    // 沿用图片已有 alpha；统计不透明像素
    for (let i = 0; i < N; i++) if (raw[i * 4 + 3] > 16) bestSize++;
  } else {
    // 自动判背景明暗：取四角平均亮度
    mode = BGMODE;
    if (mode === 'auto') {
      const corners = [0, W - 1, (H - 1) * W, H * W - 1];
      const avg = corners.reduce((s, i) => s + (raw[i * 4] + raw[i * 4 + 1] + raw[i * 4 + 2]) / 3, 0) / corners.length;
      mode = avg > 140 ? 'light' : 'dark';
    }
    const isBg = mode === 'light' ? (i) => minc(i) > LIGHT : (i) => maxc(i) < DARK;
    // ① 边界洪水填充背景像素
    const bg = new Uint8Array(N);
    const stack = new Int32Array(N); let sp = 0;
    const seed = (i) => { if (!bg[i] && isBg(i)) { bg[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i - x) / W;
      if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W);
    }
    // ② 非背景像素的最大连通块 = 战船
    const label = new Int32Array(N);
    const queue = new Int32Array(N);
    let cur = 0, bestLabel = 0;
    for (let s = 0; s < N; s++) {
      if (bg[s] || label[s]) continue;
      cur++; let qh = 0, qt = 0, size = 0; queue[qt++] = s; label[s] = cur;
      while (qh < qt) {
        const j = queue[qh++]; size++; const x = j % W, y = (j - x) / W;
        const nb = (k) => { if (!bg[k] && !label[k]) { label[k] = cur; queue[qt++] = k; } };
        if (x > 0) nb(j - 1); if (x < W - 1) nb(j + 1); if (y > 0) nb(j - W); if (y < H - 1) nb(j + W);
      }
      if (size > bestSize) { bestSize = size; bestLabel = cur; }
    }
    // ③ 写 alpha：只有最大连通块保留不透明
    for (let i = 0; i < N; i++) raw[i * 4 + 3] = (!bg[i] && label[i] === bestLabel) ? 255 : 0;
  }

  // ④ 可选裁切透明边距 → 贴合舰体
  let outW = W, outH = H, outBuf = raw;
  if (TRIM) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (raw[(y * W + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 >= x0) {
      const pad = 6;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      outW = x1 - x0 + 1; outH = y1 - y0 + 1; outBuf = Buffer.alloc(outW * outH * 4);
      for (let y = 0; y < outH; y++) raw.copy(outBuf, y * outW * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + outW) * 4);
    }
  }

  // ⑤ raw → PNG（覆盖下方 dstFile 编码用 outBuf/outW/outH）
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${outW}x${outH}`, '-i', 'pipe:0', '-frames:v', '1', dstFile], { input: outBuf, maxBuffer: MB });
  return { W: outW, H: outH, kept: bestSize, total: N, mode };
}

// 单文件模式：node scripts/cutout-ships.mjs --file=in.png [--out=out.png] [--bg=light|--nokey] [--trim]
if (fileIn) {
  const dst = fileOut || fileIn;
  process.stdout.write(`· cut  ${path.basename(fileIn)} … `);
  const r = cutout(fileIn, dst);
  console.log(`ok（${r.mode} 底，不透明占 ${(r.kept / r.total * 100).toFixed(0)}%）→ ${dst}`);
  process.exit(0);
}

let done = 0;
for (const s of SHIPS) {
  if (only && s.id !== only) continue;
  const src = path.join(SHIPS_DIR, s.id + '.png');
  if (!fs.existsSync(src)) { console.log('· miss ', s.id); continue; }
  const dst = path.join(SHIPS_DIR, s.id + suffix + '.png');
  process.stdout.write(`· cut  ${s.id} … `);
  try { const r = cutout(src, dst); console.log(`ok（不透明占 ${(r.kept / r.total * 100).toFixed(0)}%）→ ${path.basename(dst)}`); done++; }
  catch (e) { console.log('失败：' + (e.message || e)); }
}
console.log(`\n完成：抠图 ${done} 张（dark=${DARK}${suffix ? `, suffix=${suffix}` : ''}）`);
process.exit(0);
