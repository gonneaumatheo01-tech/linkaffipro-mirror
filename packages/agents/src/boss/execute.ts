/**
 * Exécution des actions du Boss et tour avec l'IA (phase 26). `runBossAction` : droits, classe (immédiate / à
 * confirmer), exécution par l'entrée du catalogue, `AuditLog` `boss.<clé>`. `bossAiTurn` (tâche `boss-text` du
 * worker) : contexte, interprète, exécution ou confirmation, réponse chiffrée, précision, ordre à une équipe (phase 33 :
 * `ordre_equipe` → planificateur → récapitulatif → OUI ou lancement), ou demande vraiment impossible (règle 3 de la
 * phase 33 : ce qui bloque, puis UNE chose faisable tout de suite, en question) ; écrit les `BossTurn` ; ne lève JAMAIS.
 * Textes : voix de Kevin (`voice.ts`), 2 à 4 variantes par texte fixe.
 */
import { adminTelegramId, agentAudit, esc, nowOf, telegramActorUserId } from "../admin/journal";
import { isSecretAdminText, type SecretTextContext } from "../admin/commands";
import { askedMessageIdsOf } from "../human/requests";
import { normalizeText } from "../human/answer";
import type { BossAction, BossActionClass, BossActor, BossChat, BossDeps, BossPending, BossReply, BossSpeaker, BossTeamInput } from "./contract";
import type { MentionRef } from "./team/addressed";
import { adminFirstName, adminMention, claimMemberPlanTurn, findTeamMember, responsibilitiesOf, BOSS_MEMBER_PLAN_DAILY_LIMIT } from "./team/members";
import { BOSS_READ_KEYS } from "./team/rights";
import { findPerson, isNoteOnlyEdit } from "./catalog-team";
import { bossRequestScope, type BossRequestScope } from "./team/request-scope";
import { BOSS_CATALOG, bossAction, bossActionAllowed } from "./catalog";
import type { BossExecDeps } from "./catalog-read";
import { createBossPending, deferBossPending, readBossPending, rememberBossPendingMessage, shadowBossPending } from "./confirm";
import { checkAction } from "./catalog-kit";
import { answerQuestion } from "./answer";
import { interpretBossText, type BossDecision } from "./interpret";
import { BossBudgetError } from "./llm";
import { bossTurnForMessage, updateBossTurn, writeBossTurn, type BossTurnStatus } from "./memory";
import { askToChoose, channelRefs, matchNames, normName, readClarify, resolveTeam } from "./resolve";
import { recordBossUnmet } from "./unmet";
import { pick, varyAgainst, voiceTemplate, type VoiceTable } from "./voice";
import { handleOrderRequest } from "../orders/request";
import { planCacheKeyOf } from "../orders/planner";
import { bossTurnsForSpeaker as turnsForSpeaker } from "./memory";
import { CHOICES_VARIANTS, clearKevinList, pickOption, readKevinList, rememberKevinList, replayText } from "./choices";
import { SITE_SELF_AUDITED_ACTIONS } from "../site/keys";
import { runSiteFlow } from "../site/flow";
import { rewritableResult, writeKevinReply } from "./converse";
// Appelé seulement pendant un tour (jamais au chargement) : le cycle d'import avec `fast.ts` est sans effet.
import { smallTalkReply } from "./fast";

/** Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const EXECUTE_VARIANTS = {
  noAi: [
    "Là je ne comprends que les commandes simples : l'IA n'est pas réglée, ou le plafond du mois est atteint. Écris aide pour la liste.",
    "Pour l'instant je ne prends que les commandes simples (pas d'IA, ou plafond du mois atteint). Écris aide pour les voir.",
  ],
  unmetHead: ["Ça, je ne sais pas encore le faire.", "Là je ne sais pas encore faire.", "Ça, pas encore possible de mon côté."],
  /** Une seule variante : le fil de confiance du chemin rapide et du worker compare ce texte. */
  secretRemoved: [
    "🔒 J'ai retiré ce message : ça ressemblait à une clé ou à un mot de passe, je ne l'ai ni lu ni gardé. Pour me donner tes identifiants bookmakers, écris « identifiants bookmakers » : je te les demande en privé, un par un. Pour une clé, écris « clé », le nom du fournisseur, puis la clé.",
  ],
  forwarded: [
    "J'ai bien reçu ce message transféré : je ne fais rien de ce qu'il contient. Dis-moi ce que tu veux en faire.",
    "Message transféré reçu, je n'exécute rien de ce qu'il dit. Tu veux que j'en fasse quoi ?",
  ],
  /** Une seule variante : texte attendu tel quel par le groupe de l'équipe (tests d'intégration). */
  notYours: voiceTemplate<{ name: string }>([{ name: "Mathéo" }, { name: "l'admin" }], (p) => [`Ça, c'est ${p.name} qui décide.`]),
  /** Jamais le message d'erreur brut : le détail va au journal seulement. */
  oops: ["Oups, ça a raté de mon côté. Réessaie dans une minute.", "Oups, raté de mon côté. Tu réessaies dans une minute ?"],
  escalateDeferred: voiceTemplate<{ name: string }>([{ name: "Mathéo" }], (p) => [
    `${p.name} a déjà une décision en attente : je lui transmets ta demande juste après.`,
    `${p.name} a déjà une décision en attente, je lui passe ta demande juste après.`,
  ]),
  escalated: voiceTemplate<{ name: string }>([{ name: "Mathéo" }], (p) => [
    `C'est ${p.name} qui décide : je lui ai transmis ta demande.`,
    `Je lui ai transmis ta demande : c'est ${p.name} qui décide.`,
  ]),
  escalateAsk: voiceTemplate<{ admin: string; who: string; ask: string }>(
    [
      { admin: "@matheo", who: "Léa", ask: "je mets le casino en pause" },
      { admin: "Mathéo", who: "Quelqu'un de l'équipe", ask: "j'arrête l'ordre n°12" },
    ],
    // Les deux variantes gardent « <prénom> demande : … OUI ? » (repère lu par l'admin et par les tests du groupe).
    (p) => [`${p.admin} ${p.who} demande : ${p.ask}. OUI ?`, `${p.admin} ${p.who} demande : ${p.ask}. Tu dis OUI ?`],
  ),
  questionForAdmin: voiceTemplate<{ name: string }>([{ name: "Mathéo" }], (p) => [`Cette question est pour ${p.name}.`, `Cette question est pour ${p.name}, pas pour toi.`]),
  unmetNoted: ["Je l'ai noté.", "C'est noté pour la suite."],
  unmetNoOffer: ["Écris aide pour voir ce que je sais faire.", "Tu peux écrire aide pour voir ce que je sais faire."],
  unmetOffer: voiceTemplate<{ what: string }>([{ what: "te dire où en sont les agents" }], (p) => [`Par contre je peux ${p.what}, tu veux ?`, `À la place, je peux ${p.what}. Ça te va ?`]),
  /** Une confirmation attend déjà : la proposition se prend par le numéro, jamais par OUI (le OUI reste à l'autre). */
  unmetOfferNumber: voiceTemplate<{ what: string }>([{ what: "te dire où en sont les agents" }], (p) => [
    `Par contre je peux ${p.what} : réponds 1 si tu veux. Ta demande d'avant attend toujours ton OUI.`,
    `À la place, je peux ${p.what}. Pour ça réponds 1 ; le OUI reste pour ta demande d'avant.`,
  ]),
  /** Membre sans droit de lancer cet ordre : Kevin transmet sa demande à l'admin, en une ligne, sans la préparer. */
  orderToAdmin: voiceTemplate<{ admin: string; who: string; ask: string }>(
    [
      { admin: "@matheo", who: "Léa", ask: "programme 2 posts par jour sur Roulette Pro en vrai" },
      { admin: "Mathéo,", who: "Marc", ask: "mets 3 paris corners sur le canal Test" },
    ],
    (p) => [`${p.admin} ${p.who} demande : « ${p.ask} ». Si tu es d'accord, redis-le-moi et je le prépare.`, `${p.admin} ${p.who} voudrait : « ${p.ask} ». Tu me le redis si tu valides, je m'en occupe.`],
  ),
  orderQuota: voiceTemplate<{ max: number; name: string }>([{ max: 5, name: "Mathéo" }], (p) => [
    `Tu as déjà fait ${p.max} demandes de ce genre aujourd'hui : je passe celle-ci à ${p.name}.`,
    `${p.max} demandes de ce genre aujourd'hui, c'est le maximum : je transmets celle-ci à ${p.name}.`,
  ]),
  empty: [
    "Je n'ai rien lu dans ce message. Tu me dis ce que tu veux en quelques mots ?",
    "Message vide de mon côté. Écris-moi ce que tu veux, en deux mots.",
  ],
} satisfies VoiceTable;

const V = EXECUTE_VARIANTS;

export const NO_AI_REPLY = V.noAi[0]!;
export const NO_AI_REPLIES = V.noAi;
/** Début d'une réponse « vraiment impossible » (variantes : `UNMET_HEADS`). */
export const UNMET_HEAD = V.unmetHead[0]!;
export const UNMET_HEADS = V.unmetHead;
export const SECRET_REMOVED_REPLY = V.secretRemoved[0]!;
export const FORWARDED_REPLIES = V.forwarded;
/** Texte d'un message transféré gardé dans la mémoire (jamais son contenu, qui partirait à l'IA). */
export function forwardedMemoryText(text: string): string {
  return `[message transféré : ${(text ?? "").trim().length} caractères]`;
}
export const NOT_YOURS_REPLY = V.notYours({ name: "l'admin" })[0]!;

/** « jeton boss <valeur> » (enregistrement du bot Boss) : la valeur, ou null (pur). */
export function bossTokenCommand(text: string): string | null {
  const m = /^\s*(?:jeton|token)\s+(?:du\s+)?(?:boss|kevin)\s*:?\s+(\S+)\s*$/iu.exec(text);
  return m ? m[1]! : null;
}

/** Un jeton de bot Telegram (« 123456789:AAE… ») dans le texte : traité comme un secret (pur). */
export function looksLikeBotToken(text: string): boolean {
  return bossTokenCommand(text) !== null || /(?<![\w])\d{6,12}:[A-Za-z0-9_-]{30,}/.test(text);
}

/** Réponse simple après une panne (jamais le détail de l'erreur, qui reste au journal de l'appelant). */
export function oopsReply(_reason?: string, chatId?: bigint | string | null): string {
  return pick(V.oops, "execute.oops", chatId ?? null);
}

/** Dernier message de Kevin dans cette conversation (`BossTurn`), pour le contrôle de répétition ; null sinon. */
export async function lastBossText(deps: BossDeps, chatId: bigint | null, excludeId?: string | null): Promise<string | null> {
  try {
    const row = (await deps.prisma.bossTurn.findFirst({
      where: { role: "BOSS", chatId, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    })) as { text: string } | null;
    return row?.text && row.text !== "…" ? row.text : null;
  } catch {
    return null;
  }
}

/**
 * Contexte du détecteur de secrets pour UNE conversation (comme `secretContextFor` du groupe) : messages des demandes
 * SECRET posées dans cette conversation (null = privé de l'admin), et demande SECRET en cours adressée à la personne
 * qui parle (admin : sans responsable ou à lui ; membre : à lui). Dans le groupe, aucune demande « en cours » : une
 * clé ne s'y demande jamais.
 */
export async function bossSecretContext(
  deps: BossDeps,
  replyToMessageId?: number | null,
  where: { chat?: BossChat | null; speaker?: BossSpeaker | null } = {},
): Promise<SecretTextContext> {
  const rows = (await deps.prisma.humanRequest.findMany({
    where: { kind: "SECRET" },
    orderBy: { createdAt: "desc" },
    take: 500,
  })) as { key: string; status: string; telegramMessageId: number | null; onAnswer: unknown; askedAt: Date | null; chatId?: bigint | null; assigneeTelegramId?: bigint | null }[];
  const group = where.chat?.type === "group";
  const member = !!where.speaker && where.speaker.kind === "member";
  // Conversation des questions : le groupe, le privé de l'admin (null), ou aucune pour le privé d'un membre.
  const conv: bigint | null | "none" = group ? where.chat!.chatId : member ? "none" : null;
  const admin = member ? null : await adminTelegramId(deps).catch(() => null);
  const forSpeaker = (a: bigint | null | undefined) =>
    member ? a != null && a === where.speaker!.telegramUserId : a == null || (admin != null && a === admin) || (where.speaker != null && a === where.speaker.telegramUserId);
  const pending = group
    ? undefined
    : rows
        .filter((r) => r.status === "PENDING" && forSpeaker(r.assigneeTelegramId))
        .sort((a, b) => (a.askedAt?.getTime() ?? 0) - (b.askedAt?.getTime() ?? 0))[0];
  const ids = new Set<number>();
  for (const r of rows) if (conv !== "none" && (r.chatId ?? null) === conv) for (const id of askedMessageIdsOf(r)) ids.add(id);
  return {
    pending: pending ? { key: pending.key, telegramMessageId: conv !== "none" && (pending.chatId ?? null) === conv ? (pending.telegramMessageId ?? null) : null } : null,
    replyToMessageId: replyToMessageId ?? null,
    secretMessageIds: [...ids],
  };
}

export async function bossActorOf(deps: BossDeps, speaker?: BossSpeaker | null): Promise<BossActor> {
  if (speaker && speaker.kind === "member") return { userId: null, via: "TELEGRAM" };
  return { userId: await telegramActorUserId(deps), via: "TELEGRAM" };
}

async function audit(deps: BossDeps, key: string, actor: BossActor, metadata: Record<string, unknown>, speaker?: BossSpeaker | null): Promise<void> {
  await agentAudit(deps, {
    userId: actor.userId,
    action: `boss.${key}`,
    entityType: "BossAction",
    entityId: key,
    metadata: {
      via: "TELEGRAM",
      ...(speaker ? { telegramActorId: speaker.telegramUserId.toString(), speaker: speaker.kind } : {}),
      ...metadata,
    },
  });
}

/** Paramètres jamais journalisés : texte libre d'une réponse à une demande, jeton (même chiffré). */
const UNLOGGED_PARAMS = new Set(["reponse", "jeton", "valeur", "cle", "mot_de_passe", "identifiant"]);

/** Paramètres pour le journal : jamais une réponse à une demande ni un jeton ; un texte qui ressemble à un secret masqué. */
export function safeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (UNLOGGED_PARAMS.has(k)) continue;
    out[k] = typeof v === "string" ? (isSecretAdminText(v) || looksLikeBotToken(v) ? "[secret]" : v.slice(0, 80)) : v;
  }
  return out;
}

export type RunResult = BossReply & { status: BossTurnStatus };

/** « Ça, c'est <prénom de l'admin> qui décide. » (« l'admin » si son prénom est inconnu). */
export async function notYoursReply(deps: BossDeps): Promise<string> {
  const name = await adminFirstName(deps).catch(() => "l'admin");
  return pick(V.notYours({ name: esc(name) }), "execute.notyours");
}

export type RunContext = {
  actor: BossActor;
  inputText?: string;
  speaker?: BossSpeaker | null;
  chat?: BossChat | null;
  mentions?: MentionRef[];
};

/** Ce qu'il faut savoir pour juger les droits d'un membre sur cette action (équipes, demande qui lui est adressée…). */
async function rightsScopeFor(deps: BossDeps, action: BossAction, params: Record<string, unknown>, ctx: RunContext, cls: BossActionClass) {
  const speaker = ctx.speaker;
  if (!speaker || speaker.kind === "admin") return { cls, params };
  const member = await findTeamMember(deps, speaker.telegramUserId);
  const teams = member ? responsibilitiesOf(member.responsibilities).teams : [];
  let assignedToSpeaker = false;
  let request: BossRequestScope["request"] = null;
  if (action.key === "repondre_demande" || action.key === "plus_tard") {
    // Adressée à lui dans cette conversation, réservée à l'admin, à un autre, ailleurs (règle du groupe).
    const scope = await bossRequestScope(deps, speaker.telegramUserId, ctx.chat);
    assignedToSpeaker = scope.assignedToSpeaker;
    request = scope.request;
  } else if (["valider_post", "refuser_post", "corriger_post"].includes(action.key) && typeof params.numero === "number") {
    const v = (await deps.prisma.agentValidation.findUnique({ where: { number: params.numero } })) as { assigneeTelegramId?: bigint | null } | null;
    assignedToSpeaker = v?.assigneeTelegramId === speaker.telegramUserId;
  }
  let selfNoteOnly = false;
  if (action.key === "modifier_membre" && isNoteOnlyEdit(params) && member) {
    // Par l'identifiant de la personne retrouvée, jamais par le prénom (un prénom Telegram est libre).
    const execDeps: BossExecDeps = { ...deps, speaker, chat: ctx.chat ?? null, mentions: ctx.mentions ?? [] };
    const found = await findPerson(execDeps, typeof params.personne === "string" ? params.personne : undefined).catch(() => null);
    selfNoteOnly = !!found && found.kind === "found" && found.person.id === speaker.telegramUserId;
  }
  return { cls, params, teams, assignedToSpeaker, request, selfNoteOnly };
}

/**
 * Un membre demande une action qui n'est pas de son ressort : Kevin résume et mentionne l'admin, qui seul confirme
 * (boutons OUI / NON ou « OUI »). Dans le groupe, le message part dans le groupe ; en privé, chez l'admin. Une
 * confirmation de l'admin encore valable n'est JAMAIS remplacée : la demande est mise de côté et lui sera montrée
 * juste après (« Mathéo a déjà une décision en attente, je lui transmets après »).
 */
async function escalateToAdmin(deps: BossDeps, action: BossAction, params: Record<string, unknown>, ctx: RunContext): Promise<RunResult> {
  const execDeps: BossExecDeps = { ...deps, inputText: ctx.inputText, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null, mentions: ctx.mentions ?? [] };
  const blocked = await checkAction(execDeps, action, params);
  if (blocked) return { ...blocked, status: "clarify" };
  const summary = action.summarize ? await action.summarize(deps, params) : `${action.description} ?`;
  const who = ctx.speaker && ctx.speaker.kind === "member" ? ctx.speaker.firstName : "Quelqu'un de l'équipe";
  const [first, ...rest] = summary.split("\n");
  // Première phrase du résumé (jusqu'au « ? »), la suite en seconde ligne.
  const ask = (first ?? "").split("?")[0]!.trim();
  const head = pick(V.escalateAsk({ admin: await adminMention(deps), who: esc(who), ask: esc(ask.charAt(0).toLowerCase() + ask.slice(1)) }), "execute.escalate.ask", ctx.chat?.chatId ?? null);
  const text = [head, ...rest.slice(0, 1).map(esc)].join("\n");
  const group = ctx.chat?.type === "group";
  const requestedBy = { telegramUserId: (ctx.speaker?.telegramUserId ?? 0n).toString(), firstName: who };
  const adminName = esc(await adminFirstName(deps));
  const current = await readBossPending(deps);
  if (current && !current.expired) {
    await deferBossPending(deps, { actionKey: action.key, params, summary, text, chatId: group ? ctx.chat!.chatId.toString() : null, requestedBy });
    await audit(deps, action.key, ctx.actor, { status: "deferred", params: safeParams(params) }, ctx.speaker);
    return { reply: pick(V.escalateDeferred({ name: adminName }), "execute.escalate.deferred", ctx.chat?.chatId ?? null), status: "confirm" };
  }
  const chatId = group ? ctx.chat!.chatId : await adminTelegramId(deps);
  const r = await createBossPending(deps, { actionKey: action.key, params, summary, chatId, requestedBy });
  await audit(deps, action.key, ctx.actor, { status: "escalated", params: safeParams(params) }, ctx.speaker);
  if (group) return { reply: text, buttons: r.buttons, pendingId: r.pendingId, status: "confirm" };
  let sent: { messageId: number } | null = null;
  try {
    sent = (await deps.admin?.send(text, { buttons: r.buttons })) ?? null;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] demande transmise à l'admin non envoyée");
  }
  if (sent && r.pendingId) await rememberBossPendingMessage(deps, r.pendingId, sent.messageId);
  return { reply: pick(V.escalated({ name: adminName }), "execute.escalate.done", ctx.chat?.chatId ?? null), status: "confirm" };
}

/** Exécute (immédiate) ou fait confirmer (à confirmer) une entrée du catalogue. */
export async function runBossAction(
  deps: BossDeps,
  action: BossAction,
  params: Record<string, unknown>,
  ctx: RunContext,
): Promise<RunResult> {
  const before = await readClarify(deps);
  // Classe jugée avec qui parle et où (phase 27 : un choix numéroté ne vaut accord que pour l'admin qui l'a reçu).
  const classifyDeps: BossExecDeps = { ...deps, inputText: ctx.inputText, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null, mentions: ctx.mentions ?? [] };
  const cls = action.classify ? await action.classify(classifyDeps, params) : action.cls;
  const member = !!ctx.speaker && ctx.speaker.kind === "member";
  if (member) {
    const scope = await rightsScopeFor(deps, action, params, ctx, cls);
    if (!bossActionAllowed(action, ctx.speaker, scope)) {
      // Lecture interdite, démarrage guidé, annulation, demande qui ne lui est pas adressée : réponse simple ; tout le
      // reste part chez l'admin.
      if (action.key === "repondre_demande" || action.key === "plus_tard") {
        await audit(deps, action.key, ctx.actor, { status: "refused", params: safeParams(params) }, ctx.speaker);
        return { reply: pick(V.questionForAdmin({ name: esc(await adminFirstName(deps).catch(() => "l'admin")) }), "execute.question.admin", ctx.chat?.chatId ?? null), status: "refused" };
      }
      if (["commencer", "annule", "groupe_equipe", "presenter_membre", "modifier_membre", "retirer_membre"].includes(action.key)) {
        await audit(deps, action.key, ctx.actor, { status: "refused", params: safeParams(params) }, ctx.speaker);
        return { reply: await notYoursReply(deps), status: "refused" };
      }
      return escalateToAdmin(deps, action, params, ctx);
    }
  } else if (!bossActionAllowed(action, ctx.speaker)) {
    await audit(deps, action.key, ctx.actor, { status: "refused", params: safeParams(params) }, ctx.speaker);
    return { reply: NOT_YOURS_REPLY, status: "refused" };
  }
  // Un membre autorisé n'a pas de confirmation à donner (validation qui lui est adressée) : l'action se fait.
  const execDeps: BossExecDeps = { ...deps, inputText: ctx.inputText, speaker: ctx.speaker ?? null, chat: ctx.chat ?? null, mentions: ctx.mentions ?? [] };
  if (cls === "confirm" && !member) {
    const blocked = await checkAction(execDeps, action, params);
    if (blocked) {
      await audit(deps, action.key, ctx.actor, { status: "clarify", params: safeParams(params) }, ctx.speaker);
      return { ...blocked, status: "clarify" };
    }
    const summary = action.summarize ? await action.summarize(deps, params) : `${action.description} ?`;
    const r = await createBossPending(deps, { actionKey: action.key, params, summary, chatId: ctx.chat?.chatId ?? null });
    await audit(deps, action.key, ctx.actor, { status: "confirm", params: safeParams(params) }, ctx.speaker);
    return { ...r, status: "confirm" };
  }
  const r = await action.execute(execDeps, params, ctx.actor);
  // Nom ambigu : l'entrée a posé une question numérotée au lieu d'agir.
  const after = await readClarify(deps);
  const status: BossTurnStatus = after && after.createdAt !== before?.createdAt ? "clarify" : "done";
  await audit(deps, action.key, ctx.actor, { status, params: safeParams(params) }, ctx.speaker);
  return { ...r, status };
}

/** Action confirmée par OUI : revalidée par le code, puis exécutée (bornes revérifiées par l'entrée). */
export async function runConfirmedAction(deps: BossDeps, pending: BossPending, actor: BossActor): Promise<BossReply> {
  const action = bossAction(pending.actionKey, { includeHidden: true });
  if (!action) {
    deps.logger?.error({ action: pending.actionKey }, "[boss] action confirmée inconnue");
    return { reply: oopsReply() };
  }
  const parsed = action.parse(pending.params);
  if (!parsed.ok) {
    deps.logger?.error({ err: parsed.error, action: action.key }, "[boss] paramètres de l'action confirmée illisibles");
    return { reply: oopsReply() };
  }
  try {
    const r = await action.execute(deps, parsed.params as Record<string, unknown>, actor);
    // Opérations du site (phase 34) : le cœur du site écrit l'`AuditLog` (`via: "TELEGRAM"`), jamais un second ici.
    if (!SITE_SELF_AUDITED_ACTIONS.has(action.key))
      await audit(deps, action.key, actor, { status: "done", confirmed: true, params: safeParams(parsed.params as Record<string, unknown>) });
    await writeBossTurn(deps, { role: "BOSS", text: r.reply ?? "", actionKey: action.key, status: "done", source: "button" });
    return r;
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, action: action.key }, "[boss] action confirmée en échec");
    return { reply: oopsReply() };
  }
}

// ------------------------------------------------------------------------------------------- actions proches

const STOP = new Set(
  "le la les un une des de du d l a au aux et ou en sur pour par avec mon ma mes ton ta tes son sa ses ce cet cette ces je tu il elle on nous vous ils me te se ne pas plus que qui quoi est sont fais fait faire peux peut veux dis dit moi toi y".split(
    " ",
  ),
);

function words(s: string): string[] {
  return normalizeText(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/s$/, ""));
}

/** 2 ou 3 actions proches d'une demande non couverte (mots en commun avec les descriptions, pur). */
export function nearestActions(text: string, catalog: readonly BossAction[] = BOSS_CATALOG, n = 3): BossAction[] {
  const want = new Set(words(text));
  const scored = catalog
    .filter((a) => a.key !== "annule")
    .map((a) => ({ a, score: words(`${a.description} ${a.key.replace(/_/g, " ")}`).filter((w) => want.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  const out = scored.slice(0, n).map((x) => x.a);
  for (const key of ["etat_general", "depenses_du_mois", "aide"]) {
    if (out.length >= 2) break;
    const a = catalog.find((c) => c.key === key);
    if (a && !out.includes(a)) out.push(a);
  }
  return out.slice(0, n);
}

/**
 * Une action proposée quand Kevin ne peut pas : une LECTURE seulement (`BOSS_READ_KEYS`), immédiate, sans paramètre
 * requis (rejouable telle quelle par OUI). Jamais une action qui change, défait ou dépense quelque chose
 * (`annuler_reglage`, `arreter_ordre`, `plus_tard`, `test_bookmaker`…) : un OUI ne défait jamais rien.
 */
export function suggestable(a: BossAction): boolean {
  return BOSS_READ_KEYS.has(a.key) && !NOT_SUGGESTED.has(a.key) && a.cls === "immediate" && !a.classify && a.parse({}).ok;
}
/** Lectures jamais proposées : l'aide (déjà citée), et celles qui lancent un travail ou des appels payants. */
const NOT_SUGGESTED = new Set(["aide", "analyser_canal", "apercu_matchs", "voir_matchs_bookmaker", "demander_equipe"]);

/** Fragment d'une description (« Dire où en sont… » → « te dire où en sont… »), pur. */
function offerFragment(description: string): string {
  const d = description.trim().replace(/[.;:!\s]+$/u, "").replace(/\s*\(.*$/, "");
  const low = d.charAt(0).toLocaleLowerCase("fr-FR") + d.slice(1);
  return /^(dire|donner|montrer|envoyer|lister)\b/.test(low) ? `te ${low}` : low;
}

/**
 * Demande vraiment impossible (règle 3) : ce qui bloque en une phrase, puis UNE chose faisable tout de suite en
 * question (OUI / NON quand aucune autre confirmation n'attend) ; la demande est notée. Plus jamais de refus sec.
 */
export async function unmetReply(
  deps: BossDeps,
  text: string,
  secretContext?: SecretTextContext | null,
  chat?: BossChat | null,
  speaker?: BossSpeaker | null,
  /** Début écrit par le rédacteur (`converse.ts`, déjà contrôlé) ; absent : une variante fixe. */
  writtenHead?: string | null,
): Promise<BossReply> {
  await recordBossUnmet(deps, text, secretContext ?? null);
  const chatId = chat?.chatId ?? null;
  const near = nearestActions(text).filter(suggestable);
  const fallback = BOSS_CATALOG.find((a) => a.key === "etat_general") ?? null;
  const offer = near[0] ?? (fallback && suggestable(fallback) ? fallback : null);
  const head = writtenHead?.trim() || pick(UNMET_HEADS, "execute.unmet.head", chatId);
  const noted = pick(V.unmetNoted, "execute.unmet.noted", chatId);
  if (!offer) return { reply: `${head} ${noted} ${pick(V.unmetNoOffer, "execute.unmet.nooffer", chatId)}` };
  const what = esc(offerFragment(offer.description));
  const pending = await readBossPending(deps);
  if (pending && !pending.expired) {
    // Une confirmation attend déjà : JAMAIS une seconde question en OUI (un OUI confirmerait l'ancienne). La
    // proposition se prend par le numéro « 1 », et le prochain OUI sans « Répondre » fera d'abord redemander.
    await askToChoose({ ...deps, speaker: speaker ?? null, chat: chat ?? null } as BossDeps, {
      actionKey: offer.key,
      params: {},
      field: "",
      question: "",
      options: [{ label: offerFragment(offer.description), value: "" }],
    });
    await shadowBossPending(deps, pending.id);
    return { reply: `${head} ${noted}\n${pick(V.unmetOfferNumber({ what }), "execute.unmet.offer.number", chatId)}` };
  }
  const question = pick(V.unmetOffer({ what }), "execute.unmet.offer", chatId);
  const r = await createBossPending(deps, { actionKey: offer.key, params: {}, summary: question.replace(/<[^>]+>/g, ""), chatId });
  return { reply: `${head} ${noted}\n${question}`, buttons: r.buttons, pendingId: r.pendingId };
}

// ------------------------------------------------------------------------------------------- ordres d'un membre

const LIVE_WORDS = /\b(en vrai|pour de vrai|vrai canal|vrais canaux|en reel|pour de bon)\b/;

/** L'ordre demandé vise-t-il clairement un vrai canal, le mode réel ou plus de 7 jours (avant tout plan) ? */
async function obviouslyNeedsAdmin(deps: BossDeps, text: string, canal: string | null | undefined): Promise<boolean> {
  const n = normalizeText(text);
  if (LIVE_WORDS.test(n)) return true;
  const days = [...n.matchAll(/(\d{1,3})\s*(?:jours|jour|j)\b/g)].map((m) => Number(m[1]));
  if (days.some((d) => d > 7) || /\b(semaines|mois)\b/.test(n)) return true;
  const refs = await channelRefs(deps).catch(() => []);
  if (canal) {
    const hits = matchNames(canal, refs);
    if (hits.some((c) => !c.isTest)) return true;
  }
  const folded = normName(text);
  return refs.some((c) => !c.isTest && normName(c.name).length >= 4 && folded.includes(normName(c.name)));
}

/**
 * Coût (règle des membres) : un membre qui n'a pas le droit de lancer cet ordre (simple membre, ou vrai canal, mode
 * réel, plus de 7 jours) ne déclenche PAS le planificateur : Kevin transmet sa demande à l'admin en une ligne. Un
 * responsable a au plus `BOSS_MEMBER_PLAN_DAILY_LIMIT` planifications par jour (un plan en cache ne compte pas).
 * L'admin n'est limité que par le plafond. Rend la réponse, ou null (le planificateur peut tourner).
 */
async function memberOrderGate(deps: BossDeps, input: BossTeamInput, canal: string | null | undefined, actor: BossActor): Promise<RunResult | null> {
  const speaker = input.speaker;
  if (!speaker || speaker.kind !== "member") return null;
  const text = input.spokenText ?? input.text;
  const mayLaunch = (speaker.role === "MANAGER" || speaker.role === "ADMIN") && !(await obviouslyNeedsAdmin(deps, text, canal));
  if (mayLaunch) {
    const cached = await deps.prisma.teamOrder
      .findFirst({ where: { planCacheKey: planCacheKeyOf(text), createdAt: { gte: new Date(nowOf(deps).getTime() - 24 * 3600_000) } } })
      .catch(() => null);
    if (cached || (await claimMemberPlanTurn(deps, speaker.telegramUserId))) return null;
  }
  const group = input.chat?.type === "group";
  const chatId = input.chat?.chatId ?? null;
  const ask = esc(text.replace(/\s+/g, " ").trim().slice(0, 200));
  const adminName = esc(await adminFirstName(deps).catch(() => "l'admin"));
  const line = pick(V.orderToAdmin({ admin: group ? await adminMention(deps) : `${adminName},`, who: esc(speaker.firstName), ask }), "execute.order.toadmin", chatId);
  await audit(deps, "ordre_equipe", actor, { status: mayLaunch ? "quota" : "transmitted", params: safeParams({ demande: text }) }, speaker);
  const quota = mayLaunch ? `${pick(V.orderQuota({ max: BOSS_MEMBER_PLAN_DAILY_LIMIT, name: adminName }), "execute.order.quota", chatId)}\n` : "";
  if (group) return { reply: `${quota}${line}`, status: "confirm" };
  try {
    await deps.admin?.send(line);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] demande d'ordre transmise non envoyée");
  }
  return { reply: quota ? quota.trim() : pick(V.escalated({ name: adminName }), "execute.escalate.done", chatId), status: "confirm" };
}

// ------------------------------------------------------------------------------------------- tour avec l'IA

async function handleDecision(
  deps: BossDeps,
  decision: BossDecision,
  input: BossTeamInput,
  actor: BossActor,
  secretContext: SecretTextContext,
  runningTurnId: string | null = null,
): Promise<RunResult & { costCents?: number; actionKey: string }> {
  switch (decision.type) {
    case "action": {
      const r = await runBossAction(deps, decision.action, decision.params, {
        actor,
        inputText: input.spokenText ?? input.text,
        speaker: input.speaker,
        chat: input.chat,
        mentions: input.mentions,
      });
      return { ...r, actionKey: decision.action.key };
    }
    case "preciser": {
      const list = decision.choix.length ? ["", ...decision.choix.map((c, i) => `${i + 1}. ${esc(c)}`)] : [];
      // Liste mémorisée (30 min) : la réponse « 3 » ou « Test » rejoue la demande d'origine complétée par l'option.
      if (decision.choix.length)
        await rememberKevinList(deps, {
          kind: "replay",
          question: decision.question,
          options: decision.choix.map((label) => ({ label })),
          originalText: input.spokenText ?? input.text,
          speaker: input.speaker ?? null,
          chatId: input.chat?.chatId ?? null,
        });
      return { reply: [esc(decision.question), ...list].join("\n").replace("\n\n", "\n"), status: "clarify", actionKey: "preciser" };
    }
    case "question": {
      let team = null;
      if (decision.team) {
        const t = resolveTeam(decision.team, { allowAll: true });
        team = t.ok && t.value !== "all" ? t.value : null;
      }
      // Dernier message de Kevin : contrôle de répétition de la réponse rédigée (`kevinText`).
      const previous = await lastBossText(deps, input.chat?.chatId ?? null, runningTurnId);
      const a = await answerQuestion({ ...deps, voicePrevious: previous, qaTurnId: runningTurnId } as BossDeps, { topic: decision.topic, question: decision.question, team, period: decision.period });
      return { reply: a.reply, status: "answered", costCents: a.costCents, actionKey: "repondre_question" };
    }
    case "ordre": {
      // Membre : droits et limite du jour AVANT le planificateur (Opus, le plus cher).
      const gated = await memberOrderGate(deps, input, decision.canal ?? null, actor);
      if (gated) return { ...gated, actionKey: "ordre_equipe" };
      // Temps 2 : le planificateur reçoit le message de l'admin tel quel (jamais la reformulation de l'IA seule).
      const memory = input.chat
        ? await turnsForSpeaker(deps, { chatId: input.chat.chatId, fromTelegramId: input.speaker?.telegramUserId ?? null }).catch(() => [])
        : [];
      const r = await handleOrderRequest(deps, {
        text: input.spokenText ?? input.text,
        hints: { equipe: decision.equipe ?? null, canal: decision.canal ?? null },
        memory,
        speaker: input.speaker ?? null,
        chat: input.chat ?? null,
        actor,
      });
      const { status, costCents, orderId: _o, ...reply } = r;
      return { ...reply, status, costCents, actionKey: "ordre_equipe" };
    }
    case "site": {
      // Phase 34 : opération du site (droits, secret, essai à blanc, confirmation, exécution : `site/flow.ts`).
      const r = await runSiteFlow(deps, { op: decision.op, params: decision.params, input });
      return { ...r, actionKey: decision.op.key };
    }
    case "discuter": {
      // Discussion sans action : Kevin répond librement, comme un collègue (`converse.ts`, garde-fous du code).
      const chatId = input.chat?.chatId ?? null;
      const w = await writeKevinReply(deps, {
        mode: "chat",
        message: input.spokenText ?? input.text,
        chat: input.chat,
        speaker: input.speaker,
        turnId: runningTurnId,
        messageId: input.messageId,
        previous: await lastBossText(deps, chatId, runningTurnId),
      });
      if (w.text) return { reply: w.text, status: "answered", costCents: w.costCents, actionKey: "discuter" };
      // Sans rédacteur (IA absente, panne, contrôle, QA) : la politesse fixe, sinon la réponse d'avant.
      const small = smallTalkReply(input.text, chatId);
      if (small) return { reply: small, status: "done", costCents: w.costCents, actionKey: "politesse" };
      return { ...(await unmetReply(deps, input.text, secretContext, input.chat, input.speaker)), status: "unmet", costCents: w.costCents, actionKey: "pas_prevu" };
    }
    case "pas_prevu": {
      // Le début (« ce qui bloque ») est écrit par le rédacteur ; la proposition et ses boutons restent au code.
      const w = await writeKevinReply(deps, {
        mode: "unmet",
        message: input.spokenText ?? input.text,
        chat: input.chat,
        speaker: input.speaker,
        turnId: runningTurnId,
        messageId: input.messageId,
        previous: await lastBossText(deps, input.chat?.chatId ?? null, runningTurnId),
      });
      return { ...(await unmetReply(deps, input.text, secretContext, input.chat, input.speaker, w.text)), status: "unmet", costCents: w.costCents, actionKey: "pas_prevu" };
    }
  }
}

/** Statuts d'une action du catalogue dont le texte peut être redit par le rédacteur (jamais une confirmation). */
const REWRITE_STATUSES = new Set<BossTurnStatus>(["done", "refused", "clarify"]);
/** Actions dont le texte part toujours tel quel : listes et guides, réponses aux questions ouvertes, annulation. */
const NOT_REWRITTEN_ACTIONS = new Set(["aide", "commencer", "qui_fait_quoi", "repondre_demande", "plus_tard", "annule"]);

/**
 * Tour complet avec l'IA (worker, tâche `boss-text`). Un message déjà traité (tour du Boss avec le même
 * `telegramMessageId`) ne l'est jamais deux fois : réponse vide. Ne lève jamais.
 */
export async function bossAiTurn(deps: BossDeps, input: BossTeamInput): Promise<BossReply> {
  const text = (input.text ?? "").trim();
  try {
    if (await bossTurnForMessage(deps, input.messageId, input.chat?.chatId ?? null)) return {};
    const actor = await bossActorOf(deps, input.speaker);
    const secretContext = await bossSecretContext(deps, input.replyToMessageId, { chat: input.chat, speaker: input.speaker });
    const chatId = input.chat?.chatId ?? null;
    const fromId = input.speaker?.telegramUserId ?? null;
    // Filet : un secret n'atteint JAMAIS l'IA (le chemin rapide l'a déjà traité ; un vocal n'en est jamais un).
    if (input.source !== "voice" && (isSecretAdminText(text, secretContext) || looksLikeBotToken(text))) {
      await writeBossTurn(deps, { role: "ADMIN", text, secret: true, source: input.source, telegramMessageId: input.messageId, chatId, fromTelegramId: fromId });
      await writeBossTurn(deps, { role: "BOSS", text: SECRET_REMOVED_REPLY, status: "refused", actionKey: "secret", telegramMessageId: input.messageId, chatId });
      return { reply: SECRET_REMOVED_REPLY, deleteMessage: true };
    }
    if (input.forwarded) {
      const reply = pick(FORWARDED_REPLIES, "execute.forwarded", chatId);
      await writeBossTurn(deps, { role: "ADMIN", text: forwardedMemoryText(text), source: input.source, telegramMessageId: input.messageId, chatId, fromTelegramId: fromId });
      await writeBossTurn(deps, { role: "BOSS", text: reply, status: "refused", actionKey: "transfere", telegramMessageId: input.messageId, chatId });
      return { reply };
    }
    await writeBossTurn(deps, { role: "ADMIN", text, source: input.source, telegramMessageId: input.messageId, chatId, fromTelegramId: fromId });
    const turnId = await writeBossTurn(deps, { role: "BOSS", text: "…", status: "running", telegramMessageId: input.messageId, chatId });
    const finish = async (r: BossReply, status: BossTurnStatus, actionKey: string, costCents = 0): Promise<BossReply> => {
      // Contrôle de répétition branché à l'envoi (texte fixe répété → une autre de ses variantes).
      if (r.reply) r = { ...r, reply: varyAgainst(r.reply, await lastBossText(deps, chatId, turnId)) };
      await updateBossTurn(deps, turnId, { text: r.reply ?? "", status, actionKey, costCents });
      return r;
    };
    if (!deps.llm || !text)
      return finish(
        { reply: text ? pick(NO_AI_REPLIES, "execute.noai", chatId) : pick(V.empty, "execute.empty", chatId) },
        "error",
        "sans_ia",
      );
    // Réponse à la dernière liste de Kevin (« 3 », « Test », « le 3 ») : la demande d'origine est rejouée, complétée par
    // l'option choisie. Tout autre message ferme la liste (un « 3 » tardif ne rejoue plus une vieille demande).
    let effective: BossTeamInput = input;
    let replayed = false;
    const list = await readKevinList(deps, { speaker: input.speaker ?? null, chatId }).catch(() => null);
    if (list) {
      const index = list.kind === "replay" && input.replyToMessageId == null ? pickOption(text, list.options.map((o) => o.label)) : null;
      const clarify = await readClarify(deps);
      const newerClarify = !!clarify && new Date(clarify.createdAt).getTime() > new Date(list.createdAt).getTime();
      if (index !== null && !newerClarify) {
        effective = { ...input, text: replayText(list.originalText, list.question, list.options[index]!.label), spokenText: undefined };
        replayed = true;
      }
      await clearKevinList(deps, input.speaker ?? null);
    }
    const aiText = (effective.text ?? "").trim();
    let interpreted: Awaited<ReturnType<typeof interpretBossText>>;
    try {
      interpreted = await interpretBossText(deps, aiText, { source: input.source, speaker: input.speaker, chat: input.chat, mentions: input.mentions });
    } catch (err) {
      if (err instanceof BossBudgetError) return finish({ reply: pick(NO_AI_REPLIES, "execute.noai", chatId) }, "error", "plafond");
      deps.logger?.warn({ err: (err as Error).message }, "[boss] interprète en échec");
      return finish({ reply: oopsReply(undefined, chatId) }, "error", "erreur");
    }
    if (replayed && (interpreted.decision.type === "pas_prevu" || interpreted.decision.type === "discuter"))
      // Jamais « pas prévu » pour un choix valide : Kevin redemande la phrase.
      return finish({ reply: pick(CHOICES_VARIANTS.replayLost, "choices.replayLost", chatId) }, "clarify", "preciser", interpreted.costCents);
    const r = await handleDecision(deps, interpreted.decision, effective, actor, secretContext, turnId);
    const { status, actionKey, costCents, ...codeReply } = r;
    let reply: BossReply = codeReply;
    let spent = interpreted.costCents + (costCents ?? 0);
    // Kevin parle comme un collègue : le texte prévu par le code pour une action du catalogue est redit naturellement
    // (mêmes chiffres, noms, sens et mode, sinon le texte du code part tel quel). Jamais une confirmation ni une liste.
    if (interpreted.decision.type === "action" && REWRITE_STATUSES.has(status) && !NOT_REWRITTEN_ACTIONS.has(actionKey) && rewritableResult(codeReply)) {
      const w = await writeKevinReply(deps, {
        mode: "result",
        message: aiText,
        codeText: codeReply.reply ?? "",
        chat: input.chat,
        speaker: input.speaker,
        turnId,
        messageId: input.messageId,
        previous: await lastBossText(deps, chatId, turnId),
      });
      spent += w.costCents;
      if (w.text) reply = { ...codeReply, reply: w.text };
    }
    return finish(reply, status, actionKey, spent);
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message }, "[boss] tour en échec");
    return { reply: oopsReply(undefined, input.chat?.chatId ?? null) };
  }
}
