/**
 * Phase 32, chantier C — ce que Kevin dit et fait pour la prospection avancée (lectures, boutons, chemin rapide,
 * recherche par compte réel). Les entrées du catalogue (`boss/catalog-prospection-advanced.ts`) et les capacités des
 * ordres (`orders/capabilities/prospection-advanced.ts`) appellent ces fonctions.
 *
 * - Alertes du Veilleur : liste (« alertes du jour », « qui a lâché son bookmaker ? », « canaux en hausse »), coupure
 *   d'un type (« plus d'alertes de ce type ») ; boutons `pra:<alerte>:<action>` → `handleAlertCallback` du chantier A
 *   (socle) ; la réponse au « 📝 Note » est prise ici par le chemin rapide (`Setting prospection.alert_note.<chat>`).
 * - Réseaux, valeur estimée (toujours une fourchette, « estimation non calibrée » tant que rien n'est calibré),
 *   affiliés signés et leurs vrais résultats Link Affi, estimé contre réel, calibrage (choix numérotés, annulable).
 * - « @x = affilié 1234 » : rattachement Link Affi par le chemin rapide (lecture seule chez Link Affi : rien n'y est écrit).
 * - Recherche par compte réel : proposée UNE fois (`ACCOUNT_SEARCH.offeredKey`), activée seulement par un OUI
 *   (confirmation de Kevin, phases 25/26), coupée d'un mot. Rien ne rejoint ni n'écrit.
 * Kevin n'écrit qu'à l'admin ou au groupe de l'équipe ; personne d'autre n'est jamais contacté.
 */
import { adminTelegramId, agentAudit, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import { createBossPending, readBossPending, rememberBossPendingMessage } from "../boss/confirm";
import type { BossDeps, BossReply, BossTeamInput } from "../boss/contract";
import { pick } from "../boss/voice";
import { prospectionAdvancedPort } from "./advanced-port";
import { answerPendingAlertNote } from "./watch/index";
import { answerLinkChoice } from "./learn/index";
import { ALERT_CALLBACK_PREFIX, ACCOUNT_SEARCH, type ProspectAlertKind, type ValueEstimate } from "./contract-advanced";
import { accountSearchEnabled, readAccountSearchCounters, requestsToday, setAccountSearchEnabled } from "./discover/sources/account-search";
import { mayChangePipeline } from "./kevin-buttons";
import { prospectionAdvancedKevinPort, estimateOf, type AlertRow, type ProspectionAdvancedKevinDeps } from "./kevin-advanced-port";
import { PROSPECTION_ADVANCED_KEVIN_VARIANTS as A } from "./kevin-advanced-texts";
import type { ProspectCallbackOutcome, ProspectionKevinDeps } from "./kevin-port";
import { findProspect, handle, type ProspectRow } from "./kevin-read";
import { compactNumber, PROSPECT_STATUS_WORDS, PROSPECTION_KEVIN_VARIANTS as V, plural, usernameOf } from "./kevin-texts";

type D = ProspectionAdvancedKevinDeps;
/** Nom affiché d'un canal (titre absent toléré). */
const nameOf = (p: { username: string | null; title: string | null }) => handle({ username: p.username, title: p.title ?? "" });
const LIST_MAX = 10;

// ------------------------------------------------------------------------------------------------ alertes

/** Ce que dit chaque type d'alerte, en français courant (jamais le nom du code). */
export const ALERT_KIND_WORDS: Readonly<Record<ProspectAlertKind, string>> = {
  AFFILIATE_DROPPED: "a lâché sa marque",
  NEW_AFFILIATE: "pousse une nouvelle marque",
  AFFILIATE_SWITCHED: "a changé de marque",
  GROWTH_SPIKE: "canal en forte hausse",
  DECLINE: "canal en baisse",
  WENT_SILENT: "ne poste plus",
  STARTED_SELLING_ADS: "vend maintenant de la pub",
  MARKETPLACE_LISTED: "en vente sur une place de marché de pub",
  CONTACT_CHANGED: "contact changé",
  TIER_UP: "monte de niveau",
  TIER_DOWN: "descend de niveau",
  AFFILIATE_NOT_POSTING: "signé, mais ne poste pas tes liens",
  AFFILIATE_PUSHES_COMPETITOR: "pousse aussi un concurrent",
  AFFILIATE_RISKY_CLAIM: "phrase à risque",
  AFFILIATE_SILENT: "affilié signé devenu silencieux",
};

const KIND_PATTERNS: Array<[RegExp, ProspectAlertKind[]]> = [
  [/lach|abandonn|bookmaker|plus de marque|ne pousse plus/, ["AFFILIATE_DROPPED"]],
  [/hausse|monte(nt)?\b|montante|etoile|grossi|croissance|decoll/, ["GROWTH_SPIKE"]],
  [/baisse|declin|chute|recul/, ["DECLINE"]],
  [/nouvelle marque|nouveau bookmaker|signe ailleurs|change de marque|changement de marque/, ["NEW_AFFILIATE", "AFFILIATE_SWITCHED"]],
  [/silen|ne poste plus|plus de post|inactif/, ["WENT_SILENT", "AFFILIATE_SILENT"]],
  [/\bpub\b|place de marche|vend/, ["STARTED_SELLING_ADS", "MARKETPLACE_LISTED"]],
  [/contact/, ["CONTACT_CHANGED"]],
  [/niveau/, ["TIER_UP", "TIER_DOWN"]],
  [/concurren/, ["AFFILIATE_PUSHES_COMPETITOR"]],
  [/risque|garanti|mineur|promesse/, ["AFFILIATE_RISKY_CLAIM"]],
  [/nos liens|mes liens|poste pas|ne poste pas/, ["AFFILIATE_NOT_POSTING"]],
];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'");

/** Types d'alerte cités dans une phrase (« plus d'alertes de hausse ») ; vide si rien de reconnu (pur). */
export function alertKindsOf(text: string | null | undefined): ProspectAlertKind[] {
  const t = fold(text ?? "");
  const out = new Set<ProspectAlertKind>();
  for (const [re, kinds] of KIND_PATTERNS) if (re.test(t)) for (const k of kinds) out.add(k);
  return [...out];
}

const numberIn = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Une ligne d'alerte (HTML échappé) : canal, ce qui change, chiffres mesurés, preuve courte. */
export function alertLine(a: AlertRow, name: string): string {
  const d = a.data;
  const brand = typeof d.brand === "string" ? d.brand : null;
  const days = numberIn(d.days);
  const before = numberIn(d.before);
  const after = numberIn(d.after);
  const parts = [ALERT_KIND_WORDS[a.kind as ProspectAlertKind] ?? "changement repéré"];
  if (brand) parts.push(brand);
  if (days !== null) parts.push(`depuis ${plural(days, "jour")}`);
  if (before !== null && after !== null) parts.push(`${compactNumber(before)} → ${compactNumber(after)}`);
  const evidence = a.evidence ? ` «\u00a0${a.evidence.split(/\s+/).slice(0, 15).join(" ")}\u00a0»` : "";
  return esc(`• ${name} : ${parts.join(", ")}${evidence}`);
}

async function namesOf(deps: D, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = (await deps.prisma.prospect.findMany({ where: { id: { in: [...new Set(ids)] } } as never, select: { id: true, username: true, title: true } as never })) as Array<{ id: string; username: string | null; title: string | null }>;
  return new Map(rows.map((r) => [r.id, nameOf(r)]));
}

export type AlertsFilter = "jour" | "lache" | "hausse" | "affilies" | "tout";

const FILTER_KINDS: Record<AlertsFilter, ProspectAlertKind[] | undefined> = {
  jour: undefined,
  tout: undefined,
  lache: ["AFFILIATE_DROPPED"],
  hausse: ["GROWTH_SPIKE"],
  affilies: ["AFFILIATE_NOT_POSTING", "AFFILIATE_PUSHES_COMPETITOR", "AFFILIATE_RISKY_CLAIM", "AFFILIATE_SILENT"],
};

/** Liste des alertes (lecture). « jour » : les dernières 24 heures. */
export async function alertsReply(deps: D, filter: AlertsFilter, chatId: string | null, pageUrl: string): Promise<BossReply> {
  const kinds = FILTER_KINDS[filter];
  let rows = await prospectionAdvancedKevinPort(deps).listAlerts(deps, { ...(kinds ? { kinds } : {}), status: ["NEW", "SENT", "SEEN"], limit: 50 });
  if (filter === "jour") {
    const since = nowOf(deps).getTime() - 24 * 3600_000;
    rows = rows.filter((a) => Math.max(a.createdAt.getTime(), a.sentAt?.getTime() ?? 0) >= since);
  }
  rows = rows.filter((a) => a.status !== "MUTED").sort((a, b) => b.strength - a.strength);
  if (!rows.length) {
    const none = filter === "lache" ? A.droppedNone : filter === "hausse" ? A.growthNone : A.alertsNone;
    return { reply: pick(none, `prospection.alerts.none.${filter}`, chatId) };
  }
  const names = await namesOf(deps, rows.map((a) => a.prospectId));
  const head = pick(A.alertsHead({ count: rows.length, what: filter === "jour" ? "du jour" : "" }), "prospection.alerts.head", chatId);
  const shown = rows.slice(0, LIST_MAX).map((a) => alertLine(a, names.get(a.prospectId) ?? "un canal"));
  const more = rows.length > LIST_MAX ? esc(pick(A.alertsMore({ more: rows.length - LIST_MAX, url: pageUrl }), "prospection.alerts.more", chatId)) : null;
  return { reply: [esc(head), ...shown, more].filter(Boolean).join("\n") };
}

/** Type d'alerte visé : dit dans la phrase, sinon celui de la dernière alerte envoyée. */
export async function alertKindsToMute(deps: D, said: string): Promise<ProspectAlertKind[]> {
  const kinds = alertKindsOf(said);
  if (kinds.length) return kinds;
  const last = (await prospectionAdvancedKevinPort(deps).listAlerts(deps, { status: ["SENT", "SEEN"], limit: 20 })).sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))[0];
  return last ? [last.kind as ProspectAlertKind] : [];
}

/** Coupe (ou remet) un ou plusieurs types d'alerte. */
export async function muteAlertsReply(deps: D, said: string, on: boolean, chatId: string | null): Promise<BossReply> {
  const kinds = await alertKindsToMute(deps, said);
  if (!kinds.length) return { reply: pick(A.muteNeedKind, "prospection.alerts.muteNeed", chatId) };
  const port = prospectionAdvancedKevinPort(deps);
  for (const k of kinds) {
    const r = on ? await port.unmuteAlertKind(deps, k, "client") : await port.muteAlertKind(deps, k, "client");
    if (!r) return { reply: pick(A.notReady, "prospection.notReady", chatId) };
    if (!r.ok) return { reply: esc(r.message ?? pick(A.notReady, "prospection.notReady", chatId)) };
  }
  const what = [...new Set(kinds.map((k) => ALERT_KIND_WORDS[k]))].join(", ");
  return { reply: esc(pick(on ? A.unmuted({ what }) : A.muted({ what }), `prospection.alerts.${on ? "unmuted" : "muted"}`, chatId)) };
}

// ------------------------------------------------------------------------------------------------ réseaux

export async function networkReply(deps: D, p: ProspectRow, chatId: string | null): Promise<BossReply> {
  const n = await prospectionAdvancedKevinPort(deps).networkOf(deps, p.id);
  if (!n || n.members.length < 2) return { reply: esc(pick(A.networkNone({ name: handle(p) }), "prospection.network.none", chatId)) };
  const countries = n.countries.length ? ` ${n.countries.join(" ")}` : "";
  const lines = [
    esc(`Réseau ${n.mainContact ?? n.name} : ${plural(n.members.length, "canal", "canaux")}${countries}, ${compactNumber(n.totalReach)} vues par post cumulées.`),
    ...n.members.slice(0, LIST_MAX).map((m) => esc(`• ${nameOf(m)} (${PROSPECT_STATUS_WORDS[m.status as keyof typeof PROSPECT_STATUS_WORDS] ?? "?"}${typeof m.medianViews === "number" ? `, ${compactNumber(m.medianViews)} vues` : ""})`)),
  ];
  const proofs = n.evidence.filter((e) => e.detail).slice(0, 3);
  if (proofs.length) lines.push(esc(`Preuves : ${proofs.map((e) => e.detail).join(" ; ")}.`));
  return { reply: lines.join("\n") };
}

/** Tous les canaux cités (« @a et @b c'est la même personne »), connus seulement. */
export async function prospectsIn(deps: D, text: string): Promise<{ found: ProspectRow[]; unknown: string[] }> {
  const names = [...new Set([...text.matchAll(/@([A-Za-z][A-Za-z0-9_]{3,31})/g)].map((m) => m[1]!.toLowerCase()))];
  const found: ProspectRow[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const p = await findProspect(deps, `@${n}`);
    if (p) found.push(p);
    else unknown.push(`@${n}`);
  }
  return { found, unknown };
}

// ------------------------------------------------------------------------------------------------ valeur

const uncalibratedLine = (v: Pick<ValueEstimate, "calibratedBy"> | { calibrated: boolean }, chatId: string | null): string | null => {
  const calibrated = "calibrated" in v ? v.calibrated : v.calibratedBy !== "default";
  return calibrated ? null : esc(pick(A.uncalibrated, "prospection.value.uncalibrated", chatId));
};

const CONFIDENCE_WORDS: Record<string, string> = { low: "faible", medium: "moyenne", high: "bonne" };

export async function valueReply(deps: D, p: ProspectRow, chatId: string | null): Promise<BossReply> {
  const v = (await prospectionAdvancedPort(deps).estimateProspectValue(deps, p.id)) ?? estimateOf((p as unknown as { valueEstimate?: unknown }).valueEstimate);
  if (!v) return { reply: esc(pick(A.valueNone({ name: handle(p) }), "prospection.value.none", chatId)) };
  const kport = prospectionAdvancedKevinPort(deps);
  const a = v.assumptions;
  const hyp = [
    `taux de clic ${pctText(a.ctr)}`,
    `inscription ${pctText(a.regRate)}`,
    `dépôt ${pctText(a.ftdRate)}`,
    a.cpa !== null ? `CPA ${a.cpa} €` : null,
    a.revsharePct !== null ? `revshare ${a.revsharePct} %` : null,
  ].filter(Boolean);
  const lines = [
    esc(`${handle(p)} : estimé ${kport.formatValueRange(v)}, confiance ${CONFIDENCE_WORDS[v.confidence] ?? v.confidence}.`),
    esc(`Hypothèses : ${hyp.join(", ")}.`),
  ];
  if (a.missing?.length) lines.push(esc(`Manque : ${a.missing.join(", ")}.`));
  const unc = uncalibratedLine(v, chatId);
  if (unc) lines.push(unc);
  return { reply: lines.join("\n") };
}

function pctText(x: number | null | undefined): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return "?";
  const p = x * 100;
  return `${(Math.round(p * 10) / 10).toString().replace(".", ",")} %`;
}

export async function pipelineValueReply(deps: D, chatId: string | null): Promise<BossReply> {
  const kport = prospectionAdvancedKevinPort(deps);
  const pv = await kport.pipelineValue(deps);
  if (!pv.total.count) return { reply: pick(A.pipelineNone, "prospection.value.pipelineNone", chatId) };
  // Texte du Valorisateur (chantier B), déjà dans la charte et sûr pour le HTML.
  if (pv.text) return { reply: pv.text };
  const lines = [
    esc(`Ton pipeline vaut ${kport.formatValueRange({ ...pv.total })} estimés, sur ${plural(pv.total.count, "canal", "canaux")}.`),
    ...pv.byStatus.map((s) => esc(`• ${PROSPECT_STATUS_WORDS[s.status as keyof typeof PROSPECT_STATUS_WORDS] ?? s.status} (${s.count}) : ${kport.formatValueRange(s)}`)),
  ];
  const unc = uncalibratedLine({ calibrated: pv.calibrated }, chatId);
  if (unc) lines.push(unc);
  return { reply: lines.join("\n") };
}

// ------------------------------------------------------------------------------------------------ affiliés

type SignedRow = ProspectRow & { linkAffiAffiliateId?: string | null };

const eurosOfCents = (c: number | null | undefined) => (typeof c === "number" ? `${Math.round(c / 100).toLocaleString("fr-FR")} €` : "?");

export async function affiliatesReply(deps: D, chatId: string | null): Promise<BossReply> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: ["SIGNED", "ACTIVE"] } } as never, orderBy: { statusChangedAt: "desc" } as never, take: 30 })) as SignedRow[];
  if (!rows.length) return { reply: pick(A.affiliatesNone, "prospection.affiliates.none", chatId) };
  const lines = [esc(pick(A.affiliatesHead({ count: rows.length }), "prospection.affiliates.head", chatId))];
  for (const p of rows.slice(0, 15)) {
    const last = (await deps.prisma.affiliateResult.findFirst({ where: { prospectId: p.id }, orderBy: { month: "desc" } })) as { month: string; ftd: number | null; revenueCents: number | null } | null;
    const link = p.linkAffiAffiliateId ? `affilié ${p.linkAffiAffiliateId}` : "pas rattaché";
    const res = last ? `, ${last.month} : ${last.ftd ?? "?"} premiers dépôts, ${eurosOfCents(last.revenueCents)}` : "";
    lines.push(esc(`• ${handle(p)} (${PROSPECT_STATUS_WORDS[p.status]}, ${link}${res})`));
  }
  return { reply: lines.join("\n") };
}

export async function performanceReply(deps: D, p: SignedRow, chatId: string | null): Promise<BossReply> {
  if (!p.linkAffiAffiliateId) return { reply: esc(pick(A.notLinked({ name: handle(p) }), "prospection.affiliates.notLinked", chatId)) };
  const kport = prospectionAdvancedKevinPort(deps);
  const perf = await kport.affiliatePerformance(deps, p.id);
  if (!perf.months.length) return { reply: esc(pick(A.perfNone({ name: handle(p) }), "prospection.affiliates.perfNone", chatId)) };
  if (perf.text) return { reply: perf.text };
  const lines = [esc(`${handle(p)}, affilié ${p.linkAffiAffiliateId} :`)];
  for (const m of perf.months.slice(0, 6))
    lines.push(esc(`• ${m.month} : ${m.clicks ?? "?"} clics, ${m.regs ?? "?"} inscriptions, ${m.ftd ?? "?"} premiers dépôts, ${eurosOfCents(m.revenueCents)}${m.missing.length ? ` (manque ${m.missing.join(", ")})` : ""}`));
  if (perf.estimate) lines.push(esc(`Estimé avant signature : ${kport.formatValueRange(perf.estimate)}.`));
  return { reply: lines.join("\n") };
}

export async function estimatedVsRealReply(deps: D, chatId: string | null): Promise<BossReply> {
  const evr = await prospectionAdvancedKevinPort(deps).estimatedVsReal(deps);
  if (evr.text) return { reply: evr.text };
  const rows = evr.rows.filter((r) => r.realCents !== null || r.base !== null);
  if (!rows.some((r) => r.realCents !== null)) return { reply: pick(A.evrNone, "prospection.evr.none", chatId) };
  const kport = prospectionAdvancedKevinPort(deps);
  const lines = rows.slice(0, 15).map((r) => {
    const est = r.low !== null && r.base !== null && r.high !== null ? kport.formatValueRange({ low: r.low, base: r.base, high: r.high }) : "pas d'estimation";
    return esc(`• ${r.name} : estimé ${est}, réel ${eurosOfCents(r.realCents)}${r.month ? ` (${r.month})` : ""}`);
  });
  return { reply: lines.join("\n") };
}

// ------------------------------------------------------------------------------------------------ calibrage

/** « applique 1 et 3 », « 1, 3 », « tout » → numéros (pur). */
export function parseChoices(text: string, max: number): number[] {
  const t = fold(text);
  if (/\b(tout|tous|toutes)\b/.test(t)) return Array.from({ length: max }, (_, i) => i + 1);
  const nums = [...t.matchAll(/\d{1,2}/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= max);
  return [...new Set(nums)].sort((a, b) => a - b);
}

export async function calibrationReply(deps: D, chatId: string | null): Promise<BossReply> {
  const choices = await prospectionAdvancedKevinPort(deps).listCalibrationChoices(deps);
  if (!choices.length) return { reply: pick(A.calibrationNone, "prospection.calibration.none", chatId) };
  return { reply: [esc(pick(A.calibrationHead({ count: choices.length }), "prospection.calibration.head", chatId)), ...choices.map((c) => esc(`${c.n}. ${c.text}`))].join("\n") };
}

export async function applyCalibrationReply(deps: D, said: string, chatId: string | null): Promise<BossReply> {
  const kport = prospectionAdvancedKevinPort(deps);
  const choices = await kport.listCalibrationChoices(deps);
  if (!choices.length) return { reply: pick(A.calibrationNone, "prospection.calibration.none", chatId) };
  const max = Math.max(...choices.map((c) => c.n));
  const picked = parseChoices(said, max);
  if (!picked.length) return { reply: pick(A.calibrationNeedChoice, "prospection.calibration.need", chatId) };
  const r = await kport.applyCalibration(deps, picked, "client");
  if (!r) return { reply: pick(A.notReady, "prospection.notReady", chatId) };
  if (!r.ok) return { reply: esc(r.message ?? pick(A.notReady, "prospection.notReady", chatId)) };
  const list = picked.length === 1 ? String(picked[0]) : `${picked.slice(0, -1).join(", ")} et ${picked.at(-1)}`;
  return { reply: esc(pick(A.calibrationApplied({ choices: list }), "prospection.calibration.applied", chatId)) };
}

export async function undoCalibrationReply(deps: D, chatId: string | null): Promise<BossReply> {
  const r = await prospectionAdvancedKevinPort(deps).undoCalibration(deps, "client");
  if (!r) return { reply: pick(A.notReady, "prospection.notReady", chatId) };
  if (!r.ok) return { reply: esc(r.message ?? pick(A.notReady, "prospection.notReady", chatId)) };
  return { reply: pick(A.calibrationUndone, "prospection.calibration.undone", chatId) };
}

// ------------------------------------------------------------------------------------------------ rattachement Link Affi

const LINK_RE = /^\s*@([A-Za-z][A-Za-z0-9_]{3,31})\s*(?:=|est\s+l'?|c'est\s+l'?)\s*(?:l'?\s*)?affili[ée]e?\s*(?:n°|no|numero|numéro|#)?\s*([A-Za-z0-9-]{1,40})\s*\.?\s*$/i;

/** « @x = affilié 1234 » → nom et identifiant (pur) ; null sinon. */
export function parseAffiliateLink(text: string): { username: string; affiliateId: string } | null {
  const m = LINK_RE.exec(text);
  return m ? { username: m[1]!.toLowerCase(), affiliateId: m[2]! } : null;
}

/** Rattache un signé à son identifiant Link Affi (lecture seule chez Link Affi : seul notre prospect change). */
export async function linkAffiliateReply(deps: D, ref: string, affiliateId: string | null | undefined, chatId: string | null, actorUserId: string | null): Promise<BossReply> {
  const p = await findProspect(deps, ref);
  const name = p ? handle(p) : `@${usernameOf(ref) ?? ref.trim().slice(0, 40)}`;
  if (!p) return { reply: esc(pick(V.unknownChannel({ name }), "prospection.unknownChannel", chatId)) };
  const id = (affiliateId ?? "").trim();
  if (!id) return { reply: pick(A.linkNeedId, "prospection.link.needId", chatId) };
  if (p.status !== "SIGNED" && p.status !== "ACTIVE" && p.status !== "CHURNED") return { reply: esc(pick(A.linkNotSigned({ name }), "prospection.link.notSigned", chatId)) };
  const r = await prospectionAdvancedPort(deps).linkAffiliate(deps, p.id, id, "client");
  if (!r.ok) return { reply: esc(r.message ?? pick(A.notReady, "prospection.notReady", chatId)) };
  await agentAudit(deps, { userId: actorUserId, action: "prospection.affiliate.linked", entityType: "Prospect", entityId: p.id, metadata: { via: "TELEGRAM" } });
  // Le message du chantier B (déjà dans la charte) passe en premier ; sinon le nôtre.
  return { reply: r.message ? r.message : esc(pick(A.linkDone({ name, id }), "prospection.link.done", chatId)) };
}

// ------------------------------------------------------------------------------------------------ recherche par compte réel

export const ACCOUNT_SEARCH_ACTION_KEY = "prospection_recherche_compte";

export async function accountSearchStateReply(deps: D, chatId: string | null): Promise<BossReply> {
  const on = await accountSearchEnabled(deps);
  const c = await readAccountSearchCounters(deps, nowOf(deps));
  return { reply: esc(pick(A.accountState({ on, today: requestsToday(c), cap: ACCOUNT_SEARCH.perAccountPerDay }), "prospection.account.state", chatId)) };
}

/** Après le OUI de l'admin. */
export async function enableAccountSearchReply(deps: D, chatId: string | null, actorUserId: string | null): Promise<BossReply> {
  if (await accountSearchEnabled(deps)) return { reply: pick(A.accountAlreadyOn, "prospection.account.alreadyOn", chatId) };
  await setAccountSearchEnabled(deps, true, nowOf(deps));
  await writeSetting(deps, ACCOUNT_SEARCH.offeredKey, { at: nowOf(deps).toISOString(), answer: "oui" });
  await agentAudit(deps, { userId: actorUserId, action: "prospection.account_search.enabled", entityType: "Setting", entityId: ACCOUNT_SEARCH.enabled.key, metadata: { via: "TELEGRAM" } });
  return { reply: pick(A.accountEnabled, "prospection.account.enabled", chatId) };
}

export async function disableAccountSearchReply(deps: D, chatId: string | null, actorUserId: string | null): Promise<BossReply> {
  if (!(await accountSearchEnabled(deps))) return { reply: pick(A.accountAlreadyOff, "prospection.account.alreadyOff", chatId) };
  await setAccountSearchEnabled(deps, false, nowOf(deps));
  await agentAudit(deps, { userId: actorUserId, action: "prospection.account_search.disabled", entityType: "Setting", entityId: ACCOUNT_SEARCH.enabled.key, metadata: { via: "TELEGRAM" } });
  return { reply: pick(A.accountDisabled, "prospection.account.disabled", chatId) };
}

/** Résumé montré avant le OUI (« active la recherche par compte »). */
export function accountSearchConfirmSummary(chatId: string | null): string {
  return pick(A.accountConfirm, "prospection.account.confirm", chatId);
}

/**
 * Proposition faite UNE fois à l'admin (`ACCOUNT_SEARCH.offeredKey`, réservé avant l'envoi) : le texte du prompt avec
 * OUI / NON (confirmation de Kevin ; le OUI active, rien d'autre). Une confirmation déjà ouverte n'est jamais remplacée :
 * Kevin dit alors comment l'activer. Rend vrai si la proposition est partie.
 */
export async function offerAccountSearchOnce(deps: D): Promise<boolean> {
  if (!deps.admin || (await accountSearchEnabled(deps))) return false;
  if ((await readSetting(deps, ACCOUNT_SEARCH.offeredKey)) != null) return false;
  try {
    await deps.prisma.setting.create({ data: { key: ACCOUNT_SEARCH.offeredKey, value: { at: nowOf(deps).toISOString() } } });
  } catch {
    return false;
  }
  try {
    const admin = await adminTelegramId(deps);
    const current = await readBossPending(deps);
    if (current && !current.expired) {
      await deps.admin.send(esc(pick(A.accountOfferLater, "prospection.account.offerLater")));
      return true;
    }
    const r = await createBossPending(deps as BossDeps, { actionKey: ACCOUNT_SEARCH_ACTION_KEY, params: { action: "activer" }, summary: pick(A.accountOffer, "prospection.account.offer"), chatId: admin });
    const sent = await deps.admin.send(r.reply ?? "", r.buttons ? { buttons: r.buttons } : {});
    if (sent && r.pendingId) await rememberBossPendingMessage(deps as BossDeps, r.pendingId, sent.messageId);
    return true;
  } catch (err) {
    await deps.prisma.setting.deleteMany({ where: { key: ACCOUNT_SEARCH.offeredKey } }).catch(() => undefined);
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] proposition de la recherche par compte non envoyée");
    return false;
  }
}

// ------------------------------------------------------------------------------------------------ boutons `pra:`

export function isProspectAlertCallbackData(data: string | null | undefined): boolean {
  return typeof data === "string" && data.startsWith(ALERT_CALLBACK_PREFIX);
}

/**
 * Bouton `pra:<alerte>:<action>` (✅ Vu, 📝 Note, 🔕 Plus pour ce canal) → `handleAlertCallback` du Veilleur (socle).
 * Seuls l'admin et les responsables agissent. « 📝 Note » : la note suivante de cette conversation va sur la fiche.
 * Ne lève jamais.
 */
export async function prospectAlertButton(
  deps0: ProspectionKevinDeps,
  input: { data: string; chatId: string | number | bigint; fromTelegramId: bigint | number | string },
): Promise<ProspectCallbackOutcome & { handled: true }> {
  const deps = deps0 as D;
  const chatId = String(input.chatId);
  try {
    if (!(await mayChangePipeline(deps, input.fromTelegramId))) return { handled: true, toast: pick(V.buttonNotYours, "prospection.button.notYours", chatId) };
    const r = await prospectionAdvancedPort(deps).handleAlertCallback(deps, { data: input.data, chatId, actorTelegramId: String(input.fromTelegramId) });
    return { ...(r ?? { toast: null }), handled: true };
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[prospection] bouton d'alerte en échec");
    return { handled: true, toast: "Oups, ça n'a pas marché." };
  }
}

// ------------------------------------------------------------------------------------------------ chemin rapide

/**
 * Chemin rapide de la prospection avancée (appelé par `prospectionFastPath`, avant l'IA) : réponse au « 📝 Note » d'une
 * alerte, puis « @x = affilié 1234 ». Seuls l'admin et les responsables (le pipeline n'est pas à un simple membre).
 */
export async function prospectionAdvancedFastPath(
  deps0: BossDeps,
  input: BossTeamInput,
  ctx: { chatKey: string | null; canChange: boolean },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  const deps = deps0 as unknown as D;
  const text = (input.text ?? "").trim();
  if (!text || input.forwarded || !ctx.canChange) return null;
  // Réponse au « 📝 Note » d'une alerte (question ouverte par le Veilleur, 30 minutes).
  if (ctx.chatKey) {
    const note = await answerPendingAlertNote(deps, ctx.chatKey, text);
    if (note) return { reply: { reply: note }, actionKey: "prospect_note" };
  }
  // Réponse « 2 » aux correspondances Link Affi proposées par Kevin à la signature.
  const choice = await answerLinkChoice(deps, text);
  if (choice) return { reply: { reply: choice }, actionKey: "prospection_rattacher" };
  const link = parseAffiliateLink(text);
  if (link) {
    return { reply: await linkAffiliateReply(deps, `@${link.username}`, link.affiliateId, ctx.chatKey, null), actionKey: "prospection_rattacher" };
  }
  return null;
}
