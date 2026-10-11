/**
 * Qui publie un message de canal qui contient des emojis animés (phase 12, D10), règles pures partagées par le
 * formulaire (navigateur) et les actions d'enregistrement (serveur), testées dans publisher.test.ts.
 *
 * Telegram interdit les emojis animés aux bots dans les canaux : un message de canal qui en contient est publié par le
 * compte Telegram connecté, sans boutons (`Post.publisher = ACCOUNT`). S'il a aussi des boutons, l'équipe choisit :
 * « Garder les emojis animés (sans boutons) » (compte, boutons retirés) ou « Garder les boutons (emojis normaux) » (bot,
 * chaque emoji animé remplacé par son emoji de remplacement). Règle unique : `planPostPublisher` de @linkaffipro/core.
 * Dans un groupe ou un supergroupe (`Channel.type = GROUP`), le bot envoie lui-même les emojis animés (Bot API 9.4),
 * avec ses boutons : rien à choisir, et le compte personnel de l'équipe n'apparaît jamais devant les membres.
 * Un modèle ne se publie jamais : il garde texte et boutons tels quels, le choix se fait quand il devient un message.
 */
import {
  accountPublishProblem,
  hasCustomEmoji,
  planPostPublisher,
  type EmojiButtonsChoice,
  type MtprotoPublishStatus,
} from "@linkaffipro/core";

export type { EmojiButtonsChoice };
export type PostPublisherValue = "BOT" | "ACCOUNT";

/** Page des réglages du compte Telegram connecté (Réglages → Connexions → Telegram). */
export const TELEGRAM_ACCOUNT_SETTINGS_HREF = "/settings/connectors/telegram";

/** Les deux choix proposés quand un message a des emojis animés ET des boutons. */
export const EMOJI_CHOICES: ReadonlyArray<{
  value: EmojiButtonsChoice;
  label: string;
  hint: string;
}> = [
  {
    value: "emojis",
    label: "Garder les emojis animés (sans boutons)",
    hint: "Publié par votre compte Telegram ; les boutons sont retirés.",
  },
  {
    value: "buttons",
    label: "Garder les boutons (emojis normaux)",
    hint: "Publié par le bot ; chaque emoji animé devient son emoji normal.",
  },
];

/** Refus quand le choix manque (serveur) ; même phrase sous le choix dans le formulaire. */
export const EMOJI_CHOICE_REQUIRED =
  "Ce message a des emojis animés et des boutons : Telegram n'accepte pas les deux dans un canal. Choisissez \u00ab\u00a0Garder les emojis animés (sans boutons)\u00a0\u00bb ou \u00ab\u00a0Garder les boutons (emojis normaux)\u00a0\u00bb.";

/** Bandeau du formulaire : le message sera publié par le compte. */
export const ACCOUNT_BANNER =
  "Ce message contient des emojis animés : il sera publié par votre compte Telegram, sans boutons";

/**
 * « Contenu protégé » et message publié par le compte : Telegram réserve la protection d'un message aux bots. Phrase du
 * formulaire (case désactivée), du bandeau et de la fiche du message.
 */
export const ACCOUNT_PROTECT_NOTE =
  "Avec des emojis animés, Telegram ne permet pas de protéger ce message ; vous pouvez protéger tout le canal dans Telegram.";

/** Type d'un canal (`Channel.type`) : CHANNEL (canal) ou GROUP (groupe ou supergroupe). */
export type PostChatType = "CHANNEL" | "GROUP";

/**
 * Le compte Telegram connecté n'est nécessaire que dans un canal : dans un groupe ou un supergroupe, le bot envoie
 * lui-même les emojis animés (Bot API 9.4, propriétaire des bots Premium), sous son nom et avec ses boutons. Type
 * inconnu : canal (le cas habituel, comme avant).
 */
export function needsAccountFor(chatType: string | null | undefined): boolean {
  return chatType !== "GROUP";
}

/** Champ du formulaire → choix (null si absent ou inconnu). */
export function parseEmojiButtonsChoice(raw: unknown): EmojiButtonsChoice | null {
  return raw === "emojis" || raw === "buttons" ? raw : null;
}

function hasButtons(rows: ReadonlyArray<ReadonlyArray<unknown>>): boolean {
  return rows.some((r) => r.length > 0);
}

export type PostVersionPlan<B> =
  | { ok: true; publisher: PostPublisherValue; text: string; buttons: B[][] }
  | { ok: false; error: string };

/**
 * Ce qui est enregistré pour une version d'un message de canal (texte déjà validé) :
 * - modèle : texte et boutons tels quels, publié « par le bot » (il ne part jamais) ;
 * - groupe ou supergroupe (`chatType` GROUP) : le bot, emojis animés et boutons tels quels (aucun choix) ;
 * - sans emoji animé : le bot, comme avant ;
 * - emojis animés sans bouton (ou choix « emojis ») : le compte, boutons retirés ;
 * - choix « boutons » : le bot, emojis animés remplacés par leurs emojis de remplacement ;
 * - emojis animés et boutons sans choix : refus (`EMOJI_CHOICE_REQUIRED`).
 */
export function planPostVersion<B>(input: {
  text: string;
  buttons: B[][];
  choice: EmojiButtonsChoice | null;
  isTemplate: boolean;
  /** Type du canal de cette version (`Channel.type`) ; absent : canal. */
  chatType?: string | null;
}): PostVersionPlan<B> {
  if (input.isTemplate || !needsAccountFor(input.chatType))
    return { ok: true, publisher: "BOT", text: input.text, buttons: input.buttons };
  const plan = planPostPublisher({
    text: input.text,
    hasButtons: hasButtons(input.buttons),
    choice: input.choice,
  });
  if (plan.needsChoice) return { ok: false, error: EMOJI_CHOICE_REQUIRED };
  return {
    ok: true,
    publisher: plan.publisher,
    text: plan.text,
    buttons: plan.keepButtons ? input.buttons : [],
  };
}

/** Qui publiera une version, vue du formulaire (null : choix à faire). */
export type VersionMode = "bot" | "account" | "fallback" | "choice" | "group";

/**
 * Mode d'une version dans le formulaire : « bot » (aucun emoji animé), « account » (publié par le compte, sans
 * boutons), « fallback » (choix « boutons » : emojis normaux, publié par le bot) ou « choice » (choix à faire) ; pour
 * une version qui ne part que dans des groupes, « group » (le bot publie lui-même les emojis animés), voir
 * `postEmojiState`.
 */
export function versionMode(input: {
  text: string;
  buttons: ReadonlyArray<ReadonlyArray<unknown>>;
  choice: EmojiButtonsChoice | null;
}): VersionMode {
  if (!hasCustomEmoji(input.text)) return "bot";
  if (!hasButtons(input.buttons)) return "account";
  if (input.choice === "emojis") return "account";
  if (input.choice === "buttons") return "fallback";
  return "choice";
}

export type PostEmojiState = {
  /** Au moins une version contient un emoji animé. */
  hasEmoji: boolean;
  /** Le choix « emojis » / « boutons » est demandé (et pas encore fait). */
  choiceMissing: boolean;
  /** Le choix est proposé (une version a des emojis animés ET des boutons, et part dans un canal). */
  choiceOffered: boolean;
  /** Mode de la version dans les canaux (« group » si elle ne part que dans des groupes). */
  modeA: VersionMode;
  modeB: VersionMode | null;
  /** Au moins une version sera publiée par le compte Telegram connecté. */
  account: boolean;
  /** Une version avec emojis animés part dans un groupe : le bot les publie lui-même, avec ses boutons. */
  groupEmoji: boolean;
  /** Les boutons de la version ne seront publiés nulle part (publiée par le compte dans tous ses canaux). */
  buttonsOffA: boolean;
  buttonsOffB: boolean;
  /**
   * « Contenu protégé » : « ok » (tous les messages partent par le bot), « partial » (une partie part par le compte,
   * non protégeable) ou « none » (tous partent par le compte : la case est sans effet).
   */
  protect: "ok" | "partial" | "none";
};

/** Où part une version : au moins un canal (`channel`) et/ou au moins un groupe ou supergroupe (`group`). */
export type VersionTargets = { channel: boolean; group: boolean };
const CHANNEL_ONLY: VersionTargets = { channel: true, group: false };

/**
 * Où part une version d'après les types des canaux cochés (`Channel.type`). Aucun canal coché, ou type inconnu :
 * un canal (le cas habituel).
 */
export function targetsOf(chatTypes: ReadonlyArray<string | null | undefined>): VersionTargets {
  if (chatTypes.length === 0) return CHANNEL_ONLY;
  return {
    channel: chatTypes.some((t) => needsAccountFor(t)),
    group: chatTypes.some((t) => !needsAccountFor(t)),
  };
}

/**
 * État « emojis animés » du formulaire d'un message de canal (versions A et B). Rien pour un modèle. `targetsA` /
 * `targetsB` : canaux et groupes où part chaque version (défaut : un canal).
 */
export function postEmojiState(input: {
  textA: string;
  buttonsA: ReadonlyArray<ReadonlyArray<unknown>>;
  textB?: string;
  buttonsB?: ReadonlyArray<ReadonlyArray<unknown>>;
  abActive: boolean;
  choice: EmojiButtonsChoice | null;
  isTemplate: boolean;
  targetsA?: VersionTargets;
  targetsB?: VersionTargets;
}): PostEmojiState {
  const emojiA = hasCustomEmoji(input.textA);
  const emojiB = input.abActive && hasCustomEmoji(input.textB ?? "");
  const hasEmoji = emojiA || emojiB;
  if (input.isTemplate)
    return {
      hasEmoji,
      choiceMissing: false,
      choiceOffered: false,
      modeA: "bot",
      modeB: null,
      account: false,
      groupEmoji: false,
      buttonsOffA: false,
      buttonsOffB: false,
      protect: "ok",
    };
  const tA = input.targetsA ?? CHANNEL_ONLY;
  const tB = input.targetsB ?? CHANNEL_ONLY;
  const mode = (text: string, buttons: ReadonlyArray<ReadonlyArray<unknown>>, t: VersionTargets) =>
    t.channel
      ? versionMode({ text, buttons, choice: input.choice })
      : hasCustomEmoji(text)
        ? ("group" as const)
        : ("bot" as const);
  const modeA = mode(input.textA, input.buttonsA, tA);
  const modeB = input.abActive ? mode(input.textB ?? "", input.buttonsB ?? [], tB) : null;
  const offeredA = tA.channel && emojiA && hasButtons(input.buttonsA);
  const offeredB = tB.channel && emojiB && hasButtons(input.buttonsB ?? []);
  const account = modeA === "account" || modeB === "account";
  // Messages partis par le bot (protégeables) : version hors compte, ou sa part dans des groupes.
  const botA = modeA !== "account" || tA.group;
  const botB = modeB !== null && (modeB !== "account" || tB.group);
  return {
    hasEmoji,
    choiceMissing: modeA === "choice" || modeB === "choice",
    choiceOffered: offeredA || offeredB,
    modeA,
    modeB,
    account,
    groupEmoji: (emojiA && tA.group) || (emojiB && tB.group),
    buttonsOffA: modeA === "account" && !tA.group,
    buttonsOffB: modeB === "account" && !tB.group,
    protect: !account ? "ok" : botA || botB ? "partial" : "none",
  };
}

export type AccountProblems = {
  /** Problème du compte lui-même (non connecté, session expirée, pas Premium), commun à tous les canaux. */
  global: string | null;
  /** Problème propre à un canal (droits du compte pas vérifiés, pas administrateur…). */
  channels: Array<{ channelId: string; title: string; problem: string }>;
};

/** Ce qui empêche le compte connecté de publier dans ces canaux (`accountPublishProblem` de @linkaffipro/core). */
export function accountProblemsFor(
  status: MtprotoPublishStatus | null | undefined,
  channels: ReadonlyArray<{ id: string; title: string }>,
): AccountProblems {
  const accountWide =
    !status || !status.connected || !!status.error || status.premium === false
      ? accountPublishProblem(status, "")
      : null;
  if (accountWide) return { global: accountWide, channels: [] };
  const out: AccountProblems["channels"] = [];
  for (const c of channels) {
    const problem = accountPublishProblem(status, c.id);
    if (problem) out.push({ channelId: c.id, title: c.title, problem });
  }
  return { global: null, channels: out };
}

/** Le compte peut-il publier partout ? */
export function hasAccountProblem(p: AccountProblems): boolean {
  return p.global !== null || p.channels.length > 0;
}

/** Un canal dont les droits du compte n'ont jamais été relevés (vérification à demander). */
export function channelsToCheck(
  status: MtprotoPublishStatus | null | undefined,
  channelIds: readonly string[],
): string[] {
  if (status && (!status.connected || status.error || status.premium === false)) return [];
  return channelIds.filter((id) => !status?.channels[id]);
}

/**
 * Phrase du serveur quand la programmation est refusée (le message est gardé en brouillon) : la première cause, en
 * français, avec le chemin des réglages du compte.
 */
export function scheduleRefusal(p: AccountProblems, count = 1): string | null {
  const settings = "Réglages → Connexions → Telegram";
  const end = (s: string) => (s.includes(settings) ? s : `${s.replace(/\.$/, "")} (${settings}).`);
  const head =
    count > 1
      ? `${count} brouillons enregistrés, pas programmés : ces messages seront publiés par votre compte Telegram`
      : "Enregistré en brouillon, pas programmé : ce message sera publié par votre compte Telegram";
  if (p.global) return `${head}. ${end(p.global)}`;
  const c = p.channels[0];
  if (!c) return null;
  return `${head}, qui ne peut pas encore publier dans « ${c.title} ». ${end(c.problem)}`;
}

/** Lit l'état enregistré par le worker (`Setting` `mtproto.publishStatus`) ; null s'il est absent ou mal formé. */
export function parsePublishStatus(value: unknown): MtprotoPublishStatus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<MtprotoPublishStatus>;
  if (typeof v.checkedAt !== "string" || typeof v.connected !== "boolean") return null;
  const channels: MtprotoPublishStatus["channels"] = {};
  if (v.channels && typeof v.channels === "object")
    for (const [id, c] of Object.entries(v.channels)) {
      if (!c || typeof c !== "object" || typeof c.canPost !== "boolean") continue;
      channels[id] = {
        canPost: c.canPost,
        checkedAt: typeof c.checkedAt === "string" ? c.checkedAt : v.checkedAt,
        error: typeof c.error === "string" ? c.error : null,
      };
    }
  return {
    checkedAt: v.checkedAt,
    connected: v.connected,
    premium: typeof v.premium === "boolean" ? v.premium : null,
    user:
      v.user && typeof v.user === "object" && typeof v.user.id === "string"
        ? {
            id: v.user.id,
            firstName: typeof v.user.firstName === "string" ? v.user.firstName : "",
            username: typeof v.user.username === "string" ? v.user.username : null,
          }
        : null,
    error: typeof v.error === "string" && v.error ? v.error : null,
    channels,
  };
}

/**
 * Le relevé est-il plus récent que la demande de vérification (la réponse du service d'arrière-plan est arrivée) ? Le
 * worker réécrit tout l'état à chaque relevé (`checkedAt` global), canaux compris.
 */
export function statusAnswered(
  status: MtprotoPublishStatus | null | undefined,
  requestedAt: string,
): boolean {
  if (!status) return false;
  const since = Date.parse(requestedAt);
  const at = Date.parse(status.checkedAt);
  return Number.isFinite(since) && Number.isFinite(at) && at >= since - 1000;
}
