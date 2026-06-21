// 批量生成星图行星底图（黑底）→ prototype/battle/planets/<scheme>.png + manifest.json
// 随后跑 `npm run cutout:planets` 把黑背景抠透明（圆形行星 + 透明四角）。
// 用法：node scripts/gen-planets.mjs [--force] [--only=mars]
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/lib/env.js';
import { ENV_FILE, CONFIG_FILE, GENERATED_DIR, PROTOTYPE_DIR } from '../src/lib/paths.js';
import { registerProvider, initConfig, loadConfig } from '../src/gateway/registry.js';
import { registerAll } from '../src/providers/index.js';
import { setPriceOverrides } from '../src/gateway/costs.js';
import { execute } from '../src/gateway/gateway.js';
import { PLANETS } from '../prototype/battle/planets.js';

loadEnv(ENV_FILE);
registerAll(registerProvider);
initConfig(CONFIG_FILE);
const cfg = loadConfig();
if (cfg.costs) setPriceOverrides(cfg.costs);

const DIR = path.join(PROTOTYPE_DIR, 'battle', 'planets');
const MANIFEST = path.join(DIR, 'manifest.json');
fs.mkdirSync(DIR, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const force = process.argv.includes('--force');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

async function fetchToFile(url, dest) {
  if (url.startsWith('/generated/')) fs.copyFileSync(path.join(GENERATED_DIR, url.slice('/generated/'.length)), dest);
  else { const res = await fetch(url); if (!res.ok) throw new Error('下载失败 ' + res.status); fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer())); }
}

let made = 0, skipped = 0, failed = 0;
for (const p of PLANETS) {
  if (only && p.scheme !== only) continue;
  const dest = path.join(DIR, p.scheme + '.png');
  if (!force && manifest[p.scheme] && fs.existsSync(dest)) { console.log('· skip   ' + p.scheme); skipped++; continue; }
  process.stdout.write(`· gen    ${p.scheme} … `);
  try {
    const r = await execute('image', { prompt: p.prompt, aspect: '1:1' });
    const url = r.files?.[0]?.url || '';
    if (!url) { console.log('无返回图'); failed++; continue; }
    await fetchToFile(url, dest);
    manifest[p.scheme] = `/battle/planets/${p.scheme}.png`;
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log('ok'); made++;
  } catch (e) { console.log('失败：' + (e.message || e)); failed++; }
}
console.log(`\n完成：新生成 ${made}，跳过 ${skipped}，失败 ${failed}。manifest → ${MANIFEST}`);
process.exit(0);
