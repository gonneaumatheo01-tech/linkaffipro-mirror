import type { Bot, Context } from "grammy";
import { GrammyError } from "grammy";
import type { Message } from "grammy/types";
import {
  handleAdminText,
  handleAgentsCallback,
  isAgentsCallbackData,
  isSecretAdminText,
  rememberEditPrompt,
  BOSS_DEFAULT_NAME,
  pick,
  type BossTeamInput,
  type VoiceTable,
  type VoiceTemplate,
  hasLibraryKeyword,
  isBossInputCallbackData,
  refersToReceivedInput,
  INPUT_REFERENCE_DELAY_MS,
} from "@linkaffipro/agents";
import { isBossBot, type AdminDialogBot, type BotIdentity, type TelegramDeps } from "../ports";
import { htmlToPlain } from "../agents/admin-messenger";
import { secretContextOf } from "../agents/redact";
import { findChannelLinkInText } from "../channels/username";
import { messageHasCustomEmoji } from "../custom-emoji/extract";
import { realBossEngine, type BossEngine } from "../boss/engine";
import { bossReplyText, deliverBossReply, type BossReplyApi } from "../boss/reply";
import { ackForwarded, bumpAlbumAck, isPlainDocument, keepForwarded, noteBossPhrase, onBossInputCallback, receiveBossDocument } from "./boss-inputs";

type NameSample = { name: string };
type BotSample = { username: string; name: string };
const NAME_SAMPLES: NameSample[] = [{ name: "Kevin" }, { name: "Léa" }];

/**
 * Même forme que `voiceTemplate` de `@linkaffipro/agents` (rendu + valeurs d'exemple), construite ICI : le chargement
 * de ce module n'appelle aucune fonction du paquet des agents (les tests du worker le remplacent par un faux module).
 */
function voiceTemplate<P>(samples: readonly P[], render: (p: P) => readonly string[]): VoiceTemplate<P> {
  const fn = ((p: P) => render(p)) as VoiceTemplate<P>;
  Object.defineProperty(fn, "samples", { value: samples });
  return fn;
}
const BOT_SAMPLES: BotSample[] = [
  { username: "kevin_boss_bot", name: "Kevin" },
  { username: "kevcanauxbot", name: "Léa" },
];

/**
 * Phase 33 : textes fixes envoyés par Kevin depuis ce handler (charte `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun,
 * choisies par `pick` (jamais deux fois de suite la même dans une conversation).
 */
export const AGENTS_ADMIN_VARIANTS = {
  /** Service d'arrière-plan muet depuis plus de 3 minutes (texte). */
  workerDown: [
    "Je suis en panne de mon côté, réessaie dans quelques minutes. L'équipe technique est prévenue. Les commandes simples marchent quand même : écris aide.",
    "Petite panne chez moi, réessaie dans quelques minutes. L'équipe technique est au courant. En attendant, écris aide pour les commandes simples.",
    "Je suis en panne pour l'instant, retente dans quelques minutes. L'équipe technique est prévenue. Les commandes simples marchent : écris aide.",
  ],
  /** Même cas pour un vocal (il sera écouté au redémarrage). */
  voiceWorkerDown: [
    "Je suis en panne de mon côté, je t'écoute dès que ça repart. L'équipe technique est prévenue. En attendant, les commandes simples écrites marchent : écris aide.",
    "Petite panne chez moi : ton vocal passera dès que ça repart, d'ici quelques minutes. L'équipe technique est prévenue. Écris aide pour les commandes simples.",
  ],
  /** Dernier recours quand la réponse ne part pas. */
  received: ["Bien reçu ✅", "Reçu ✅", "C'est arrivé ✅"],
  /** Texte qui ressemble à une clé, effacé sans être mis en file. */
  secretNotQueued: [
    "🔒 Ce message ressemblait à une clé : je l'ai effacé sans le garder. Pour enregistrer une clé, écris « clé <nom> <valeur> » ou réponds à ma question.",
    "🔒 J'ai effacé ton message sans le garder, il ressemblait à une clé. Pour en enregistrer une, écris « clé <nom> <valeur> » ou réponds à ma question.",
  ],
  /** `/start` de l'admin (HTML). */
  welcome: voiceTemplate(NAME_SAMPLES, (p) => [
    [
      `Salut, moi c'est ${p.name}, je pilote les agents pour toi.`,
      "Parle-moi normalement, par écrit ou en vocal : je réponds toujours. Avant tout ce qui dépense ou publie, je te demande ton accord.",
      "Écris <b>commencer</b> et on démarre ensemble, ou <b>aide</b> pour voir ce que je sais faire.",
    ].join("\n"),
    [
      `Salut, moi c'est ${p.name}. Je m'occupe des agents pour toi.`,
      "Écris-moi ou envoie un vocal, comme à un collègue, je réponds toujours. Rien ne dépense ni ne publie sans ton accord.",
      "Tape <b>commencer</b> pour qu'on démarre, ou <b>aide</b> pour voir ce que je sais faire.",
    ].join("\n"),
    [
      `Hey, moi c'est ${p.name}, je gère les agents pour toi.`,
      "Tu peux m'écrire ou m'envoyer un vocal, je réponds toujours. Je te demande ton accord avant de dépenser ou de publier quoi que ce soit.",
      "On commence ? Écris <b>commencer</b>, ou <b>aide</b> pour voir ce que je sais faire.",
    ].join("\n"),
  ]),
  /** Un bot de canal renvoie l'admin vers Kevin. */
  redirect: voiceTemplate(BOT_SAMPLES, (p) => [
    `Parle-moi sur @${p.username} (${p.name}) 👉`,
    `Pour me parler, c'est sur @${p.username} (${p.name}) 👉`,
    `Écris-moi plutôt sur @${p.username} (${p.name}) 👉`,
  ]),
  /** Lien du compte du site accepté. */
  accountLinked: voiceTemplate(NAME_SAMPLES, (p) => [
    `Fait, ton compte ${p.name} est lié.`,
    `C'est bon, compte ${p.name} lié.`,
  ]),
  /** Lien du compte du site périmé. */
  linkExpired: [
    "Ce lien n'est plus valable. Recrée-le dans « Mon compte » sur le site.",
    "Lien périmé. Tu en refais un dans « Mon compte » sur le site ?",
  ],
  /** « Corriger » appuyé sur un bot de canal après la bascule vers Kevin. */
  editTail: voiceTemplate(BOT_SAMPLES, (p) => [
    `Écris le nouveau texte à @${p.username} (${p.name}).`,
    `Envoie le nouveau texte sur @${p.username} (${p.name}).`,
  ]),
  /** Vocal transféré : une donnée, jamais une consigne. */
  forwardedVoice: [
    "C'est un vocal transféré : je ne suis que les vocaux que tu enregistres toi-même.",
    "Vocal transféré, je ne le prends pas comme une consigne. Je ne suis que ceux que tu enregistres toi-même.",
  ],
  /** Petit message d'un bouton en erreur. */
  buttonError: ["Ça n'a pas marché, réessaie dans un instant.", "Raté, réessaie dans un instant."],
  /** Ancien dialogue (phase 19) en erreur. */
  legacyError: [
    "Oups, je n'ai pas pu traiter ce message. Réessaie dans un instant.",
    "Ça a coincé de mon côté, je n'ai pas pu traiter ce message. Tu réessaies dans un instant ?",
  ],
} as const satisfies VoiceTable;

type ChatKey = number | bigint | null;

/**
 * Service d'arrière-plan (worker) muet depuis plus de 3 minutes (battement `worker:heartbeat`) : réponse immédiate,
 * la tâche est quand même mise en file (elle se fera au redémarrage, sans double réponse : le worker vérifie le tour).
 */
export const BOSS_WORKER_DOWN_REPLY = AGENTS_ADMIN_VARIANTS.workerDown[0];
/** Même cas pour un vocal (il sera écouté au redémarrage). */
export const BOSS_VOICE_WORKER_DOWN_REPLY = AGENTS_ADMIN_VARIANTS.voiceWorkerDown[0];
/** Dernier recours quand la réponse ne part pas (même en texte brut) : l'admin sait que son message est arrivé. */
export const BOSS_RECEIVED_REPLY = AGENTS_ADMIN_VARIANTS.received[0];

/** Une variante d'un texte fixe de ce handler pour cette conversation. */
function say(key: Exclude<keyof typeof AGENTS_ADMIN_VARIANTS, "welcome" | "redirect" | "accountLinked" | "editTail">, chatId: ChatKey): string {
  return pick(AGENTS_ADMIN_VARIANTS[key], `agents-admin.${key}`, chatId);
}

/**
 * Le service d'arrière-plan est-il arrêté (battement absent ou de plus de 3 minutes) ? Faux sur un doute (lecture
 * impossible, dépendance absente) : la mise en file dira elle-même si Redis est injoignable. Ne lève jamais.
 */
export async function workerLooksDown(deps: Pick<TelegramDeps, "workerDown">): Promise<boolean> {
  if (!deps.workerDown) return false;
  try {
    return (await deps.workerDown()) === true;
  } catch {
    return false;
  }
}

/** Texte dont tout le contenu visible est fait d'emojis animés (espaces mis à part). */
export function onlyCustomEmojis(msg: Pick<Message, "text" | "entities">): boolean {
  const text = msg.text ?? "";
  const covered = new Array<boolean>(text.length).fill(false);
  let any = false;
  for (const e of msg.entities ?? []) {
    if (e.type !== "custom_emoji") continue;
    any = true;
    for (let i = e.offset; i < Math.min(text.length, e.offset + e.length); i++) covered[i] = true;
  }
  if (!any) return false;
  for (let i = 0; i < text.length; i++) if (!covered[i] && !/\s/.test(text[i]!)) return false;
  return true;
}

/** Une validation attend-elle le texte corrigé de l'admin (« ✏️ Corriger ») ? Faux sur un doute. */
async function awaitingPostEdit(deps: TelegramDeps): Promise<boolean> {
  try {
    const row = await deps.agentsDeps!().prisma.agentValidation.findFirst({
      where: { status: "PENDING", awaitingEditAt: { not: null } },
      select: { id: true },
    });
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Phase 12 + 26 : un message de l'admin à emojis animés remplit-il la bibliothèque d'emojis plutôt que d'aller au Boss ?
 * - transféré (d'un canal, d'une personne ou d'un groupe) : oui, toujours ;
 * - réponse à un message (correction d'un post, réponse à une question) ou correction attendue : non, chemin du Boss
 *   (les emojis restent dans le texte corrigé) ;
 * - sinon : oui sur un bot de canal (dont le bot casino qui fait office de Boss) ; sur le vrai Boss, seulement si le
 *   message ne contient que des emojis animés (une phrase avec un emoji animé reste une phrase pour Kevin).
 */
export async function wantsEmojiLibrary(identity: BotIdentity, deps: TelegramDeps, msg: Message & { text: string }): Promise<boolean> {
  if (!messageHasCustomEmoji(msg)) return false;
  if (msg.forward_origin) return true;
  if (msg.reply_to_message) return false;
  if (deps.agentsDeps && (await awaitingPostEdit(deps))) return false;
  return isBossBot(identity) ? onlyCustomEmojis(msg) : true;
}

/** Taille maximale d'un vocal de l'admin (la transcription refuse au-delà de 2 Mo, environ 2 minutes). */
export const ADMIN_VOICE_MAX_BYTES = 2 * 1024 * 1024;

/** Nom affiché du Boss (`Setting` `boss.name`) : « Kevin » si absent ; ne lève jamais. */
export async function bossNameOf(deps: TelegramDeps): Promise<string> {
  if (!deps.bossName) return BOSS_DEFAULT_NAME;
  try {
    return (await deps.bossName()).trim() || BOSS_DEFAULT_NAME;
  } catch {
    return BOSS_DEFAULT_NAME;
  }
}

/** `/start` de l'admin sur le bot du dialogue admin (phase 26). */
export function bossWelcomeText(name: string, chatId: ChatKey = null): string {
  return pick(AGENTS_ADMIN_VARIANTS.welcome({ name }), "agents-admin.welcome", chatId);
}

/** Un bot de canal renvoie l'admin vers le bot du dialogue admin (une seule fois par bot, puis silence). */
export function bossRedirectText(username: string, name: string = BOSS_DEFAULT_NAME, chatId: ChatKey = null): string {
  return pick(AGENTS_ADMIN_VARIANTS.redirect({ username, name }), "agents-admin.redirect", chatId);
}

/** Réponse en HTML, repli en texte brut si Telegram refuse le HTML. Rend l'identifiant du message envoyé. */
async function replyHtml(ctx: Context, text: string): Promise<number | null> {
  try {
    const sent = await ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return sent?.message_id ?? null;
  } catch (err) {
    if (err instanceof GrammyError && /parse entities/i.test(err.description)) {
      const sent = await ctx.reply(htmlToPlain(text), { link_preview_options: { is_disabled: true } });
      return sent?.message_id ?? null;
    }
    throw err;
  }
}

/** Même règle que le masquage du journal (`redactAdminSecretUpdate`) ; ne lève jamais. */
/** Un post transféré ressemble-t-il à une clé ou à un jeton de bot (jamais rangé comme post de référence) ? */
export async function forwardedLooksSecret(deps: TelegramDeps, fromId: number, text: string): Promise<boolean> {
  if (!text.trim()) return false;
  if (/(?<![\w])\d{6,12}:[A-Za-z0-9_-]{30,}/.test(text)) return true;
  return looksSecret(deps, fromId, text);
}

async function looksSecret(deps: TelegramDeps, fromId: number, text: string, replyTo?: number): Promise<boolean> {
  try {
    const state = deps.agentsAdminState ? await deps.agentsAdminState(BigInt(fromId)) : null;
    return isSecretAdminText(text, state ? secretContextOf(state, replyTo) : null);
  } catch {
    return isSecretAdminText(text, null);
  }
}

/**
 * Qui traite ce message privé (phase 26) ?
 * - `dialog` : l'expéditeur est l'admin et CE bot est le bot du dialogue admin (`adminBot()` : le Boss, sinon le bot
 *   casino de repli ; aucun des deux → ce bot) ;
 * - `redirect` : l'admin écrit à un autre de nos bots → renvoi une fois vers le bot du dialogue, puis silence ;
 * - `legacy` : dépendances sans `adminDialogBot` (tests de la phase 19) → ancien dialogue ;
 * - `other` : toute autre personne → traitement habituel (bot de canal) ou silence total (Boss).
 */
export type AdminRoute =
  | { kind: "dialog" }
  | { kind: "redirect"; target: AdminDialogBot }
  | { kind: "legacy" }
  | { kind: "other" };

export async function adminRouteFor(
  identity: BotIdentity,
  deps: TelegramDeps,
  fromId: number,
  chatType: string,
): Promise<AdminRoute> {
  if (chatType !== "private" || !deps.agentsDeps || !deps.isAdminDialogPartner) return { kind: "other" };
  if (!(await deps.isAdminDialogPartner(BigInt(fromId)))) return { kind: "other" };
  if (!deps.adminDialogBot) return isBossBot(identity) ? { kind: "dialog" } : { kind: "legacy" };
  const target = await deps.adminDialogBot();
  if (!target || target.id === identity.id) return { kind: "dialog" };
  return { kind: "redirect", target };
}

/** Renvoi vers le bot du dialogue admin : une fois par bot (et par bot cible), puis silence. Ne lève jamais. */
async function redirectOnce(ctx: Context, identity: BotIdentity, deps: TelegramDeps, target: AdminDialogBot): Promise<void> {
  try {
    const first = deps.claimBossRedirect ? await deps.claimBossRedirect(identity.id, target.id) : false;
    if (first) await ctx.reply(bossRedirectText(target.username, await bossNameOf(deps), ctx.chat?.id ?? null));
  } catch (err) {
    console.error("[boss] renvoi vers le bot du dialogue admin", identity.username, (err as Error).message);
  }
}

function engineOf(deps: TelegramDeps): BossEngine {
  return deps.bossEngine ?? realBossEngine;
}

/** API de réponse du Boss pour la conversation en cours (même instance grammY que le webhook). */
function replyApiOf(ctx: Context): BossReplyApi {
  return {
    sendMessage: (chatId, text, other) => ctx.api.sendMessage(chatId, text, other),
    deleteMessage: (chatId, messageId) => ctx.api.deleteMessage(chatId, messageId),
  };
}

/** Texte d'une commande pour le Boss : `/aide` → « aide », `/commencer x` → « commencer x » (`@bot` retiré). */
export function commandAsText(text: string): string {
  const m = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return text;
  const cmd = m[1]!.toLowerCase();
  const rest = (m[2] ?? "").trim();
  const word = cmd === "help" ? "aide" : cmd;
  return rest ? `${word} ${rest}` : word;
}

function isForwarded(msg: Message): boolean {
  return Boolean(msg.forward_origin);
}

/**
 * Texte (ou commande) de l'admin au bot du dialogue : chemin rapide du Boss, sinon tâche `boss-text` du worker. Jamais
 * de silence : erreur → « Oups… », file indisponible → réponse de secours.
 */
async function handleDialogText(
  ctx: Context,
  identity: BotIdentity,
  deps: TelegramDeps,
  msg: Message & { text: string },
  next: () => Promise<void>,
): Promise<void> {
  const chatId = ctx.chat!.id;
  const fromId = ctx.from!.id;
  const forwarded = isForwarded(msg);
  let text = msg.text;
  if (!forwarded && text.startsWith("/")) {
    const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/.exec(text);
    if (m) {
      const payload = m[1];
      // Bot casino qui fait office de Boss : `/start <paramètre>` (lien du compte, offre, canal à rejoindre…) suit le
      // chemin habituel ; `/start` seul garde l'état du membre (`memberStarted`) puis reçoit l'accueil de Kevin.
      if (!isBossBot(identity)) {
        if (payload) return next();
        try {
          await deps.memberStarted(identity, ctx.from!, undefined);
        } catch (err) {
          console.error("[boss] /start de l'admin non enregistré", identity.username, (err as Error).message);
        }
        await replyHtml(ctx, bossWelcomeText(await bossNameOf(deps), chatId));
        return;
      }
      // Lien du compte du site (« Mon compte » → Lier Telegram) : inchangé.
      if (payload?.startsWith("admin_")) {
        const linked = await deps.linkAdminAccount(payload.slice("admin_".length), BigInt(fromId));
        await ctx.reply(
          linked
            ? pick(AGENTS_ADMIN_VARIANTS.accountLinked({ name: linked.name }), "agents-admin.accountLinked", chatId)
            : say("linkExpired", chatId),
        );
        return;
      }
      await replyHtml(ctx, bossWelcomeText(await bossNameOf(deps), chatId));
      return;
    }
    text = commandAsText(text);
  }
  // Phase 34 : une phrase de l'admin juste avant un transfert (son commentaire) est la demande ; le transfert qui suit
  // n'a pas d'accusé en plus.
  if (!forwarded) noteBossPhrase(chatId);
  const agents = deps.agentsDeps!();
  const engine = engineOf(deps);
  const input: BossTeamInput = {
    text,
    messageId: msg.message_id,
    replyToMessageId: msg.reply_to_message?.message_id ?? null,
    source: "text",
    entities: msg.entities ?? null,
    ...(forwarded ? { forwarded: true } : {}),
    speaker: { kind: "admin", telegramUserId: BigInt(fromId), firstName: ctx.from?.first_name ?? null },
    chat: { type: "private", chatId: BigInt(chatId) },
  };
  let fast: Awaited<ReturnType<BossEngine["fastPath"]>>;
  try {
    fast = await engine.fastPath(agents, input);
  } catch (err) {
    console.error("[boss] chemin rapide", identity.username, (err as Error).message);
    // Un message qui contenait un secret ne reste jamais dans la conversation, même si le traitement a échoué.
    if (!forwarded && (await looksSecret(deps, fromId, msg.text, msg.reply_to_message?.message_id)))
      await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
    await ctx.reply(bossReplyText("error", chatId)).catch(() => undefined);
    return;
  }
  if (fast.handled) {
    try {
      await deliverBossReply({ api: replyApiOf(ctx), chatId, messageId: msg.message_id, reply: fast, deps: agents, engine });
    } catch (err) {
      console.error("[boss] réponse non envoyée", identity.username, (err as Error).message);
      // Jamais de silence (surtout après la suppression d'un secret) : texte brut, puis une courte phrase.
      await sendReplyFallback(ctx, chatId, fast.reply);
    }
    return;
  }
  // Filet : un texte qui ressemble à un secret n'est jamais mis en file (Redis garde le contenu des tâches). Le chemin
  // rapide les prend avant ; s'il ne l'a pas fait, le message est effacé et rien d'autre ne se passe.
  if (!forwarded && (await looksSecret(deps, fromId, msg.text, msg.reply_to_message?.message_id))) {
    await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
    await ctx.reply(say("secretNotQueued", chatId)).catch(() => undefined);
    return;
  }
  // Interprète IA : le worker répond dans quelques secondes (« écrit… » en attendant). Worker arrêté : réponse de
  // secours tout de suite, la tâche part quand même en file (traitée au redémarrage).
  const down = await workerLooksDown(deps);
  if (down) await ctx.reply(say("workerDown", chatId)).catch(() => undefined);
  else await ctx.api.sendChatAction(chatId, "typing").catch(() => undefined);
  try {
    await agents.enqueue.orchestrator(
      {
        type: "boss-text",
        botId: identity.id,
        chatId,
        messageId: msg.message_id,
        text,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
        source: "text",
        ...(forwarded ? { forwarded: true } : {}),
        entities: msg.entities ? msg.entities.map((e) => ({ ...e })) : null,
      },
      // Idempotent : un webhook rejoué n'interprète pas deux fois le même message. Phase 34 : une phrase qui parle de
      // « ça », « ce fichier »… attend 2 s (Telegram envoie le commentaire avant les messages transférés).
      {
        jobId: `boss-text:${identity.id}:${msg.message_id}`,
        ...(!forwarded && refersToReceivedInput(text) ? { delayMs: INPUT_REFERENCE_DELAY_MS } : {}),
      },
    );
  } catch (err) {
    console.error("[boss] message de l'admin non mis en file", identity.username, (err as Error).message);
    if (!down) await ctx.reply(bossReplyText("queueDown", chatId)).catch(() => undefined);
  }
}

/** Texte qui ressemble à une clé mais que le chemin rapide n'a pas pris : effacé, jamais envoyé à l'interprète. */
export const BOSS_SECRET_NOT_QUEUED_REPLY = AGENTS_ADMIN_VARIANTS.secretNotQueued[0];

/** Réponse de secours quand l'envoi normal a échoué : texte brut sans « Répondre », puis « Bien reçu ✅ ». */
async function sendReplyFallback(ctx: Context, chatId: number, html: string | undefined): Promise<void> {
  const plain = html?.trim() ? htmlToPlain(html).slice(0, 4000) : "";
  if (plain) {
    try {
      await ctx.api.sendMessage(chatId, plain, { link_preview_options: { is_disabled: true } });
      return;
    } catch (err) {
      console.error("[boss] réponse en texte brut non envoyée", (err as Error).message);
    }
  }
  await ctx.api.sendMessage(chatId, say("received", chatId)).catch(() => undefined);
}

/**
 * Dialogue admin (phases 19 et 26). Seul le bot du dialogue admin (`adminBot()`) traite les messages privés de l'admin
 * (`Setting` `admin.telegramUserId`) : boutons des aperçus (`agv:`), des questions (`agh:`) et des confirmations du
 * Boss (`bsc:`), vocaux (tâche `admin-voice`), textes Y COMPRIS ceux qui commencent par « / » (`/start` → accueil,
 * `/aide` → aide) et messages transférés (des données, jamais des ordres). Chaque message de l'admin reçoit une
 * réponse. Un autre de nos bots renvoie l'admin vers lui une seule fois puis se tait ; sur un bot de canal, les
 * messages transférés, les commandes et les liens de canal de l'admin gardent leur traitement habituel (ajout d'un
 * canal, emojis animés). Toute autre personne : traitement habituel (`next()`) ; sur le Boss, rien ne suit (silence).
 */
export function registerAgentsAdminHandlers(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  // Phase 34 : sur le Boss, un message transféré par l'admin est gardé 30 min comme contenu possible d'un post ou d'un
  // envoi (une DONNÉE, jamais exécutée ni envoyée à l'interprète). Un fichier CSV / TXT transféré suit le chemin des
  // fichiers ; un post à emojis animés continue vers la bibliothèque d'emojis (phase 12).
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message;
    if (!msg.forward_origin || ctx.from.is_bot || !isBossBot(identity) || !deps.agentsDeps) return next();
    const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.chat.type);
    if (route.kind !== "dialog") return next();
    // Les secrets d'abord : un post transféré qui contient une clé n'est jamais gardé ; le chemin habituel l'efface
    // sans le journaliser.
    if (await forwardedLooksSecret(deps, ctx.from.id, msg.text ?? msg.caption ?? "")) return next();
    const plainDoc = isPlainDocument(msg);
    const kept = plainDoc ? null : await keepForwarded(identity, deps, msg);
    if (plainDoc || !kept || messageHasCustomEmoji(msg as Message & { text: string })) return next();
    // Média de l'admin avec mots-clés de la médiathèque (transféré d'une personne) : rangé comme avant.
    if (msg.forward_origin.type !== "channel" && hasLibraryKeyword(msg.caption ?? "")) return next();
    // Suite d'un album ou d'une rafale, ou commentaire écrit juste avant : un seul contenu, pas d'accusé de plus.
    if (!kept.ack) return bumpAlbumAck(deps, msg);
    // Transfert sans texte (photo, vidéo, album) : accusé ici (le chemin du texte n'en verrait rien).
    if (msg.text === undefined) return ackForwarded(ctx, deps, msg, kept);
    return next();
  });

  // Phase 34 : fichier (CSV, TXT…) envoyé ou transféré par l'admin à Kevin : lu et gardé 30 min ; sa légende est la
  // demande (chemin d'un texte). Une image ou une vidéo envoyée comme fichier garde le chemin de la médiathèque.
  bot.on("message:document", async (ctx, next) => {
    const msg = ctx.message;
    if (ctx.from.is_bot || !isBossBot(identity) || !deps.agentsDeps || !isPlainDocument(msg)) return next();
    const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.chat.type);
    if (route.kind !== "dialog") return next();
    if (msg.caption && (await looksSecret(deps, ctx.from.id, msg.caption, msg.reply_to_message?.message_id))) {
      await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => undefined);
      await ctx.reply(say("secretNotQueued", ctx.chat.id)).catch(() => undefined);
      return;
    }
    let caption: string | null = null;
    try {
      caption = (await receiveBossDocument(ctx, identity, deps, msg)).caption;
    } catch (err) {
      console.error("[boss] fichier de l'admin", identity.username, (err as Error).message);
      await ctx.reply(bossReplyText("error", ctx.chat.id)).catch(() => undefined);
      return;
    }
    if (caption) {
      const asText = { ...msg, text: caption, entities: msg.caption_entities } as Message & { text: string };
      await handleDialogText(ctx, identity, deps, asText, next);
    }
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    // Phase 34 : choix des comptes publicitaires après une autorisation Meta / TikTok (admin seulement).
    if (isBossInputCallbackData(data)) {
      if (!deps.agentsDeps || !isBossBot(identity)) return next();
      const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.callbackQuery.message?.chat.type ?? "private");
      if (route.kind !== "dialog") {
        await ctx.answerCallbackQuery().catch(() => undefined);
        return;
      }
      return onBossInputCallback(ctx, deps);
    }
    const engine = engineOf(deps);
    const isBoss = engine.isCallbackData(data);
    if (!isBoss && !isAgentsCallbackData(data)) return next();
    if (!deps.agentsDeps) return next();
    const chatType = ctx.callbackQuery.message?.chat.type ?? "private";
    const route = await adminRouteFor(identity, deps, ctx.from.id, chatType);
    if (route.kind === "other") {
      // Boss : silence total. Ailleurs, un bouton de confirmation du Boss n'est jamais pris d'une autre personne ; les
      // boutons des agents vérifient eux-mêmes l'expéditeur (chemin d'avant la phase 26, réponse « réservé »).
      if (isBossBot(identity)) return;
      if (isBoss) {
        await ctx.answerCallbackQuery().catch(() => undefined);
        return;
      }
    }
    // Bouton de confirmation du Boss sur un autre bot : renvoi. Un bouton d'aperçu (`agv:`) ou de question (`agh:`)
    // déjà envoyé par ce bot (avant la bascule vers Kevin) agit sur la base : il continue de marcher ici.
    if (route.kind === "redirect" && isBoss) {
      await ctx
        .answerCallbackQuery({ text: bossRedirectText(route.target.username, await bossNameOf(deps), ctx.from.id) })
        .catch(() => undefined);
      await redirectOnce(ctx, identity, deps, route.target);
      return;
    }
    const agents = deps.agentsDeps();
    if (isBoss) {
      try {
        const r = await engine.callback(agents, {
          data,
          fromTelegramId: BigInt(ctx.from.id),
          messageId: ctx.callbackQuery.message?.message_id ?? null,
        });
        await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
        if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
        const chatId = ctx.callbackQuery.message?.chat.id ?? ctx.from.id;
        const messageId = ctx.callbackQuery.message?.message_id;
        if (r.reply || r.followUp) {
          await deliverBossReply({
            api: replyApiOf(ctx),
            chatId,
            messageId: messageId ?? 0,
            reply: { ...r, deleteMessage: false },
            deps: agents,
            engine,
          });
        }
      } catch (err) {
        console.error("[boss] bouton de confirmation", identity.username, (err as Error).message);
        await ctx.answerCallbackQuery({ text: say("buttonError", ctx.from.id) }).catch(() => undefined);
      }
      return;
    }
    try {
      const r = await handleAgentsCallback(agents, { data, fromTelegramId: BigInt(ctx.from.id) });
      await ctx.answerCallbackQuery(r.toast ? { text: r.toast } : undefined).catch(() => undefined);
      if (r.removeButtons) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      if (r.reply) {
        if (route.kind === "redirect") {
          // Bot de canal après la bascule : la conversation continue chez Kevin (le texte corrigé s'écrit là-bas).
          const name = await bossNameOf(deps);
          const tail = r.editPromptFor
            ? `\n\n${pick(AGENTS_ADMIN_VARIANTS.editTail({ username: route.target.username, name }), "agents-admin.editTail", ctx.from.id)}`
            : "";
          await replyHtml(ctx, `${r.reply}${tail}`);
        } else {
          const messageId = await replyHtml(ctx, r.reply);
          // « ✏️ Corriger » : une réponse à CE message sera le nouveau texte du post.
          if (r.editPromptFor && messageId) await rememberEditPrompt(agents, r.editPromptFor, messageId);
        }
      }
    } catch (err) {
      console.error("[agents] bouton de validation", identity.username, (err as Error).message);
      await ctx.answerCallbackQuery({ text: say("buttonError", ctx.from.id) }).catch(() => undefined);
    }
  });

  // Phase 20 : vocal (ou message audio) de l'admin → tâche `admin-voice` du worker (téléchargement, transcription,
  // puis même chemin qu'un texte). Aucun appel à un fournisseur externe dans le webhook.
  bot.on(["message:voice", "message:audio"], async (ctx, next) => {
    const from = ctx.from;
    if (from.is_bot) return next();
    const msg = ctx.message;
    const route = await adminRouteFor(identity, deps, from.id, ctx.chat.type);
    if (route.kind === "other") return next();
    if (route.kind === "redirect") {
      if (msg.forward_origin) return next();
      return redirectOnce(ctx, identity, deps, route.target);
    }
    // Ancien dialogue (phase 19) : un vocal transféré n'est pas un ordre.
    if (route.kind === "legacy" && msg.forward_origin) return next();
    const audio = msg.voice ?? msg.audio;
    if (!audio) return next();
    const replyLine = (text: string) =>
      ctx.reply(text, { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
    if (msg.forward_origin) {
      // Boss : un vocal transféré est une donnée, jamais un ordre ; il reçoit quand même une réponse.
      await replyLine(say("forwardedVoice", ctx.chat.id)).catch(() => undefined);
      return;
    }
    if (audio.file_size && audio.file_size > ADMIN_VOICE_MAX_BYTES) {
      await replyLine(bossReplyText("voiceTooLong", ctx.chat.id));
      return;
    }
    // Worker arrêté : réponse tout de suite, le vocal part quand même en file (écouté au redémarrage).
    const down = route.kind === "dialog" && (await workerLooksDown(deps));
    if (down) await replyLine(say("voiceWorkerDown", ctx.chat.id)).catch(() => undefined);
    else if (route.kind === "dialog") await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => undefined);
    try {
      await deps.agentsDeps!().enqueue.orchestrator(
        {
          type: "admin-voice",
          botId: identity.id,
          fileId: audio.file_id,
          messageId: msg.message_id,
          chatId: ctx.chat.id,
          replyToMessageId: msg.reply_to_message?.message_id ?? null,
          mimeType: audio.mime_type ?? "audio/ogg",
        },
        // Idempotent : un webhook rejoué ne transcrit pas deux fois le même vocal.
        { jobId: `admin-voice:${identity.id}:${msg.message_id}` },
      );
    } catch (err) {
      console.error("[agents] vocal de l'admin non mis en file", identity.username, (err as Error).message);
      if (!down) await replyLine(bossReplyText("voiceQueueDown", ctx.chat.id));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const from = ctx.from;
    if (from.is_bot) return next();
    const msg = ctx.message;
    const route = await adminRouteFor(identity, deps, from.id, ctx.chat.type);
    if (route.kind === "other") return next();
    if (route.kind === "redirect") {
      // Bot de canal : commandes, transferts (ajout d'un canal, emojis animés), liens de canal et textes à emojis animés
      // (bibliothèque, phase 12) gardent leur chemin.
      if (msg.text.startsWith("/") || msg.forward_origin || findChannelLinkInText(msg.text) || messageHasCustomEmoji(msg))
        return next();
      return redirectOnce(ctx, identity, deps, route.target);
    }
    if (route.kind === "legacy") return legacyAdminText(ctx, identity, deps, msg, next);
    // Emojis animés (transférés, ou envoyés seuls) : bibliothèque d'emojis AVANT le chemin rapide (voir `wantsEmojiLibrary`).
    if (await wantsEmojiLibrary(identity, deps, msg)) return next();
    // Bot de canal qui fait office de Boss : un transfert de canal ou un lien de canal sert toujours à ajouter le canal.
    if (!isBossBot(identity) && (msg.forward_origin?.type === "channel" || (!msg.forward_origin && findChannelLinkInText(msg.text))))
      return next();
    await handleDialogText(ctx, identity, deps, msg, next);
  });
}

/** Ancien dialogue (phase 19, dépendances sans `adminDialogBot`) : non reconnu → `next()`. */
async function legacyAdminText(
  ctx: Context,
  identity: BotIdentity,
  deps: TelegramDeps,
  msg: Message & { text: string },
  next: () => Promise<void>,
): Promise<void> {
  if (msg.text.startsWith("/") || msg.forward_origin) return next();
  const agents = deps.agentsDeps!();
  const chatId = ctx.chat!.id;
  let r: Awaited<ReturnType<typeof handleAdminText>>;
  try {
    r = await handleAdminText(agents, {
      text: msg.text,
      messageId: msg.message_id,
      replyToMessageId: msg.reply_to_message?.message_id ?? null,
      // Mises en forme (gras, liens, emojis animés) : gardées dans un texte corrigé (« ✏️ Corriger »).
      entities: msg.entities ?? null,
    });
  } catch (err) {
    console.error("[agents] dialogue admin", identity.username, (err as Error).message);
    if (await looksSecret(deps, ctx.from!.id, msg.text, msg.reply_to_message?.message_id))
      await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
    await ctx.reply(say("legacyError", chatId));
    return;
  }
  if (!r.handled) return next();
  if (r.deleteMessage) await ctx.api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
  if (r.reply) await replyHtml(ctx, r.reply);
  if (r.followUp) await r.followUp().catch((err) => console.error("[agents] question suivante", (err as Error).message));
}

/**
 * Dernier filet du dialogue admin (enregistré APRÈS tous les handlers) : un message privé de l'admin au bot du dialogue
 * que personne n'a pris (photo sans mot-clé, autocollant, document…) reçoit quand même une réponse. Sur un bot de
 * canal, l'admin renvoyé vers le Boss l'est ici aussi (une fois), sauf transferts.
 */
export function registerAdminDialogFallback(bot: Bot, identity: BotIdentity, deps: TelegramDeps): void {
  bot.on("message", async (ctx, next) => {
    if (ctx.from.is_bot) return next();
    const route = await adminRouteFor(identity, deps, ctx.from.id, ctx.chat.type);
    if (route.kind === "dialog") {
      await ctx
        .reply(bossReplyText("otherMessage", ctx.chat.id), {
          reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
        })
        .catch(() => undefined);
      return;
    }
    if (route.kind === "redirect" && !ctx.message.forward_origin) return redirectOnce(ctx, identity, deps, route.target);
    return next();
  });
}
