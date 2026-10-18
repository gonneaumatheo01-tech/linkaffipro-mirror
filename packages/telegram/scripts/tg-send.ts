// Envoie un message privé HTML à l'administrateur via le bot casino.
// Usage : tsx tg-send.ts "message"   (ou TG_MESSAGE_B64=<base64>)   [--confirm <telegramUserId>]
import { Api, GrammyError } from "grammy";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { chooseAdminTelegramId, splitMessage } from "../src/admin-chat";

async function resolveAdminId(confirm: string | undefined): Promise<bigint> {
  const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  const settingId = setting && typeof setting.value === "string" ? BigInt(setting.value) : null;
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { telegramUserId: true } });
  const casino = await prisma.bot.findFirst({ where: { vertical: "CASINO", isActive: true, mode: "STANDARD" } });
  const states = casino
    ? await prisma.memberBotState.findMany({ where: { botId: casino.id, startedAt: { not: null } }, orderBy: { startedAt: "desc" }, take: 20, include: { member: true } })
    : [];
  const candidate = chooseAdminTelegramId({
    settingId,
    adminUserTelegramId: admin?.telegramUserId ?? null,
    envUsername: process.env.ADMIN_TELEGRAM_USERNAME ?? null,
    starts: states.map((s) => ({ telegramUserId: s.member.telegramUserId, username: s.member.username, firstName: s.member.firstName, startedAt: s.startedAt! })),
  });
  if (!candidate) throw new Error("Aucun identifiant Telegram d'administrateur : faites /start sur le bot casino, ou liez votre compte dans Mon compte.");
  if ("needsConfirmation" in candidate) {
    if (confirm !== candidate.id.toString()) {
      const m = candidate.member;
      throw new Error(
        `CONFIRMATION REQUISE : le dernier /start sur le bot casino vient de ${m.firstName ?? "?"}${m.username ? ` (@${m.username})` : ""}, identifiant ${candidate.id}. ` +
          `Relancez avec --confirm ${candidate.id} si c'est bien l'administrateur.`,
      );
    }
  }
  if (candidate.source !== "setting") {
    await prisma.setting.upsert({ where: { key: "admin.telegramUserId" }, create: { key: "admin.telegramUserId", value: candidate.id.toString() }, update: { value: candidate.id.toString() } });
  }
  return candidate.id;
}

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf("--confirm");
  const confirm = ci >= 0 ? args[ci + 1] : undefined;
  const positional = args.filter((a, i) => a !== "--confirm" && i !== ci + 1);
  const text = process.env.TG_MESSAGE_B64 ? Buffer.from(process.env.TG_MESSAGE_B64, "base64").toString("utf8") : positional.join(" ");
  if (!text.trim()) throw new Error("Message vide.");

  const adminId = await resolveAdminId(confirm);
  const bot = await prisma.bot.findFirst({ where: { vertical: "CASINO", isActive: true, mode: "STANDARD" } });
  if (!bot) throw new Error("Aucun bot casino actif.");
  const api = new Api(decrypt(bot.tokenEncrypted));
  const parts = splitMessage(text);
  for (const part of parts) {
    try {
      await api.sendMessage(Number(adminId), part, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch (err) {
      if (err instanceof GrammyError && /parse entities/i.test(err.description)) {
        await api.sendMessage(Number(adminId), part, { link_preview_options: { is_disabled: true } });
      } else if (err instanceof GrammyError) {
        throw new Error(`Telegram a refusé l'envoi (${err.error_code}) : ${err.description}`);
      } else throw err;
    }
  }
  console.log(`Envoyé à ${adminId} via @${bot.username} (${parts.length} message${parts.length > 1 ? "s" : ""}).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
