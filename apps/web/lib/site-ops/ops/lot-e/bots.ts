/**
 * Phase 34, lot E — cœurs de Réglages → Bots (ajout par jeton, connexion Telegram, activation, mode). Appelés par
 * `app/(admin)/settings/bots/actions.ts` et par Kevin. Jetons et réglages = ADMIN ; reposer la connexion Telegram
 * (webhook) = ADMIN et MANAGER, comme sur le site. Le jeton n'est jamais dans un message, un aperçu ni le journal.
 */
import { z } from "zod";
import { isVertical, VERTICAL_LABELS } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import {
  BOT_TOKEN_PATTERN,
  BossRegisterError,
  bossRegisteredText,
  evictBot,
  registerBossFromToken,
  registerBotFromToken,
  setAssistantProfile,
  setWebhookForBot,
} from "@linkaffipro/telegram";
import { assistantModeRefusal } from "@/components/settings/bot-mode-logic";
import { profileErrorNextStep, profileErrorReason } from "@/lib/personas/profile-error";
import { applyAssistantHandover, loadAssistantHandover } from "@/app/(admin)/settings/bots/assistant-handover";
import { adminOnly, fail, isNextRedirect, ok, optBool, preview, resolveNamed, str, viaMeta, type CoreRun, type Fail } from "./common";

/** Bot désigné par son identifiant (site) ou par son @ / son nom (Kevin). */
async function findBotId(input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const id = str(input.botId).trim();
  if (id) return { ok: true, id };
  const raw = str(input.bot).trim().replace(/^@/, "");
  if (!raw) return { ok: false, result: fail("Quel bot ? Donnez son @.", "invalid", "botId") };
  const rows = await prisma.bot.findMany({ select: { id: true, username: true, name: true } });
  const exact = rows.find((r) => r.username.toLowerCase() === raw.toLowerCase());
  if (exact) return { ok: true, id: exact.id };
  const ref = await resolveNamed({ plural: "bots", one: "le bot" }, raw, rows.map((r) => ({ id: r.id, name: `@${r.username}`, extra: [r.username, r.name] })));
  return ref.ok ? { ok: true, id: ref.id } : ref;
}

/**
 * Ajouter un bot par son jeton (ADMIN : les jetons sont sensibles). Rôle « Boss (administration) » →
 * `registerBossFromToken` (un seul Boss à la fois) ; sinon bot de canal d'un univers.
 */
export const botAdd: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const token = str(input.token).trim();
  const role = str(input.role || "CHANNEL");
  // Formulaire du site : CASINO / SPORTS / DATING ; Kevin peut écrire la valeur en minuscules.
  const vertical = str(input.vertical).trim().toUpperCase();
  if (opts.dryRun) {
    if (!BOT_TOKEN_PATTERN.test(token)) return fail("Format de jeton invalide", "invalid", "token");
    if (role === "ADMIN") return preview({ summary: "J'enregistre ce bot comme Boss (dialogue avec l'administrateur) ; l'ancien Boss sera désactivé." });
    if (!isVertical(vertical)) return fail("Choisissez un univers (casino, paris sportifs ou rencontres).", "invalid", "vertical");
    return preview({ summary: `J'ajoute le bot (univers ${VERTICAL_LABELS[vertical]}) et je pose sa connexion Telegram.` });
  }
  if (role === "ADMIN") {
    try {
      const r = await registerBossFromToken(token, { userId: actor.userId, via: actor.via === "TELEGRAM" ? "TELEGRAM" : "SITE" });
      const replaced = r.replaced.length ? ` L'ancien Boss (@${r.replaced.join(", @")}) est désactivé.` : "";
      return ok(`${bossRegisteredText(r.username)}${replaced}`, { botId: r.botId, username: r.username });
    } catch (err) {
      if (isNextRedirect(err)) throw err;
      return fail(err instanceof BossRegisterError || err instanceof Error ? err.message : "Échec de l'enregistrement du Boss.");
    }
  }
  if (!isVertical(vertical)) return fail("Choisissez un univers (casino, paris sportifs ou rencontres).", "invalid", "vertical");
  try {
    const r = await registerBotFromToken(token, vertical, { userId: actor.userId });
    return ok(`Bot @${r.username} ${r.created ? "ajouté" : "mis à jour"} : connexion Telegram posée.`, { botId: r.botId, username: r.username });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return fail(err instanceof Error ? err.message : "Échec de l'ajout du bot.");
  }
};

/** Reposer la connexion Telegram (webhook) du bot (ADMIN et MANAGER). */
export const botResyncWebhook: CoreRun = async (input, actor, opts = {}) => {
  const found = await findBotId(input);
  if (!found.ok) return found.result;
  const botId = found.id;
  if (opts.dryRun) {
    const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { username: true } });
    if (!bot) return fail("Bot introuvable.", "not_found");
    return preview({ summary: `Je repose la connexion Telegram de @${bot.username}.` });
  }
  try {
    const info = await setWebhookForBot(botId);
    await audit({
      userId: actor.userId,
      action: "bot.webhook_resync",
      entityType: "Bot",
      entityId: botId,
      metadata: { url: info.url, ...viaMeta(actor) },
    });
    return ok("Connexion Telegram reposée : le bot reçoit à nouveau les messages.", { botId });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return fail(err instanceof Error ? err.message : "Impossible de reposer la connexion Telegram. Réessayez dans un instant.", "unavailable");
  }
};

/** Activer / désactiver un bot (le site bascule ; Kevin peut dire l'état voulu). */
export const botToggle: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const found = await findBotId(input);
  if (!found.ok) return found.result;
  const botId = found.id;
  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) return fail("Bot introuvable.", "not_found");
  const wanted = optBool(input.active);
  if (wanted !== undefined && wanted === bot.isActive)
    return ok(`@${bot.username} est déjà ${bot.isActive ? "actif" : "désactivé"}.`, { botId, unchanged: true });
  if (opts.dryRun)
    return preview({
      summary: bot.isActive ? `Désactivation de @${bot.username}.` : `Activation de @${bot.username}.`,
      impact: bot.isActive ? "Il ne répondra plus aux membres (accueil, demandes d'adhésion, boutons)." : null,
    });
  await prisma.bot.update({ where: { id: botId }, data: { isActive: !bot.isActive } });
  evictBot(botId);
  await audit({
    userId: actor.userId,
    action: bot.isActive ? "bot.deactivated" : "bot.activated",
    entityType: "Bot",
    entityId: botId,
    metadata: viaMeta(actor),
  });
  return ok(bot.isActive ? `@${bot.username} désactivé : il ne répond plus aux membres.` : `@${bot.username} activé.`, { botId });
};

const botModeSchema = z.object({
  botId: z.string().min(1),
  mode: z.enum(["STANDARD", "ASSISTANT"]),
  personaId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => v || null),
});

const canals = (n: number) => `${n} ${n > 1 ? "canaux" : "canal"}`;

/** Ce que le passage en assistant a changé dans les canaux, en phrases simples. */
function handoverMessages(h: { replaced: number; emptied: number; posts: number }): string[] {
  const out: string[] = [];
  if (h.replaced > 0) out.push(`Un autre de nos bots le remplace comme bot principal (${canals(h.replaced)}).`);
  if (h.emptied > 0)
    out.push(
      `${h.emptied > 1 ? `${canals(h.emptied)} n'ont` : "1 canal n'a"} plus de bot principal : ajoutez un autre de nos bots comme administrateur pour y publier.`,
    );
  if (h.posts > 0)
    out.push(
      h.posts > 1
        ? `${h.posts} messages de canal pas encore publiés passent à un autre de nos bots.`
        : "1 message de canal pas encore publié passe à un autre de nos bots.",
    );
  return out;
}

/**
 * Mode du bot (phase 17, ADMIN) : bot normal, ou assistant de conversation avec sa persona liée (voir l'action du site
 * pour toutes les règles : refus pour un bot qui administre un canal, passation des messages à publier, profil Telegram
 * jamais bloquant). Kevin peut désigner le bot par son @ et la persona par son nom.
 */
export const botSetMode: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  // Site : identifiant tel quel (vide = refus du schéma, même texte) ; Kevin : @ ou nom du bot.
  const foundBot = input.botId || !input.bot ? { ok: true as const, id: str(input.botId) } : await findBotId(input);
  if (!foundBot.ok) return foundBot.result;
  let personaRaw = input.personaId ?? undefined;
  if (!personaRaw && input.persona) {
    const rows = await prisma.persona.findMany({ select: { id: true, name: true } });
    const ref = await resolveNamed({ plural: "personas", one: "la persona" }, str(input.persona), rows);
    if (!ref.ok) return ref.result;
    personaRaw = ref.id;
  }
  const parsed = botModeSchema.safeParse({ botId: foundBot.id, mode: input.mode, personaId: personaRaw });
  if (!parsed.success) return fail("Choisissez un mode valide pour le bot.", "invalid", "mode");
  const { botId, mode } = parsed.data;
  const personaId = mode === "ASSISTANT" ? parsed.data.personaId : null;
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { id: true, username: true, mode: true, personaId: true, role: true },
  });
  if (!bot) return fail("Bot introuvable.", "not_found");
  // Phase 26 : le Boss ne parle qu'à l'administrateur, jamais en assistant de conversation.
  if (bot.role === "ADMIN" && mode === "ASSISTANT")
    return fail("Ce bot est le Boss : il parle seulement avec l'administrateur et ne peut pas devenir assistant de conversation.", "conflict");
  // Garde-fou : un bot qui gère des canaux n'en deviendrait pas moins absent pour eux (accueil, demandes d'adhésion).
  if (mode === "ASSISTANT" && bot.mode !== "ASSISTANT") {
    const channelCount = await prisma.channelBotAdmin.count({ where: { botId, revokedAt: null } });
    const refusal = assistantModeRefusal(bot.mode, channelCount);
    if (refusal) return fail(refusal, "conflict");
  }
  const persona = personaId
    ? await prisma.persona.findUnique({ where: { id: personaId }, select: { id: true, name: true, isActive: true } })
    : null;
  if (personaId && !persona) return fail("Persona introuvable : choisissez-en une autre.", "not_found", "personaId");

  // Un assistant ne publie jamais dans les canaux : ses messages à venir doivent pouvoir passer par un autre bot.
  const handover = mode === "ASSISTANT" ? await loadAssistantHandover(botId) : null;
  if (handover && handover.stuck.length > 0) {
    const titles = [...new Set(handover.stuck.map((s) => s.channelTitle ?? "canal sans nom"))].slice(0, 3);
    const n = handover.stuck.length;
    return fail(
      `@${bot.username} doit encore publier ${n} message${n > 1 ? "s" : ""} dans ${titles.map((t) => `« ${t} »`).join(", ")}, où aucun autre de nos bots n'est administrateur. Ajoutez un autre bot comme administrateur de ce canal, ou supprimez ces messages, puis réessayez.`,
      "conflict",
    );
  }
  if (opts.dryRun)
    return preview({
      summary:
        mode === "ASSISTANT"
          ? `@${bot.username} devient assistant de conversation${persona ? ` (persona ${persona.name})` : ""}.`
          : `@${bot.username} redevient un bot normal.`,
      impact:
        handover && (handover.primaries.length || handover.posts.length)
          ? `Ses messages de canal pas encore publiés et son rôle de bot principal passent à un autre de nos bots.`
          : null,
    });

  await prisma.bot.update({ where: { id: botId }, data: { mode, personaId } });
  evictBot(botId);
  const handed = handover ? await applyAssistantHandover(botId, handover) : { replaced: 0, emptied: 0, posts: 0 };
  await audit({
    userId: actor.userId,
    action: "assistant.bot_mode_changed",
    entityType: "Bot",
    entityId: botId,
    metadata: {
      from: bot.mode,
      to: mode,
      fromPersonaId: bot.personaId,
      personaId,
      ...(handed.replaced || handed.emptied || handed.posts
        ? { primaryReplaced: handed.replaced, primaryEmptied: handed.emptied, postsMoved: handed.posts }
        : {}),
      ...viaMeta(actor),
    },
  });

  // Profil Telegram : jamais bloquant pour l'enregistrement du mode (Telegram peut être injoignable un instant).
  let profileProblem: string | null = null;
  let profileWarnings: string[] = [];
  try {
    const report = await setAssistantProfile(botId);
    if (report.mode === "ASSISTANT" && report.applied) profileWarnings = report.warnings;
  } catch (err) {
    // Texte brut de Telegram ou de la bibliothèque : jamais affiché, seulement dans le journal du serveur.
    console.error(`[bots] profil Telegram de @${bot.username} non posé :`, err);
    profileProblem = `${profileErrorReason(err)}. ${profileErrorNextStep(err, "Réessayez dans un instant.")}`;
  }

  const done =
    mode === "ASSISTANT"
      ? `@${bot.username} est maintenant un assistant de conversation${persona ? ` (persona ${persona.name})` : ""}.`
      : `@${bot.username} est maintenant un bot normal.`;
  const notes = handoverMessages(handed);
  // Le mode est enregistré : l'échec du profil Telegram est rendu comme une erreur (la page l'affiche en rouge).
  if (profileProblem)
    return fail([`${done} Mais la description du bot n'a pas pu être posée dans Telegram : ${profileProblem}`, ...notes].join(" "), "unavailable");
  if (mode === "ASSISTANT" && !persona) notes.push("Liez une persona : sans elle, l'assistant ne répond à personne.");
  else if (mode === "ASSISTANT" && persona && !persona.isActive)
    notes.push("La persona est désactivée : l'assistant ne répondra qu'une fois activée.");
  notes.push(...profileWarnings);
  return ok([done, ...notes].join(" "), { botId, mode, personaId });
};
