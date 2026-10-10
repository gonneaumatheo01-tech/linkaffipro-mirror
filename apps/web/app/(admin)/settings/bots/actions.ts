"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { evictBot, registerBotFromToken, setWebhookForBot } from "@linkaffipro/telegram";
import { requireAdmin, requireUser } from "@/lib/session";

function back(params: Record<string, string>): never {
  redirect(`/settings/bots?${new URLSearchParams(params).toString()}`);
}

/** Ajouter un bot en collant son jeton (ADMIN seulement : les jetons sont sensibles). */
export async function addBotAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const token = String(formData.get("token") ?? "").trim();
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
