// 批量预生成星舰底图 → prototype/battle/ships/<id>.png + manifest.json
// 用法：
//   node scripts/gen-ships.mjs              # 仅生成缺失的（幂等，可反复跑）
//   node scripts/gen-ships.mjs --force      # 全部重生成
//   node scripts/gen-ships.mjs --only=enemy-boss   # 只生成某一艘
// 需在 .env 里已录入对应平台 API key（与服务器同源）。
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/lib/env.js';
import { ENV_FILE, CONFIG_FILE, GENERATED_DIR, PROTOTYPE_DIR } from '../src/lib/paths.js';
import { registerProvider, initConfig, loadConfig } from '../src/gateway/registry.js';
import { registerAll } from '../src/providers/index.js';
import { setPriceOverrides } from '../src/gateway/costs.js';
import { execute } from '../src/gateway/gateway.js';
import { SHIPS } from '../prototype/battle/ships.js';

loadEnv(ENV_FILE);
registerAll(registerProvider);
initConfig(CONFIG_FILE);
const cfg = loadConfig();
if (cfg.costs) setPriceOverrides(cfg.costs);

const SHIPS_DIR = path.join(PROTOTYPE_DIR, 'battle', 'ships');
const MANIFEST = path.join(SHIPS_DIR, 'manifest.json');
fs.mkdirSync(SHIPS_DIR, { recursive: true });
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

const force = process.argv.includes('--force');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

async function fetchToFile(url, dest) {
  if (url.startsWith('/generated/')) {
    fs.copyFileSync(path.join(GENERATED_DIR, url.slice('/generated/'.length)), dest);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

let made = 0, skipped = 0, failed = 0;
for (const s of SHIPS) {
  if (only && s.id !== only) continue;
  const dest = path.join(SHIPS_DIR, s.id + '.png');
  if (!force && manifest[s.id] && fs.existsSync(dest)) { console.log(`· skip   ${s.id}`); skipped++; continue; }
  process.stdout.write(`· gen    ${s.id} … `);
  try {
    const r = await execute('image', { prompt: s.prompt, aspect: s.aspect || '16:9' });
    const url = r.files?.[0]?.url || '';
    if (!url) { console.log('无返回图，跳过'); failed++; continue; }
    await fetchToFile(url, dest);
    manifest[s.id] = `/battle/ships/${s.id}.png`;
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`ok → battle/ships/${s.id}.png`);
    made++;
  } catch (e) {
    console.log('失败：' + (e.message || e));
    failed++;
  }
}
console.log(`\n完成：新生成 ${made}，跳过 ${skipped}，失败 ${failed}。manifest → ${MANIFEST}`);
process.exit(0);
