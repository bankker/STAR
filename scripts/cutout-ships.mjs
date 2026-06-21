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
const DARK = parseInt(arg('dark', '64'), 10);     // max(R,G,B) < DARK 视为深空
const only = arg('only', '');
const suffix = arg('suffix', '');                 // 非空则输出到 <id><suffix>.png（不覆盖原图，便于试）
const MB = 1 << 28;

function cutout(srcFile, dstFile) {
  const dim = probeImageSize(srcFile);
  if (!dim) throw new Error('无法读取尺寸');
  const W = dim.w, H = dim.h;
  const raw = execFileSync(FF, ['-v', 'error', '-i', srcFile, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: MB });
  const N = W * H;
  const maxc = (i) => { const o = i * 4, r = raw[o], g = raw[o + 1], b = raw[o + 2]; return r > g ? (r > b ? r : b) : (g > b ? g : b); };

  // ① 边界洪水填充暗像素 → 背景
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N); let sp = 0;
  const seed = (i) => { if (!bg[i] && maxc(i) < DARK) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp], x = i % W, y = (i - x) / W;
    if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W);
  }

  // ② 非背景像素的最大连通块 = 战船
  const label = new Int32Array(N);
  const queue = new Int32Array(N);
  let cur = 0, bestLabel = 0, bestSize = 0;
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

  // ④ raw → PNG
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', dstFile], { input: raw, maxBuffer: MB });
  return { W, H, kept: bestSize, total: N };
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
