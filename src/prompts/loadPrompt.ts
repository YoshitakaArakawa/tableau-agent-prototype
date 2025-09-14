import fs from 'fs';
import path from 'path';

const cache = new Map<string, string>();

function promptsDir(): string {
  const p = process.env.PROMPTS_PATH;
  if (p && p.trim()) return path.resolve(p);
  return path.resolve(process.cwd(), 'prompts');
}

export function loadPrompt(agentName: string, opts: { strict?: boolean } = {}): string {
  const { strict = true } = opts;
  const dir = promptsDir();
  const primary = path.join(dir, `${agentName}.xml`);
  const legacy = path.join(dir, `${agentName}.prompt.xml`);
  const chosen = fs.existsSync(primary) ? primary : legacy;
  if (cache.has(chosen)) return cache.get(chosen)!;
  try {
    const txt = fs.readFileSync(chosen, 'utf8');
    const cleaned = txt.replace(/^\uFEFF/, '').trim();
    if (cleaned) {
      cache.set(chosen, cleaned);
      return cleaned;
    }
  } catch (e: any) {
    if (strict) {
      const err: any = new Error(`Prompt XML not found for ${agentName}: ${primary} (legacy tried: ${legacy})`);
      err.cause = e;
      throw err;
    }
    return '';
  }
  return '';
}

export default { loadPrompt };
