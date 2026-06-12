import path from 'node:path';
import { registerProvider, initConfig, loadConfig } from './gateway/registry.js';
import { initLedger } from './gateway/ledger.js';
import { setPriceOverrides } from './gateway/costs.js';
import { registerAll } from './providers/index.js';
import { CONFIG_FILE, LOGS_DIR } from './lib/paths.js';

export function bootstrap() {
  registerAll(registerProvider);
  initConfig(CONFIG_FILE);
  initLedger(path.join(LOGS_DIR, 'ai-usage.jsonl'));
  const cfg = loadConfig();
  if (cfg.costs) setPriceOverrides(cfg.costs);
}
