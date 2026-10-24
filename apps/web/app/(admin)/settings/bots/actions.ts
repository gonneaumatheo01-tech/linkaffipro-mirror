"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import {
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
import { requireAdmin, requireUser } from "@/lib/session";
import { applyAssistantHandover, loadAssistantHandover } from "./assistant-handover";

function back(params: Record<string, string>): never {
  redirect(`/settings/bots?${new URLSearchParams(params).toString()}`);
}

/**
 * Ajouter un bot en collant son jeton (ADMIN seulement : les jetons sont sensibles). Phase 26 : rôle « Boss
 * (administration) » → `registerBossFromToken` (même code que « jeton boss » par Telegram ; un seul Boss à la fois).
 */
export async function addBotAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const token = String(formData.get("token") ?? "").trim();
  const role = String(formData.get("role") ?? "CHANNEL");
  if (role === "ADMIN") {
    try {
      const r = await registerBossFromToken(token, { userId: user.id, via: "SITE" });
      revalidatePath("/settings/bots");
      const replaced = r.replaced.length ? ` L'ancien Boss (@${r.replaced.join(", @")}) est désactivé.` : "";
      back({ ok: `${bossRegisteredText(r.username)}${replaced}` });
    } catch (err) {
      if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
      back({
        error:
          err instanceof BossRegisterError || err instanceof Error
            ? err.message
            : "Échec de l'enregistrement du Boss.",
      });
    }
  }
  const vertical = String(formData.get("vertical") ?? "");
  if (!isVertical(vertical))
    back({ error: "Choisissez un univers (casino, paris sportifs ou rencontres)." });
  try {
    const r = await registerBotFromToken(token, vertical, { userId: user.id });
    revalidatePath("/settings/bots");
    back({
      ok: `Bot @${r.username} ${r.created ? "ajouté" : "mis à jour"} : connexion Telegram posée.`,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    back({ error: err instanceof Error ? err.message : "Échec de l'ajout du bot." });
  }
}

/** Reposer la connexion Telegram (webhook) du bot (ADMIN et MANAGER). */
export async function resyncWebhookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const botId = z.string().min(1).parse(formData.get("botId"));
  try {
    const info = await setWebhookForBot(botId);
    await audit({
      userId: user.id,
      action: "bot.webhook_resync",
      entityType: "Bot",
      entityId: botId,
      metadata: { url: info.url },
    });
    revalidatePath("/settings/bots");
    back({ ok: "Connexion Telegram reposée : le bot reçoit à nouveau les messages." });
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    back({
      error:
        err instanceof Error
          ? err.message
          : "Impossible de reposer la connexion Telegram. Réessayez dans un instant.",
    });
  }
}

/** Activer / désactiver un bot (ADMIN). */
export async function toggleBotAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const botId = z.string().min(1).parse(formData.get("botId"));
  const bot = await prisma.bot.findUniqueOrThrow({ where: { id: botId } });
  await prisma.bot.update({ where: { id: botId }, data: { isActive: !bot.isActive } });
  evictBot(botId);
  await audit({
    userId: user.id,
    action: bot.isActive ? "bot.deactivated" : "bot.activated",
    entityType: "Bot",
    entityId: botId,
  });
  revalidatePath("/settings/bots");
  back({
    ok: bot.isActive
      ? `@${bot.username} désactivé : il ne répond plus aux membres.`
      : `@${bot.username} activé.`,
  });
}

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

/**
 * Mode du bot (phase 17, ADMIN) : bot normal, ou assistant de conversation avec sa persona liée. L'instance du bot est
 * recréée (handlers du nouveau mode) et son profil Telegram reposé (description qui dit « assistant(e) », commandes
 * /start, /stop, /reset ; remis à vide pour un bot normal). Un bot normal n'a pas de persona liée.
 * Passage en assistant : refusé pour un bot normal qui administre au moins un canal (`ChannelBotAdmin` non retiré) :
 * l'assistante a toujours un bot à elle, créé exprès dans @BotFather (`assistantModeRefusal`, même règle que le
 * formulaire). Sinon il ne publie plus rien dans les canaux : il cesse d'être bot principal d'un canal qu'il
 * n'administre plus (remplacé par un bot normal administrateur du canal) et ses messages pas encore publiés
 * (brouillons, programmés, annulés, échoués) passent à ce bot ; refusé tant qu'un brouillon ou un message programmé n'a
 * aucun autre bot pour le publier.
 * Profil Telegram jamais bloquant : une erreur est notée dans le journal du serveur, la page n'en montre que la raison
 * en clair (`profileErrorReason`) et la suite qui débloque vraiment (`profileErrorNextStep` : nouveau jeton, correction
 * de la description, ou réessayer si l'échec est passager).
 */
export async function setBotModeAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const parsed = botModeSchema.safeParse({
    botId: formData.get("botId"),
    mode: formData.get("mode"),
    personaId: formData.get("personaId") ?? undefined,
  });
  if (!parsed.success) back({ error: "Choisissez un mode valide pour le bot." });
  const { botId, mode } = parsed.data;
  const personaId = mode === "ASSISTANT" ? parsed.data.personaId : null;
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { id: true, username: true, mode: true, personaId: true, role: true },
  });
  if (!bot) back({ error: "Bot introuvable." });
  // Phase 26 : le Boss ne parle qu'à l'administrateur, jamais en assistant de conversation.
  if (bot.role === "ADMIN" && mode === "ASSISTANT")
    back({ error: "Ce bot est le Boss : il parle seulement avec l'administrateur et ne peut pas devenir assistant de conversation." });
  // Garde-fou : un bot qui gère des canaux n'en deviendrait pas moins absent pour eux (accueil, demandes d'adhésion).
  if (mode === "ASSISTANT" && bot.mode !== "ASSISTANT") {
    const channelCount = await prisma.channelBotAdmin.count({
      where: { botId, revokedAt: null },
    });
    const refusal = assistantModeRefusal(bot.mode, channelCount);
    if (refusal) back({ error: refusal });
  }
  const persona = personaId
    ? await prisma.persona.findUnique({
        where: { id: personaId },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (personaId && !persona) back({ error: "Persona introuvable : choisissez-en une autre." });

  // Un assistant ne publie jamais dans les canaux : ses messages à venir doivent pouvoir passer par un autre bot.
  const handover = mode === "ASSISTANT" ? await loadAssistantHandover(botId) : null;
  if (handover && handover.stuck.length > 0) {
    const titles = [
      ...new Set(handover.stuck.map((s) => s.channelTitle ?? "canal sans nom")),
    ].slice(0, 3);
    const n = handover.stuck.length;
    back({
      error: `@${bot.username} doit encore publier ${n} message${n > 1 ? "s" : ""} dans ${titles.map((t) => `« ${t} »`).join(", ")}, où aucun autre de nos bots n'est administrateur. Ajoutez un autre bot comme administrateur de ce canal, ou supprimez ces messages, puis réessayez.`,
    });
  }

  await prisma.bot.update({ where: { id: botId }, data: { mode, personaId } });
  evictBot(botId);
  const handed = handover
    ? await applyAssistantHandover(botId, handover)
    : { replaced: 0, emptied: 0, posts: 0 };
  await audit({
    userId: user.id,
    action: "assistant.bot_mode_changed",
    entityType: "Bot",
    entityId: botId,
    metadata: {
      from: bot.mode,
      to: mode,
      fromPersonaId: bot.personaId,
      personaId,
      ...(handed.replaced || handed.emptied || handed.posts
        ? {
            primaryReplaced: handed.replaced,
            primaryEmptied: handed.emptied,
            postsMoved: handed.posts,
          }
        : {}),
    },
  });
  revalidatePath("/settings/bots");

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
  const handoverNotes = handoverMessages(handed);
  if (profileProblem)
    back({
      error: [
        `${done} Mais la description du bot n'a pas pu être posée dans Telegram : ${profileProblem}`,
        ...handoverNotes,
      ].join(" "),
    });
  const notes: string[] = [...handoverNotes];
  if (mode === "ASSISTANT" && !persona)
    notes.push("Liez une persona : sans elle, l'assistant ne répond à personne.");
  else if (mode === "ASSISTANT" && persona && !persona.isActive)
    notes.push("La persona est désactivée : l'assistant ne répondra qu'une fois activée.");
  notes.push(...profileWarnings);
  back({ ok: [done, ...notes].join(" ") });
}

const canals = (n: number) => `${n} ${n > 1 ? "canaux" : "canal"}`;

/** Ce que le passage en assistant a changé dans les canaux, en phrases simples. */
function handoverMessages(h: { replaced: number; emptied: number; posts: number }): string[] {
  const out: string[] = [];
  if (h.replaced > 0)
    out.push(`Un autre de nos bots le remplace comme bot principal (${canals(h.replaced)}).`);
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
