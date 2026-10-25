import { safeEqual } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { Update } from "grammy/types";
// Phase 34 : boutons de choix des comptes publicitaires chez Kevin → fonctions du site.
import "@/lib/boss-inputs/register";
import { installInProcessSiteOps } from "@/lib/site-ops/in-process";

// Phase 34 : le chemin rapide de Kevin (dans ce webhook) appelle les opérations du site en direct, sans réseau.
installInProcessSiteOps();

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Une update Telegram ne dépasse jamais quelques dizaines de Ko : au-delà de 1 Mo, c'est un abus. */
const MAX_BODY_BYTES = 1_000_000;

/** Webhook Telegram : un bot par URL, vérifié par le secret transmis dans l'en-tête. */
export async function POST(req: Request, ctx: RouteContext<"/api/telegram/[botId]">) {
  const { botId } = await ctx.params;
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  const rec = await prisma.bot.findUnique({ where: { id: botId } });
  if (!rec || !rec.isActive) return new Response("unknown bot", { status: 404 });

  const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(secret, rec.webhookSecret)) return new Response("forbidden", { status: 403 });

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const bot = getOrCreateBot(rec, prismaTelegramDeps);
  try {
    await bot.handleUpdate(update);
    // Une update traitée sans erreur efface la dernière erreur mémorisée (sinon l'alerte « bot en difficulté » persiste).
    if (rec.lastError) await prisma.bot.update({ where: { id: rec.id }, data: { lastError: null } }).catch(() => undefined);
  } catch (err) {
    console.error("[telegram] erreur de traitement", rec.username, err);
    await prisma.bot.update({ where: { id: rec.id }, data: { lastError: (err as Error).message } }).catch(() => undefined);
  }
  // Toujours 200 : sinon Telegram renvoie la même update en boucle.
  return new Response("ok", { status: 200 });
}
