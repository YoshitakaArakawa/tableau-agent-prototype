const fs = require('fs');
const path = require('path');

const cache = new Map();

function promptsDir() {
  const p = process.env.PROMPTS_PATH;
  if (p && p.trim()) return path.resolve(p);
  return path.resolve(process.cwd(), 'prompts');
}

function loadPrompt(agentName, opts = {}) {
  const { strict = true } = opts;
  const dir = promptsDir();
  const primary = path.join(dir, `${agentName}.xml`);
  const filePath = fs.existsSync(primary);
  if (cache.has(filePath)) return cache.get(filePath);
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const cleaned = txt.replace(/^\uFEFF/, '').trim();
    if (cleaned) {
      cache.set(filePath, cleaned);
      return cleaned;
    }
  } catch (e) {
    if (strict) {
      const err = new Error(`Prompt XML not found for ${agentName}: ${primary}`);
      err.cause = e;
      throw err;
    }
    return '';
  }
  return '';
}

module.exports = { loadPrompt };
