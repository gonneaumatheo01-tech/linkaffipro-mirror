/**
 * Phase 27, chantier C — Kevin après une lecture (`afterReferenceRead`, appelé par la lecture du chantier A) et après
 * une relecture hebdomadaire (`afterReferenceReread`).
 * - lecture : analyse (chantier B) ; trop peu de posts → « J'ai lu N posts de @x, il m'en faut 20 : transfère-m'en
 *   d'autres » ; canal illisible → demande de 10 à 30 posts transférés ; sinon profil de style (B), comparaison avec le
 *   canal cible, puis RÉSUMÉ en 6 lignes au plus (rythme, heures, forme, fond, ce qui marche chez eux, les 2 plus grands
 *   écarts), chiffres du code uniquement, puis « Tu veux voir le détail ou mes propositions ? ». Envoyé à la personne
 *   qui a demandé (admin en privé, groupe, ou membre en privé). L'analyse ne touche à AUCUN réglage ;
 * - relecture : la méthode a changé nettement (seuils `REREAD_THRESHOLDS`) → 2 lignes à l'admin et une proposition de
 *   revoir les réglages ; sinon SILENCE. Jamais d'application automatique.
 * Ne lève jamais (une erreur est journalisée).
 */
import { adminTelegramId, agentEvent, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { AgentsDeps } from "../types";
import { loadAlgoTeam } from "../algo/settings";
import { isAgentsPausedAll } from "../missions/settings";
import { INSPIRATION_LIMITS, type ChannelComparison, type InspirationAnalysis, type InspirationGap, type Measure } from "./contract";
import { analyzeReference, buildStyleProfile, compareWithChannel } from "./kevin-ports";
import { loadReferenceRow, readAsker, referenceLabel, referencePostCount, sendToAsker, targetIdsOf, type ReferenceRow } from "./kevin-refs";

export const SUMMARY_MAX_LINES = 6;
export const SUMMARY_QUESTION = "Tu veux voir le détail ou mes propositions ?";
/** `Setting` : réglage d'une collecte de posts transférés ouverte pour une référence (par conversation). */
export const INSPIRATION_COLLECT_PREFIX = "inspiration.collect.";
/** `Setting` : chiffres clés gardés à chaque analyse (comparaison de la relecture suivante). */
export const INSPIRATION_SNAPSHOT_PREFIX = "inspiration.snapshot.";

// ------------------------------------------------------------------------------------------ lecture des mesures

export function measureOf(a: Pick<InspirationAnalysis, "rhythm" | "form" | "content" | "results">, key: string): Measure | undefined {
  return [...a.rhythm, ...a.form, ...a.content, ...a.results].find((m) => m.key === key);
}

export function numberOf(a: Pick<InspirationAnalysis, "rhythm" | "form" | "content" | "results">, key: string): number | null {
  const v = measureOf(a, key)?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Nombre au format français (1 décimale au plus). */
export function fr(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

const MEDIA_WORDS: Record<string, string> = { text: "texte seul", photo: "photo", video: "vidéo", poll: "sondage", document: "document", other: "autre" };

/** Parts des médias de leurs posts (%), de la plus forte à la plus faible (pur). */
export function mediaShares(a: InspirationAnalysis): { kind: string; share: number }[] {
  return Object.keys(MEDIA_WORDS)
    .map((k) => ({ kind: k, share: numberOf(a, `media.${k}`) ?? 0 }))
    .filter((x) => x.share > 0)
    .sort((x, y) => y.share - x.share);
}

function gapSize(g: InspirationGap): number {
  if (typeof g.theirs !== "number" || typeof g.ours !== "number") return g.matters ? 0.5 : 0;
  if (g.unit === "%") return Math.abs(g.theirs - g.ours) / 100;
  const base = Math.max(Math.abs(g.theirs), Math.abs(g.ours));
  return base > 0 ? Math.abs(g.theirs - g.ours) / base : 0;
}

/** Les écarts qui comptent, du plus grand au plus petit (pur). */
export function biggestGaps(c: ChannelComparison | null, n = 2): InspirationGap[] {
  if (!c) return [];
  return c.gaps
    .filter((g) => g.matters)
    .sort((a, b) => gapSize(b) - gapSize(a))
    .slice(0, n);
}

function valueText(v: number | string | null, unit?: string): string {
  if (v === null) return "?";
  if (typeof v === "string") return v;
  return unit === "%" ? `${fr(v)} %` : unit ? `${fr(v)} ${unit}` : fr(v);
}

/** « Posts par jour : 4,2 chez eux contre 1 chez nous » (pur). */
export function gapText(g: InspirationGap): string {
  return `${g.label.toLowerCase()} ${valueText(g.theirs, g.unit)} contre ${valueText(g.ours, g.unit)}`;
}

/**
 * Résumé en 6 lignes au plus (pur, texte brut). Seuls des chiffres de l'analyse et de la comparaison (code) y entrent.
 */
export function inspirationSummaryLines(refLabel: string, a: InspirationAnalysis, comparison: ChannelComparison | null): string[] {
  const out: string[] = [];
  const perDay = numberOf(a, "postsPerDay");
  const gap = numberOf(a, "medianGapMinutes");
  if (perDay !== null)
    out.push(`📅 Rythme : ${fr(perDay)} posts par jour${gap !== null ? `, un toutes les ${fr(gap)} min en médiane` : ""} (${a.sampleSize} posts lus).`);
  if (a.peakSlots.length) {
    const share = numberOf(a, "peakShare");
    out.push(`🕘 Heures de pointe (Paris) : ${a.peakSlots.join(", ")}${share !== null ? ` (${fr(share)} % des posts)` : ""}.`);
  }
  const len = numberOf(a, "lengthMedian");
  const media = mediaShares(a)
    .slice(0, 3)
    .map((m) => `${MEDIA_WORDS[m.kind]} ${fr(m.share)} %`);
  if (len !== null || media.length) out.push(`✍️ Forme : ${[len !== null ? `${fr(len)} caractères en médiane` : null, media.join(", ") || null].filter(Boolean).join(" ; ")}.`);
  const fond: string[] = [];
  const vip = numberOf(a, "vipCallShare");
  if (vip !== null) fond.push(`appel au VIP dans ${fr(vip)} % des posts`);
  if (a.universe === "sports") {
    const odds = numberOf(a, "oddsShare");
    const series = numberOf(a, "betSeries");
    if (odds !== null) fond.push(`une cote dans ${fr(odds)} %`);
    if (series !== null && series > 0) fond.push(`${fr(series)} séries pari → résultat`);
  }
  if (a.universe === "casino") {
    const bonus = numberOf(a, "bonusShare");
    if (bonus !== null) fond.push(`bonus dans ${fr(bonus)} %`);
  }
  const flagged = a.flagged.length ? ` ⚠️ ${a.flagged.length} pratique${a.flagged.length > 1 ? "s" : ""} interdite${a.flagged.length > 1 ? "s" : ""} chez nous, que je ne reprends pas.` : "";
  if (fond.length || flagged) out.push(`🎯 Fond : ${fond.join(" ; ") || "rien de marquant"}.${flagged}`);
  const best = measureOf(a, "best.1");
  const views = numberOf(a, "viewsMedian");
  if (best && typeof best.value === "number") {
    const what = best.label.replace(/^Meilleur post n°1 : /, "");
    out.push(`📈 Ce qui marche chez eux : ${what} (${fr(best.value)} vues${views !== null ? `, médiane ${fr(views)}` : ""}).`);
  } else out.push("📈 Leurs vues ne sont pas visibles : je ne peux pas dire quel post marche le mieux.");
  const gaps = biggestGaps(comparison);
  if (comparison) out.push(gaps.length ? `↔️ Écarts avec ${comparison.channelTitle} : ${gaps.map(gapText).join(" ; ")}.` : `↔️ Pas d'écart net avec ${comparison.channelTitle}.`);
  return out.slice(0, SUMMARY_MAX_LINES);
}

/** Faits (seule source des chiffres) d'un résumé : sert au contrôle « aucun chiffre inventé ». */
export function summaryFacts(a: InspirationAnalysis, comparison: ChannelComparison | null): Record<string, unknown> {
  const best = measureOf(a, "best.1");
  return { analysis: a, comparison, flaggedCount: a.flagged.length, bestPost: best ? best.label.replace(/^Meilleur post n°1 : /, "") : null };
}

// ------------------------------------------------------------------------------------------ collectes de transferts

export type InspirationCollect = { referenceChannelId: string; at: string; telegramUserId?: string | null };

/**
 * Ouvre une collecte : les prochains posts transférés par cette personne, dans cette conversation, d'un canal encore
 * inconnu vont à cette référence (dans un groupe, seuls ces transferts-là sont rangés sans mention de Kevin).
 */
export async function openCollect(deps: AgentsDeps, chatKey: string, referenceChannelId: string, telegramUserId: string | null = null): Promise<void> {
  await writeSetting(deps, `${INSPIRATION_COLLECT_PREFIX}${chatKey}`, { referenceChannelId, at: nowOf(deps).toISOString(), telegramUserId });
}

export async function readCollect(deps: AgentsDeps, chatKey: string): Promise<InspirationCollect | null> {
  const v = (await readSetting(deps, `${INSPIRATION_COLLECT_PREFIX}${chatKey}`)) as InspirationCollect | undefined;
  if (!v || typeof v.referenceChannelId !== "string") return null;
  // Collecte valable 7 jours.
  if (nowOf(deps).getTime() - new Date(v.at).getTime() > 7 * 86_400_000) return null;
  return v;
}

async function askerChatKey(deps: AgentsDeps, refId: string): Promise<string> {
  const a = await readAsker(deps, refId);
  if (a?.chatId) return a.chatId;
  // Privé de l'admin : la conversation a l'identifiant Telegram de l'admin (clé des transferts qu'il fera).
  return (await adminTelegramId(deps))?.toString() ?? "admin";
}

/** « Transfère-moi 10 à 30 posts » (canal illisible ou trop peu de posts) : message à la personne qui a demandé. */
export async function askForForwards(deps: AgentsDeps, ref: ReferenceRow, reason: string | null, count: number): Promise<void> {
  const label = esc(referenceLabel(ref));
  const head =
    count > 0
      ? `J'ai lu ${count} post${count > 1 ? "s" : ""} de ${label}, il m'en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} : transfère-m'en d'autres.`
      : `Je ne peux pas lire ${label}${reason ? ` (${esc(reason.slice(0, 160))})` : ""}.`;
  const tail = count > 0 ? "" : `\nTransfère-moi ${INSPIRATION_LIMITS.forwardMin} à ${INSPIRATION_LIMITS.forwardMax} de ses posts ici : je les range et je l'analyse.`;
  await openCollect(deps, await askerChatKey(deps, ref.id), ref.id, (await readAsker(deps, ref.id))?.telegramUserId ?? null);
  await sendToAsker(deps, ref.id, `${head}${tail}`, { actionKey: "inspiration_transfert" });
}

// ------------------------------------------------------------------------------------------ après une lecture

/** Le profil de style se refait au plus une fois par jour, seulement si de nouveaux posts sont arrivés depuis, et jamais
 * quand l'équipe Algorithme (qui paie l'IA) ou tous les agents sont en pause. */
export const STYLE_PROFILE_MIN_INTERVAL_MS = 24 * 3600_000;

export async function shouldRebuildProfile(deps: AgentsDeps, refId: string): Promise<boolean> {
  const team = await loadAlgoTeam(deps.prisma);
  if (team.paused || (await isAgentsPausedAll(deps.prisma))) return false;
  const latest = (await deps.prisma.styleProfile.findFirst({ where: { referenceChannelId: refId }, orderBy: { version: "desc" } })) as { createdAt: Date } | null;
  if (!latest) return true;
  if (nowOf(deps).getTime() - new Date(latest.createdAt).getTime() < STYLE_PROFILE_MIN_INTERVAL_MS) return false;
  return (await deps.prisma.referencePost.count({ where: { referenceChannelId: refId, createdAt: { gt: latest.createdAt } } })) > 0;
}

/** Canal cible dont on parle : celui de la demande, sinon le premier rattaché. */
async function primaryTarget(deps: AgentsDeps, ref: ReferenceRow): Promise<string | null> {
  const asker = await readAsker(deps, ref.id);
  const ids = targetIdsOf(ref);
  if (asker?.channelId && ids.includes(asker.channelId)) return asker.channelId;
  return ids[0] ?? null;
}

type Snapshot = { postsPerDay: number | null; lengthMedian: number | null; vipCallShare: number | null; peakSlots: string[]; media: Record<string, number>; at: string };

export function snapshotOf(a: InspirationAnalysis, at: Date): Snapshot {
  const media: Record<string, number> = {};
  for (const m of mediaShares(a)) media[m.kind] = m.share;
  return { postsPerDay: numberOf(a, "postsPerDay"), lengthMedian: numberOf(a, "lengthMedian"), vipCallShare: numberOf(a, "vipCallShare"), peakSlots: a.peakSlots, media, at: at.toISOString() };
}

export async function afterReferenceRead(deps: AgentsDeps, referenceChannelId: string): Promise<void> {
  try {
    const ref = await loadReferenceRow(deps, referenceChannelId);
    if (!ref) return;
    const count = await referencePostCount(deps, ref.id);
    if (ref.status === "UNAVAILABLE" && count < INSPIRATION_LIMITS.minPostsForAnalysis) {
      await askForForwards(deps, ref, ref.unavailableReason, 0);
      await agentEvent(deps, "agents.inspiration.forwards_asked", { referenceChannelId, reason: "unavailable" });
      return;
    }
    const analysis = await analyzeReference(deps, ref.id);
    if ("tooFew" in analysis) {
      await askForForwards(deps, ref, null, analysis.count);
      await agentEvent(deps, "agents.inspiration.forwards_asked", { referenceChannelId, reason: "too_few", count: analysis.count });
      return;
    }
    if (await shouldRebuildProfile(deps, ref.id))
      await buildStyleProfile(deps, ref.id, analysis).catch((err) => {
        deps.logger?.warn({ err: (err as Error).message, referenceChannelId }, "[inspiration] profil de style impossible");
        return null;
      });
    const target = await primaryTarget(deps, ref);
    const comparison = target
      ? await compareWithChannel(deps, analysis, target).catch((err) => {
          deps.logger?.warn({ err: (err as Error).message, referenceChannelId }, "[inspiration] comparaison impossible");
          return null;
        })
      : null;
    const lines = inspirationSummaryLines(referenceLabel(ref), analysis, comparison);
    const html = [`🔎 <b>${esc(referenceLabel(ref))}</b>`, ...lines.map(esc), SUMMARY_QUESTION].join("\n");
    await sendToAsker(deps, ref.id, html, { actionKey: "inspiration_resume" });
    await writeSetting(deps, `${INSPIRATION_SNAPSHOT_PREFIX}${ref.id}`, snapshotOf(analysis, nowOf(deps)));
    await agentEvent(deps, "agents.inspiration.summary_sent", { referenceChannelId, posts: analysis.sampleSize, target });
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, referenceChannelId }, "[inspiration] suite de la lecture (Kevin) en échec");
    // Jamais de silence : la personne sait que l'analyse n'a pas abouti.
    const ref = await loadReferenceRow(deps, referenceChannelId).catch(() => null);
    if (ref) await sendToAsker(deps, ref.id, `Je n'ai pas réussi à analyser ${esc(referenceLabel(ref))} (${esc(String((err as Error).message ?? err).slice(0, 120))}). Redemande-moi dans un moment.`, { actionKey: "inspiration_resume" });
  }
}

// ------------------------------------------------------------------------------------------ après une relecture

/** Seuils d'un changement net de méthode entre deux analyses. */
export const REREAD_THRESHOLDS = {
  /** Posts par jour : écart relatif (et au moins 1 post par jour d'écart). */
  postsPerDayRelative: 0.3,
  postsPerDayMin: 1,
  /** Parts (médias, appels au VIP) : écart en points. */
  sharePoints: 15,
  /** Longueur médiane : écart relatif. */
  lengthRelative: 0.3,
  /** Heures de pointe : au moins 2 des 3 tranches ont changé. */
  peakSlotsChanged: 2,
} as const;

/** Changements nets entre deux instantanés (pur) : phrases courtes, chiffres des deux analyses. */
export function methodChanges(before: Snapshot, after: Snapshot, t = REREAD_THRESHOLDS): string[] {
  const out: string[] = [];
  if (before.postsPerDay !== null && after.postsPerDay !== null) {
    const d = Math.abs(after.postsPerDay - before.postsPerDay);
    const base = Math.max(before.postsPerDay, after.postsPerDay);
    if (d >= t.postsPerDayMin && base > 0 && d / base >= t.postsPerDayRelative) out.push(`${fr(after.postsPerDay)} posts par jour au lieu de ${fr(before.postsPerDay)}`);
  }
  const kinds = new Set([...Object.keys(before.media), ...Object.keys(after.media)]);
  for (const k of kinds) {
    const a = before.media[k] ?? 0;
    const b = after.media[k] ?? 0;
    if (Math.abs(b - a) >= t.sharePoints) out.push(`${MEDIA_WORDS[k] ?? k} ${fr(b)} % au lieu de ${fr(a)} %`);
  }
  if (before.vipCallShare !== null && after.vipCallShare !== null && Math.abs(after.vipCallShare - before.vipCallShare) >= t.sharePoints)
    out.push(`appel au VIP dans ${fr(after.vipCallShare)} % des posts au lieu de ${fr(before.vipCallShare)} %`);
  if (before.lengthMedian !== null && after.lengthMedian !== null) {
    const base = Math.max(before.lengthMedian, after.lengthMedian);
    if (base > 0 && Math.abs(after.lengthMedian - before.lengthMedian) / base >= t.lengthRelative)
      out.push(`${fr(after.lengthMedian)} caractères en médiane au lieu de ${fr(before.lengthMedian)}`);
  }
  if (before.peakSlots.length && after.peakSlots.length) {
    const changed = after.peakSlots.filter((s) => !before.peakSlots.includes(s)).length;
    if (changed >= t.peakSlotsChanged) out.push(`heures de pointe ${after.peakSlots.join(", ")} au lieu de ${before.peakSlots.join(", ")}`);
  }
  return out;
}

function isSnapshot(v: unknown): v is Snapshot {
  return !!v && typeof v === "object" && Array.isArray((v as Snapshot).peakSlots) && typeof (v as Snapshot).media === "object";
}

export async function afterReferenceReread(deps: AgentsDeps, referenceChannelId: string): Promise<void> {
  try {
    const ref = await loadReferenceRow(deps, referenceChannelId);
    if (!ref) return;
    const analysis = await analyzeReference(deps, ref.id);
    if ("tooFew" in analysis) return;
    const key = `${INSPIRATION_SNAPSHOT_PREFIX}${ref.id}`;
    const before = await readSetting(deps, key);
    const after = snapshotOf(analysis, nowOf(deps));
    await writeSetting(deps, key, after);
    if (!isSnapshot(before)) return;
    const changes = methodChanges(before, after);
    if (!changes.length) return;
    // Changement net : 2 lignes à l'admin et une proposition (jamais d'application automatique).
    const label = esc(referenceLabel(ref));
    const html = [
      `🔁 ${label} a changé de méthode : ${esc(changes.slice(0, 2).join(" ; "))}.`,
      `Je peux revoir mes propositions pour suivre ce changement : écris « propositions ${label} » (rien ne change sans ton accord).`,
    ].join("\n");
    await deps.admin?.send(html).catch(() => null);
    await agentEvent(deps, "agents.inspiration.method_changed", { referenceChannelId, changes: changes.length });
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, referenceChannelId }, "[inspiration] suite de la relecture (Kevin) en échec");
  }
}

// ------------------------------------------------------------------------------------------ lecture reportée ou en échec

const NOTICE_PREFIX = "inspiration.notice.";

/** Un message par référence et par motif et par jour au plus (pas de répétition à chaque nouvel essai). */
async function noticeOnce(deps: AgentsDeps, refId: string, motive: string): Promise<boolean> {
  const key = `${NOTICE_PREFIX}${refId}`;
  const day = nowOf(deps).toISOString().slice(0, 10);
  const v = (await readSetting(deps, key)) as Record<string, string> | undefined;
  if (v && v[motive] === day) return false;
  await writeSetting(deps, key, { ...(v ?? {}), [motive]: day });
  return true;
}

/**
 * Lecture reportée (quota de 5 par jour, autre lecture en cours, Telegram indisponible) : la personne est prévenue
 * (« Déjà 5 lectures aujourd'hui, je lis @x demain »). À appeler par la lecture (chantier A) et le worker.
 */
export async function notifyReadPostponed(deps: AgentsDeps, referenceChannelId: string, reason: string): Promise<void> {
  try {
    const ref = await loadReferenceRow(deps, referenceChannelId);
    if (!ref || !(await noticeOnce(deps, ref.id, "postponed"))) return;
    const label = esc(referenceLabel(ref));
    const text = /5 lectures|quota/i.test(reason)
      ? `Déjà 5 lectures aujourd'hui : je lis ${label} demain.`
      : `Je ne peux pas lire ${label} tout de suite (${esc(reason.slice(0, 160))}) : je réessaie un peu plus tard.`;
    await sendToAsker(deps, ref.id, text, { actionKey: "inspiration_lecture" });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, referenceChannelId }, "[inspiration] report de lecture non signalé");
  }
}

/** Lecture abandonnée (essais épuisés, erreur) : la personne est prévenue, avec la voie des posts transférés. */
export async function notifyReadFailed(deps: AgentsDeps, referenceChannelId: string, reason: string): Promise<void> {
  try {
    const ref = await loadReferenceRow(deps, referenceChannelId);
    if (!ref || !(await noticeOnce(deps, ref.id, "failed"))) return;
    await openCollect(deps, await askerChatKey(deps, ref.id), ref.id, (await readAsker(deps, ref.id))?.telegramUserId ?? null);
    await sendToAsker(
      deps,
      ref.id,
      `Lecture impossible de ${esc(referenceLabel(ref))} : ${esc(reason.slice(0, 160))}.\nTransfère-moi ${INSPIRATION_LIMITS.forwardMin} à ${INSPIRATION_LIMITS.forwardMax} de ses posts ici : je les range et je l'analyse.`,
      { actionKey: "inspiration_lecture" },
    );
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, referenceChannelId }, "[inspiration] échec de lecture non signalé");
  }
}
