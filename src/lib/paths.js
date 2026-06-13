import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROTOTYPE_DIR = path.join(ROOT_DIR, 'prototype');
export const GENERATED_DIR = path.join(PROTOTYPE_DIR, 'generated');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const CONFIG_FILE = path.join(ROOT_DIR, 'config', 'ai-providers.json');
export const ENV_FILE = path.join(ROOT_DIR, '.env');
