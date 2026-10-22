import { prisma } from "@linkaffipro/db";
const base = (process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
const key = process.env.LINKAFFI_API_KEY ?? "";
const anon = process.env.LINKAFFI_ANON_KEY ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const res = await fetch(`${base}/stats?limit=5000&offset=0`, {
    headers: { "x-api-key": key, apikey: anon, accept: "application/json" },
  });
  const rows = ((await res.json()) as { rows: Record<string, unknown>[] }).rows;

  const acs = await prisma.affiliateCampaign.findMany({ select: { id: true, externalId: true, raw: true } });
  const connus = new Set(acs.map((a) => a.externalId));
  const candidats = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const aff = String(r.affiliate_id);
    if (!UUID_RE.test(aff)) continue;
    if (!connus.has(String(r.campaign_id))) continue;
    if (!candidats.has(aff)) candidats.set(aff, r);
  }
  const liste = [...candidats.entries()].slice(0, 6);
  if (liste.length === 0) {
    console.log("aucun candidat : rien a faire");
    return;
  }

  const demo = acs
    .filter((a) => (a.raw as Record<string, unknown> | null)?.demo === true)
    .sort((a, b) => a.externalId.localeCompare(b.externalId));
  console.log("offres de demo:", demo.map((d) => d.externalId).join(", "));

  for (let i = 0; i < demo.length; i++) {
    const d = demo[i];
    const c = liste[i % liste.length];
    const [aff, exemple] = c;
    const raw = {
      ...(d.raw as Record<string, unknown>),
      affiliate_id: aff,
      campaign_id: String(exemple.campaign_id),
    };
    console.log(`${d.externalId} : affiliate_id -> ${aff} | campaign_id -> ${String(exemple.campaign_id)}`);
    await prisma.affiliateCampaign.update({ where: { id: d.id }, data: { raw } });
  }
  console.log("mise a jour terminee");
}
main().then(() => process.exit(0));
