import fs from "fs";
import path from "path";

function ensureDirFor(filePath: string) {
  try {
    const dir = path.dirname(path.resolve(filePath));
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function appendLine(filePath: string, line: string) {
  try {
    ensureDirFor(filePath);
    fs.appendFile(filePath, line + "\n", { encoding: "utf8" }, () => {});
  } catch {}
}

function ts() {
  return new Date().toISOString();
}

/**
 * Append analysis/debug text into a simple txt file.
 * - Path: env ANALYSIS_LOG_FILE (default: logs/analysis.txt)
 * - Adds ISO timestamp prefix per line.
 */
export function appendAnalysisLog(text: string) {
  try {
    const out = process.env.ANALYSIS_LOG_FILE || path.join("logs", "analysis.txt");
    const line = `${ts()} ${text}`;
    appendLine(out, line);
  } catch {}
}

