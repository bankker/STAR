import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROTOTYPE_DIR = path.join(ROOT_DIR, 'prototype');
// 数据与产物目录可用环境变量隔离（测试/验证跑临时目录，永不动真实记录）。
// 真实运行不设这俩变量 → 用默认 data/ 与 prototype/generated/。
export const GENERATED_DIR = process.env.GENERATED_DIR ? path.resolve(process.env.GENERATED_DIR) : path.join(PROTOTYPE_DIR, 'generated');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
export const DRAMA_DIR = path.join(DATA_DIR, 'dramas');
export const GUESTS_DIR = path.join(DATA_DIR, 'guests');
export const INTERVIEWS_DIR = path.join(DATA_DIR, 'interviews');
export const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const CONFIG_FILE = path.join(ROOT_DIR, 'config', 'ai-providers.json');
export const ENV_FILE = path.join(ROOT_DIR, '.env');
