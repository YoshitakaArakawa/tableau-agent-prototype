import fs from "fs";
import path from "path";

function stripQuotes(v: string): string {
  const s = v.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

// Lightweight .env loader without extra dependencies.
// - Reads <project>/.env if present
// - Ignores commented/blank lines
// - Parses key=value and strips surrounding quotes from value
// - Does not overwrite existing process.env values
export function loadDotEnvFromProjectRoot(): void {
  try {
    const file = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, { encoding: "utf8" });
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = stripQuotes(trimmed.slice(eq + 1).trim());
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // silently ignore .env load errors
  }
}

