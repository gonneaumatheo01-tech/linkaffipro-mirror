/**
 * Phase 27, chantier C — entrées du catalogue de Kevin pour le canal d'inspiration :
 * - `analyser_canal` (immédiate ; à CONFIRMER pour entrer par un lien d'invitation privé) : lien `t.me/x`, `@x` ou nom,
 *   ou « ces posts » transférés ; canal cible du client (même univers obligatoire) ; accusé « Je lis @x… » puis lecture
 *   en tâche (chantier A) ;
 * - `voir_inspiration` (immédiate) : résumé, détail d'une mesure, comparaison, exemples, propositions numérotées ;
 * - `appliquer_inspiration` : à confirmer, SAUF quand c'est la réponse au choix numéroté posé par Kevin (le choix vaut
 *   accord) ; « 1 3 », « 1 et 3 », « tout » ;
 * - `annuler_inspiration` (immédiate) : toutes les propositions appliquées d'une référence, ou une seule par numéro ;
 * - `retirer_reference` (à confirmer) : efface posts et profils, détache les plans.
 * Et le chemin rapide (`inspirationFastPath`, sans IA) : numéros en réponse au choix, nom d'un canal demandé après des
 * transferts masqués, « annule » juste après une application.
 * Les chiffres viennent du code (analyse du chantier B) ; une rédaction de l'IA n'est gardée que si elle n'invente aucun
 * chiffre (`checkedAnswer`).
 */
import { esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import { INSPIRATION_LIMITS, type InspirationAnalysis, type Measure } from "../inspiration/contract";
import { inspirationSummaryLines, measureOf, fr } from "../inspiration/kevin";
import { analyzeReference, compareWithChannel, enqueueReferenceRead, freeReaderAccounts, isInviteLink, joinWithInviteOnce, normalizeChannelUsername, prismaAccountHistoryReader, storeReferencePosts, type AccountJoinReader } from "../inspiration/kevin-ports";
import {
  activeReferences,
  askerOf,
  createReference,
  findReference,
  linkTarget,
  loadReferenceRow,
  referenceLabel,
  referencePostCount,
  rememberAsker,
  targetIdsOf,
  type ReferenceRow,
} from "../inspiration/kevin-refs";
import { inspirationNameAnswer, readForwardBatch } from "../inspiration/kevin-forward";
import { inspirationProposals, proposalsText } from "../inspiration/proposals";
import { applyInspiration, removeReference, undoInspiration } from "../inspiration/apply";
import { afterReferenceRead } from "../inspiration/kevin";
import type { BossAction, BossDeps, BossReply, BossTeamInput } from "./contract";
import { actorRef, defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { ANSWER_MAX_LINES, ANSWER_SYSTEM, checkedAnswer } from "./answer";
import { BossBudgetError } from "./llm";
import { int, oneOf, str } from "./params";
import { askToChoose, matchNames, resolveChannel } from "./resolve";

// ------------------------------------------------------------------------------------------ choix numéroté

export const INSPIRATION_CHOICE_SETTING = "inspiration.choice";
export const INSPIRATION_LAST_APPLIED_SETTING = "inspiration.lastApplied";
/** Le choix numéroté de Kevin vaut accord pendant 24 heures. */
export const INSPIRATION_CHOICE_TTL_MS = 24 * 3600_000;
/** « annule » seul annule la dernière application pendant 30 minutes. */
export const INSPIRATION_QUICK_UNDO_MS = 30 * 60_000;

export type InspirationChoice = {
  referenceChannelId: string;
  channelId: string;
  items: { n: number; ids: string[]; label: string }[];
  chatId: string | null;
  askedBy: string | null;
  createdAt: string;
  answeredAt: string | null;
};

type LastApplied = { referenceChannelId: string; ids: string[]; chatId: string | null; at: string };

export async function readInspirationChoice(deps: BossDeps): Promise<InspirationChoice | null> {
  const v = (await readSetting(deps, INSPIRATION_CHOICE_SETTING)) as InspirationChoice | undefined;
  return v && typeof v === "object" && Array.isArray(v.items) ? v : null;
}

/** Choix ouvert (posé, sans réponse, de moins de 24 h) : une réponse par numéros vaut accord. */
export function choiceIsOpen(c: InspirationChoice | null, now: Date): c is InspirationChoice {
  return !!c && !c.answeredAt && now.getTime() - new Date(c.createdAt).getTime() < INSPIRATION_CHOICE_TTL_MS;
}

/** « 1 3 », « 1 et 3 », « 1,3 », « n°2 », « tout » → numéros (pur) ; null si illisible. */
export function parseProposalNumbers(raw: string, max: number): number[] | null {
  const t = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*(?:applique[rsz]?|appliquez|vas[- ]y pour|ok pour|go pour|les|la|le|propositions?|numeros?|n°|no)\s*/g, "")
    .trim();
  if (/^(?:tout|tous|toutes|tout appliquer|les \d+|toutes les propositions)$/.test(t)) return Array.from({ length: max }, (_, i) => i + 1);
  if (!/^[\d\s,;et&+n°.-]+$/.test(t)) return null;
  const nums = [...new Set((t.match(/\d{1,2}/g) ?? []).map(Number))].sort((a, b) => a - b);
  if (!nums.length || nums.some((n) => n < 1 || n > max)) return null;
  return nums;
}

async function storeChoice(deps: BossExecDeps, refId: string, channelId: string, items: InspirationChoice["items"]): Promise<void> {
  const choice: InspirationChoice = {
    referenceChannelId: refId,
    channelId,
    items,
    chatId: deps.chat ? deps.chat.chatId.toString() : null,
    askedBy: deps.speaker && deps.speaker.kind === "member" ? deps.speaker.telegramUserId.toString() : "admin",
    createdAt: nowOf(deps).toISOString(),
    answeredAt: null,
  };
  await writeSetting(deps, INSPIRATION_CHOICE_SETTING, choice);
}

// ------------------------------------------------------------------------------------------ références

type RefCtx = { actionKey: string; params: Record<string, unknown>; field: string };

/** Référence nommée (« @x », lien, titre) ou, sans nom, la dernière dont on a parlé. */
async function resolveReference(deps: BossExecDeps, raw: string | undefined, ctx: RefCtx): Promise<{ ok: true; ref: ReferenceRow } | { ok: false; reply: BossReply }> {
  const refs = await activeReferences(deps);
  if (!refs.length) return { ok: false, reply: { reply: "Aucun canal d'inspiration pour le moment : envoie-moi son lien (t.me/…) ou transfère-moi ses posts." } };
  if (!raw) {
    const choice = await readInspirationChoice(deps);
    const chatKey = deps.chat?.chatId.toString();
    const batch = chatKey ? await readForwardBatch(deps, chatKey) : null;
    const pick = [choice?.referenceChannelId, batch?.lastRefId].map((id) => refs.find((r) => r.id === id)).find(Boolean) ?? refs[0]!;
    return { ok: true, ref: pick };
  }
  if (raw.startsWith("id:")) {
    const r = refs.find((x) => x.id === raw.slice(3));
    if (r) return { ok: true, ref: r };
  }
  const username = normalizeChannelUsername(raw);
  if (username) {
    const r = refs.find((x) => x.username?.toLowerCase() === username.toLowerCase());
    if (r) return { ok: true, ref: r };
  }
  const items = refs.map((r) => ({ id: r.id, name: referenceLabel(r), extra: [r.username ?? "", r.title ?? ""].filter(Boolean) }));
  const found = matchNames(raw, items);
  if (found.length === 1) return { ok: true, ref: refs.find((r) => r.id === found[0]!.id)! };
  if (found.length > 1)
    return { ok: false, reply: await askToChoose(deps, { ...ctx, question: `Plusieurs canaux d'inspiration correspondent à « ${raw} » :`, options: found.map((f) => ({ label: f.name, value: `id:${f.id}` })) }) };
  return { ok: false, reply: { reply: `Je ne connais pas le canal d'inspiration « ${esc(raw)} ». Connus : ${refs.slice(0, 8).map((r) => esc(referenceLabel(r))).join(", ")}.` } };
}

/** Recalcule les caractéristiques des posts rangés avant que l'univers soit connu (posts transférés, texte encore là). */
async function refreshFeatures(deps: BossDeps, refId: string): Promise<void> {
  const rows = (await deps.prisma.referencePost.findMany({ where: { referenceChannelId: refId } })) as {
    externalId: number;
    postedAt: Date;
    text: string | null;
    textPurgedAt: Date | null;
    mediaKind: string;
    views: number | null;
    hasButton: boolean;
    hasLink: boolean;
    via: "WEB" | "ACCOUNT" | "FORWARDED";
  }[];
  const live = rows.filter((r) => r.text && !r.textPurgedAt);
  if (!live.length) return;
  await storeReferencePosts(
    deps,
    refId,
    live.map((r) => ({ externalId: r.externalId, postedAt: r.postedAt, text: r.text, mediaKind: r.mediaKind as never, views: r.views, hasButton: r.hasButton, linkCount: r.hasLink ? 1 : 0 })),
    live[0]!.via,
  );
}

/** Rattache le canal cible ; univers fixé à cette occasion → caractéristiques recalculées. */
async function attachTarget(deps: BossExecDeps, ref: ReferenceRow, channelId: string): Promise<{ ok: true; ref: ReferenceRow; title: string } | { ok: false; reply: BossReply }> {
  const hadUniverse = ["dating", "casino", "sports"].includes(ref.universe);
  const r = await linkTarget(deps, ref, channelId);
  if (!r.ok) return { ok: false, reply: { reply: esc(r.message) } };
  if (!hadUniverse) await refreshFeatures(deps, ref.id).catch(() => undefined);
  await rememberAsker(deps, ref.id, askerOf(deps.speaker, deps.chat, channelId), channelId);
  return { ok: true, ref: r.ref, title: r.channel.title };
}

// ------------------------------------------------------------------------------------------ analyser_canal

type AnalyserParams = { canal?: string; canal_cible?: string };

type InspirationDeps = BossExecDeps & { inspirationReader?: AccountJoinReader | null };

function readerOf(deps: InspirationDeps): AccountJoinReader {
  return deps.inspirationReader ?? prismaAccountHistoryReader(deps.prisma);
}

async function freeAccount(deps: InspirationDeps): Promise<{ id: string; label: string } | null> {
  const reader = readerOf(deps) as AccountJoinReader & { available?: boolean };
  if (reader.available === false || !reader.joinWithInvite) return null;
  const ids = await freeReaderAccounts(deps.prisma, nowOf(deps));
  if (!ids.length) return null;
  const acc = (await deps.prisma.telegramUserAccount.findUnique({ where: { id: ids[0]! } })) as { id: string; label: string } | null;
  return acc ? { id: acc.id, label: acc.label } : null;
}

const FORWARD_ASK = `transfère-moi ${INSPIRATION_LIMITS.forwardMin} à ${INSPIRATION_LIMITS.forwardMax} de ses posts ici, je les range et je l'analyse.`;

export const analyserCanal = defineAction<AnalyserParams>({
  key: "analyser_canal",
  description: "S'inspirer d'un canal Telegram qui marche (lien t.me, @nom, ou les posts transférés) pour un de nos canaux : je le lis et je l'analyse",
  theme: "algorithme",
  cls: "immediate",
  spec: {
    canal: str("Canal à analyser : lien t.me/…, @nom ou nom (absent = les posts que je viens de recevoir en transfert)", { optional: true }),
    canal_cible: str("Notre canal qui doit s'en inspirer, tel que dit (« Roulette »)", { optional: true }),
  },
  async classify(_deps, p) {
    return p.canal && isInviteLink(p.canal) ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const acc = await freeAccount(deps as InspirationDeps);
    return `Entrer avec le compte ${acc?.label ?? "réel"} par ce lien ?\nUne seule tentative, débit lent ; je ne lis que les posts (aucun membre).${p.canal_cible ? ` Pour ${p.canal_cible}.` : ""}`;
  },
  async check(deps, p) {
    if (!p.canal || !isInviteLink(p.canal)) return null;
    const acc = await freeAccount(deps as InspirationDeps);
    if (!acc) return { reply: `Aucun compte réel libre ne peut entrer par ce lien (et je ne rejoins jamais un canal de moi-même) : ${FORWARD_ASK}` };
    if (!p.canal_cible) return { reply: "Pour quel de nos canaux ? Redis-moi la phrase avec le canal (par exemple « … pour Roulette »)." };
    return null;
  },
  async execute(d, p) {
    const deps = d as InspirationDeps;
    const params = p as Record<string, unknown>;
    // Canal cible.
    let targetId: string | null = null;
    if (p.canal_cible) {
      const t = await resolveChannel(deps, { actionKey: "analyser_canal", params, field: "canal_cible" }, p.canal_cible);
      if (!t.ok) return t.reply;
      targetId = t.value.id;
    }
    // « ces posts » : la dernière référence alimentée par des transferts dans cette conversation.
    if (!p.canal) {
      const chatKey = deps.chat?.chatId.toString();
      const batch = chatKey ? await readForwardBatch(deps, chatKey) : null;
      const ref = batch?.lastRefId ? await loadReferenceRow(deps, batch.lastRefId) : null;
      if (!ref) return { reply: `Donne-moi le lien du canal (t.me/…) ou son @nom, ou ${FORWARD_ASK}` };
      if (!targetId) {
        if (targetIdsOf(ref).length) return { reply: `${esc(referenceLabel(ref))} est déjà rattaché. Dis-moi pour quel canal, par exemple « c'est pour le canal Roulette ».` };
        const t = await resolveChannel(deps, { actionKey: "analyser_canal", params, field: "canal_cible" }, undefined);
        return t.ok ? { reply: "?" } : t.reply;
      }
      const a = await attachTarget(deps, ref, targetId);
      if (!a.ok) return a.reply;
      const n = await referencePostCount(deps, ref.id);
      const label = esc(referenceLabel(a.ref));
      if (n < INSPIRATION_LIMITS.minPostsForAnalysis) return { reply: `C'est noté : ${label} inspire ${esc(a.title)}. J'ai ${n} posts, il m'en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} : transfère-m'en d'autres.` };
      return { reply: `C'est noté : ${label} inspire ${esc(a.title)}. Je l'analyse (${n} posts), je reviens dans quelques minutes.`, followUp: () => afterReferenceRead(deps, ref.id) };
    }
    // Lien d'invitation privé : seulement après le OUI (cette entrée est « à confirmer »).
    if (isInviteLink(p.canal)) {
      const acc = await freeAccount(deps);
      if (!acc || !targetId) return { reply: `Aucun compte réel libre ne peut entrer par ce lien : ${FORWARD_ASK}` };
      const joined = await joinWithInviteOnce(readerOf(deps), acc.id, p.canal);
      if (!joined.ok) return { reply: `${esc(joined.message)} Sinon, ${FORWARD_ASK}` };
      const ref =
        (joined.chatId != null ? await findReference(deps, { chatId: joined.chatId }) : null) ??
        (await createReference(deps, { chatId: joined.chatId, title: joined.title, via: "ACCOUNT", universe: "", addedBy: deps.speaker?.telegramUserId ?? null, accountId: acc.id }));
      const a = await attachTarget(deps, ref, targetId);
      if (!a.ok) return a.reply;
      await enqueueReferenceRead(deps, ref.id);
      return { reply: `Le compte ${esc(acc.label)} est entré. Je lis ${esc(referenceLabel(a.ref))}, je reviens dans quelques minutes.` };
    }
    const username = normalizeChannelUsername(p.canal);
    const existingByName = username ? null : (await activeReferences(deps)).find((r) => matchNames(p.canal!, [{ id: r.id, name: referenceLabel(r), extra: [r.title ?? ""] }]).length > 0) ?? null;
    if (!username && !existingByName) {
      if (/t\.me\/c\//i.test(p.canal)) return { reply: `C'est un lien de canal privé : je ne peux pas le lire sans y être. ${FORWARD_ASK.charAt(0).toUpperCase()}${FORWARD_ASK.slice(1)}` };
      return { reply: "Donne-moi le lien du canal (t.me/nom) ou son @nom." };
    }
    let ref = existingByName ?? (await findReference(deps, { username }));
    if (!targetId) {
      const known = ref ? targetIdsOf(ref) : [];
      if (known.length) targetId = known[0]!;
      else {
        const t = await resolveChannel(deps, { actionKey: "analyser_canal", params, field: "canal_cible" }, undefined);
        return t.ok ? { reply: "?" } : t.reply;
      }
    }
    // Même univers obligatoire : vérifié avant toute création.
    ref ??= await createReference(deps, { username, via: "WEB", universe: "", addedBy: deps.speaker?.telegramUserId ?? null });
    const a = await attachTarget(deps, ref, targetId);
    if (!a.ok) {
      if (!targetIdsOf(ref).length && ref.postCount === 0 && !["dating", "casino", "sports"].includes(ref.universe))
        await deps.prisma.referenceChannel.update({ where: { id: ref.id }, data: { removedAt: nowOf(deps) } });
      return a.reply;
    }
    const label = esc(referenceLabel(a.ref));
    const fresh = a.ref.status === "READY" && a.ref.lastReadAt && nowOf(deps).getTime() - new Date(a.ref.lastReadAt).getTime() < 7 * 86_400_000;
    if (fresh && (await referencePostCount(deps, ref.id)) >= INSPIRATION_LIMITS.minPostsForAnalysis)
      return { reply: `Je connais déjà ${label} (lu récemment) : je te fais le point pour ${esc(a.title)}.`, followUp: () => afterReferenceRead(deps, ref!.id) };
    if (a.ref.status !== "READING") await deps.prisma.referenceChannel.update({ where: { id: ref.id }, data: { status: "READING" } });
    await enqueueReferenceRead(deps, ref.id);
    return { reply: `Je lis ${label}, je reviens dans quelques minutes.` };
  },
});

// ------------------------------------------------------------------------------------------ voir_inspiration

export const INSPIRATION_TOPICS = ["resume", "rythme", "heures", "forme", "fond", "resultats", "comparaison", "exemples", "propositions"] as const;
type Topic = (typeof INSPIRATION_TOPICS)[number];
type VoirParams = { sujet: Topic; reference?: string; canal_cible?: string; question?: string };

const isDetail = (k: string) => /^(?:slot|weekday)\./.test(k);

function measureLine(m: Measure): string | null {
  if (m.value === null || m.value === undefined) return null;
  const v = typeof m.value === "number" ? (m.unit === "%" ? `${fr(m.value)} %` : `${fr(m.value)}${m.unit ? ` ${m.unit}` : ""}`) : m.value;
  return `${m.label} : ${v}`;
}

/** Faits et lignes du code pour un sujet (pur). */
export function topicFacts(topic: Topic, a: InspirationAnalysis): { facts: Record<string, unknown>; lines: string[] } {
  const pick = (list: Measure[]) => list.filter((m) => m.value !== null);
  switch (topic) {
    case "rythme": {
      const list = pick(a.rhythm).filter((m) => !isDetail(m.key));
      return { facts: { rythme: list, postsLus: a.sampleSize }, lines: list.map(measureLine).filter((l): l is string => !!l) };
    }
    case "heures": {
      const slots = pick(a.rhythm)
        .filter((m) => m.key.startsWith("slot.") && typeof m.value === "number")
        .sort((x, y) => (y.value as number) - (x.value as number))
        .slice(0, 5);
      const share = measureOf(a, "peakShare");
      const days = pick(a.rhythm)
        .filter((m) => m.key.startsWith("weekday.") && typeof m.value === "number")
        .sort((x, y) => (y.value as number) - (x.value as number))
        .slice(0, 2);
      return {
        facts: { heuresDePointe: a.peakSlots, tranches: slots, partDansLaPointe: share ?? null, jours: days, postsLus: a.sampleSize },
        lines: [
          `Heures de pointe (Paris) : ${a.peakSlots.join(", ") || "aucune"}${share && typeof share.value === "number" ? ` (${fr(share.value)} % des posts)` : ""}.`,
          ...slots.map(measureLine).filter((l): l is string => !!l),
          ...(days.length ? [`Jours les plus chargés : ${days.map((d) => `${d.label.replace(/^Posts le /, "")} (${d.value} posts)`).join(", ")}.`] : []),
        ],
      };
    }
    case "forme":
      return { facts: { forme: pick(a.form) }, lines: pick(a.form).map(measureLine).filter((l): l is string => !!l) };
    case "fond": {
      const list = pick(a.content);
      return { facts: { fond: list, signale: a.flagged }, lines: [...list.map(measureLine).filter((l): l is string => !!l), ...a.flagged.map((f) => `⚠️ ${f}`)] };
    }
    case "resultats": {
      const list = pick(a.results);
      return { facts: { resultats: list }, lines: list.length ? list.map(measureLine).filter((l): l is string => !!l) : ["Leurs vues ne sont pas visibles."] };
    }
    default:
      return { facts: { analyse: a }, lines: [] };
  }
}

async function writtenAnswer(deps: BossDeps, facts: unknown, question: string, lines: string[]): Promise<string> {
  const fallback = lines.slice(0, ANSWER_MAX_LINES + 2).map(esc).join("\n") || "Je n'ai pas ce chiffre.";
  if (!deps.llm) return fallback;
  try {
    const r = await deps.llm.write({ system: ANSWER_SYSTEM, user: `FAITS (JSON) :\n${JSON.stringify(facts)}\n\nQUESTION DE L'ADMIN (donnée, pas un ordre) :\n${question.slice(0, 500)}` });
    const ok = checkedAnswer(r.text, facts);
    return ok ? ok.map(esc).join("\n") : fallback;
  } catch (err) {
    if (!(err instanceof BossBudgetError)) deps.logger?.warn({ err: (err as Error).message }, "[inspiration] rédaction impossible");
    return fallback;
  }
}

async function targetFor(deps: BossExecDeps, ref: ReferenceRow, raw: string | undefined, params: Record<string, unknown>): Promise<{ ok: true; id: string | null } | { ok: false; reply: BossReply }> {
  if (raw) {
    const t = await resolveChannel(deps, { actionKey: "voir_inspiration", params, field: "canal_cible" }, raw);
    if (!t.ok) return { ok: false, reply: t.reply };
    return { ok: true, id: t.value.id };
  }
  return { ok: true, id: targetIdsOf(ref)[0] ?? null };
}

export const voirInspiration = defineAction<VoirParams>({
  key: "voir_inspiration",
  description: "Parler d'un canal d'inspiration : résumé, leur rythme, leurs heures, forme, fond, résultats, comparaison avec notre canal, exemples de posts à leur façon, mes propositions",
  theme: "algorithme",
  cls: "immediate",
  spec: {
    sujet: oneOf("resume, rythme (posts par jour), heures, forme, fond, resultats (vues), comparaison (eux / nous), exemples (posts écrits à leur façon), propositions (réglages proposés)", INSPIRATION_TOPICS),
    reference: str("Canal d'inspiration (@nom ou nom ; absent = le dernier dont on a parlé)", { optional: true }),
    canal_cible: str("Notre canal concerné (facultatif)", { optional: true }),
    question: str("La question telle que posée (facultatif)", { optional: true, maxLength: 300 }),
  },
  async execute(d, p) {
    const deps = d as BossExecDeps;
    const params = p as Record<string, unknown>;
    const r = await resolveReference(deps, p.reference, { actionKey: "voir_inspiration", params, field: "reference" });
    if (!r.ok) return r.reply;
    const ref = r.ref;
    const label = referenceLabel(ref);
    if (p.sujet === "exemples") {
      const prof = (await deps.prisma.styleProfile.findFirst({ where: { referenceChannelId: ref.id }, orderBy: { version: "desc" } })) as { examples: unknown; rules: unknown } | null;
      const ex = Array.isArray(prof?.examples) ? (prof!.examples as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3) : [];
      if (!ex.length) return { reply: `Je n'ai pas encore d'exemple à la façon de ${esc(label)} (le profil de style se fait après l'analyse).` };
      return { reply: [`✍️ À la façon de ${esc(label)}, écrit à neuf pour nous (jamais copié) :`, ...ex.map((e, i) => `${i + 1}. ${esc(e.slice(0, 600))}`)].join("\n") };
    }
    const target = await targetFor(deps, ref, p.canal_cible, params);
    if (!target.ok) return target.reply;
    if (p.sujet === "propositions") {
      if (!target.id) return { reply: `Pour quel de nos canaux ? Dis-moi par exemple « inspire-toi de ${esc(label)} pour Roulette ».` };
      const res = await inspirationProposals(deps, ref.id, target.id);
      if (!res.ok) return { reply: esc(res.message) };
      if (res.proposals.length) await storeChoice(deps, ref.id, target.id, res.proposals.map((x) => ({ n: x.number, ids: x.recommendationIds, label: x.label })));
      return { reply: proposalsText(label, res) };
    }
    const analysis = await analyzeReference(deps, ref.id);
    if ("tooFew" in analysis) return { reply: `J'ai lu ${analysis.count} posts de ${esc(label)}, il m'en faut ${INSPIRATION_LIMITS.minPostsForAnalysis} : transfère-m'en d'autres.` };
    if (p.sujet === "resume" || p.sujet === "comparaison") {
      const comparison = target.id ? await compareWithChannel(deps, analysis, target.id).catch(() => null) : null;
      if (p.sujet === "resume") return { reply: [`🔎 <b>${esc(label)}</b>`, ...inspirationSummaryLines(label, analysis, comparison).map(esc)].join("\n") };
      if (!comparison) return { reply: `Pour comparer, dis-moi avec quel de nos canaux (par exemple « compare ${esc(label)} avec Roulette »).` };
      const gaps = comparison.gaps.filter((g) => g.theirs !== null || g.ours !== null);
      const lines = gaps
        .filter((g) => g.matters)
        .slice(0, 8)
        .map((g) => `${g.label} : eux ${typeof g.theirs === "number" ? fr(g.theirs) : (g.theirs ?? "?")}${g.unit === "%" ? " %" : ""}, nous ${typeof g.ours === "number" ? fr(g.ours) : (g.ours ?? "?")}${g.unit === "%" ? " %" : ""}`);
      const text = await writtenAnswer(deps, { comparaison: comparison }, p.question ?? "Compare-les avec notre canal.", [`${label} / ${comparison.channelTitle} (${comparison.ourSampleSize} posts chez nous sur 28 jours) :`, ...(lines.length ? lines : ["Pas d'écart net."])]);
      return { reply: text };
    }
    const t = topicFacts(p.sujet, analysis);
    return { reply: await writtenAnswer(deps, { reference: label, postsLus: analysis.sampleSize, ...t.facts }, p.question ?? p.sujet, [`${label} (${analysis.sampleSize} posts lus) :`, ...t.lines]) };
  },
});

// ------------------------------------------------------------------------------------------ appliquer_inspiration

type ApplyParams = { numeros: string; reference?: string };

async function choiceFor(deps: BossDeps, reference?: string): Promise<InspirationChoice | null> {
  const c = await readInspirationChoice(deps);
  if (!c) return null;
  if (reference) {
    const ref = await loadReferenceRow(deps, c.referenceChannelId);
    const u = normalizeChannelUsername(reference);
    if (ref && u && ref.username?.toLowerCase() !== u.toLowerCase()) return null;
  }
  return c;
}

export const appliquerInspiration = defineAction<ApplyParams>({
  key: "appliquer_inspiration",
  description: "Appliquer mes propositions d'inspiration par leurs numéros (« applique 1 et 3 », « tout »), dans les bornes, annulables",
  theme: "algorithme",
  cls: "confirm",
  spec: {
    numeros: str("Numéros des propositions tels que dits : « 1 3 », « 1 et 3 », « tout »", { maxLength: 60 }),
    reference: str("Canal d'inspiration (facultatif)", { optional: true }),
  },
  async classify(deps) {
    // Réponse au choix numéroté posé par Kevin : le choix vaut accord.
    return choiceIsOpen(await readInspirationChoice(deps), nowOf(deps)) ? "immediate" : "confirm";
  },
  async summarize(deps, p) {
    const c = await choiceFor(deps, p.reference);
    const nums = c ? parseProposalNumbers(p.numeros, c.items.length) : null;
    const ref = c ? await loadReferenceRow(deps, c.referenceChannelId) : null;
    const labels = c && nums ? nums.map((n) => c.items.find((i) => i.n === n)?.label).filter(Boolean) : [];
    return `Appliquer ${nums && nums.length > 1 ? "les propositions" : "la proposition"} ${nums?.join(", ") ?? p.numeros} d'après ${ref ? referenceLabel(ref) : "l'inspiration"} ?\n${labels.join(" ; ").slice(0, 200)}`;
  },
  async check(deps, p) {
    const c = await choiceFor(deps, p.reference);
    if (!c?.items.length) return { reply: "Je n'ai pas de propositions en cours : demande-moi « tes propositions pour @nom »." };
    if (!parseProposalNumbers(p.numeros, c.items.length)) return { reply: `Donne-moi des numéros de 1 à ${c.items.length} (par exemple « 1 3 ») ou « tout ».` };
    return null;
  },
  async execute(d, p, actor) {
    const deps = d as BossExecDeps;
    const c = await choiceFor(deps, p.reference);
    if (!c?.items.length) return { reply: "Je n'ai pas de propositions en cours : demande-moi « tes propositions pour @nom »." };
    const nums = parseProposalNumbers(p.numeros, c.items.length);
    if (!nums) return { reply: `Donne-moi des numéros de 1 à ${c.items.length} (par exemple « 1 3 ») ou « tout ».` };
    const chosen = nums.map((n) => c.items.find((i) => i.n === n)!).filter(Boolean);
    const ids = chosen.flatMap((i) => i.ids);
    const r = await applyInspiration(deps, ids, actorRef(actor));
    await writeSetting(deps, INSPIRATION_CHOICE_SETTING, { ...c, answeredAt: nowOf(deps).toISOString() });
    if (r.applied.length)
      await writeSetting(deps, INSPIRATION_LAST_APPLIED_SETTING, { referenceChannelId: c.referenceChannelId, ids: r.applied, chatId: deps.chat ? deps.chat.chatId.toString() : null, at: nowOf(deps).toISOString() } satisfies LastApplied);
    const lines = chosen.map((i) => {
      const ok = i.ids.every((id) => r.applied.includes(id));
      const err = r.failed.find((f) => i.ids.includes(f.id));
      return ok ? `✅ ${i.n}. ${esc(i.label)}` : `❌ ${i.n}. ${esc(i.label)} : ${esc(err?.message ?? "non appliquée")}`;
    });
    if (!r.applied.length) return { reply: lines.join("\n") };
    const test = r.experimentMode === "ab" ? "Je mesure l'effet pendant 14 jours (test A/B)." : "Je compare avant / après pendant 14 jours.";
    return { reply: [...lines, test, "Pour revenir en arrière : « annule l'inspiration » (30 jours)."].join("\n") };
  },
});

// ------------------------------------------------------------------------------------------ annuler / retirer

type UndoParams = { reference?: string; numero?: number };

export const annulerInspiration = defineAction<UndoParams>({
  key: "annuler_inspiration",
  description: "Annuler l'inspiration : remettre les réglages d'avant (toutes les propositions appliquées d'un canal d'inspiration, ou une seule par son numéro)",
  theme: "algorithme",
  cls: "immediate",
  spec: {
    reference: str("Canal d'inspiration (facultatif)", { optional: true }),
    numero: int("Numéro d'une seule proposition (facultatif)", 1, 9, true),
  },
  async execute(d, p, actor) {
    const deps = d as BossExecDeps;
    if (p.numero) {
      const c = await readInspirationChoice(deps);
      const item = c?.items.find((i) => i.n === p.numero);
      if (!item) return { reply: `Je ne trouve pas de proposition n°${p.numero}.` };
      return { reply: esc((await undoInspiration(deps, item.ids, actorRef(actor))).message) };
    }
    let refId: string | null = null;
    if (p.reference) {
      const r = await resolveReference(deps, p.reference, { actionKey: "annuler_inspiration", params: p as Record<string, unknown>, field: "reference" });
      if (!r.ok) return r.reply;
      refId = r.ref.id;
    } else {
      const last = (await readSetting(deps, INSPIRATION_LAST_APPLIED_SETTING)) as LastApplied | undefined;
      refId = last?.referenceChannelId ?? (await readInspirationChoice(deps))?.referenceChannelId ?? null;
      if (!refId) {
        const any = (await deps.prisma.recommendation.findFirst({ where: { source: "inspiration", status: "APPLIED" }, orderBy: { appliedAt: "desc" } })) as { referenceChannelId: string | null } | null;
        refId = any?.referenceChannelId ?? null;
      }
    }
    if (!refId) return { reply: "Aucun réglage d'inspiration appliqué à annuler." };
    return { reply: esc((await undoInspiration(deps, refId, actorRef(actor))).message) };
  },
});

type RemoveParams = { reference: string };

export const retirerReference = defineAction<RemoveParams>({
  key: "retirer_reference",
  description: "Retirer un canal d'inspiration (j'efface ses posts lus et son profil de style)",
  theme: "algorithme",
  cls: "confirm",
  spec: { reference: str("Canal d'inspiration à retirer (@nom ou nom)") },
  async summarize(deps, p) {
    const r = await resolveReference(deps as BossExecDeps, p.reference, { actionKey: "retirer_reference", params: p as Record<string, unknown>, field: "reference" });
    const label = r.ok ? referenceLabel(r.ref) : p.reference;
    return `Retirer ${label} des canaux d'inspiration ?\nSes posts lus et son profil de style sont effacés ; les réglages déjà appliqués restent (annulables).`;
  },
  async check(deps, p) {
    const r = await resolveReference(deps as BossExecDeps, p.reference, { actionKey: "retirer_reference", params: p as Record<string, unknown>, field: "reference" });
    return r.ok ? null : r.reply;
  },
  async execute(d, p, actor) {
    const r = await resolveReference(d as BossExecDeps, p.reference, { actionKey: "retirer_reference", params: p as Record<string, unknown>, field: "reference" });
    if (!r.ok) return r.reply;
    return { reply: esc((await removeReference(d, r.ref.id, actorRef(actor))).message) };
  },
});

export const INSPIRATION_ACTIONS: BossAction[] = [analyserCanal, voirInspiration, appliquerInspiration, annulerInspiration, retirerReference] as unknown as BossAction[];

/** Entrées de lecture (ou sans effet sur les réglages) qu'un membre présenté fait lui-même. */
export const INSPIRATION_MEMBER_KEYS = ["analyser_canal", "voir_inspiration"] as const;

// ------------------------------------------------------------------------------------------ chemin rapide

const NUMBERS_ONLY = /^\s*(?:\d{1,2}(?:\s*(?:,|;|et|&|\+|\s)\s*\d{1,2})*|tout|tous|toutes)\s*[.!]?\s*$/i;

/**
 * Chemin rapide (sans IA) de l'inspiration. Rend la réponse, ou null pour laisser la suite :
 * - nom du canal demandé après des transferts masqués (« @nomducanal ») ;
 * - numéros (« 1 3 », « tout ») en réponse au choix numéroté ouvert de Kevin, plus récent que toute autre question ;
 * - « annule » (sans confirmation en attente) dans les 30 minutes qui suivent une application.
 * `run` : exécute une entrée du catalogue (droits, journal), fourni par le chemin rapide.
 */
export async function inspirationFastPath(
  deps: BossDeps,
  input: BossTeamInput,
  ctx: {
    word: "yes" | "no" | "cancel" | null;
    pendingOpen: boolean;
    otherQuestionAt: number;
    run: (action: BossAction, params: Record<string, unknown>) => Promise<BossReply>;
  },
): Promise<{ reply: BossReply; actionKey: string } | null> {
  const text = (input.text ?? "").trim();
  if (!text || input.forwarded) return null;
  const named = await inspirationNameAnswer(deps, { text, chat: input.chat ?? null, speaker: input.speaker ?? null }).catch(() => null);
  if (named) return { reply: named, actionKey: "inspiration_nom" };
  if (input.speaker && input.speaker.kind === "member") return null;
  const now = nowOf(deps);
  const chatKey = input.chat ? input.chat.chatId.toString() : null;
  if (NUMBERS_ONLY.test(text)) {
    const c = await readInspirationChoice(deps);
    if (choiceIsOpen(c, now) && (!c.chatId || !chatKey || c.chatId === chatKey) && new Date(c.createdAt).getTime() > ctx.otherQuestionAt) {
      return { reply: await ctx.run(appliquerInspiration as unknown as BossAction, { numeros: text }), actionKey: "appliquer_inspiration" };
    }
  }
  if (ctx.word === "cancel" && !ctx.pendingOpen) {
    const last = (await readSetting(deps, INSPIRATION_LAST_APPLIED_SETTING)) as LastApplied | undefined;
    if (last && now.getTime() - new Date(last.at).getTime() < INSPIRATION_QUICK_UNDO_MS && (!last.chatId || !chatKey || last.chatId === chatKey)) {
      const r = await ctx.run(annulerInspiration as unknown as BossAction, {});
      await deps.prisma.setting.deleteMany({ where: { key: INSPIRATION_LAST_APPLIED_SETTING } });
      return { reply: r, actionKey: "annuler_inspiration" };
    }
  }
  return null;
}

