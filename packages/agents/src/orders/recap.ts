/**
 * Phase 33 (chantier B) — récapitulatif, confirmation et transmission d'un ordre (règle 4). Kevin ne produit rien : il
 * reformule l'ordre validé en 3 lignes au plus (valeurs résolues, ce qui a été ramené dans une borne, ce qui est
 * impossible), écrites par le code avec la voix de Kevin (Haiku ne fait que lisser la première ligne, contrôlé « aucun
 * chiffre inventé » + `voiceCheck`), puis :
 * - confirmation OUI / NON (mécanique `BossPending` de la phase 26, une seule à la fois) dès qu'un ordre touche un vrai
 *   canal, passe une équipe en vrai, dépense chez un fournisseur ou dure plus de 7 jours ;
 * - sinon (canal Test, pour de faux, sans dépense) : transmis tout de suite au Grand Chef (`runOrder`), « annule »
 *   pendant 60 s l'arrête avant sa première production.
 * Partie impossible : raison en une phrase, UNE proposition en question (OUI), les autres replis par numéros (un « 2 »
 * rejoue le repli sans IA). Chevauchement : une question « lequel garder ? ».
 */
import { esc, nowOf, readSetting, writeSetting, adminTelegramId } from "../admin/journal";
import { allowedNumbers, inventedNumbers } from "../rules/report-numbers";
import { addDaysToDay, parisDayStart } from "../rules/time";
import type { BossActor, BossChat, BossDeps, BossReply, BossSpeaker, BossTeamInput } from "../boss/contract";
import { createBossPending, readBossPending, rememberBossPendingMessage } from "../boss/confirm";
import { askToChoose } from "../boss/resolve";
import { adminFirstName, findTeamMember } from "../boss/team/members";
import { KEVIN_VOICE, pick, voiceCheck, voiceTemplate, type VoiceTable } from "../boss/voice";
import type { BossTurnStatus } from "../boss/memory";
import { ORDER_LIMITS, type Alternative, type OrderPlan, type OrderStep } from "./contract";
import {
  channelNames,
  interpretationOf,
  orderById,
  orderTeamLabel,
  periodLabel,
  type StoredInterpretation,
  type TeamOrderRow,
} from "./current";
import { runOrder, stopOrder } from "./ports";
import type { PlannedOrder } from "./planner";
import { recordOrderUnmet } from "./unmet";
import { validatePlan, workingTeam, type ImpossibleOut, type ValidatedPlan } from "./validate";

/** Clés des entrées internes du catalogue (`boss/catalog-orders.ts`) visées par les confirmations et les numéros. */
export const ORDER_CONFIRM_ACTION = "confirmer_ordre";
export const ORDER_ALTERNATIVE_ACTION = "ordre_repli";
export const ORDER_OVERLAP_ACTION = "ordre_choix";
/** `Setting` : dernier ordre lancé sans confirmation (« annule » pendant 60 s). */
export const ORDER_QUICK_CANCEL_SETTING = "boss.orders.quickCancel";

export type OrderSubmitContext = {
  requestText: string;
  actor: BossActor;
  speaker?: BossSpeaker | null;
  chat?: BossChat | null;
  /** Coût de la planification (centimes, IA de Kevin). */
  plannerCostCents?: number;
  cacheKey?: string | null;
  raw?: PlannedOrder | null;
  /** Ordre DRAFT déjà créé à réutiliser (repli choisi par numéro, choix après chevauchement). */
  orderId?: string | null;
};

export type OrderReply = BossReply & { status: BossTurnStatus; orderId?: string | null };

// ------------------------------------------------------------------------------------------- textes de Kevin

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. Les morceaux de phrase
 * (`reason*`, `adjust*`, `option*`) prennent la première variante : ils entrent dans une phrase déjà tirée au sort.
 */
export const ORDER_RECAP_VARIANTS = {
  reasonReal: ["ça touche un vrai canal", "ça touche un canal en vrai"],
  reasonGoesReal: ["ça passe en vrai", "ça bascule en vrai"],
  reasonCost: voiceTemplate<{ amount: string }>([{ amount: "3,50 €" }], (p) => [`ça coûte environ ${p.amount} chez un fournisseur`, `ça coûte à peu près ${p.amount} chez un fournisseur`]),
  reasonMedia: ["ça fait produire des photos ou des vidéos payantes", "ça fait produire des photos ou des vidéos qui coûtent"],
  reasonDays: voiceTemplate<{ days: number }>([{ days: 10 }], (p) => [`ça dure ${p.days} jours`, `ça court sur ${p.days} jours`]),
  whatGeneric: voiceTemplate<{ body: string; mode: string }>(
    [
      { body: "l'équipe Casino teste 2 posts sur le canal Test", mode: "pour de faux" },
      { body: "Paris sportifs s'en occupe", mode: "en vrai" },
    ],
    (p) => [`Je m'en occupe : ${p.body}, ${p.mode}.`, `Ok, je lance : ${p.body}, ${p.mode}.`, `C'est noté : ${p.body}, ${p.mode}.`],
  ),
  whatAsIf: voiceTemplate<{ where: string; as: string; duration: string; qty: string; onTheme: string; mode: string }>(
    [
      { where: "le canal Test", as: "un canal paris", duration: "pendant 3 jours, du 25 au 27 octobre", qty: "2 paris par jour", onTheme: " sur les hors-jeux", mode: "pour de faux" },
      { where: "le canal Test", as: "un canal casino", duration: "le 25 octobre", qty: "1 post par jour", onTheme: "", mode: "en vrai" },
    ],
    (p) => [
      `Je fais tourner ${p.where} comme ${p.as} ${p.duration} : ${p.qty}${p.onTheme}, ${p.mode}.`,
      `${capFirst(p.where)} passe en mode ${p.as.replace(/^un /, "")} ${p.duration} : ${p.qty}${p.onTheme}, ${p.mode}.`,
    ],
  ),
  what: voiceTemplate<{ where: string; duration: string; qty: string; onTheme: string; mode: string }>(
    [
      { where: "Roulette Pro", duration: "pendant 3 jours, du 25 au 27 octobre", qty: "3 posts par jour", onTheme: " sur la roulette", mode: "en vrai" },
      { where: "le canal Test", duration: "le 25 octobre", qty: "1 pari par jour", onTheme: "", mode: "pour de faux" },
    ],
    (p) => [`Je lance ${p.qty} sur ${p.where} ${p.duration}${p.onTheme}, ${p.mode}.`, `${capFirst(p.where)} : ${p.qty} ${p.duration}${p.onTheme}, ${p.mode}.`],
  ),
  adjustClamped: voiceTemplate<{ list: string }>([{ list: "10 paris par jour ramenés à 5" }], (p) => [`J'ai ramené dans les limites : ${p.list}.`, `J'ai dû ramener dans les limites : ${p.list}.`]),
  adjustImpossible: voiceTemplate<{ list: string }>([{ list: "les vidéos (pas de vidéo sur un canal casino)" }], (p) => [`Pas possible : ${p.list}.`, `Ça, pas possible : ${p.list}.`]),
  optionLaunchPossible: ["lancer ce qui est possible", "lancer la partie possible"],
  altNone: ["Je n'ai rien d'autre à te proposer pour l'instant. Je l'ai noté pour la suite.", "Pas de solution de rechange pour le moment, c'est noté pour plus tard."],
  altPartial: ["Je lance le reste quand même ?", "Je fais déjà ce qui est possible ?", "On part sur le reste en attendant ?"],
  altOne: voiceTemplate<{ label: string }>([{ label: "les corners" }], (p) => [`Je te le fais avec ${p.label} à la place ?`, `On part sur ${p.label} à la place ?`, `Je te propose ${p.label}, ça te va ?`]),
  altHow: ["Réponds par le numéro, ou OUI pour le premier.", "Dis-moi le numéro (OUI = le premier)."],
  waitYes: voiceTemplate<{ reasons: string }>([{ reasons: "ça touche un vrai canal" }, { reasons: "ça touche un vrai canal et ça dure 10 jours" }], (p) => [
    `${capFirst(p.reasons)}, j'attends ton OUI.`,
    `${capFirst(p.reasons)} : il me faut ton OUI.`,
  ]),
  waitYesNone: ["J'attends ton OUI.", "Il me faut ton OUI."],
  memberAsksGroup: voiceTemplate<{ admin: string; who: string; body: string }>([{ admin: "Mathéo", who: "Léa", body: "Je lance 2 posts sur Roulette Pro le 25 octobre, en vrai." }], (p) => [
    `${p.admin}, ${p.who} demande ça :\n${p.body}`,
    `${p.admin}, ${p.who} voudrait ça :\n${p.body}`,
  ]),
  memberAsksPrivate: voiceTemplate<{ who: string; body: string }>([{ who: "Léa", body: "Je lance 2 posts sur Roulette Pro le 25 octobre, en vrai." }], (p) => [
    `${p.who} demande ça :\n${p.body}`,
    `${p.who} voudrait ça :\n${p.body}`,
  ]),
  memberHandedOver: voiceTemplate<{ name: string }>([{ name: "Mathéo" }], (p) => [`C'est ${p.name} qui décide : je lui ai transmis.`, `Je passe la main à ${p.name}, c'est lui qui valide.`]),
  tailConfirmed: ["Je te fais un point chaque soir.", "Je te tiens au courant chaque soir."],
  tailImmediate: ["Je te fais un point chaque soir. Tu changes d'avis ? Écris « annule » dans la minute.", "Point chaque soir. « annule » dans la minute si tu changes d'avis."],
  tailFirst: voiceTemplate<{ at: string }>([{ at: "10 h" }, { at: "18 h 30" }], (p) => [`Première production vers ${p.at}.`, `Ça démarre vers ${p.at}.`]),
  startFailed: voiceTemplate<{ reason: string }>([{ reason: "erreur interne" }], (p) => [
    `Ça n'a pas pu démarrer : ${p.reason}. Je réessaie si tu me le redemandes.`,
    `Raté au démarrage (${p.reason}). Redemande-moi et je relance.`,
  ]),
  overlap: voiceTemplate<{ n: number; where: string }>([{ n: 12, where: "le canal Test" }], (p) => [
    `Il y a déjà l'ordre n°${p.n} sur ${p.where} pour la même période. Lequel je garde ?`,
    `${capFirst(p.where)} a déjà l'ordre n°${p.n} sur ces jours-là. On garde lequel ?`,
  ]),
  overlapNew: voiceTemplate<{ n: number }>([{ n: 12 }], (p) => [`le nouveau (j'arrête le n°${p.n})`, `le nouveau (je coupe le n°${p.n})`]),
  overlapOld: ["l'ancien (je laisse tomber le nouveau)", "l'ancien (le nouveau tombe)"],
  overlapHow: ["Réponds par le numéro.", "Réponds par le numéro, 1 ou 2."],
  orderLost: ["Je ne retrouve plus cet ordre.", "Cet ordre a disparu de mon côté."],
  already: ["Celui-là est déjà parti, rien de plus à faire.", "Déjà traité de mon côté."],
  revalidateFailed: ["Entre-temps ce n'est plus possible, j'ai laissé tomber.", "Ça ne passe plus les vérifications, je ne lance rien."],
  choiceUnknown: ["Je n'ai pas compris ce choix.", "Ce choix ne me dit rien, tu me redonnes le numéro ?"],
  choiceStale: ["Ce choix n'est plus valable, redemande-moi.", "Ce choix a expiré, tu me redemandes ?"],
  nothingLeft: ["Plus rien de possible dans cet ordre, je laisse tomber.", "Il ne reste rien de faisable dans cet ordre, je laisse tomber."],
  altFree: voiceTemplate<{ label: string }>([{ label: "un post sur la roulette" }], (p) => [
    `Pour « ${p.label} », dis-le moi en une phrase et je m'en occupe.`,
    `Ok pour « ${p.label} » : redis-le moi en une phrase, je lance.`,
  ]),
  overlapKeptOld: ["Ok, je garde l'ancien et je laisse tomber le nouveau.", "D'accord, rien ne change : l'ancien continue."],
  quickLate: [
    "Trop tard pour l'annuler d'un mot : un premier post est déjà parti. Dis-moi « arrête l'ordre » et je stoppe la suite.",
    "Le premier est déjà sorti. Écris « arrête l'ordre » et je coupe le reste.",
  ],
  quickDone: ["C'est annulé, rien n'est parti.", "Annulé avant le départ, rien n'a été publié.", "Ok, j'annule : rien n'est sorti."],
} satisfies VoiceTable;

const RV = ORDER_RECAP_VARIANTS;

// ------------------------------------------------------------------------------------------------ classe

export type OrderClass = { cls: "immediate" | "confirm"; reasons: string[]; days: number };

function daysBetween(from: string | null, to: string | null): number {
  if (!from || !to) return 1;
  let n = 1;
  for (let d = from; d < to && n < 400; d = addDaysToDay(d, 1)) n++;
  return n;
}

/**
 * Classe d'un ordre validé (règle 4) : OUI dès qu'un vrai canal est touché, qu'une équipe passe en vrai, qu'il y a une
 * dépense chez un fournisseur (vidéo, photo, cotes payantes), ou au-delà de 7 jours ; sinon immédiat.
 */
export async function classifyOrder(deps: BossDeps, v: Pick<ValidatedPlan, "plan" | "steps" | "plannedSteps" | "channelIds" | "fromDay" | "toDay" | "costCents">): Promise<OrderClass> {
  const reasons: string[] = [];
  const names = await channelNames(deps, v.channelIds);
  const scope = v.plan.scope as { test?: boolean; teamWide?: boolean; channelIds?: string[] };
  const realChannel = scope.teamWide === true || v.channelIds.some((id) => !names.get(id)?.isTest) || (!scope.test && !v.channelIds.length && v.steps.length > 0);
  if (realChannel) reasons.push(RV.reasonReal[0]!);
  const goesReal = v.plan.mode === "real" || v.steps.some((s) => s.capability.key === "mode");
  if (goesReal) reasons.push(RV.reasonGoesReal[0]!);
  const team = workingTeam(v.plan);
  const mediaSpend =
    team === "dating" &&
    (v.plan.format === "video" ||
      v.plan.format === "photo" ||
      v.plannedSteps.some((p) => (p.overrides ?? []).some((o) => o.format === "video" || o.format === "photo" || (o.mix && ((o.mix.video ?? 0) > 0 || (o.mix.photo ?? 0) > 0)))));
  if (v.costCents > 0 || mediaSpend) reasons.push(v.costCents > 0 ? RV.reasonCost({ amount: eur(v.costCents) })[0]! : RV.reasonMedia[0]!);
  const days = daysBetween(v.fromDay, v.toDay);
  if (days > ORDER_LIMITS.confirmOverDays) reasons.push(RV.reasonDays({ days })[0]!);
  return { cls: reasons.length ? "confirm" : "immediate", reasons, days };
}

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

// ------------------------------------------------------------------------------------------------ récapitulatif

const AS_IF_LABEL: Record<string, string> = { sports: "un canal paris", casino: "un canal casino", dating: "un canal rencontres", algo: "un canal suivi par l'Algorithme" };

function themeWord(theme: string | null | undefined): string | null {
  if (!theme) return null;
  const t = theme.trim();
  return /^(les|le|la|l')\b/i.test(t) ? t : `les ${t}`;
}

function perDayOf(v: Pick<ValidatedPlan, "plan" | "plannedSteps">): number | null {
  if (typeof v.plan.perDay === "number" && v.plan.perDay > 0) return v.plan.perDay;
  for (const p of v.plannedSteps)
    for (const o of p.overrides ?? []) {
      const n = o.picksPerDay ?? o.postsPerDay;
      if (typeof n === "number" && n > 0) return n;
    }
  return null;
}

/** Première ligne (ce qui va se passer), écrite par le code (pur, données déjà lues). */
export function recapWhatLine(
  v: Pick<ValidatedPlan, "plan" | "plannedSteps" | "fromDay" | "toDay">,
  where: string,
  chatId?: bigint | string | null,
): string {
  const team = workingTeam(v.plan);
  const unitMany = team === "sports" ? "paris" : "posts";
  const unitOne = team === "sports" ? "pari" : "post";
  const perDay = perDayOf(v as ValidatedPlan);
  const days = daysBetween(v.fromDay, v.toDay);
  const period = v.fromDay && v.toDay ? periodLabel(v.fromDay, v.toDay) : null;
  const theme = themeWord(v.plan.theme);
  const mode = v.plan.mode === "real" ? "en vrai" : "pour de faux";
  const qty = perDay ? `${perDay} ${perDay > 1 ? unitMany : unitOne} par jour` : null;
  if (!period || !qty) {
    const summaries = v.plannedSteps.map((p) => p.summary.trim().replace(/[.;\s]+$/, "")).filter(Boolean);
    const body = summaries.length ? summaries.join(" ; ") : `${orderTeamLabel(team)} s'en occupe`;
    return pick(RV.whatGeneric({ body, mode }), "order.what.generic", chatId);
  }
  const duration = days > 1 ? `pendant ${days} jours, ${period}` : period;
  const onTheme = theme ? ` sur ${theme}` : "";
  if (v.plan.asIfTeamKey) {
    const as = AS_IF_LABEL[v.plan.asIfTeamKey] ?? `un canal ${orderTeamLabel(v.plan.asIfTeamKey)}`;
    return pick(RV.whatAsIf({ where, as, duration, qty, onTheme, mode }), "order.what.asif", chatId);
  }
  return pick(RV.what({ where, duration, qty, onTheme, mode }), "order.what", chatId);
}

/** Ligne des bornes et des impossibles (pur), ou null. */
export function recapAdjustLine(v: Pick<ValidatedPlan, "clamped" | "impossible">): string | null {
  const parts: string[] = [];
  if (v.clamped.length) parts.push(RV.adjustClamped({ list: v.clamped.slice(0, 2).join(" ; ") })[0]!);
  const imp = v.impossible.slice(0, 2).map((i) => `${i.part} (${i.reason})`);
  if (imp.length) parts.push(RV.adjustImpossible({ list: imp.join(" ; ") })[0]!);
  return parts.length ? parts.join(" ") : null;
}

/** Chiffres permis pour le lissage de la première ligne (« aucun chiffre inventé »). */
function recapFacts(v: ValidatedPlan, draft: string): Record<string, unknown> {
  const nums: number[] = [];
  for (const d of [v.fromDay, v.toDay]) if (d) nums.push(...d.split("-").map(Number));
  return {
    jours: daysBetween(v.fromDay, v.toDay),
    parJour: perDayOf(v),
    dates: nums,
    brouillon: draft,
  };
}

const SMOOTH_SYSTEM = [
  KEVIN_VOICE,
  "Réécris le BROUILLON en une seule phrase plus naturelle, avec exactement les mêmes informations et les mêmes chiffres.",
  "N'ajoute rien, n'enlève rien, pas de guillemets autour. Réponds seulement par la phrase.",
].join("\n");

/** Lisse une ligne écrite par le code (Haiku), contrôlée : même nombre de lignes, aucun chiffre inventé, voix. */
export async function smoothLine(deps: BossDeps, draft: string, facts: Record<string, unknown>): Promise<{ text: string; costCents: number }> {
  if (!deps.llm) return { text: draft, costCents: 0 };
  try {
    const r = await deps.llm.write({ system: SMOOTH_SYSTEM, user: `FAITS (JSON) :\n${JSON.stringify(facts)}\n\nBROUILLON :\n${draft}` });
    const text = r.text.trim().replace(/^["«]\s*|\s*["»]$/g, "");
    if (!text || text.includes("\n") || text.length > draft.length * 1.6) return { text: draft, costCents: r.costCents };
    const allowed = allowedNumbers({ ...facts, brouillon: undefined, nombresDuBrouillon: (draft.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", "."))) });
    if (inventedNumbers(text, allowed).length) return { text: draft, costCents: r.costCents };
    if (!voiceCheck(text).ok) return { text: draft, costCents: r.costCents };
    return { text, costCents: r.costCents };
  } catch {
    return { text: draft, costCents: 0 };
  }
}

/** Récapitulatif d'un ordre validé : 3 lignes au plus (ce qui va se passer, ajustements, suite). */
export async function orderRecap(
  deps: BossDeps,
  v: ValidatedPlan,
  opts: { chatId?: bigint | string | null; cls?: OrderClass | null; tail?: string | null } = {},
): Promise<{ lines: string[]; costCents: number }> {
  const names = await channelNames(deps, v.channelIds);
  const scope = v.plan.scope as { test?: boolean; teamWide?: boolean };
  const where = v.channelIds.length
    ? v.channelIds.map((id) => names.get(id)?.name ?? "un canal").slice(0, 2).join(" et ")
    : scope.test
      ? "le canal Test"
      : `tous les canaux ${orderTeamLabel(workingTeam(v.plan))}`;
  const draft = recapWhatLine(v, where, opts.chatId);
  const smooth = await smoothLine(deps, draft, recapFacts(v, draft));
  const lines = [smooth.text];
  const adjust = recapAdjustLine(v);
  if (adjust) lines.push(adjust);
  if (opts.tail) lines.push(opts.tail);
  return { lines: lines.slice(0, 3), costCents: smooth.costCents };
}

// ------------------------------------------------------------------------------------------------ écriture

function storedOf(v: ValidatedPlan, extra: Partial<StoredInterpretation> = {}): StoredInterpretation {
  return JSON.parse(
    JSON.stringify({
      ...v.plan,
      channelIds: v.channelIds,
      fromDay: v.fromDay,
      toDay: v.toDay,
      plannedSteps: v.plannedSteps,
      clamped: v.clamped,
      ...extra,
    }),
  ) as StoredInterpretation;
}

function impossibleJson(list: readonly ImpossibleOut[]): unknown {
  return list.length ? JSON.parse(JSON.stringify(list.map(({ part, reason, alternatives }) => ({ part, reason, alternatives })))) : null;
}

async function writeOrder(deps: BossDeps, v: ValidatedPlan, ctx: OrderSubmitContext, data: { status: string; recap: string; alternatives?: Alternative[] }): Promise<TeamOrderRow> {
  const fromDay = v.fromDay;
  const toDay = v.toDay;
  const interp = storedOf(v, { raw: ctx.raw ?? null, ...(data.alternatives ? { alternatives: data.alternatives } : {}) } as Partial<StoredInterpretation>);
  const fields = {
    requestText: ctx.requestText.slice(0, 2000),
    interpretation: interp as never,
    recap: data.recap,
    kind: v.plan.kind,
    teamKey: workingTeam(v.plan),
    status: data.status as never,
    startsAt: fromDay ? parisDayStart(fromDay) : null,
    endsAt: toDay ? parisDayStart(addDaysToDay(toDay, 1)) : null,
    impossible: impossibleJson(v.impossible) as never,
    createdById: ctx.actor.userId,
    chatId: ctx.chat?.chatId != null ? ctx.chat.chatId.toString() : null,
    planCacheKey: ctx.cacheKey || null,
  };
  if (ctx.orderId) {
    const prev = await orderById(deps, ctx.orderId);
    return (await deps.prisma.teamOrder.update({
      where: { id: ctx.orderId },
      data: { ...fields, costCents: (prev?.costCents ?? 0) + Math.max(0, Math.round(ctx.plannerCostCents ?? 0)) },
    })) as unknown as TeamOrderRow;
  }
  return (await deps.prisma.teamOrder.create({
    data: { ...fields, createdAt: nowOf(deps), costCents: Math.max(0, Math.round(ctx.plannerCostCents ?? 0)) },
  })) as unknown as TeamOrderRow;
}

async function auditOrder(deps: BossDeps, action: string, order: Pick<TeamOrderRow, "id" | "number">, actor: BossActor, metadata: Record<string, unknown> = {}): Promise<void> {
  try {
    await deps.prisma.auditLog.create({
      data: { userId: actor.userId, action: `boss.order.${action}`, entityType: "TeamOrder", entityId: order.id, metadata: { via: "TELEGRAM", number: order.number, ...metadata } as never },
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[orders] journal non écrit");
  }
}

// ------------------------------------------------------------------------------------------------ replis

/** Phrase d'une raison (majuscule, point final). */
function sentence(s: string): string {
  const t = s.trim().replace(/[.\s]+$/, "");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

/**
 * Replis numérotés d'un ordre : la raison en une phrase, UNE proposition en question (OUI / NON quand aucune autre
 * confirmation n'attend), les autres par numéros (« 2 » rejoue sans IA). `launchPossible` : plan partiel, le choix 1
 * lance la partie possible.
 */
async function offerAlternatives(
  deps: BossDeps,
  order: TeamOrderRow,
  v: ValidatedPlan,
  ctx: OrderSubmitContext,
  opts: { launchPossible: boolean; head?: string | null },
): Promise<OrderReply> {
  const alts: Alternative[] = [];
  for (const i of v.impossible) for (const a of i.alternatives) if (alts.length < 4 && !alts.some((x) => x.label === a.label)) alts.push(a);
  const first = v.impossible[0];
  const reason = first ? sentence(`${first.part === "cette demande" ? "" : `${first.part} : `}${first.reason}`) : "";
  const options: { label: string; value: string }[] = [];
  if (opts.launchPossible) options.push({ label: RV.optionLaunchPossible[0]!, value: `${order.id}:go` });
  alts.forEach((a, i) => options.push({ label: a.label, value: `${order.id}:${i}` }));
  const shown = options.slice(0, 4);
  // Interprétation gardée avec les replis (le numéro rejoue sans IA).
  const interp = { ...(interpretationOf(order) ?? storedOf(v)), alternatives: alts } as StoredInterpretation & { alternatives: Alternative[] };
  await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { interpretation: JSON.parse(JSON.stringify(interp)) as never } });
  const execDeps = { ...deps, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null };
  if (!shown.length) {
    const none = pick(RV.altNone, "order.alt.none", ctx.chat?.chatId);
    return { reply: [opts.head, reason, none].filter(Boolean).map((l) => esc(l!)).join("\n"), status: "unmet", orderId: order.id };
  }
  await askToChoose(execDeps, { actionKey: ORDER_ALTERNATIVE_ACTION, params: {}, field: "choix", question: reason, options: shown });
  const top = shown[0]!;
  const question = opts.launchPossible
    ? pick(RV.altPartial, "order.alt.partial", ctx.chat?.chatId)
    : pick(RV.altOne({ label: top.label }), "order.alt.one", ctx.chat?.chatId);
  // Une seule confirmation à la fois : la proposition principale se confirme par OUI seulement si rien d'autre n'attend.
  const pending = await readBossPending(deps);
  let buttons: BossReply["buttons"];
  let pendingId: string | undefined;
  if (!(pending && !pending.expired)) {
    const r = await createBossPending(deps, {
      actionKey: ORDER_CONFIRM_ACTION,
      params: { ordre: order.id, op: "alt", choix: top.value },
      summary: question,
      chatId: ctx.chat?.chatId ?? (await adminTelegramId(deps)),
    });
    buttons = r.buttons;
    pendingId = r.pendingId;
  }
  const lines = [
    opts.head ?? null,
    `${reason} ${question}`.trim(),
    ...(shown.length > 1 ? shown.map((o, i) => `${i + 1}. ${o.label}`) : []),
    shown.length > 1
      ? pick(RV.altHow, "order.alt.how", ctx.chat?.chatId)
      : null,
  ].filter((l): l is string => !!l);
  return { reply: lines.map(esc).join("\n"), ...(buttons ? { buttons } : {}), ...(pendingId ? { pendingId } : {}), status: "clarify", orderId: order.id };
}

// ------------------------------------------------------------------------------------------------ transmission

/** Un membre qui n'est pas responsable ne lance rien lui-même (règles de la phase 26). */
async function memberMayLaunch(deps: BossDeps, speaker: BossSpeaker | null | undefined, cls: OrderClass): Promise<boolean> {
  if (!speaker || speaker.kind === "admin") return true;
  if (cls.cls === "confirm") return false;
  const m = await findTeamMember(deps, speaker.telegramUserId).catch(() => null);
  return !!m && (speaker.role === "MANAGER" || speaker.role === "ADMIN");
}

/** Lance un ordre DRAFT : confirmation si besoin (règle 4), sinon transmis au Grand Chef tout de suite. */
async function launchOrConfirm(deps: BossDeps, order: TeamOrderRow, v: ValidatedPlan, ctx: OrderSubmitContext): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const cls = await classifyOrder(deps, v);
  const allowed = await memberMayLaunch(deps, ctx.speaker, cls);
  if (cls.cls === "confirm" || !allowed) {
    const recap = await orderRecap(deps, v, { chatId });
    const why = cls.reasons.length ? pick(RV.waitYes({ reasons: cls.reasons.slice(0, 2).join(" et ") }), "order.wait.yes", chatId) : pick(RV.waitYesNone, "order.wait.yes", chatId);
    const summaryLines = [recap.lines[0]!, [recap.lines[1], why].filter(Boolean).join(" ")];
    const summary = summaryLines.join("\n");
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "WAITING_CONFIRM", recap: summary, costCents: order.costCents + recap.costCents } });
    if (ctx.speaker && ctx.speaker.kind === "member") {
      // Transmis à l'admin, qui seul confirme (jamais un vrai canal sans lui).
      const who = ctx.speaker.firstName;
      const adminChat = ctx.chat?.type === "group" ? ctx.chat.chatId : await adminTelegramId(deps);
      const r = await createBossPending(deps, {
        actionKey: ORDER_CONFIRM_ACTION,
        params: { ordre: order.id, op: "launch" },
        summary,
        chatId: adminChat,
        requestedBy: { telegramUserId: ctx.speaker.telegramUserId, firstName: who },
      });
      await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { pendingId: r.pendingId ?? null } });
      await auditOrder(deps, "escalated", order, ctx.actor, { by: ctx.speaker.telegramUserId.toString() });
      const name = esc(await adminFirstName(deps).catch(() => "l'admin"));
      if (ctx.chat?.type === "group")
        return { reply: pick(RV.memberAsksGroup({ admin: name, who: esc(who), body: r.reply ?? "" }), "order.member.asks", chatId), buttons: r.buttons, pendingId: r.pendingId, status: "confirm", orderId: order.id };
      try {
        const sent = await deps.admin?.send(pick(RV.memberAsksPrivate({ who: esc(who), body: r.reply ?? "" }), "order.member.asks"), { buttons: r.buttons });
        if (sent && r.pendingId) await rememberBossPendingMessage(deps, r.pendingId, sent.messageId);
      } catch (err) {
        deps.logger?.warn({ err: (err as Error).message }, "[orders] demande transmise non envoyée");
      }
      return { reply: pick(RV.memberHandedOver({ name }), "order.member", chatId), status: "confirm", orderId: order.id };
    }
    const r = await createBossPending(deps, { actionKey: ORDER_CONFIRM_ACTION, params: { ordre: order.id, op: "launch" }, summary, chatId });
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { pendingId: r.pendingId ?? null } });
    await auditOrder(deps, "confirm", order, ctx.actor);
    return { ...r, status: "confirm", orderId: order.id };
  }
  return startOrder(deps, order, v, ctx);
}

/** Transmet au Grand Chef (`runOrder`) et répond avec le récapitulatif (« annule » pendant 60 s si immédiat). */
export async function startOrder(deps: BossDeps, order: TeamOrderRow, v: ValidatedPlan | null, ctx: { actor: BossActor; chat?: BossChat | null; confirmed?: boolean }): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const tail = ctx.confirmed
    ? pick(RV.tailConfirmed, "order.tail.confirmed", chatId)
    : pick(RV.tailImmediate, "order.tail.immediate", chatId);
  let lines: string[];
  let cost = 0;
  const firstAt = v ? firstWindow(v.plannedSteps) : null;
  const fullTail = firstAt ? `${pick(RV.tailFirst({ at: firstAt }), "order.tail.first", chatId)} ${tail}` : tail;
  if (v) {
    const recap = await orderRecap(deps, v, { chatId, tail: fullTail });
    lines = recap.lines;
    cost = recap.costCents;
  } else lines = [order.recap.split("\n")[0] ?? "", fullTail].filter(Boolean);
  // Le récapitulatif annonce déjà le départ : le rapport « started » du Grand Chef n'est pas renvoyé en double.
  const before = await orderById(deps, order.id);
  const prog = (before?.progress && typeof before.progress === "object" ? before.progress : {}) as Record<string, unknown>;
  const reported = Array.isArray(prog.kevinReportedDays) ? (prog.kevinReportedDays as string[]) : [];
  await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { progress: JSON.parse(JSON.stringify({ ...prog, kevinReportedDays: [...reported, "started"] })) as never } });
  const r = await runOrder(deps, order.id).catch((err: Error) => ({ ok: false, message: err.message }));
  if (!r.ok) {
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
    await auditOrder(deps, "failed", order, ctx.actor, { message: (r.message ?? "").slice(0, 160) });
    return {
      reply: esc(pick(RV.startFailed({ reason: r.message ?? "erreur interne" }), "order.start.failed", chatId)),
      status: "error",
      orderId: order.id,
    };
  }
  const fresh = await orderById(deps, order.id);
  await deps.prisma.teamOrder.update({
    where: { id: order.id },
    data: { status: (fresh && fresh.status !== "DRAFT" && fresh.status !== "WAITING_CONFIRM" ? fresh.status : "RUNNING") as never, recap: lines.slice(0, 2).join("\n"), costCents: (fresh?.costCents ?? order.costCents) + cost },
  });
  if (!ctx.confirmed) await writeSetting(deps, ORDER_QUICK_CANCEL_SETTING, { orderId: order.id, at: nowOf(deps).toISOString(), chatId: chatId != null ? chatId.toString() : null });
  await auditOrder(deps, "started", order, ctx.actor, { confirmed: !!ctx.confirmed });
  return { reply: lines.map(esc).join("\n"), status: "done", orderId: order.id };
}

/** Heure de début de la première fenêtre prévue (« 10 h »), ou null. */
function firstWindow(steps: readonly OrderStep[]): string | null {
  const starts = steps.flatMap((s) => (s.overrides ?? []).map((o) => o.windowStart)).filter((x): x is string => typeof x === "string" && /^\d{1,2}:\d{2}$/.test(x));
  if (!starts.length) return null;
  const [h, m] = starts.sort()[0]!.split(":").map(Number);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/**
 * Soumet un plan validé (temps 2 → récapitulatif → OUI ou lancement). Crée (ou met à jour) le `TeamOrder` : DRAFT →
 * WAITING_CONFIRM ou RUNNING ; CANCELLED pour une demande sans rien de possible (gardée pour le journal et le cache).
 */
export async function submitOrder(deps: BossDeps, v: ValidatedPlan, ctx: OrderSubmitContext): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const order = await writeOrder(deps, v, ctx, { status: "DRAFT", recap: "" });
  // Ce qui n'a pas pu être pris est noté une fois par demande (bilan hebdomadaire).
  const firstImpossible = v.impossible[0];
  if (firstImpossible && !ctx.orderId)
    await recordOrderUnmet(deps, {
      text: ctx.requestText,
      part: firstImpossible.part,
      teamKey: firstImpossible.teamKey ?? null,
      suggestedCapability: firstImpossible.suggestedCapability ?? null,
      orderId: order.id,
    });
  if (v.status === "overlap" && v.overlap) {
    const names = await channelNames(deps, [v.overlap.channelId]);
    const where = names.get(v.overlap.channelId)?.name ?? "ce canal";
    const question = pick(RV.overlap({ n: v.overlap.number, where }), "order.overlap", chatId);
    const options = [
      { label: RV.overlapNew({ n: v.overlap.number })[0]!, value: `new:${order.id}:${v.overlap.orderId}` },
      { label: RV.overlapOld[0]!, value: `old:${order.id}` },
    ];
    await askToChoose({ ...deps, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null } as BossDeps, { actionKey: ORDER_OVERLAP_ACTION, params: {}, field: "choix", question, options });
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { recap: question } });
    return { reply: [question, ...options.map((o, i) => `${i + 1}. ${o.label}`), pick(RV.overlapHow, "order.overlap.how", chatId)].map(esc).join("\n"), status: "clarify", orderId: order.id };
  }
  if (v.status === "question") {
    const q = v.plan.questions[0]!;
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", recap: q } });
    return { reply: esc(q), status: "clarify", orderId: order.id };
  }
  if (v.status === "empty") {
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    const r = await offerAlternatives(deps, order, v, ctx, { launchPossible: false });
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { recap: (r.reply ?? "").replace(/<[^>]+>/g, "").split("\n")[0] ?? "" } });
    return r;
  }
  if (v.status === "partial") {
    const recap = await orderRecap(deps, { ...v, impossible: [], clamped: v.clamped }, { chatId });
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { recap: recap.lines[0] ?? "" } });
    return offerAlternatives(deps, order, v, ctx, { launchPossible: true, head: recap.lines[0] ?? null });
  }
  return launchOrConfirm(deps, order, v, ctx);
}

/** Relit l'ordre stocké et le revalide (OUI, numéro choisi) : les bornes et le réel sont revérifiés. */
export async function revalidateStored(deps: BossDeps, order: TeamOrderRow, mutate?: (p: OrderPlan) => OrderPlan): Promise<ValidatedPlan | null> {
  const interp = interpretationOf(order);
  if (!interp) return null;
  const { channelIds: _c, fromDay: _f, toDay: _t, plannedSteps: _p, clamped: _cl, raw: _r, pendingChange: _pc, replaces: _rep, ...plan } = interp as StoredInterpretation & { alternatives?: unknown };
  delete (plan as { alternatives?: unknown }).alternatives;
  const base = JSON.parse(JSON.stringify(plan)) as OrderPlan;
  return validatePlan(deps, mutate ? mutate(base) : base, { excludeOrderId: order.id });
}

/** OUI à un ordre en attente (`confirmer_ordre` op « launch ») : revalidé puis transmis. */
export async function confirmOrderLaunch(deps: BossDeps, orderId: string, actor: BossActor): Promise<BossReply> {
  const order = await orderById(deps, orderId);
  if (!order) return { reply: pick(RV.orderLost, "order.lost") };
  if (order.status !== "WAITING_CONFIRM" && order.status !== "DRAFT")
    return { reply: pick(RV.already, "order.already", order.chatId) };
  const v = await revalidateStored(deps, order);
  if (!v || !v.steps.length) {
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    return { reply: esc(pick(RV.revalidateFailed, "order.revalidate.failed", order.chatId)) };
  }
  const chat: BossChat | null = order.chatId ? { type: BigInt(order.chatId) < 0n ? "group" : "private", chatId: BigInt(order.chatId) } : null;
  const { status: _s, orderId: _o, ...reply } = await startOrder(deps, order, v, { actor, chat, confirmed: true });
  return reply;
}

/** Rejoue un repli choisi (« 2 » ou OUI) sans IA : la capacité de l'`Alternative` remplace la partie impossible. */
export async function replayAlternative(
  deps: BossDeps,
  choice: string,
  ctx: { actor: BossActor; speaker?: BossSpeaker | null; chat?: BossChat | null },
): Promise<OrderReply> {
  const m = /^([^:]+):(go|\d+)$/.exec(choice.trim());
  if (!m) return { reply: pick(RV.choiceUnknown, "order.choice.unknown", ctx.chat?.chatId), status: "clarify" };
  const order = await orderById(deps, m[1]!);
  const interp = order ? (interpretationOf(order) as (StoredInterpretation & { alternatives?: Alternative[] }) | null) : null;
  if (!order || !interp) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  const sub: OrderSubmitContext = { requestText: order.requestText, actor: ctx.actor, speaker: ctx.speaker, chat: ctx.chat, orderId: order.id, raw: interp.raw ?? null, cacheKey: order.planCacheKey };
  if (m[2] === "go") {
    const v = await revalidateStored(deps, order, (p) => ({ ...p, impossible: [] }));
    if (!v || !v.steps.length) return { reply: pick(RV.nothingLeft, "order.nothing.left", ctx.chat?.chatId), status: "unmet" };
    return submitOrder(deps, { ...v, impossible: [], status: v.status === "partial" ? "ok" : v.status }, sub);
  }
  const alt = interp.alternatives?.[Number(m[2])];
  if (!alt) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  if (!alt.capability)
    return {
      reply: esc(pick(RV.altFree({ label: alt.label }), "order.alt.free", ctx.chat?.chatId)),
      status: "clarify",
    };
  const altCap = alt.capability;
  const v = await revalidateStored(deps, order, (p) => ({
    ...p,
    steps: [...p.steps.filter((s) => !(s.teamKey === altCap.teamKey && s.capability === altCap.key)), { teamKey: altCap.teamKey, capability: altCap.key, params: altCap.params }],
    theme: typeof altCap.params.theme === "string" ? altCap.params.theme : p.theme,
    impossible: [],
  }));
  if (!v) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  return submitOrder(deps, v, sub);
}

/** Choix après un chevauchement : garder le nouveau (l'ancien est arrêté) ou l'ancien (le nouveau est abandonné). */
export async function resolveOverlapChoice(deps: BossDeps, choice: string, ctx: { actor: BossActor; speaker?: BossSpeaker | null; chat?: BossChat | null }): Promise<OrderReply> {
  const parts = choice.split(":");
  const order = parts[1] ? await orderById(deps, parts[1]) : null;
  if (!order) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  if (parts[0] === "old") {
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await auditOrder(deps, "dropped", order, ctx.actor);
    return { reply: pick(RV.overlapKeptOld, "order.overlap.old", ctx.chat?.chatId), status: "done" };
  }
  const old = parts[2] ? await orderById(deps, parts[2]) : null;
  if (old) {
    await stopOrder(deps, old.id, ctx.actor, "remplacé par un nouvel ordre").catch(() => undefined);
    await auditOrder(deps, "replaced", old, ctx.actor, { by: order.id });
  }
  const v = await revalidateStored(deps, order);
  if (!v) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  return launchOrConfirm(deps, order, { ...v, overlap: null, status: v.steps.length ? (v.impossible.length ? "partial" : "ok") : "empty" }, {
    requestText: order.requestText,
    actor: ctx.actor,
    speaker: ctx.speaker,
    chat: ctx.chat,
    orderId: order.id,
  });
}

// ------------------------------------------------------------------------------------------------ annulation rapide

type QuickCancel = { orderId: string; at: string; chatId: string | null };

/**
 * « annule » dans la minute qui suit un ordre lancé sans confirmation (règle 4) : l'ordre est arrêté avant sa première
 * production. Rend la réponse, ou null pour laisser la suite du chemin rapide. Admin seulement, sans IA.
 */
export async function orderQuickCancel(
  deps: BossDeps,
  input: Pick<BossTeamInput, "speaker" | "chat" | "replyToMessageId">,
  ctx: { word: "yes" | "no" | "cancel" | null; pendingOpen: boolean },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  if (ctx.word !== "cancel" || ctx.pendingOpen) return null;
  if (input.speaker && input.speaker.kind === "member") return null;
  const q = (await readSetting(deps, ORDER_QUICK_CANCEL_SETTING)) as QuickCancel | undefined;
  if (!q || typeof q.orderId !== "string") return null;
  const now = nowOf(deps).getTime();
  if (now - new Date(q.at).getTime() > ORDER_LIMITS.immediateCancelMs) return null;
  const chat = input.chat?.chatId != null ? input.chat.chatId.toString() : null;
  if (q.chatId && chat && q.chatId !== chat) return null;
  await deps.prisma.setting.deleteMany({ where: { key: ORDER_QUICK_CANCEL_SETTING } });
  const order = await orderById(deps, q.orderId);
  if (!order) return null;
  const started = (await deps.prisma.agentMission.count({
    where: { orderId: order.id, OR: [{ postId: { not: null } }, { status: { in: ["DONE", "WAITING_VALIDATION"] } }] },
  })) as number;
  if (started > 0)
    return {
      reply: { reply: pick(RV.quickLate, "order.quick.late", chat) },
      actionKey: "annuler_ordre",
    };
  await stopOrder(deps, order.id, { userId: order.createdById, via: "TELEGRAM" }, "annulé dans la minute");
  await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  await auditOrder(deps, "cancelled", order, { userId: null, via: "TELEGRAM" }, { quick: true });
  return {
    reply: { reply: pick(RV.quickDone, "order.quick.done", chat) },
    actionKey: "annuler_ordre",
  };
}

export { workingTeam };
export type { ValidatedPlan, OrderStep };
