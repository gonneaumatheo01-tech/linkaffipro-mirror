/**
 * Phase 34, lot B — cœurs de la page Canaux : réglages d'un canal (univers, langue, bot principal, test, médiathèque,
 * actif), ajout par lien public, import depuis le compte connecté, re-vérification des droits des bots. Appelés par
 * `app/(admin)/channels/actions.ts`, `app/(admin)/channels/[id]/actions.ts` et par Kevin.
 */
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import {
  importChannelByChatId,
  importChannelByUsername,
  importedChannelMessage,
  listActiveBots,
  mapWithLimit,
  parseChannelLink,
  recheckAllChannelRights,
  recheckChannelRights,
} from "@linkaffipro/telegram";
import { importOutcomeOf, importSummary, rightsMessage, rightsSummary } from "@/lib/channels/rights-message";
import {
  bool,
  errorText,
  fail,
  isNextRedirect,
  ok,
  preview,
  resolveChannelRef,
  str,
  viaMeta,
  type CoreRun,
  type SiteOpActor,
  type SiteOpResult,
} from "./common";

const schema = z.object({
  channelId: z.string().min(1),
  vertical: z.enum(["", "CASINO", "SPORTS", "DATING"]),
  language: z.string().trim().min(2).max(5).toLowerCase(),
  primaryBotId: z.string(),
  isTest: z.boolean(),
  isMediaLibrary: z.boolean(),
  isActive: z.boolean(),
});

export const CHANNEL_SETTINGS_ERROR =
  "Vérifiez les réglages du canal : la langue doit être un code de 2 à 5 lettres (fr, en, pt-br…).";
/** Refus affiché quand le bot principal choisi est un assistant de conversation (phase 17). */
export const PRIMARY_BOT_ASSISTANT_ERROR =
  "Ce bot est un assistant de conversation : il ne peut pas être le bot principal d'un canal. Choisissez un autre bot.";

/** Univers donné en clair par Kevin (« paris sportifs », « rencontres », « aucun ») ou par sa clé. */
export function verticalKey(raw: unknown): string {
  const s = str(raw).trim();
  const n = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (["", "casino", "sports", "dating"].includes(n)) return n.toUpperCase();
  if (/sport|pari|foot/.test(n)) return "SPORTS";
  if (/casino/.test(n)) return "CASINO";
  if (/dating|rencontre/.test(n)) return "DATING";
  if (/aucun|sans|rien|none/.test(n)) return "";
  return s;
}

const VERTICAL_LABEL: Record<string, string> = { CASINO: "casino", SPORTS: "paris sportifs", DATING: "rencontres", "": "sans univers" };

/** Bot principal par identifiant (site) ou par son @nom (Kevin) ; "" = aucun. */
async function primaryBotIdOf(input: Record<string, unknown>, current: string | null): Promise<string> {
  if (input.primaryBotId !== undefined && input.primaryBotId !== null) return str(input.primaryBotId);
  const raw = str(input.primaryBot).trim().replace(/^@/, "");
  if (!raw) return current ?? "";
  const bot = await prisma.bot.findFirst({ where: { username: { equals: raw, mode: "insensitive" } }, select: { id: true } });
  return bot?.id ?? raw;
}

/**
 * Réglages d'un canal (volet de la liste ou de la fiche). Le site envoie tous les champs ; Kevin peut n'en donner
 * qu'une partie (« mets Zone Interdite en paris sportifs ») : les autres valeurs actuelles sont gardées.
 */
const FIELD_KEYS = ["vertical", "language", "primaryBotId", "isTest", "isMediaLibrary", "isActive"] as const;

export const channelUpdate: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (ref && !ref.ok) return ref.result;
  const channelId = ref?.id ?? "";
  // Le site envoie tous les champs : le canal n'est relu que pour compléter une phrase de Kevin (ou l'essai à blanc).
  const partial = FIELD_KEYS.some((k) => input[k] === undefined && !(k === "primaryBotId" && input.primaryBot !== undefined));
  const current = channelId && (partial || opts.dryRun)
    ? await prisma.channel.findUnique({
        where: { id: channelId },
        select: { title: true, vertical: true, language: true, primaryBotId: true, isTest: true, isMediaLibrary: true, isActive: true },
      })
    : null;
  const keep = <T>(key: string, fallback: T) => (input[key] === undefined ? fallback : input[key]);
  const parsed = schema.safeParse({
    channelId,
    vertical: verticalKey(keep("vertical", current?.vertical ?? "")),
    language: keep("language", current?.language ?? "fr") ?? "fr",
    primaryBotId: await primaryBotIdOf(input, current?.primaryBotId ?? null),
    isTest: input.isTest === undefined ? (current?.isTest ?? false) : bool(input.isTest),
    isMediaLibrary: input.isMediaLibrary === undefined ? (current?.isMediaLibrary ?? false) : bool(input.isMediaLibrary),
    isActive: input.isActive === undefined ? (current?.isActive ?? false) : bool(input.isActive),
  });
  if (!parsed.success) return fail(CHANNEL_SETTINGS_ERROR);
  const d = parsed.data;
  // Bot principal : jamais un assistant de conversation (phase 17) ni le Boss (phase 26).
  if (d.primaryBotId !== "") {
    const bot = await prisma.bot.findUnique({ where: { id: d.primaryBotId }, select: { mode: true, role: true } });
    if (!bot) return fail("Ce bot est introuvable : choisissez-en un autre.", "not_found", "primaryBotId");
    if (bot.role === "ADMIN")
      return fail("Ce bot sert seulement à parler avec l'administrateur : choisissez un bot de canal.", "invalid", "primaryBotId");
    if (bot.mode !== "STANDARD") return fail(PRIMARY_BOT_ASSISTANT_ERROR, "invalid", "primaryBotId");
  }
  if (!current && (partial || opts.dryRun)) return fail("Ce canal n'existe plus : revenez à la liste des canaux.", "not_found");
  if (opts.dryRun && current)
    return preview({
      summary: `Canal « ${current.title} » : ${VERTICAL_LABEL[d.vertical] ?? d.vertical}, langue ${d.language}${d.isTest ? ", canal de test" : ""}${d.isMediaLibrary ? ", médiathèque" : ""}${d.isActive ? "" : ", désactivé"}.`,
    });
  await prisma.channel.update({
    where: { id: d.channelId },
    data: {
      vertical: d.vertical === "" ? null : d.vertical,
      language: d.language,
      primaryBotId: d.primaryBotId === "" ? null : d.primaryBotId,
      isTest: d.isTest,
      isMediaLibrary: d.isMediaLibrary,
      isActive: d.isActive,
    },
  });
  await audit({
    userId: actor.userId,
    action: "channel.updated",
    entityType: "Channel",
    entityId: d.channelId,
    metadata: {
      vertical: d.vertical,
      language: d.language,
      primaryBotId: d.primaryBotId,
      isTest: d.isTest,
      isMediaLibrary: d.isMediaLibrary,
      isActive: d.isActive,
      ...viaMeta(actor),
    },
  });
  return ok("Réglages du canal enregistrés.", { channelId: d.channelId });
};

const SETTING_KEYS = ["vertical", "language", "primaryBotId", "primaryBot", "isTest", "isMediaLibrary", "isActive"] as const;

/**
 * Ajout d'un canal par son lien public (`t.me/<nom>`, `t.me/s/<nom>`, `@nom` ou `nom`). Kevin peut donner les réglages
 * dans la même phrase (« ajoute t.me/xxx et mets-le en paris sportifs ») : appliqués juste après l'ajout, par le même
 * cœur que le volet des réglages.
 */
export const channelAdd: CoreRun = async (input, actor, opts = {}) => {
  const link = str(input.link).trim();
  if (!link) return fail("Collez le lien public du canal (t.me/mon_canal) ou son @nom.", "invalid", "link");
  const settings = Object.fromEntries(SETTING_KEYS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  if (opts.dryRun) {
    const parsed = parseChannelLink(link);
    if (parsed.kind !== "username")
      return fail(
        parsed.kind === "invalid"
          ? "Nom de canal invalide. Collez un lien comme t.me/mon_canal ou @mon_canal (lettres, chiffres et _ ; 4 caractères au moins)."
          : "Ce lien est privé : il ne permet pas de retrouver le canal. Transférez au bot un message du canal.",
        "invalid",
        "link",
      );
    const vertical = settings.vertical !== undefined ? verticalKey(settings.vertical) : null;
    return preview({
      summary: `Ajout du canal @${parsed.username}${vertical !== null ? `, univers ${VERTICAL_LABEL[vertical] ?? vertical}` : ""}${bool(settings.isTest) ? ", canal de test" : ""}.`,
    });
  }
  let channelId: string;
  let message: string;
  try {
    const r = await importChannelByUsername(link, { userId: actor.userId, metadata: viaMeta(actor) });
    channelId = r.channelId;
    message = importedChannelMessage(r);
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return fail(errorText(err, "Ajout impossible."), "invalid", "link");
  }
  if (Object.keys(settings).length === 0) return ok(message, { channelId });
  const s = await channelUpdate({ ...settings, channelId }, actor, {});
  return s.ok ? ok(`${message} ${s.message}`, { channelId }) : { ok: true, message: `${message} Réglages non appliqués : ${s.error}`, data: { channelId, settingsError: s.error } };
};

/** Re-vérifie les droits de nos bots sur un canal (bouton de la fiche). Audit `channel.rights_rechecked`. */
export const channelRecheckRights: CoreRun = async (input, actor, opts = {}) => {
  const ref = await resolveChannelRef(input);
  if (!ref) return fail("Quel canal faut-il vérifier ?", "invalid", "channel");
  if (!ref.ok) return ref.result;
  if (opts.dryRun) return preview({ summary: `Re-vérification des droits de nos bots sur « ${ref.name} ».` });
  try {
    return ok(rightsMessage(await recheckChannelRights(ref.id, { userId: actor.userId })), { channelId: ref.id });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return fail(`Vérification impossible : ${err instanceof Error ? err.message : "erreur inconnue"}`, "unavailable");
  }
};

/** Re-vérifie les droits de nos bots sur tous les canaux actifs (page Canaux). */
export const channelsRecheckAll: CoreRun = async (_input, actor, opts = {}) => {
  if (opts.dryRun) {
    const n = await prisma.channel.count({ where: { isActive: true } });
    return preview({ summary: `Re-vérification des droits de nos bots sur ${n} canal${n > 1 ? "aux" : ""} actif${n > 1 ? "s" : ""}.` });
  }
  try {
    return ok(rightsSummary(await recheckAllChannelRights({ userId: actor.userId })));
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return fail(`Vérification impossible : ${err instanceof Error ? err.message : "erreur inconnue"}`, "unavailable");
  }
};

const accountRowSchema = z.object({
  telegramChatId: z.string().regex(/^-?\d{5,20}$/),
  title: z.string().trim().min(1).max(255),
  username: z.string().trim().max(64).nullable(),
  isBroadcast: z.boolean(),
});

export type AccountChannelRow = { telegramChatId: unknown; title: unknown; username: unknown; isBroadcast: unknown };

/**
 * « Importer tous mes canaux » : canaux cochés → création + droits, un audit par canal, 5 canaux à la fois. Retour
 * résumé (« 12 canaux importés, 3 sans bot ») : `ok` et `error` (dans `data.error` quand une partie a échoué).
 */
export const channelsImportFromAccount: CoreRun = async (input, actor, opts = {}) => {
  const rows = (Array.isArray(input.channels) ? input.channels : []) as AccountChannelRow[];
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const id = str(r?.telegramChatId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (unique.length === 0) return fail("Cochez au moins un canal à importer.", "invalid", "channels");
  if (opts.dryRun)
    return preview({ summary: `Import de ${unique.length} canal${unique.length > 1 ? "aux" : ""} : ${unique.map((r) => str(r.title) || str(r.telegramChatId)).slice(0, 10).join(", ")}.` });
  const bots = await listActiveBots();
  const outcomes = await mapWithLimit(unique, 5, async (row) => {
    const id = str(row.telegramChatId);
    const parsed = accountRowSchema.safeParse({
      telegramChatId: id,
      title: row.title ?? "",
      username: (row.username as string | null) || null,
      isBroadcast: row.isBroadcast !== false,
    });
    if (!parsed.success) return { title: `canal ${id}`, error: "informations incomplètes" };
    try {
      const r = await importChannelByChatId(
        { ...parsed.data, telegramChatId: BigInt(parsed.data.telegramChatId) },
        { userId: actor.userId, bots },
      );
      return importOutcomeOf(r);
    } catch (err) {
      if (isNextRedirect(err)) throw err;
      return { title: parsed.data.title, error: err instanceof Error ? err.message : "erreur inconnue" };
    }
  });
  const summary = importSummary(outcomes);
  return summaryResult(summary);
};

function summaryResult(s: { ok?: string; error?: string }): SiteOpResult {
  if (!s.ok && s.error) return { ok: false, code: "unavailable", error: s.error };
  return { ok: true, message: s.ok ?? "", data: s.error ? { error: s.error } : {} };
}

export type { SiteOpActor };
