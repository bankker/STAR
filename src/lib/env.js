import fs from 'node:fs';

export function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export function setEnvKey(file, key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`非法环境变量名: ${key}`);
  if (/[\r\n]/.test(value)) throw new Error('值不能包含换行');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(text)) text = text.replace(re, line);
  else text = text + (text === '' || text.endsWith('\n') ? '' : '\n') + line + '\n';
  fs.writeFileSync(file, text);
  process.env[key] = value;
}
