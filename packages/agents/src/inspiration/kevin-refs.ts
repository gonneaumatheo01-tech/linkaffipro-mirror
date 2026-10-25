/**
 * Phase 27, chantier C — références d'inspiration vues par Kevin : nom affiché, univers d'un canal du client, règle
 * « même univers obligatoire » (règle 6), rattachement d'un canal cible, personne qui a demandé (pour lui répondre là
 * où elle a parlé : l'admin en privé, le groupe de l'équipe, ou un membre en privé) et envoi d'un message par Kevin.
 */
import { adminTelegramId, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { BossChat, BossSpeaker } from "../boss/contract";
import { writeBossTurn } from "../boss/memory";
import type { AdminButton, AgentsDeps } from "../types";
import type { InspirationUniverse, ReferenceViaName } from "./contract";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";

/** Textes de Kevin (charte `docs/KEVIN-VOIX.md`), vérifiés par `boss/voice.test.ts`. */
export const INSPIRATION_REFS_VARIANTS = {
  universeRefusal: voiceTemplate(
    [
      { ref: "@foot_pro", refU: "Paris sportifs", channel: "Casino VIP", channelU: "Casino" },
      { ref: "« Club Love »", refU: "Rencontres", channel: "Roulette Pro", channelU: "Casino" },
    ],
    (p: { ref: string; refU: string; channel: string; channelU: string }) => [
      `Je ne mélange pas les univers : ${p.ref} est un canal ${p.refU}, ${p.channel} est un canal ${p.channelU}.`,
      `Pas possible : ${p.ref} est un canal ${p.refU} et ${p.channel} un canal ${p.channelU}, je ne mélange pas les univers.`,
      `${p.ref} est un canal ${p.refU}, ${p.channel} un canal ${p.channelU} : je ne mélange pas les univers.`,
    ],
  ),
  channelNotFound: ["Je ne trouve pas ce canal.", "Ce canal, je ne le trouve pas chez nous."],
  testUniverse: [
    "C'est pour quel univers, ce test ? Paris sportifs, casino ou rencontres ?",
    "Ce test, c'est pour quel univers : paris sportifs, casino ou rencontres ?",
  ],
  universeUnknown: voiceTemplate([{ channel: "Casino VIP" }, { channel: "Roulette Pro" }], (p: { channel: string }) => [
    `Je ne sais pas si ${p.channel} est un canal rencontres, casino ou paris. Tu le règles dans sa fiche ?`,
    `Il me manque l'univers de ${p.channel} (rencontres, casino ou paris). Tu le choisis dans sa fiche ?`,
  ]),
} satisfies VoiceTable;

export type ReferenceRow = {
  id: string;
  username: string | null;
  telegramChatId: bigint | null;
  title: string | null;
  via: ReferenceViaName;
  universe: string;
  targetChannelIds: unknown;
  status: "READING" | "READY" | "UNAVAILABLE" | string;
  unavailableReason: string | null;
  accountId: string | null;
  addedByTelegramId: bigint | null;
  postCount: number;
  lastReadAt: Date | null;
  nextReadAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
};

export const UNIVERSE_LABELS: Record<InspirationUniverse, string> = { dating: "Rencontres", casino: "Casino", sports: "Paris sportifs" };
const VERTICAL_UNIVERSE: Record<string, InspirationUniverse> = { DATING: "dating", CASINO: "casino", SPORTS: "sports" };

export function isUniverse(v: unknown): v is InspirationUniverse {
  return v === "dating" || v === "casino" || v === "sports";
}

/** « @nom », sinon le titre, sinon « ce canal » (pur). */
export function referenceLabel(ref: Pick<ReferenceRow, "username" | "title">): string {
  if (ref.username) return `@${ref.username}`;
  // Titre choisi par le propriétaire du canal : coupé à 40 caractères, entre guillemets (il entre dans la mémoire de
  // Kevin, jamais comme une consigne).
  const t = (ref.title ?? "").replace(/[\r\n]+/g, " ").trim();
  if (t) return `« ${t.length > 40 ? `${t.slice(0, 39)}…` : t} »`;
  return "ce canal";
}

/** Canaux cibles d'une référence (JSON `string[]`, pur). */
export function targetIdsOf(ref: Pick<ReferenceRow, "targetChannelIds">): string[] {
  return Array.isArray(ref.targetChannelIds) ? ref.targetChannelIds.filter((x): x is string => typeof x === "string") : [];
}

export async function loadReferenceRow(deps: Pick<AgentsDeps, "prisma">, id: string): Promise<ReferenceRow | null> {
  const r = (await deps.prisma.referenceChannel.findUnique({ where: { id } })) as ReferenceRow | null;
  return r && !r.removedAt ? r : null;
}

/** Références en service (non retirées), la plus récente d'abord. */
export async function activeReferences(deps: Pick<AgentsDeps, "prisma">): Promise<ReferenceRow[]> {
  return (await deps.prisma.referenceChannel.findMany({ where: { removedAt: null }, orderBy: { createdAt: "desc" }, take: 100 })) as ReferenceRow[];
}

export type ChannelUniverse = { id: string; title: string; universe: InspirationUniverse | null; teamKey: string | null; isTest?: boolean };

const SPORTS_WORDS = /\b(?:paris?|pari sportif|paris sportifs|sport|sports|foot|football|tirs? cadres?|corners?|buteurs?|cotes?|matchs?|bets?|pronos?|pronostics?)\b/;
const CASINO_WORDS = /\b(?:casinos?|roulettes?|machines? a sous|slots?|blackjack|poker|jackpots?|bonus casino)\b/;
const DATING_WORDS = /\b(?:rencontres?|dating|celibataires?|drague|coquine?s?|seduction)\b/;

/**
 * Univers dit dans une demande (pur) : « tir cadré », « paris », « corners » → sports ; « casino », « roulette » →
 * casino ; « rencontre », « dating » → dating. Plusieurs univers ou aucun → null. Les liens et @noms sont ignorés.
 */
export function universeFromText(text: string | null | undefined): InspirationUniverse | null {
  if (!text) return null;
  const n = text
    .replace(/(?:https?:\/\/)?t\.me\/\S+|@\w+/gi, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
  const hits = (["sports", "casino", "dating"] as const).filter((u) => (u === "sports" ? SPORTS_WORDS : u === "casino" ? CASINO_WORDS : DATING_WORDS).test(n));
  return hits.length === 1 ? hits[0]! : null;
}

/** Univers d'un canal du client : équipe de son plan d'agents, sinon son univers (`Channel.vertical`). */
export async function channelUniverse(deps: Pick<AgentsDeps, "prisma">, channelId: string): Promise<ChannelUniverse | null> {
  const ch = (await deps.prisma.channel.findUnique({ where: { id: channelId } })) as { id: string; title: string; vertical: string | null; isTest?: boolean } | null;
  if (!ch) return null;
  const plan = (await deps.prisma.channelAgentPlan.findUnique({ where: { channelId } })) as { teamKey: string } | null;
  const fromPlan = plan && isUniverse(plan.teamKey) ? plan.teamKey : null;
  return {
    id: ch.id,
    title: ch.title,
    universe: fromPlan ?? (ch.vertical ? (VERTICAL_UNIVERSE[ch.vertical] ?? null) : null),
    teamKey: plan?.teamKey ?? null,
    isTest: ch.isTest === true,
  };
}

/** Refus en une ligne (règle 6, pur). */
export function universeRefusal(
  refLabel: string,
  refUniverse: InspirationUniverse,
  channelTitle: string,
  channelUniverse: InspirationUniverse,
  chatId: bigint | string | null = null,
): string {
  return pick(
    INSPIRATION_REFS_VARIANTS.universeRefusal({ ref: refLabel, refU: UNIVERSE_LABELS[refUniverse], channel: channelTitle, channelU: UNIVERSE_LABELS[channelUniverse] }),
    "inspiration.universeRefusal",
    chatId,
  );
}

export type LinkResult =
  | { ok: true; ref: ReferenceRow; added: boolean; channel: ChannelUniverse }
  | { ok: false; message: string; /** Canal Test sans univers connu : l'appelant demande l'univers. */ needUniverse?: boolean };

/**
 * Rattache un canal cible à la référence (même univers obligatoire). Une référence sans univers encore (posts transférés
 * avant de dire pour quel canal) prend celui du canal. Le canal Test n'a pas d'univers par nature : il prend celui de
 * la demande (`opts.universe`), sinon celui de la référence ; sans l'un ni l'autre, `needUniverse` (jamais « règle-le
 * dans sa fiche » pour le canal Test).
 */
export async function linkTarget(
  deps: Pick<AgentsDeps, "prisma">,
  ref: ReferenceRow,
  channelId: string,
  opts: { universe?: InspirationUniverse | null } = {},
): Promise<LinkResult> {
  const found = await channelUniverse(deps, channelId);
  if (!found) return { ok: false, message: pick(INSPIRATION_REFS_VARIANTS.channelNotFound, "inspiration.channelNotFound", null) };
  const universe = found.universe ?? (found.isTest ? (opts.universe ?? (isUniverse(ref.universe) ? ref.universe : null)) : null);
  if (!universe) {
    if (found.isTest) return { ok: false, needUniverse: true, message: pick(INSPIRATION_REFS_VARIANTS.testUniverse, "inspiration.testUniverse", null) };
    return { ok: false, message: pick(INSPIRATION_REFS_VARIANTS.universeUnknown({ channel: found.title }), "inspiration.universeUnknown", null) };
  }
  const ch: ChannelUniverse = { ...found, universe };
  if (isUniverse(ref.universe) && ref.universe !== universe)
    return { ok: false, message: universeRefusal(referenceLabel(ref), ref.universe, ch.title, universe) };
  const ids = targetIdsOf(ref);
  const added = !ids.includes(channelId);
  const next = added ? [...ids, channelId] : ids;
  const updated = (await deps.prisma.referenceChannel.update({
    where: { id: ref.id },
    data: { targetChannelIds: next, ...(isUniverse(ref.universe) ? {} : { universe }) },
  })) as ReferenceRow;
  return { ok: true, ref: updated, added, channel: ch };
}

/** Référence déjà connue (même nom public ou même identifiant Telegram), non retirée. */
export async function findReference(deps: Pick<AgentsDeps, "prisma">, by: { username?: string | null; chatId?: bigint | null }): Promise<ReferenceRow | null> {
  const all = await activeReferences(deps);
  const u = by.username?.toLowerCase() ?? null;
  return all.find((r) => (u && r.username?.toLowerCase() === u) || (by.chatId != null && r.telegramChatId != null && r.telegramChatId === by.chatId)) ?? null;
}

export async function createReference(
  deps: Pick<AgentsDeps, "prisma">,
  input: { username?: string | null; chatId?: bigint | null; title?: string | null; via: ReferenceViaName; universe: string; addedBy?: bigint | null; accountId?: string | null },
): Promise<ReferenceRow> {
  return (await deps.prisma.referenceChannel.create({
    data: {
      username: input.username ?? null,
      telegramChatId: input.chatId ?? null,
      title: input.title ?? null,
      via: input.via,
      universe: input.universe,
      targetChannelIds: [],
      status: "READING",
      unavailableReason: null,
      accountId: input.accountId ?? null,
      addedByTelegramId: input.addedBy ?? null,
      postCount: 0,
      lastReadAt: null,
      nextReadAt: null,
      removedAt: null,
    },
  })) as ReferenceRow;
}

// ------------------------------------------------------------------------------------- qui a demandé, où répondre

export const INSPIRATION_ASKER_PREFIX = "inspiration.asker.";

export type InspirationAsker = {
  chatType: "private" | "group";
  /** Conversation (chaîne d'un BigInt). */
  chatId: string;
  kind: "admin" | "member";
  telegramUserId: string | null;
  /** Canal cible dont on parle (le dernier rattaché). */
  channelId: string | null;
  at: string;
};

export function askerOf(speaker: BossSpeaker | null | undefined, chat: BossChat | null | undefined, channelId: string | null): Omit<InspirationAsker, "at"> | null {
  if (!chat) return null;
  return {
    chatType: chat.type,
    chatId: chat.chatId.toString(),
    kind: speaker?.kind === "member" ? "member" : "admin",
    telegramUserId: speaker ? speaker.telegramUserId.toString() : null,
    channelId,
  };
}

export async function rememberAsker(deps: AgentsDeps, refId: string, asker: Omit<InspirationAsker, "at"> | null, channelId?: string | null): Promise<void> {
  const prev = await readAsker(deps, refId);
  const base: Omit<InspirationAsker, "at"> = asker ?? prev ?? { chatType: "private", chatId: "", kind: "admin", telegramUserId: null, channelId: null };
  const value: InspirationAsker = { ...base, channelId: channelId ?? base.channelId ?? prev?.channelId ?? null, at: nowOf(deps).toISOString() };
  await writeSetting(deps, `${INSPIRATION_ASKER_PREFIX}${refId}`, value);
}

export async function readAsker(deps: Pick<AgentsDeps, "prisma">, refId: string): Promise<InspirationAsker | null> {
  const v = (await readSetting(deps, `${INSPIRATION_ASKER_PREFIX}${refId}`)) as InspirationAsker | undefined;
  return v && typeof v === "object" && typeof v.chatType === "string" ? v : null;
}

/**
 * Envoi par Kevin à la personne qui a demandé : l'admin en privé (par défaut), le groupe de l'équipe, ou le membre en
 * privé. Le message entre dans la mémoire de Kevin (tour du Boss de cette conversation). Ne lève jamais.
 */
export async function sendToAsker(
  deps: AgentsDeps,
  refId: string,
  html: string,
  opts: { buttons?: AdminButton[][]; actionKey?: string } = {},
): Promise<boolean> {
  const asker = await readAsker(deps, refId);
  const adminId = await adminTelegramId(deps).catch(() => null);
  const toAdmin = !asker || !asker.chatId || (adminId !== null && asker.chatId === adminId.toString()) || (asker.chatType === "private" && asker.kind === "admin");
  const extra = opts.buttons ? { buttons: opts.buttons } : undefined;
  let sent: { messageId: number } | null | undefined = null;
  let chatId: bigint | null = toAdmin ? adminId : BigInt(asker!.chatId);
  try {
    sent = toAdmin ? await deps.admin?.send(html, extra) : await deps.admin?.sendTo?.(BigInt(asker!.chatId), html, extra);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, refId }, "[inspiration] message de Kevin non envoyé");
  }
  if (!sent && !toAdmin) {
    // Groupe ou membre injoignable : l'admin reçoit le message (jamais de silence).
    try {
      sent = await deps.admin?.send(html, extra);
      chatId = adminId;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, refId }, "[inspiration] message de Kevin non envoyé à l'admin");
    }
  }
  if (sent) await writeBossTurn(deps, { role: "BOSS", text: html.replace(/<[^>]+>/g, ""), actionKey: opts.actionKey ?? "inspiration", status: "done", chatId });
  return !!sent;
}

/** Phrase courte d'une référence (« @nom (12 posts lus) »), échappée. */
export function referenceLine(ref: ReferenceRow, count = ref.postCount): string {
  return `${esc(referenceLabel(ref))} (${count} post${count > 1 ? "s" : ""} lu${count > 1 ? "s" : ""})`;
}

/** Posts rangés d'une référence (compte réel en base, jamais le compteur seul). */
export async function referencePostCount(deps: Pick<AgentsDeps, "prisma">, refId: string): Promise<number> {
  return deps.prisma.referencePost.count({ where: { referenceChannelId: refId } });
}
