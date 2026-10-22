import { prisma } from "@linkaffipro/db";

const base = (process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
const key = process.env.LINKAFFI_API_KEY ?? "";
const anon = process.env.LINKAFFI_ANON_KEY ?? "";

async function main() {
  console.log("base:", base || "(vide)", "| key:", key ? "presente" : "(vide)", "| anon:", anon ? "presente" : "(vide)");

  const [campaigns, withPlayers, withClicks] = await Promise.all([
    prisma.campaign.findMany({ select: { affiliateCampaignIds: true } }),
    prisma.player.groupBy({ by: ["affiliateCampaignId"], where: { clickId: { not: null } } }),
    prisma.trackingLink.findMany({
      where: {
        kind: "OFFER",
        affiliateCampaignId: { not: null },
        clickRecords: { some: { subId: { not: null }, isBot: false } },
      },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);

  const ids = new Set<string>();
  for (const c of campaigns) for (const id of ((c.affiliateCampaignIds as string[] | null) ?? [])) ids.add(id);
  for (const p of withPlayers) if (p.affiliateCampaignId) ids.add(p.affiliateCampaignId);
  for (const l of withClicks) if (l.affiliateCampaignId) ids.add(l.affiliateCampaignId);
  console.log("affiliateCampaignIds retenus:", ids.size, [...ids]);

  const offers = await prisma.affiliateCampaign.findMany({
    where: { id: { in: [...ids] } },
    select: { raw: true },
  });
  const affIds = [...new Set(offers.map((o) => (o.raw as Record<string, unknown> | null)?.affiliate_id).filter((v): v is string => typeof v === "string" && v.length > 0))];
  console.log("affiliate_id (raw) retenus:", affIds.length, affIds);

  const essais: Record<string, string>[] = [];
  for (const aff of affIds) {
    essais.push({ "eq.affiliate_id": aff, date_col: "date", from: "2026-10-15", order: "date" });
    essais.push({ "eq.affiliate_id": aff, date_col: "created_at", from: "2026-10-15", order: "created_at" });
    essais.push({ "eq.affiliate_id": aff });
  }
  essais.push({ date_col: "date", from: "2026-10-15", order: "date" });

  for (const e of essais) {
    const params = new URLSearchParams({ ...e, limit: "5000", offset: "0" });
    const url = `${base}/stats?${params.toString()}`;
    const res = await fetch(url, {
      headers: { "x-api-key": key, apikey: anon, accept: "application/json" },
    });
    const txt = await res.text();
    console.log(`\n[${res.status}] ${url}`);
    if (!res.ok) console.log("   BODY:", txt.slice(0, 400));
    else console.log("   total:", (JSON.parse(txt) as { total?: number }).total);
    await new Promise((r) => setTimeout(r, 1100));
  }
}
main().then(() => process.exit(0));
