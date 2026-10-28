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
import { clearBossPending, createBossPending, deferBossPending, readBossPending, rememberBossPendingMessage } from "../boss/confirm";
import { askToChoose, clearClarify, readClarify } from "../boss/resolve";
import { adminFirstName, findTeamMember } from "../boss/team/members";
import { KEVIN_VOICE, pick, voiceCheck, voiceFidelityProblems, voiceTemplate, type VoiceTable } from "../boss/voice";
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
import { capability, runOrder, stopOrder } from "./ports";
import type { PlannedOrder } from "./planner";
import { recordOrderUnmet } from "./unmet";
import { stepsPerDay, stepsTheme, validatePlan, workingTeam, type ImpossibleOut, type OverlapInfo, type ValidatedPlan } from "./validate";
import { kevinReplyId, qaKevinLine } from "../qa-gates/kevin";

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
  reasonUnknown: ["ça peut toucher un vrai canal", "ça pourrait toucher un vrai canal"],
  reasonSetting: ["ça change un réglage", "ça change un réglage durable"],
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
  altHowNumbers: ["Réponds par le numéro.", "Dis-moi le numéro."],
  aiPart: ["une partie de la demande", "une partie de ce que tu demandes"],
  aiReason: ["ce n'est pas faisable avec ce que les équipes savent faire aujourd'hui", "les équipes ne savent pas encore faire ça"],
  aiAlt: ["une autre façon de faire", "une solution de rechange"],
  aiQuestion: [
    "Il me manque une précision : tu me redis ta demande avec le canal et la durée ?",
    "Je n'ai pas tout : tu me redonnes le canal et la durée ?",
  ],
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
  startFailed: ["Ça n'a pas pu démarrer, rien n'est parti. Redemande-moi et je relance.", "Raté au démarrage, rien n'est sorti. Redemande-moi et je relance."],
  startBlocked: ["C'est prêt, mais l'équipe est arrêtée ou au plafond : rien ne part tant que ce n'est pas réglé. Je te préviens dès que ça repart.", "Ordre posé, mais l'équipe ne peut pas produire pour l'instant (pause ou plafond). Je te dis quand ça repart."],
  overlapAdmin: voiceTemplate<{ admin: string }>([{ admin: "Mathéo" }], (p) => [`Ça touche un vrai canal : c'est ${p.admin} qui choisit lequel garder.`, `Sur un vrai canal, c'est ${p.admin} qui tranche.`]),
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
  quickOnTheWay: [
    "C'est déjà en route : l'équipe a commencé. Dis-moi « arrête l'ordre » et je coupe tout ce qui n'a pas commencé.",
    "Trop tard pour l'annuler d'un mot, l'équipe a déjà commencé. Écris « arrête l'ordre » et je stoppe le reste.",
  ],
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

/** Ce que touche une étape : sa déclaration, sinon ses dérogations ; null = inconnu (pur). */
export function stepTouches(step: OrderStep): NonNullable<OrderStep["touches"]> | null {
  if (step.touches) return step.touches;
  if (step.overrides?.length) return { channelIds: step.overrides.map((o) => o.channelId) };
  return null;
}

/** Réglages réservés à l'admin (un membre les transmet, jamais il ne les lance). */
export const ADMIN_ONLY_CAPABILITIES = new Set([
  "changer_plan",
  "changer_categorie",
  "consignes_canal",
  "mot_interdit_canal",
  "appliquer_reglage",
  "annuler_reglage",
  "lancer_test_ab",
  "pause_reprise",
  "mode",
  // Phase 35 : tester un bookmaker connecte le compte du client (même la nuit) : l'admin seul, comme la commande directe.
  "tester_site",
]);

/** Un des réglages de l'ordre est réservé à l'admin (pur). */
export function adminOnlyOrder(v: Pick<ValidatedPlan, "plannedSteps">): boolean {
  return v.plannedSteps.some((s) => s.touches?.setting === true || ADMIN_ONLY_CAPABILITIES.has(s.capability));
}

/**
 * Classe d'un ordre validé (règle 4), décidée sur ce que les étapes déclarent TOUCHER (jamais sur la portée donnée par
 * l'IA) : OUI dès qu'un vrai canal ou toute une équipe est touché (tout réglage hors canal Test), qu'on ne sait pas ce
 * qui est touché, qu'une équipe passe en vrai, qu'il y a une dépense chez un fournisseur, ou au-delà de 7 jours (durée
 * réelle : période de l'ordre ou durée de ce qui est lancé, test A/B compris) ; sinon immédiat.
 */
export async function classifyOrder(deps: BossDeps, v: Pick<ValidatedPlan, "plan" | "steps" | "plannedSteps" | "channelIds" | "fromDay" | "toDay" | "costCents">): Promise<OrderClass> {
  const reasons: string[] = [];
  const touches = v.plannedSteps.map(stepTouches);
  const unknown = touches.some((t) => !t) || (v.steps.length > 0 && v.plannedSteps.length === 0);
  const ids = [...new Set(touches.flatMap((t) => t?.channelIds ?? []))];
  const names = await channelNames(deps, ids);
  // Un canal introuvable compte comme un vrai canal.
  const realChannel = touches.some((t) => t?.teamWide === true) || ids.some((id) => names.get(id)?.isTest !== true);
  if (realChannel) reasons.push(RV.reasonReal[0]!);
  else if (unknown) reasons.push(RV.reasonUnknown[0]!);
  const goesReal = v.plan.mode === "real" || v.steps.some((s) => s.capability.key === "mode");
  if (goesReal) reasons.push(RV.reasonGoesReal[0]!);
  const team = workingTeam(v.plan);
  const mediaSpend =
    team === "dating" &&
    (v.plan.format === "video" ||
      v.plan.format === "photo" ||
      v.plannedSteps.some((p) => (p.overrides ?? []).some((o) => o.format === "video" || o.format === "photo" || (o.mix && ((o.mix.video ?? 0) > 0 || (o.mix.photo ?? 0) > 0)))));
  if (v.costCents > 0 || mediaSpend) reasons.push(v.costCents > 0 ? RV.reasonCost({ amount: eur(v.costCents) })[0]! : RV.reasonMedia[0]!);
  const ranDays = touches.reduce((m, t) => Math.max(m, typeof t?.days === "number" ? t.days : 0), 0);
  const days = Math.max(daysBetween(v.fromDay, v.toDay), ranDays);
  if (days > ORDER_LIMITS.confirmOverDays) reasons.push(RV.reasonDays({ days })[0]!);
  return { cls: reasons.length ? "confirm" : "immediate", reasons, days };
}

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

// ------------------------------------------------------------------------------------------------ récapitulatif

const AS_IF_LABEL: Record<string, string> = { sports: "un canal paris", casino: "un canal casino", dating: "un canal rencontres", algo: "un canal suivi par l'Algorithme" };

function themeWord(theme: string | null | undefined): string | null {
  if (!theme) return null;
  const t = theme.trim();
  const low = `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  return /^(les|le|la|l')\b/i.test(low) ? low : `les ${low}`;
}

/** Quantité par jour BORNÉE (celle des étapes validées), jamais celle proposée par le planificateur. */
function perDayOf(v: Pick<ValidatedPlan, "plan" | "plannedSteps">): number | null {
  return stepsPerDay(v.plannedSteps);
}

/** Mode RÉEL qui s'appliquera : « en vrai » seulement si une dérogation part sur un vrai canal, l'ordre en vrai et
 * l'équipe en vrai ; un réglage écrit sur un vrai canal est toujours « en vrai ». */
export async function effectiveOrderMode(deps: BossDeps, v: Pick<ValidatedPlan, "plan" | "plannedSteps">): Promise<"real" | "simulation"> {
  const overrides = v.plannedSteps.flatMap((s) => s.overrides ?? []);
  if (overrides.length) {
    if (v.plan.mode !== "real") return "simulation";
    const live = overrides.filter((o) => !o.isTest);
    if (!live.length) return "simulation";
    for (const team of new Set(live.map((o) => o.teamKey))) {
      const row = (await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: team } }).catch(() => null)) as { simulation?: boolean } | null;
      if (row?.simulation === false) return "real";
    }
    return "simulation";
  }
  const settings = v.plannedSteps.filter((s) => s.touches?.setting);
  if (!settings.length) return v.plan.mode === "real" ? "real" : "simulation";
  if (settings.some((s) => s.touches?.teamWide)) return "real";
  const ids = [...new Set(settings.flatMap((s) => s.touches?.channelIds ?? []))];
  const names = await channelNames(deps, ids);
  return ids.some((id) => names.get(id)?.isTest !== true) ? "real" : "simulation";
}

/** Première ligne (ce qui va se passer), écrite par le code (pur, données déjà lues). */
export function recapWhatLine(
  v: Pick<ValidatedPlan, "plan" | "plannedSteps" | "fromDay" | "toDay">,
  where: string,
  chatId?: bigint | string | null,
  realMode?: "real" | "simulation",
): string {
  const team = workingTeam(v.plan);
  const unitMany = team === "sports" ? "paris" : "posts";
  const unitOne = team === "sports" ? "pari" : "post";
  const perDay = perDayOf(v as ValidatedPlan);
  const days = daysBetween(v.fromDay, v.toDay);
  const period = v.fromDay && v.toDay ? periodLabel(v.fromDay, v.toDay) : null;
  const theme = themeWord(stepsTheme(v.plannedSteps));
  const mode = (realMode ?? (v.plan.mode === "real" ? "real" : "simulation")) === "real" ? "en vrai" : "pour de faux";
  const qty = perDay ? `${perDay} ${perDay > 1 ? unitMany : unitOne} par jour` : null;
  if (!period || !qty) {
    const summaries = v.plannedSteps.map((p) => p.summary.trim().replace(/[.;\s]+$/, "").replace(/, (pour de faux|en vrai)$/, "")).filter(Boolean);
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
  if (v.clamped.length) parts.push(RV.adjustClamped({ list: v.clamped.slice(0, 3).join(" ; ") })[0]!);
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
    // Même sens que le brouillon (rien d'ajouté, rien d'enlevé : canal, quantité, mode…).
    if (voiceFidelityProblems(draft, text).length) return { text: draft, costCents: r.costCents };
    // Phase 30 : la ligne lissée par l'IA passe le QA Global ; refusée ou QA indisponible → le brouillon du code.
    const checked = await qaKevinLine(deps, { contentId: kevinReplyId("order-line", { draft }), question: "récapitulatif d'un ordre", dataConsulted: facts, aiText: text, codeText: draft });
    return { text: checked, costCents: r.costCents };
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
  const where = v.channelIds.length
    ? v.channelIds.map((id) => names.get(id)?.name ?? "un canal").slice(0, 2).join(" et ")
    : `tous les canaux ${orderTeamLabel(workingTeam(v.plan))}`;
  const draft = recapWhatLine(v, where, opts.chatId, await effectiveOrderMode(deps, v));
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

// ------------------------------------------------------------------------------------------------ choix ouverts

/** Choix ouvert d'un ordre (replis numérotés ou « lequel garder ? ») : jeton à usage unique. */
type OpenChoice = { token: string; kind: "alt" | "overlap"; at: string };

const newToken = () => Math.random().toString(36).slice(2, 10);

async function writeInterp(deps: BossDeps, orderId: string, patch: Record<string, unknown>): Promise<void> {
  const row = await orderById(deps, orderId);
  const interp = (row ? (interpretationOf(row) ?? {}) : {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...interp, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  await deps.prisma.teamOrder.update({ where: { id: orderId }, data: { interpretation: JSON.parse(JSON.stringify(next)) as never } });
}

async function openChoice(deps: BossDeps, orderId: string, kind: OpenChoice["kind"]): Promise<string> {
  const token = newToken();
  await writeInterp(deps, orderId, { choice: { token, kind, at: nowOf(deps).toISOString() } satisfies OpenChoice });
  return token;
}

function choiceOf(order: TeamOrderRow): OpenChoice | null {
  const c = (interpretationOf(order) as { choice?: unknown } | null)?.choice as OpenChoice | undefined;
  return c && typeof c.token === "string" ? c : null;
}

/**
 * Ferme tout ce qui reste ouvert pour un ordre dès qu'un choix est fait (OUI, « 2 », « 1 » du chevauchement) : jeton
 * du choix, question numérotée et confirmation OUI / NON qui le visent. Un OUI ou un numéro tardif ne rejoue plus rien.
 */
export async function closeOrderChoices(deps: BossDeps, orderId: string): Promise<void> {
  try {
    const row = await orderById(deps, orderId);
    if (row && choiceOf(row)) await writeInterp(deps, orderId, { choice: undefined });
    const clarify = await readClarify(deps);
    if (clarify && [ORDER_ALTERNATIVE_ACTION, ORDER_OVERLAP_ACTION].includes(clarify.actionKey) && clarify.options.some((o) => o.value.includes(orderId))) await clearClarify(deps);
    const pending = await readBossPending(deps);
    if (pending && pending.actionKey === ORDER_CONFIRM_ACTION && pending.params.ordre === orderId) await clearBossPending(deps, pending.id);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, orderId }, "[orders] choix non fermés");
  }
}

/** Statuts d'un ordre dont un choix peut encore être fait (un ordre en cours, fini ou arrêté : jamais). */
const CHOOSABLE = ["DRAFT", "WAITING_CONFIRM", "CANCELLED"];

// ------------------------------------------------------------------------------------------------ replis

/** Phrase d'une raison (majuscule, point final). */
function sentence(s: string): string {
  const t = s.trim().replace(/[.\s]+$/, "");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

/** Nombres du contexte réel d'un ordre (demande, période, étapes, bornes) : seuls permis dans un texte de l'IA. */
function contextNumbers(v: ValidatedPlan, requestText: string): ReturnType<typeof allowedNumbers> {
  const fromText = (requestText.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
  const days = [v.fromDay, v.toDay, v.plan.period?.start].filter((d): d is string => !!d).flatMap((d) => d.split("-").map(Number));
  return allowedNumbers({
    fromText,
    days,
    period: v.plan.period?.days ?? null,
    steps: v.plannedSteps.map((p) => ({ o: p.overrides ?? [], params: p.params })),
    clamped: v.clamped.flatMap((c) => (c.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")))),
    limits: [ORDER_LIMITS.maxDays, ORDER_LIMITS.confirmOverDays],
  });
}

/** Texte écrit par l'IA (planificateur) : gardé seulement s'il passe la voix de Kevin et n'invente aucun chiffre. */
function safeAiText(text: string, allowed: ReturnType<typeof allowedNumbers>, fallback: string): string {
  const t = text.trim();
  if (!t || t.length > 240) return fallback;
  if (inventedNumbers(t, allowed).length) return fallback;
  if (!voiceCheck(t).ok) return fallback;
  return t;
}

/**
 * Replis numérotés d'un ordre : la raison en une phrase, UNE proposition en question (OUI / NON) SEULEMENT si aucune
 * autre confirmation n'attend (sinon un OUI confirmerait l'ancienne : choix par numéro uniquement), les autres par
 * numéros (« 2 » rejoue sans IA). `launchPossible` : plan partiel, le choix 1 lance la partie possible. Les textes du
 * planificateur (partie, raison, libellés des replis) passent la voix et le contrôle « aucun chiffre inventé ».
 */
async function offerAlternatives(
  deps: BossDeps,
  order: TeamOrderRow,
  v: ValidatedPlan,
  ctx: OrderSubmitContext,
  opts: { launchPossible: boolean; head?: string | null },
): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const nums = contextNumbers(v, ctx.requestText);
  const alts: Alternative[] = [];
  for (const i of v.impossible)
    for (const a of i.alternatives) {
      if (alts.length >= 4) break;
      const label = i.fromAi
        ? safeAiText(a.label, nums, a.capability ? (capabilityLabel(a.capability.teamKey, a.capability.key) ?? pick(RV.aiAlt, "order.ai.alt", chatId)) : pick(RV.aiAlt, "order.ai.alt", chatId))
        : a.label;
      if (!alts.some((x) => x.label === label)) alts.push({ ...a, label });
    }
  const first = v.impossible[0];
  let reason = "";
  if (first) {
    const part = first.part === "cette demande" ? "" : first.fromAi ? safeAiText(first.part, nums, pick(RV.aiPart, "order.ai.part", chatId)) : first.part;
    const why = first.fromAi ? safeAiText(first.reason, nums, pick(RV.aiReason, "order.ai.reason", chatId)) : first.reason;
    reason = sentence(`${part ? `${part} : ` : ""}${why}`);
  }
  const token = await openChoice(deps, order.id, "alt");
  const options: { label: string; value: string }[] = [];
  if (opts.launchPossible) options.push({ label: RV.optionLaunchPossible[0]!, value: `${order.id}:go:${token}` });
  alts.forEach((a, i) => options.push({ label: a.label, value: `${order.id}:${i}:${token}` }));
  const shown = options.slice(0, 4);
  // Interprétation gardée avec les replis (le numéro rejoue sans IA).
  await writeInterp(deps, order.id, { alternatives: JSON.parse(JSON.stringify(alts)) });
  const execDeps = { ...deps, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null };
  if (!shown.length) {
    await writeInterp(deps, order.id, { choice: undefined });
    const none = pick(RV.altNone, "order.alt.none", chatId);
    return { reply: [opts.head, reason, none].filter(Boolean).map((l) => esc(l!)).join("\n"), status: "unmet", orderId: order.id };
  }
  await askToChoose(execDeps, { actionKey: ORDER_ALTERNATIVE_ACTION, params: {}, field: "choix", question: reason, options: shown });
  const top = shown[0]!;
  // Une seule confirmation à la fois : avec une confirmation déjà ouverte, AUCUNE question en OUI (choix par numéro).
  const pending = await readBossPending(deps);
  const pendingOpen = !!pending && !pending.expired;
  let buttons: BossReply["buttons"];
  let pendingId: string | undefined;
  let question: string | null = null;
  if (!pendingOpen) {
    question = opts.launchPossible ? pick(RV.altPartial, "order.alt.partial", chatId) : pick(RV.altOne({ label: top.label }), "order.alt.one", chatId);
    const r = await createBossPending(deps, {
      actionKey: ORDER_CONFIRM_ACTION,
      params: { ordre: order.id, op: "alt", choix: top.value },
      summary: question,
      chatId: ctx.chat?.chatId ?? (await adminTelegramId(deps)),
    });
    buttons = r.buttons;
    pendingId = r.pendingId;
  }
  const listed = pendingOpen || shown.length > 1;
  const lines = [
    opts.head ?? null,
    `${reason} ${question ?? ""}`.trim(),
    ...(listed ? shown.map((o, i) => `${i + 1}. ${o.label}`) : []),
    listed ? (pendingOpen ? pick(RV.altHowNumbers, "order.alt.how", chatId) : pick(RV.altHow, "order.alt.how", chatId)) : null,
  ].filter((l): l is string => !!l);
  return { reply: lines.map(esc).join("\n"), ...(buttons ? { buttons } : {}), ...(pendingId ? { pendingId } : {}), status: "clarify", orderId: order.id };
}

/** Libellé d'une capacité du registre (repli de l'IA dont le libellé n'a pas passé le contrôle). */
function capabilityLabel(teamKey: string, key: string): string | null {
  const c = capability(teamKey, key);
  return c ? `${c.description.charAt(0).toLowerCase()}${c.description.slice(1)}`.slice(0, 100) : null;
}

// ------------------------------------------------------------------------------------------------ transmission

/**
 * Un membre qui n'est pas responsable ne lance rien lui-même (règles de la phase 26) ; les réglages (plan d'un canal,
 * catégorie, consignes, mots interdits, réglages de l'Algorithme, test A/B, reprise, mode) sont réservés
 * à l'admin : un membre les lui transmet.
 */
async function memberMayLaunch(deps: BossDeps, speaker: BossSpeaker | null | undefined, cls: OrderClass, v?: Pick<ValidatedPlan, "plannedSteps">): Promise<boolean> {
  if (!speaker || speaker.kind === "admin") return true;
  if (cls.cls === "confirm") return false;
  if (v && adminOnlyOrder(v)) return false;
  const m = await findTeamMember(deps, speaker.telegramUserId).catch(() => null);
  return !!m && (speaker.role === "MANAGER" || speaker.role === "ADMIN");
}

/** Lance un ordre DRAFT : confirmation si besoin (règle 4), sinon transmis au Grand Chef tout de suite. */
async function launchOrConfirm(deps: BossDeps, order: TeamOrderRow, v: ValidatedPlan, ctx: OrderSubmitContext): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const cls = await classifyOrder(deps, v);
  const allowed = await memberMayLaunch(deps, ctx.speaker, cls, v);
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
      const requestedBy = { telegramUserId: ctx.speaker.telegramUserId.toString(), firstName: who };
      // Gardé pour prévenir le membre si sa demande est annulée faute de OUI (`sweepStaleOrderConfirmations`).
      await writeInterp(deps, order.id, { requestedBy });
      const name0 = esc(await adminFirstName(deps).catch(() => "l'admin"));
      // L'admin a déjà une confirmation ouverte : la demande du membre est mise de côté (jamais de remplacement).
      const current = await readBossPending(deps);
      if (current && !current.expired) {
        const text = pick(RV.memberAsksPrivate({ who: esc(who), body: esc(summary) }), "order.member.asks");
        await deferBossPending(deps, { actionKey: ORDER_CONFIRM_ACTION, params: { ordre: order.id, op: "launch" }, summary, text, chatId: ctx.chat?.type === "group" ? ctx.chat.chatId.toString() : null, requestedBy });
        await auditOrder(deps, "deferred", order, ctx.actor, { by: requestedBy.telegramUserId });
        return { reply: pick(RV.memberHandedOver({ name: name0 }), "order.member", chatId), status: "confirm", orderId: order.id };
      }
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

/** Question « lequel garder ? » (chevauchement), choix numérotés à usage unique. */
async function askOverlap(deps: BossDeps, order: TeamOrderRow, overlap: OverlapInfo, ctx: { speaker?: BossSpeaker | null; chat?: BossChat | null }): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const names = await channelNames(deps, [overlap.channelId]);
  const where = names.get(overlap.channelId)?.name ?? "ce canal";
  const question = pick(RV.overlap({ n: overlap.number, where }), "order.overlap", chatId);
  const token = await openChoice(deps, order.id, "overlap");
  const options = [
    { label: RV.overlapNew({ n: overlap.number })[0]!, value: `new:${order.id}:${overlap.orderId}:${token}` },
    { label: RV.overlapOld[0]!, value: `old:${order.id}:${token}` },
  ];
  await askToChoose({ ...deps, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null } as BossDeps, { actionKey: ORDER_OVERLAP_ACTION, params: {}, field: "choix", question, options });
  await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "DRAFT", recap: question } });
  return { reply: [question, ...options.map((o, i) => `${i + 1}. ${o.label}`), pick(RV.overlapHow, "order.overlap.how", chatId)].map(esc).join("\n"), status: "clarify", orderId: order.id };
}

/**
 * Transmet au Grand Chef (`runOrder`) et répond avec le récapitulatif (« annule » pendant 60 s si immédiat). Refusé si
 * l'ordre n'attend plus de départ (déjà en cours, fini, arrêté) ; ferme confirmation et choix encore ouverts.
 */
export async function startOrder(deps: BossDeps, order: TeamOrderRow, v: ValidatedPlan | null, ctx: { actor: BossActor; chat?: BossChat | null; speaker?: BossSpeaker | null; confirmed?: boolean }): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  const current = await orderById(deps, order.id);
  if (!current || !["DRAFT", "WAITING_CONFIRM"].includes(current.status)) return { reply: pick(RV.already, "order.already", chatId), status: "done", orderId: order.id };
  await closeOrderChoices(deps, order.id);
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
  const r = await runOrder(deps, order.id).catch((err: Error) => ({ ok: false, message: err.message, status: undefined, conflicts: undefined }));
  if (!r.ok) {
    // Un autre ordre a pris le même canal entre-temps : la même question « lequel garder ? », jamais un échec.
    const c = r.conflicts?.[0];
    if (c) {
      const other = await orderById(deps, c.orderId);
      return askOverlap(deps, order, { orderId: c.orderId, number: c.number ?? other?.number ?? 0, recap: other?.recap ?? "", channelId: c.channelId }, ctx);
    }
    // Bloqué (équipe en pause, plafond) : l'ordre attend, il repartira tout seul.
    if (r.status === "BLOCKED") {
      await auditOrder(deps, "blocked", order, ctx.actor, { message: (r.message ?? "").slice(0, 160) });
      return { reply: esc(pick(RV.startBlocked, "order.start.blocked", chatId)), status: "done", orderId: order.id };
    }
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
    // Détail technique au journal seulement ; à l'admin, une phrase simple.
    await auditOrder(deps, "failed", order, ctx.actor, { message: (r.message ?? "").slice(0, 300) });
    deps.logger?.warn({ orderId: order.id, err: r.message }, "[orders] départ impossible");
    return { reply: esc(pick(RV.startFailed, "order.start.failed", chatId)), status: "error", orderId: order.id };
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

/** Refus marqué « précision demandée » par la capacité (« casino ou paris sportifs ? ») : une question, pas un manque. */
function isClarification(i: ValidatedPlan["impossible"][number]): boolean {
  return i.clarify === true;
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
 * Un ordre déjà en cours, fini ou arrêté n'est jamais remis en préparation (OUI ou numéro tardif).
 */
export async function submitOrder(deps: BossDeps, v: ValidatedPlan, ctx: OrderSubmitContext): Promise<OrderReply> {
  const chatId = ctx.chat?.chatId ?? null;
  if (ctx.orderId) {
    const prev = await orderById(deps, ctx.orderId);
    if (!prev || !CHOOSABLE.includes(prev.status)) return { reply: pick(RV.already, "order.already", chatId), status: "done", orderId: ctx.orderId };
  }
  const order = await writeOrder(deps, v, ctx, { status: "DRAFT", recap: "" });
  // Ce qui n'a pas pu être pris est noté une fois par demande (bilan hebdomadaire).
  // Une précision manquante (le thème…) avec des choix rejouables de la même équipe n'est pas une demande impossible.
  const firstImpossible = v.impossible.find((i) => !isClarification(i));
  if (firstImpossible && !ctx.orderId)
    await recordOrderUnmet(deps, {
      text: ctx.requestText,
      part: firstImpossible.part,
      teamKey: firstImpossible.teamKey ?? null,
      suggestedCapability: firstImpossible.suggestedCapability ?? null,
      orderId: order.id,
    });
  if (v.status === "overlap" && v.overlap) return askOverlap(deps, order, v.overlap, ctx);
  if (v.status === "question") {
    // Question écrite par le planificateur : voix de Kevin et aucun chiffre inventé, sinon la question du code.
    const q = safeAiText(v.plan.questions[0] ?? "", contextNumbers(v, ctx.requestText), pick(RV.aiQuestion, "order.ai.question", chatId));
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
  delete (plan as { choice?: unknown }).choice;
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
    await closeOrderChoices(deps, order.id);
    return { reply: esc(pick(RV.revalidateFailed, "order.revalidate.failed", order.chatId)) };
  }
  const chat: BossChat | null = order.chatId ? { type: BigInt(order.chatId) < 0n ? "group" : "private", chatId: BigInt(order.chatId) } : null;
  const { status: _s, orderId: _o, ...reply } = await startOrder(deps, order, v, { actor, chat, confirmed: true });
  return reply;
}

/**
 * Rejoue un repli choisi (« 2 » ou OUI) sans IA : la capacité de l'`Alternative` remplace la partie impossible. Valable
 * une seule fois (jeton du choix) et seulement tant que l'ordre n'est pas parti.
 */
export async function replayAlternative(
  deps: BossDeps,
  choice: string,
  ctx: { actor: BossActor; speaker?: BossSpeaker | null; chat?: BossChat | null },
): Promise<OrderReply> {
  const m = /^([^:]+):(go|\d+)(?::([a-z0-9]+))?$/.exec(choice.trim());
  if (!m) return { reply: pick(RV.choiceUnknown, "order.choice.unknown", ctx.chat?.chatId), status: "clarify" };
  const order = await orderById(deps, m[1]!);
  const interp = order ? (interpretationOf(order) as (StoredInterpretation & { alternatives?: Alternative[] }) | null) : null;
  if (!order || !interp) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  const open = choiceOf(order);
  if (!CHOOSABLE.includes(order.status) || !open || open.kind !== "alt" || open.token !== m[3])
    return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  // Le choix est fait : la question numérotée et la proposition en OUI se ferment tout de suite.
  await closeOrderChoices(deps, order.id);
  const fresh = (await orderById(deps, order.id)) ?? order;
  const sub: OrderSubmitContext = { requestText: order.requestText, actor: ctx.actor, speaker: ctx.speaker, chat: ctx.chat, orderId: order.id, raw: interp.raw ?? null, cacheKey: order.planCacheKey };
  if (m[2] === "go") {
    const v = await revalidateStored(deps, fresh, (p) => ({ ...p, impossible: [] }));
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
  const v = await revalidateStored(deps, fresh, (p) => ({
    ...p,
    steps: [...p.steps.filter((s) => !(s.teamKey === altCap.teamKey && s.capability === altCap.key)), { teamKey: altCap.teamKey, capability: altCap.key, params: altCap.params }],
    theme: typeof altCap.params.theme === "string" ? altCap.params.theme : p.theme,
    impossible: [],
  }));
  if (!v) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  return submitOrder(deps, v, sub);
}

/**
 * Choix après un chevauchement : garder le nouveau ou l'ancien. L'ancien n'est arrêté qu'au LANCEMENT effectif du
 * nouveau (`TeamOrder.interpretation.replaces`, arrêté par le Grand Chef), jamais avant le OUI. Sur un vrai canal,
 * seul l'admin choisit.
 */
export async function resolveOverlapChoice(deps: BossDeps, choice: string, ctx: { actor: BossActor; speaker?: BossSpeaker | null; chat?: BossChat | null }): Promise<OrderReply> {
  const parts = choice.split(":");
  const order = parts[1] ? await orderById(deps, parts[1]) : null;
  const token = parts[0] === "new" ? parts[3] : parts[2];
  const open = order ? choiceOf(order) : null;
  if (!order || order.status !== "DRAFT" || !open || open.kind !== "overlap" || open.token !== token)
    return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  const v = await revalidateStored(deps, order);
  if (!v) return { reply: pick(RV.choiceStale, "order.choice.stale", ctx.chat?.chatId), status: "clarify" };
  if (ctx.speaker && ctx.speaker.kind === "member") {
    const ids = [...new Set([...v.channelIds, ...(v.overlap ? [v.overlap.channelId] : [])])];
    const names = await channelNames(deps, ids);
    if (!ids.length || ids.some((id) => names.get(id)?.isTest !== true)) {
      const admin = await adminFirstName(deps).catch(() => "l'admin");
      return { reply: esc(pick(RV.overlapAdmin({ admin }), "order.overlap.admin", ctx.chat?.chatId)), status: "clarify", orderId: order.id };
    }
  }
  await closeOrderChoices(deps, order.id);
  if (parts[0] === "old") {
    await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    await auditOrder(deps, "dropped", order, ctx.actor);
    return { reply: pick(RV.overlapKeptOld, "order.overlap.old", ctx.chat?.chatId), status: "done" };
  }
  const old = parts[2] ? await orderById(deps, parts[2]) : null;
  if (old) await writeInterp(deps, order.id, { replaces: old.id });
  const fresh = (await orderById(deps, order.id)) ?? order;
  return launchOrConfirm(deps, fresh, { ...v, overlap: null, status: v.steps.length ? (v.impossible.length ? "partial" : "ok") : "empty" }, {
    requestText: order.requestText,
    actor: ctx.actor,
    speaker: ctx.speaker,
    chat: ctx.chat,
    orderId: order.id,
  });
}

// ------------------------------------------------------------------------------------------------ annulation rapide

type QuickCancel = { orderId: string; at: string; chatId: string | null };

/** Mission pas encore commencée : en attente, aucune étape lancée (pur). */
function missionNotStarted(m: { status: string; steps: unknown }): boolean {
  if (m.status !== "PENDING") return false;
  const steps = Array.isArray(m.steps) ? (m.steps as Array<{ status?: string; startedAt?: unknown }>) : [];
  return steps.every((x) => (x.status === "PENDING" || x.status === "SKIPPED" || !x.status) && !x.startedAt);
}

/**
 * « annule » dans la minute qui suit un ordre lancé sans confirmation (règle 4) : l'ordre est arrêté s'il n'a encore
 * rien commencé ; dès qu'une production a démarré, Kevin le dit honnêtement (« déjà en route »). Ignoré pour un message
 * en « Répondre » à un autre, ou quand une question a été posée APRÈS l'ordre (elle a la priorité). Admin seulement,
 * sans IA ; journal au nom de la personne qui annule.
 */
export async function orderQuickCancel(
  deps: BossDeps,
  input: Pick<BossTeamInput, "speaker" | "chat" | "replyToMessageId">,
  ctx: { word: "yes" | "no" | "cancel" | null; pendingOpen: boolean; otherQuestionAt?: number },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  if (ctx.word !== "cancel" || ctx.pendingOpen) return null;
  if (input.speaker && input.speaker.kind === "member") return null;
  if (input.replyToMessageId != null) return null;
  const q = (await readSetting(deps, ORDER_QUICK_CANCEL_SETTING)) as QuickCancel | undefined;
  if (!q || typeof q.orderId !== "string") return null;
  const now = nowOf(deps).getTime();
  const at = new Date(q.at).getTime();
  if (now - at > ORDER_LIMITS.immediateCancelMs) return null;
  const chat = input.chat?.chatId != null ? input.chat.chatId.toString() : null;
  if (q.chatId && chat && q.chatId !== chat) return null;
  // Une question posée après l'ordre (précision, choix, demande au client) a la priorité sur « annule ».
  if ((ctx.otherQuestionAt ?? 0) > at) return null;
  const clarify = await readClarify(deps).catch(() => null);
  if (clarify && new Date(clarify.createdAt).getTime() > at) return null;
  const asked = (await deps.prisma.humanRequest.findFirst({ where: { status: "PENDING", askedAt: { gt: new Date(at) } } }).catch(() => null)) as unknown;
  if (asked) return null;
  await deps.prisma.setting.deleteMany({ where: { key: ORDER_QUICK_CANCEL_SETTING } });
  const order = await orderById(deps, q.orderId);
  if (!order) return null;
  const missions = (await deps.prisma.agentMission.findMany({ where: { orderId: order.id }, select: { status: true, steps: true, postId: true } })) as Array<{ status: string; steps: unknown; postId: string | null }>;
  const started = missions.filter((m) => m.status !== "CANCELLED" && (m.postId || !missionNotStarted(m)));
  if (started.length > 0)
    return {
      reply: { reply: pick(started.some((m) => m.postId || m.status === "DONE") ? RV.quickLate : RV.quickOnTheWay, "order.quick.late", chat) },
      actionKey: "annuler_ordre",
    };
  const actor = await speakerActor(deps, input.speaker ?? null);
  await stopOrder(deps, order.id, actor, "annulé dans la minute");
  await deps.prisma.teamOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  await auditOrder(deps, "cancelled", order, actor, { quick: true });
  return {
    reply: { reply: pick(RV.quickDone, "order.quick.done", chat) },
    actionKey: "annuler_ordre",
  };
}

/** Utilisateur du site lié à la personne qui parle (journal), sinon l'admin enregistré. */
async function speakerActor(deps: BossDeps, speaker: BossSpeaker | null): Promise<BossActor> {
  try {
    const tid = speaker?.telegramUserId ?? (await adminTelegramId(deps));
    if (tid == null) return { userId: null, via: "TELEGRAM" };
    const u = (await deps.prisma.user.findFirst({ where: { telegramUserId: BigInt(tid) }, select: { id: true } })) as { id: string } | null;
    return { userId: u?.id ?? null, via: "TELEGRAM" };
  } catch {
    return { userId: null, via: "TELEGRAM" };
  }
}

export { workingTeam };
export type { ValidatedPlan, OrderStep };
