import fs from 'fs';
import path from 'path';

// Minimal .env loader to avoid extra deps.
function parseLine(line: string): { key: string; value: string } | null {
  const idx = line.indexOf('=');
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  // Strip surrounding quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export function loadEnv(customPath?: string): boolean {
  const envPath = path.resolve(process.cwd(), customPath || '.env');
  if (!fs.existsSync(envPath)) return false;
  const raw = fs.readFileSync(envPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  for (const l of lines) {
    const line = l.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = parseLine(line);
    if (!kv) continue;
    const { key, value } = kv;
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
  return true;
}

export default { loadEnv };
