import { audit, prisma } from "@linkaffipro/db";
import { TELEGRAM_SESSION_ID } from "@linkaffipro/mtproto";
import { enqueue } from "@linkaffipro/queue";

/**
 * Import des packs d'emojis installés sur le compte Telegram connecté (D3, phase 12) : le site enfile la tâche
 * `custom-emoji` `import-account` ; le worker lit les packs (un seul client Telegram à la fois), les ajoute à la
 * bibliothèque (source ACCOUNT) et récupère leurs aperçus.
 */
export async function requestAccountImport(
  userId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await prisma.telegramUserSession.findUnique({
    where: { id: TELEGRAM_SESSION_ID },
    select: { status: true },
  });
  if (!session || session.status !== "ACTIVE")
    return {
      ok: false,
      error:
        session?.status === "ERROR"
          ? "Le compte Telegram connecté est à reconnecter (Réglages → Connexions → Telegram)."
          : "Aucun compte Telegram connecté : connectez-le d'abord dans Réglages → Connexions → Telegram.",
    };
  try {
    // Une demande par minute au plus (un double clic ne lance pas deux imports).
    await enqueue(
      "custom-emoji",
      { type: "import-account", requestedById: userId },
      { jobId: `custom-emoji:import-account:${Math.floor(Date.now() / 60_000)}` },
    );
  } catch (err) {
    console.error("[custom-emoji] import du compte non demandé", err);
    return {
      ok: false,
      error: "Le service d'arrière-plan ne répond pas : réessayez dans une minute.",
    };
  }
  await audit({
    userId,
    action: "custom_emoji.account_import_requested",
    entityType: "CustomEmoji",
  });
  return {
    ok: true,
    message:
      "Import demandé : vos packs d'emojis animés arrivent dans la bibliothèque d'ici une minute.",
  };
}
