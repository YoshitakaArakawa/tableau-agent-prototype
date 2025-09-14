import fs from "fs";
import path from "path";

function vdsDir(): string {
  const dir = path.resolve(process.cwd(), "logs", "vdsapi_json");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function makeRequestId(): string {
  const iso = new Date().toISOString().replace(/[^0-9TZ]/g, "").replace("T", "_").replace("Z", "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${iso}_${rand}`;
}

export function saveVdsJson(data: any): { requestId: string; relPath: string; fullPath: string } {
  const dir = vdsDir();
  const requestId = makeRequestId();
  const filename = `${requestId}.json`;
  const fullPath = path.join(dir, filename);
  try {
    const json = JSON.stringify(data ?? null, null, 2);
    fs.writeFileSync(fullPath, json, { encoding: "utf8" });
  } catch {}
  return { requestId, relPath: path.join("logs", "vdsapi_json", filename), fullPath };
}

