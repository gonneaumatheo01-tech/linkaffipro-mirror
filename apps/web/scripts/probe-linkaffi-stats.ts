import { prisma } from "@linkaffipro/db";

const baseUrl = (process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
const apiKey = process.env.LINKAFFI_API_KEY ?? "";
const anonKey = process.env.LINKAFFI_ANON_KEY ?? "";
const aff = process.argv[2] ?? "";

async function raw(path: string) {
  const res = await fetch(baseUrl + path, {
    headers: { "x-api-key": apiKey, apikey: anonKey, accept: "application/json" },
  });
  const text = await res.text();
  console.log(`\n[${res.status}] ${path}\n${text.slice(0, 700)}`);
}

async function main() {
  console.log("baseUrl:", baseUrl || "(absent)");
  console.log("cle api:", apiKey ? "presente" : "ABSENTE", "| cle anon:", anonKey ? "presente" : "ABSENTE");
  if (!baseUrl || !apiKey || !anonKey) { console.log("=> cles/url manquantes"); return; }

  await raw("");
  await raw("/stats?limit=2");
  await raw("/stats?limit=2&order=date");
  if (aff) {
    await raw(`/stats?limit=2&eq.affiliate_id=${aff}`);
    await raw(`/stats?limit=2&eq.affiliate_id=${aff}&order=date`);
    await raw(`/stats?limit=2&eq.affiliate_id=${aff}&date_col=created_at&from=2026-10-01&order=created_at`);
  } else {
    const rows = await (prisma as any).affiliate.findMany({ take: 10 });
    console.log("\nAFFILIES (pour recuperer un id) :\n" + JSON.stringify(rows, null, 2).slice(0, 1500));
  }
}

main().then(() => process.exit(0));
