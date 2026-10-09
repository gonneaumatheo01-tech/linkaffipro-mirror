// Inspecte le schéma apparent des tables utiles : colonnes, types, exemples anonymisés. Sans secrets ni données personnelles.
import { LINKAFFI_ALLOWED_TABLES, LinkAffiClient } from "../src/index";

const PII = /email|phone|name|ip|address|iban|password|token|first|last|user_agent|login/i;

function kind(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "object") return Array.isArray(v) ? "array" : "json";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return "timestamp";
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "date";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) return "uuid";
    if (/^-?\d+(\.\d+)?$/.test(v)) return "numeric(str)";
    return "text";
  }
  return typeof v;
}

function sample(col: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (PII.test(col) && kind(v) === "text") return "<masqué>";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

async function main() {
  const client = new LinkAffiClient();
  const only = process.argv[2];
  for (const t of LINKAFFI_ALLOWED_TABLES) {
    if (only && t !== only) continue;
    let page;
    try {
      page = await client.getPage(t, { limit: 5, order: "-created_at" });
    } catch {
      try {
        page = await client.getPage(t, { limit: 5 });
      } catch (err) {
        console.log(`\n## ${t} — erreur : ${(err as Error).message}`);
        continue;
      }
    }
    console.log(`\n## ${t} — ${page.total} lignes`);
    const cols = new Map<string, { types: Set<string>; ex: string }>();
    for (const row of page.rows) {
      for (const [k, v] of Object.entries(row)) {
        const c = cols.get(k) ?? { types: new Set(), ex: "" };
        c.types.add(kind(v));
        if (!c.ex && v !== null && v !== undefined) c.ex = sample(k, v);
        cols.set(k, c);
      }
    }
    for (const [k, c] of cols) console.log(`  ${k.padEnd(28)} ${[...c.types].join("|").padEnd(14)} ${c.ex}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
