import fs from 'node:fs';
import path from 'node:path';

const TEXT_CAPS = new Set(['chat', 'content', 'world', 'plan', 'drama-script', 'storyboard']);
let ledgerFile = null;

export function initLedger(file) {
  ledgerFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function recordUsage(entry) {
  if (!ledgerFile) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try { fs.appendFileSync(ledgerFile, line + '\n'); }
  catch (err) { console.error('[ledger] 写入失败', err.message); }
}

const round = (n) => Math.round(n * 10000) / 10000;

export function summarize({ sinceMs }) {
  const out = { totalUsd: 0, textUsd: 0, calls: 0, byCapability: {}, byProvider: {} };
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return out;
  for (const line of fs.readFileSync(ledgerFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (new Date(e.ts).getTime() < sinceMs) continue;
    const usd = e.estUsd || 0;
    out.totalUsd += usd;
    out.calls += 1;
    if (TEXT_CAPS.has(e.capability)) out.textUsd += usd;
    const cap = (out.byCapability[e.capability] ||= { usd: 0, calls: 0 });
    cap.usd = round(cap.usd + usd); cap.calls += 1;
    const prov = (out.byProvider[e.provider] ||= { usd: 0, calls: 0 });
    prov.usd = round(prov.usd + usd); prov.calls += 1;
  }
  out.totalUsd = round(out.totalUsd);
  out.textUsd = round(out.textUsd);
  return out;
}
