const base = (process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
const key = process.env.LINKAFFI_API_KEY ?? "";
const anon = process.env.LINKAFFI_ANON_KEY ?? "";
async function main() {
  const res = await fetch(`${base}/stats?limit=5000&offset=0`, {
    headers: { "x-api-key": key, apikey: anon, accept: "application/json" },
  });
  const j = (await res.json()) as { total: number; rows: Record<string, unknown>[] };
  const aff = [...new Set(j.rows.map((r) => String(r.affiliate_id)))];
  const camp = [...new Set(j.rows.map((r) => String(r.campaign_id)))];
  const casino = [...new Set(j.rows.map((r) => String(r.casino_id)))];
  console.log("total lignes stats:", j.total);
  console.log("affiliate_id distincts:", aff);
  console.log("campaign_id distincts:", camp);
  console.log("casino_id distincts:", casino);
  console.log("exemple de ligne:", JSON.stringify(j.rows[0]));
}
main().then(() => process.exit(0));
