import { prisma } from "@linkaffipro/db";
const base = (process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
const key = process.env.LINKAFFI_API_KEY ?? "";
const anon = process.env.LINKAFFI_ANON_KEY ?? "";
async function raw(label: string, path: string) {
  const res = await fetch(base + path, { headers: { "x-api-key": key, apikey: anon, accept: "application/json" } });
  const t = await res.text();
  console.log(`\n[${res.status}] ${label}\n${t.slice(0, 300)}`);
}
async function main() {
  const s = await prisma.syncState.findUnique({ where: { source: "stats" } });
  const cur = (s?.cursor ?? {}) as any;
  console.log("lastError:", s?.lastError, "| updatedAt:", s?.updatedAt, "| isRunning:", s?.isRunning);
  const affs = (cur.affiliates ?? []) as string[];
  console.log("affilies dans le curseur:", affs.length, JSON.stringify(affs).slice(0, 700));
  const a = affs[0] ?? "38281248-09a8-4033-9695-e16866292981";
  console.log("\n-- test du limit --");
  for (const lim of [100, 500, 1000, 5000]) {
    await raw(`limit=${lim}`, `/stats?limit=${lim}&offset=0&order=date&eq.affiliate_id=${a}`);
  }
  console.log("\n-- les deux formes envoyees par le sync --");
  await raw("date_col=date + from", `/stats?limit=1000&offset=0&date_col=date&from=2026-10-15&order=date&eq.affiliate_id=${a}`);
  await raw("date_col=created_at + from", `/stats?limit=1000&offset=0&date_col=created_at&from=2026-10-15&order=created_at&eq.affiliate_id=${a}`);
  console.log("\n-- id d'affilie non-UUID (si le curseur en contient) --");
  for (const bad of affs.filter((x) => !/^[0-9a-f-]{36}$/i.test(x)).slice(0, 3)) {
    await raw(`affilie suspect ${bad}`, `/stats?limit=100&eq.affiliate_id=${bad}`);
  }
}
main().then(() => process.exit(0));
