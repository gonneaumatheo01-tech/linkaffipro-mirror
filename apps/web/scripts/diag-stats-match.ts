import { prisma } from "@linkaffipro/db";
const base = (process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
const key = process.env.LINKAFFI_API_KEY ?? "";
const anon = process.env.LINKAFFI_ANON_KEY ?? "";
async function main() {
  const res = await fetch(`${base}/stats?limit=5000&offset=0`, {
    headers: { "x-api-key": key, apikey: anon, accept: "application/json" },
  });
  const j = (await res.json()) as { rows: Record<string, unknown>[] };
  const acs = await prisma.affiliateCampaign.findMany({ select: { externalId: true, raw: true } });
  const known = new Set(acs.map((a) => a.externalId));
  const counts = new Map<string, number>();
  let matched = 0;
  for (const r of j.rows) {
    if (!known.has(String(r.campaign_id))) continue;
    matched++;
    const a = String(r.affiliate_id);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  console.log("lignes stats rattachables a une offre connue :", matched, "/", j.rows.length);
  console.log("offres connues (externalId) :", known.size);
  console.log("affiliate_id candidats (nb de lignes) :", [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
  const demo = acs.filter((a) => (a.raw as Record<string, unknown> | null)?.demo === true);
  console.log("offres de demo (externalId) :", demo.map((d) => d.externalId));
}
main().then(() => process.exit(0));
