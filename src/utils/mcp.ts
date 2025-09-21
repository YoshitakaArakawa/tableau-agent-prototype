export function extractResultJson(result: any): any {
  try {
    if (Array.isArray(result)) {
      const jsonItem = result.find((entry) => entry && (entry.type === "json" || entry.kind === "json"));
      if (jsonItem && (jsonItem.value !== undefined || jsonItem.data !== undefined)) {
        return jsonItem.value ?? jsonItem.data;
      }
      const textItems = result.filter((entry) => entry && entry.type === "text" && typeof entry.text === "string");
      const joined = textItems.map((entry: any) => entry.text).join("\n").trim();
      if (joined) return JSON.parse(joined);
    }
    if (result && typeof result === "object") {
      if ((result as any).ok && "value" in (result as any)) return (result as any).value;
      if ("value" in (result as any)) return (result as any).value;
      if ("result" in (result as any)) return (result as any).result;
      if (Array.isArray((result as any).data)) return (result as any).data;
    }
  } catch {}
  return undefined;
}
