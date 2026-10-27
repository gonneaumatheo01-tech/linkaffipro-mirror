/**
 * Phase 31, chantier D — lectures de Kevin sur les prospects (aucune IA, chiffres lus en base) : canal par son nom,
 * filtres (« prospects FR casino libres », « les A sans concurrent », « ceux qui vendent de la pub en Espagne »),
 * fiche lisible, relances, chiffres du pipeline, offres. Les canaux hors Europe (`NON_EU`) n'apparaissent jamais, sauf
 * périmètre élargi par le client. LECTURE SEULE.
 */
import { esc, nowOf } from "../admin/journal";
import { parisDay, parisDayStart } from "../rules/time";
import { PROSPECTION_SETTINGS, type ProspectionDeps, type ProspectStatus, type ProspectVertical } from "./contract";
import { boolSetting, loadCountriesScope, loadScoreSettings, numberSetting, objectOf, regionVisible, stringArray } from "./score/settings";
import { BREAKDOWN_WORDS, COMPETITION_WORDS, compactNumber, countryLabel, dealText, pct, plural, PROSPECT_STATUS_WORDS, usernameOf, VERTICAL_WORDS } from "./kevin-texts";

export type ProspectRow = {
  id: string;
  username: string | null;
  channelUrl: string;
  title: string;
  kind: string;
  vertical: ProspectVertical;
  verticalDetails: unknown;
  contentType: string | null;
  language: string | null;
  countries: unknown;
  region: string;
  regulatoryFlag: string | null;
  subscribers: number | null;
  medianViews: number | null;
  viewRate: number | null;
  monetization: unknown;
  brands: unknown;
  hasCompetitor?: boolean;
  competitiveState: string | null;
  contactConfidence: string;
  bestContact: string | null;
  score: number | null;
  scoreBreakdown: unknown;
  tier: string | null;
  tierReason: string | null;
  dossier: string | null;
  status: ProspectStatus;
  statusChangedAt: Date | null;
  presentedAt: Date | null;
  snoozedUntil: Date | null;
  contactedAt: Date | null;
  respondedAt: Date | null;
  signedAt: Date | null;
  dealType: string | null;
  dealTerms: unknown;
  sourceType: string;
  discoveredAt: Date;
  fakeFlags: unknown;
  riskFlags: unknown;
  enrichError?: string | null;
  enrichAttempts?: number;
  nextEnrichAt?: Date | null;
  priority?: number;
};

export type OfferRow = { id: string; brand: string; vertical: ProspectVertical; countries: unknown; dealTypes: unknown; isActive: boolean; createdAt: Date };

export const PIPELINE_STATUSES: readonly ProspectStatus[] = ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE"];

export async function prospectionEnabled(deps: Pick<ProspectionDeps, "prisma">): Promise<boolean> {
  return boolSetting(deps, PROSPECTION_SETTINGS.enabled.key, PROSPECTION_SETTINGS.enabled.value);
}

export const handle = (p: Pick<ProspectRow, "username" | "title">): string => (p.username ? `@${p.username}` : (p.title || "canal sans nom").slice(0, 60));

/** Canal par son nom (`@x`, `t.me/x`) ou, à défaut, par son titre (une seule correspondance). */
export async function findProspect(deps: Pick<ProspectionDeps, "prisma">, raw: string | null | undefined): Promise<ProspectRow | null> {
  const name = usernameOf(raw);
  if (name) {
    const p = (await deps.prisma.prospect.findFirst({ where: { username: name } })) as ProspectRow | null;
    if (p) return p;
  }
  const t = (raw ?? "").trim();
  if (t.length < 3) return null;
  const rows = (await deps.prisma.prospect.findMany({ where: { title: { contains: t, mode: "insensitive" } } as never, take: 2 })) as ProspectRow[];
  return rows.length === 1 ? rows[0]! : null;
}

export type ProspectFilter = {
  countries: string[];
  vertical: "CASINO" | "SPORTS" | null;
  tiers: string[];
  competition: string[];
  openness: Array<"ads" | "vip" | "affiliate" | "marketplace">;
  withContact: boolean;
  subtypes: string[];
  sort: "score" | "audience";
  statuses: ProspectStatus[];
};

export const emptyFilter = (): ProspectFilter => ({ countries: [], vertical: null, tiers: [], competition: [], openness: [], withContact: false, subtypes: [], sort: "score", statuses: ["QUALIFIED"] });

function opennessOk(p: ProspectRow, wanted: ProspectFilter["openness"]): boolean {
  if (!wanted.length) return true;
  const m = objectOf(p.monetization);
  return wanted.every((w) => (w === "ads" ? m.sellsAds === true : w === "vip" ? m.sellsVip === true : w === "affiliate" ? m.pushesAffiliate === true : typeof m.marketplaceListing === "string" && m.marketplaceListing.length > 0));
}

function subtypesOk(p: ProspectRow, wanted: string[]): boolean {
  if (!wanted.length) return true;
  const d = objectOf(p.verticalDetails);
  const all = [...stringArray(d.sports), ...stringArray(d.casino), p.contentType ?? ""].map((s) => s.toLowerCase());
  return wanted.some((w) => all.some((s) => s.includes(w)));
}

/** Prospects visibles qui passent le filtre, triés (niveau puis score, ou vues médianes). */
export async function queryProspects(deps: Pick<ProspectionDeps, "prisma">, f: ProspectFilter): Promise<ProspectRow[]> {
  const scope = await loadCountriesScope(deps);
  const rows = (await deps.prisma.prospect.findMany({
    where: { status: { in: [...f.statuses] }, ...(f.tiers.length ? { tier: { in: f.tiers } } : {}) } as never,
    orderBy: [{ score: "desc" }],
    take: 3000,
  })) as ProspectRow[];
  const out = rows.filter((p) => {
    if (!regionVisible(p, scope)) return false;
    const countries = stringArray(p.countries).map((c) => c.toUpperCase());
    if (f.countries.length && !f.countries.includes(countries[0] ?? "")) return false;
    if (f.vertical && p.vertical !== f.vertical && p.vertical !== "BOTH") return false;
    if (f.competition.length && !f.competition.includes(p.competitiveState ?? "")) return false;
    if (f.withContact && (p.contactConfidence === "NONE" || !p.bestContact)) return false;
    return opennessOk(p, f.openness) && subtypesOk(p, f.subtypes);
  });
  const tierRank = (t: string | null) => (t ? "ABCD".indexOf(t) : 9);
  return out.sort((a, b) =>
    f.sort === "audience" ? (b.medianViews ?? 0) - (a.medianViews ?? 0) : tierRank(a.tier) - tierRank(b.tier) || (b.score ?? 0) - (a.score ?? 0),
  );
}

/** « A · @nom — France, casino, 2,1k vues/post, aucune marque, contact @x ». */
export function prospectLine(p: ProspectRow): string {
  const country = stringArray(p.countries)[0];
  const parts = [
    country ? countryLabel(country) : null,
    VERTICAL_WORDS[p.vertical] ?? null,
    p.medianViews !== null ? `${compactNumber(p.medianViews)} vues/post` : null,
    p.competitiveState ? (COMPETITION_WORDS[p.competitiveState] ?? null) : null,
    p.bestContact ? `contact ${p.bestContact}` : "sans contact",
  ].filter((x): x is string => !!x);
  return esc(`${p.tier ?? "?"} · ${handle(p)} — ${parts.join(", ")}`);
}

function brandsText(v: unknown): string | null {
  const list = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  const names = list
    .filter((b) => typeof b?.brand === "string")
    .slice(0, 4)
    .map((b) => `${b.brand as string}${typeof b.promoCode === "string" && b.promoCode ? ` (code ${b.promoCode})` : ""}`);
  return names.length ? names.join(", ") : null;
}

/** Fiche lisible d'un prospect (détail demandé : longue permise). */
export async function prospectDetailLines(deps: Pick<ProspectionDeps, "prisma">, p: ProspectRow): Promise<string[]> {
  const s = await loadScoreSettings(deps);
  const max: Record<string, number> = { ...s.weights };
  const b = objectOf(p.scoreBreakdown);
  const breakdown = BREAKDOWN_WORDS.filter(([k]) => typeof b[k] === "number")
    .map(([k, label]) => (k === "penalties" ? `${label} ${(b[k] as number) < 0 ? "−" : ""}${Math.abs(b[k] as number)}` : `${label} ${b[k] as number}/${max[k] ?? "?"}`))
    .join(", ");
  const country = stringArray(p.countries);
  const m = objectOf(p.monetization);
  const money = [m.sellsAds === true ? `vend de la pub${typeof m.adPrice === "string" ? ` (${m.adPrice})` : ""}` : null, m.sellsVip === true ? `VIP${typeof m.vipPrice === "string" ? ` ${m.vipPrice}` : ""}` : null, m.pushesAffiliate === true ? "pousse des liens d'affiliation" : null].filter(Boolean);
  const lines = [
    `${handle(p)}${p.username && p.title ? ` (${p.title.slice(0, 60)})` : ""} : ${p.tier ? `niveau ${p.tier}, ` : ""}${p.score !== null ? `${p.score}/100, ` : ""}${PROSPECT_STATUS_WORDS[p.status] ?? "à voir"}.`,
    p.tierReason ? `Pourquoi : ${p.tierReason}` : null,
    breakdown ? `Score : ${breakdown}.` : null,
    [country.length ? country.map(countryLabel).join(", ") : null, VERTICAL_WORDS[p.vertical], p.subscribers !== null ? `${compactNumber(p.subscribers)} abonnés` : null, p.medianViews !== null ? `${compactNumber(p.medianViews)} vues par post (${pct(p.viewRate)})` : null].filter(Boolean).join(", ") + ".",
    brandsText(p.brands) ? `Marques : ${brandsText(p.brands)}${p.competitiveState ? `, ${COMPETITION_WORDS[p.competitiveState] ?? ""}` : ""}.` : null,
    money.length ? `Argent : ${money.join(", ")}.` : null,
    p.bestContact ? `Contact : ${p.bestContact}.` : "Pas de contact public trouvé.",
    p.dealType ? `Deal : ${dealText(objectOf(p.dealTerms).cpa !== undefined || objectOf(p.dealTerms).revshare !== undefined ? p.dealTerms : {})}.` : null,
    p.dossier ? `Dossier :\n${p.dossier}` : null,
    p.channelUrl,
  ];
  return lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0 && l !== ".").map(esc);
}

/** Relances dues : contactés sans réponse depuis `reminder_days`, négos qui traînent depuis `negotiation_reminder_days`. */
export async function relancesDue(deps: Pick<ProspectionDeps, "prisma" | "now">): Promise<Array<{ p: ProspectRow; kind: "contacted" | "negotiating"; days: number }>> {
  const now = nowOf(deps);
  const [rd, nd] = await Promise.all([
    numberSetting(deps, PROSPECTION_SETTINGS.reminderDays.key, PROSPECTION_SETTINGS.reminderDays.value),
    numberSetting(deps, PROSPECTION_SETTINGS.negotiationReminderDays.key, PROSPECTION_SETTINGS.negotiationReminderDays.value),
  ]);
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: ["CONTACTED", "NEGOTIATING"] } } as never, take: 500 })) as ProspectRow[];
  const out: Array<{ p: ProspectRow; kind: "contacted" | "negotiating"; days: number }> = [];
  for (const p of rows) {
    if (p.snoozedUntil && p.snoozedUntil > now) continue;
    const since = p.status === "CONTACTED" ? (p.contactedAt ?? p.statusChangedAt) : p.statusChangedAt;
    if (!since) continue;
    const days = Math.floor((now.getTime() - since.getTime()) / 86400_000);
    if (p.status === "CONTACTED" && days >= rd && !p.respondedAt) out.push({ p, kind: "contacted", days });
    if (p.status === "NEGOTIATING" && days >= nd) out.push({ p, kind: "negotiating", days });
  }
  return out.sort((a, b) => b.days - a.days);
}

export function relanceLine(r: { p: ProspectRow; kind: "contacted" | "negotiating"; days: number }): string {
  return esc(`${handle(r.p)} : ${r.kind === "contacted" ? `contacté il y a ${plural(r.days, "jour")}, pas de réponse` : `en négo depuis ${plural(r.days, "jour")}`}${r.p.bestContact ? ` (${r.p.bestContact})` : ""}`);
}

export type ProspectionStatsFacts = {
  aContacter: number;
  parNiveau: Record<string, number>;
  contactes: number;
  repondu: number;
  enNego: number;
  signes: number;
  actifs: number;
  signesCeMois: number;
  tauxDeReponse: number | null;
  trouves7Jours: number;
  qualifies7Jours: number;
};

/** Chiffres du pipeline (visibles seulement), lus en base. */
export async function prospectionStats(deps: Pick<ProspectionDeps, "prisma" | "now">): Promise<ProspectionStatsFacts> {
  const now = nowOf(deps);
  const scope = await loadCountriesScope(deps);
  const rows = ((await deps.prisma.prospect.findMany({ take: 20000 })) as ProspectRow[]).filter((p) => regionVisible(p, scope));
  const monthStart = parisDayStart(`${parisDay(now).slice(0, 7)}-01`);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const by = (s: ProspectStatus) => rows.filter((p) => p.status === s).length;
  const parNiveau: Record<string, number> = {};
  for (const p of rows) if (p.status === "QUALIFIED" && p.tier) parNiveau[p.tier] = (parNiveau[p.tier] ?? 0) + 1;
  const contacted = rows.filter((p) => p.contactedAt).length;
  const responded = rows.filter((p) => p.contactedAt && p.respondedAt).length;
  return {
    aContacter: by("QUALIFIED"),
    parNiveau,
    contactes: by("CONTACTED"),
    repondu: by("RESPONDED"),
    enNego: by("NEGOTIATING"),
    signes: by("SIGNED"),
    actifs: by("ACTIVE"),
    signesCeMois: rows.filter((p) => p.signedAt && p.signedAt >= monthStart).length,
    tauxDeReponse: contacted ? Math.round((responded / contacted) * 100) : null,
    trouves7Jours: rows.filter((p) => p.discoveredAt >= week).length,
    qualifies7Jours: rows.filter((p) => p.discoveredAt >= week && ["QUALIFIED", ...PIPELINE_STATUSES].includes(p.status)).length,
  };
}

export function statsLines(f: ProspectionStatsFacts): string[] {
  const tiers = ["A", "B", "C"].filter((t) => f.parNiveau[t]).map((t) => `${f.parNiveau[t]} ${t}`);
  return [
    `${plural(f.aContacter, "canal à contacter", "canaux à contacter")}${tiers.length ? ` (${tiers.join(", ")})` : ""}.`,
    `En cours : ${f.contactes} contactés, ${f.repondu} qui ont répondu, ${f.enNego} en négo.`,
    `${plural(f.signes + f.actifs, "signé", "signés")} en tout, dont ${f.actifs} qui ${f.actifs > 1 ? "produisent" : "produit"} déjà. Ce mois-ci : ${plural(f.signesCeMois, "signature")}.`,
    f.tauxDeReponse !== null ? `Taux de réponse : ${f.tauxDeReponse} % des canaux contactés.` : "Aucun canal contacté pour l'instant.",
    `Ces 7 jours : ${plural(f.trouves7Jours, "canal trouvé", "canaux trouvés")}, ${plural(f.qualifies7Jours, "bon à contacter", "bons à contacter")}.`,
  ].map(esc);
}

export async function activeOffers(deps: Pick<ProspectionDeps, "prisma">): Promise<OfferRow[]> {
  return (await deps.prisma.affiliateOffer.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } })) as OfferRow[];
}

export function offerLine(o: OfferRow): string {
  const countries = stringArray(o.countries);
  return esc(`${o.brand} — ${VERTICAL_WORDS[o.vertical] ?? "casino et paris"}, ${countries.length ? countries.map(countryLabel).join(", ") : "pays à préciser"}, ${dealText(o.dealTypes)}`);
}
