/**
 * Phase 31, chantier C — carte d'un prospect dans le Top du jour (section 5 du prompt), pure :
 *
 *   Niveau A · 🇫🇷 @nom — Paris sportifs — 2,1k vues/post (12 % des 17k abonnés)
 *   Pousse 1xbet (code XYZ) depuis 4 mois · vend ses posts 40 € · VIP 29 €/mois
 *   Contact : @admin_pub (pub, sûr) · site : xxx.fr
 *   Pourquoi : audience FR réelle, concurrent rotatif, contact direct — colle à l'offre Winamax (CPA 100 €)
 *   À vérifier : 1 signal de faux · règle du pays
 *
 * Écart voulu avec le gabarit du prompt : pas d'emoji 🅰️ ni ⚠️ (la voix de Kevin permet UN emoji par message, le
 * drapeau ; « Niveau A » et « À vérifier » disent la même chose en mots).
 */
import { esc } from "../../admin/journal";
import type { AdminButton } from "../../types";
import { PROSPECT_CALLBACK_PREFIX, type ContactConfidence, type FakeFlag, type ProspectAction, type RiskFlag } from "../contract";
import { CONTACT_CONFIDENCE_LABELS, FAKE_FLAG_LABELS, RISK_FLAG_LABELS, VERTICAL_LABELS, flagOf, formatCount, formatEur, formatPct, handleOf } from "../score/format";
import { DAY_MS, objectOf, stringArray } from "../score/settings";
import type { ContactRow, OfferRow, ProspectRow } from "../score/store";

const NBSP = "\u00a0";

/** Libellés des boutons (pas des phrases de Kevin). */
export const PROSPECT_BUTTONS = {
  contacted: "✅ Contacté",
  signed: "🤝 Signé",
  dossier: "🔎 Dossier",
  later: "⏰ Plus tard",
  no: "❌ Pas intéressé",
  deal_cpa: "CPA",
  deal_revshare: "Revshare",
  deal_hybrid: "Hybride",
  relaunched: "✅ Relancé",
  snooze3: "⏰ 3 jours",
  abandon: "❌ Abandon",
} as const satisfies Record<ProspectAction, string>;

/** `prospect:<id>:<action>` (64 octets au plus : un cuid fait 25 caractères). */
export function prospectCallback(prospectId: string, action: ProspectAction): string {
  const data = `${PROSPECT_CALLBACK_PREFIX}${prospectId}:${action}`;
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error("callback_data trop long");
  return data;
}

export function parseProspectCallback(data: string): { prospectId: string; action: ProspectAction } | null {
  if (!data.startsWith(PROSPECT_CALLBACK_PREFIX)) return null;
  const m = /^prospect:([A-Za-z0-9_-]{1,40}):([a-z0-9_]{1,20})$/.exec(data);
  if (!m || !(m[2]! in PROSPECT_BUTTONS)) return null;
  return { prospectId: m[1]!, action: m[2] as ProspectAction };
}

const button = (id: string, action: ProspectAction): AdminButton => ({ text: PROSPECT_BUTTONS[action], callbackData: prospectCallback(id, action) });

export function prospectCardButtons(prospectId: string): AdminButton[][] {
  return [
    [button(prospectId, "contacted"), button(prospectId, "signed"), button(prospectId, "dossier")],
    [button(prospectId, "later"), button(prospectId, "no")],
  ];
}

export function dealButtons(prospectId: string): AdminButton[][] {
  return [[button(prospectId, "deal_cpa"), button(prospectId, "deal_revshare"), button(prospectId, "deal_hybrid")]];
}

export function contactedReminderButtons(prospectId: string): AdminButton[][] {
  return [[button(prospectId, "relaunched"), button(prospectId, "snooze3"), button(prospectId, "abandon")]];
}

export function negotiationReminderButtons(prospectId: string): AdminButton[][] {
  return [[button(prospectId, "signed"), button(prospectId, "snooze3"), button(prospectId, "abandon")]];
}

/** Offre en mots : « CPA 100 € », « revshare 30 % », « hybride 50 € + 15 % ». */
export function dealText(dealTypes: unknown): string | null {
  const d = objectOf(dealTypes);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const parts: string[] = [];
  const cpa = num(d.cpa);
  const rs = num(d.revshare);
  if (cpa !== null) parts.push(`CPA ${formatEur(cpa)}`);
  if (rs !== null) parts.push(`revshare ${rs}${NBSP}%`);
  const h = objectOf(d.hybrid);
  const hc = num(h.cpa);
  const hr = num(h.revshare);
  if (hc !== null && hr !== null) parts.push(`hybride ${formatEur(hc)} + ${hr}${NBSP}%`);
  return parts.length ? parts.join(" ou ") : null;
}

/** Ligne d'audience : « 2,1k vues/post (12 % des 17k abonnés) ». */
export function audienceText(p: Pick<ProspectRow, "medianViews" | "subscribers" | "viewRate" | "kind">): string {
  const who = p.kind === "GROUP" ? "membres" : "abonnés";
  if (p.medianViews === null) return p.subscribers !== null ? `aperçu fermé, ${formatCount(p.subscribers)} ${who}` : "aperçu fermé";
  const rate = p.viewRate ?? (p.subscribers ? p.medianViews / p.subscribers : null);
  if (p.subscribers === null || rate === null) return `${formatCount(p.medianViews)} vues/post`;
  return `${formatCount(p.medianViews)} vues/post (${formatPct(rate)} des ${formatCount(p.subscribers)} ${who})`;
}

function monthsSince(iso: unknown, now: Date): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / (30 * DAY_MS))) : null;
}

/** Ligne « ce qu'il pousse et comment il gagne de l'argent ». */
export function moneyText(p: Pick<ProspectRow, "brands" | "monetization" | "competitiveState">, now: Date): string {
  const parts: string[] = [];
  const brands = (Array.isArray(p.brands) ? (p.brands as Array<Record<string, unknown>>) : []).filter((b) => typeof b.brand === "string");
  const rank: Record<string, number> = { HEAVY: 0, MEDIUM: 1, LIGHT: 2 };
  brands.sort((a, b) => (rank[String(a.intensity)] ?? 3) - (rank[String(b.intensity)] ?? 3));
  const top = brands[0];
  if (top) {
    const months = monthsSince(top.firstSeenAt, now);
    const since = months === null ? "" : months < 1 ? " depuis moins d'un mois" : ` depuis ${months} mois`;
    const promo = typeof top.promoCode === "string" && top.promoCode ? ` (code ${top.promoCode})` : "";
    const more = brands.length > 1 ? ` et ${brands.length - 1} autre${brands.length > 2 ? "s" : ""} marque${brands.length > 2 ? "s" : ""}` : "";
    parts.push(`Pousse ${top.brand}${promo}${since}${more}`);
  } else parts.push(p.competitiveState === "OURS" ? "Pousse déjà une de nos marques" : "Aucune marque repérée");
  const m = objectOf(p.monetization);
  if (m.sellsAds === true) parts.push(typeof m.adPrice === "string" && m.adPrice ? `vend ses posts ${m.adPrice}` : "vend de la pub");
  if (m.sellsVip === true) parts.push(typeof m.vipPrice === "string" && m.vipPrice ? `VIP ${m.vipPrice}` : "vend un VIP");
  if (!m.sellsAds && typeof m.marketplaceListing === "string" && m.marketplaceListing) parts.push("fiche sur une place de marché de pub");
  return parts.join(" · ");
}

export function contactText(contacts: readonly ContactRow[], bestContact: string | null): string {
  const best = contacts.find((c) => c.value === bestContact) ?? contacts.find((c) => c.type !== "WEBSITE") ?? contacts[0] ?? null;
  if (!best && !bestContact) return "Contact : aucun trouvé, regarde la description du canal";
  const parts: string[] = [];
  if (best) {
    const conf = CONTACT_CONFIDENCE_LABELS[best.confidence as ContactConfidence] ?? "";
    const label = [best.label?.trim(), conf].filter(Boolean).join(", ");
    parts.push(`${best.value}${label ? ` (${label})` : ""}`);
  } else if (bestContact) parts.push(bestContact);
  const site = contacts.find((c) => c.type === "WEBSITE" && c.value !== best?.value);
  if (site) parts.push(`site : ${site.value.replace(/^https?:\/\//, "").replace(/\/$/, "")}`);
  return `Contact : ${parts.join(" · ")}`;
}

export function whyText(p: ProspectRow, offer: OfferRow | null): string {
  const reasons: string[] = [];
  const country = stringArray(p.countries)[0]?.toUpperCase();
  if (p.authenticity === "REAL") reasons.push(country ? `audience ${country} réelle` : "audience réelle");
  if (p.viewRate !== null && p.viewRate >= 0.2) reasons.push("fort taux de vue");
  const comp: Record<string, string> = { FREE: "aucune marque en place", ROTATING: "concurrent rotatif", EXCLUSIVE: "déjà exclusif ailleurs", OURS: "pousse déjà une de nos marques" };
  if (p.competitiveState && comp[p.competitiveState]) reasons.push(comp[p.competitiveState]!);
  if (p.contactConfidence === "HIGH") reasons.push("contact direct");
  const m = objectOf(p.monetization);
  if (m.sellsAds === true && reasons.length < 3) reasons.push("vend déjà de la pub");
  let line = `Pourquoi : ${reasons.slice(0, 3).join(", ") || "bon score global"}`;
  if (offer) {
    const deal = dealText(offer.dealTypes);
    line += ` — colle à l'offre ${offer.brand}${deal ? ` (${deal})` : ""}`;
  }
  return line;
}

export function warningText(p: ProspectRow): string | null {
  const w: string[] = [];
  const fakes = stringArray(p.fakeFlags) as FakeFlag[];
  if (fakes.length === 1) w.push(`1 signal de faux (${FAKE_FLAG_LABELS[fakes[0]!] ?? "à vérifier"})`);
  else if (fakes.length > 1) w.push(`${fakes.length} signaux de faux`);
  if (p.region === "UNKNOWN") w.push("pays à vérifier");
  if (p.regulatoryFlag) {
    const c = stringArray(p.countries)[0]?.toUpperCase();
    w.push(c ? `règle ${c} à vérifier` : "règle du pays à vérifier");
  }
  if (p.authenticity === "SUSPECT_GENERIC") w.push("contenu assez générique");
  for (const r of stringArray(p.riskFlags) as RiskFlag[]) if (r !== "SCAM_FIXED_MATCHES" && RISK_FLAG_LABELS[r]) w.push(RISK_FLAG_LABELS[r]);
  return w.length ? `À vérifier : ${[...new Set(w)].join(" · ")}` : null;
}

/** Carte HTML d'un prospect (échappée). */
export function renderProspectCard(p: ProspectRow, contacts: readonly ContactRow[], offer: OfferRow | null, now: Date): string {
  const flag = flagOf(stringArray(p.countries)[0]);
  const name = esc(handleOf(p));
  const link = p.channelUrl ? `<a href="${esc(p.channelUrl)}">${name}</a>` : name;
  const lines = [
    `Niveau ${p.tier ?? "?"} · ${flag ? `${flag} ` : ""}${link} — ${VERTICAL_LABELS[p.vertical] ?? "Autre"} — ${esc(audienceText(p))}`,
    esc(moneyText(p, now)),
    esc(contactText(contacts, p.bestContact)),
    esc(whyText(p, offer)),
  ];
  const warn = warningText(p);
  if (warn) lines.push(esc(warn));
  return lines.join("\n");
}

/** Prospect d'exemple (tests de la voix, captures). */
export function sampleProspect(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "pr_exemple",
    username: "pronos_fr",
    channelUrl: "https://t.me/pronos_fr",
    kind: "CHANNEL",
    title: "Pronos FR",
    summaryFr: "Pronostics foot quotidiens.",
    vertical: "SPORTS",
    verticalDetails: { sports: ["foot"], casino: [] },
    contentType: "tips_free",
    language: "fr",
    countries: ["FR"],
    region: "EU",
    regulatoryFlag: null,
    subscribers: 17_000,
    postsPerDay: 4,
    medianViews: 2100,
    avgViews: 2300,
    viewRate: 0.12,
    reactionRate: 0.01,
    commentRate: null,
    lastPostAt: new Date("2026-10-25T10:00:00Z"),
    firstSeenPostAt: new Date("2026-07-25T10:00:00Z"),
    authenticity: "REAL",
    authenticityReason: "voix propre",
    fakeFlags: [],
    riskFlags: [],
    monetization: { sellsAds: true, adPrice: "40 €", sellsVip: true, vipPrice: "29 €/mois", pushesAffiliate: true },
    brands: [{ brand: "1xbet", promoCode: "XYZ", firstSeenAt: "2026-06-20", lastSeenAt: "2026-10-24", intensity: "HEAVY", links: 7 }],
    competitiveState: "ROTATING",
    contactConfidence: "HIGH",
    bestContact: "@admin_pub",
    score: 78,
    scoreBreakdown: { audience: 21, engagement: 9, fit: 20, openness: 14, competition: 8, reach: 10, penalties: 0 },
    tier: "A",
    tierReason: "2,1k vues/post, FR, pousse 1xbet (rotatif), contact pub : @admin_pub — A",
    dossier: null,
    dossierAt: null,
    matchedOfferId: null,
    status: "QUALIFIED",
    statusChangedAt: null,
    presentedAt: null,
    snoozedUntil: null,
    contactedAt: null,
    respondedAt: null,
    signedAt: null,
    dealType: null,
    dealTerms: null,
    sourceType: "GRAPH_FORWARD",
    cocitationCount: 3,
    discoveredAt: new Date("2026-10-20T10:00:00Z"),
    enrichedAt: new Date("2026-10-20T11:00:00Z"),
    ...over,
  };
}
