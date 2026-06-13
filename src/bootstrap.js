import path from 'node:path';
import { registerProvider, initConfig, loadConfig } from './gateway/registry.js';
import { initLedger } from './gateway/ledger.js';
import { setPriceOverrides } from './gateway/costs.js';
import { registerAll } from './providers/index.js';
import { CONFIG_FILE, LOGS_DIR, DATA_DIR } from './lib/paths.js';
import { startHealthLoop } from './gateway/health.js';
import { initJobs } from './gateway/jobs.js';
import { execute } from './gateway/gateway.js';
import { initArtists } from './studio/artists.js';

export function bootstrap() {
  try {
    registerAll(registerProvider);
    initConfig(CONFIG_FILE);
    initLedger(path.join(LOGS_DIR, 'ai-usage.jsonl'));
    const cfg = loadConfig();
    if (cfg.costs) setPriceOverrides(cfg.costs);
    initJobs({ file: path.join(DATA_DIR, 'jobs.json'), executeFn: execute });
    initArtists(path.join(DATA_DIR, 'artists.json'));
    startHealthLoop();
  } catch (e) {
    console.error('[bootstrap] 启动失败:', e.message);
    console.error('请检查 config/ai-providers.json 是否存在、为合法 JSON，且路由引用的 provider 均已注册。');
    process.exit(1);
  }
}
