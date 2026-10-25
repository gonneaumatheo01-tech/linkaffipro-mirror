/**
 * Phase 34, lot E — cœurs du compte Telegram qui relève les vues (Réglages → Connexions → Telegram, phase 7). Appelés
 * par `app/(admin)/settings/connectors/telegram/actions.ts` et par Kevin. Administrateurs seulement.
 * L'étape « code reçu » (`signInAction`) reste sur le site : Telegram annule un code de connexion recopié dans une
 * conversation Telegram (exclusion documentée, Kevin envoie le lien direct de la page).
 */
import { z } from "zod";
import { encrypt } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import {
  checkPassword,
  isValidApiHash,
  logOut,
  MtprotoFloodWait,
  normalizePhone,
  sendCode,
  TELEGRAM_SESSION_ID,
  TELEGRAM_USER_API_SETTING,
} from "@linkaffipro/mtproto";
import { enqueue, getRedis, withMtprotoLock } from "@linkaffipro/queue";
import { getTelegramSessionSecret, getTelegramUserApi } from "@/lib/views/session";
import { adminOnly, fail, ok, preview, str, viaMeta, type CoreRun } from "./common";

/** Message d'erreur lisible (jamais de session ni de secret dedans). */
export function describeMtproto(err: unknown): string {
  if (err instanceof MtprotoFloodWait)
    return `Telegram demande d'attendre ${err.seconds} seconde${err.seconds > 1 ? "s" : ""} avant de réessayer.`;
  if (err instanceof Error) return err.message;
  return "Erreur inconnue.";
}

/** Identifiants de l'application Telegram (my.telegram.org) → Setting `telegram.userApi` (hash chiffré). */
export const telegramSaveUserApi: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = z
    .object({ apiId: z.coerce.number().int().positive(), apiHash: z.string().trim() })
    .safeParse({ apiId: input.apiId, apiHash: input.apiHash });
  if (!parsed.success || !isValidApiHash(parsed.data.apiHash))
    return fail("Vérifiez les deux champs : api_id est un nombre, api_hash fait 32 caractères (lettres et chiffres).");
  if (opts.dryRun) return preview({ summary: `Application Telegram : api_id ${parsed.data.apiId}, api_hash enregistré chiffré.` });
  const value = { apiId: parsed.data.apiId, apiHashEncrypted: encrypt(parsed.data.apiHash.toLowerCase()) };
  await prisma.setting.upsert({
    where: { key: TELEGRAM_USER_API_SETTING },
    create: { key: TELEGRAM_USER_API_SETTING, value },
    update: { value },
  });
  await audit({
    userId: actor.userId,
    action: "telegram.userapi_saved",
    entityType: "Setting",
    entityId: TELEGRAM_USER_API_SETTING,
    metadata: { apiId: parsed.data.apiId, ...viaMeta(actor) },
  });
  return ok("Application Telegram enregistrée. Vous pouvez connecter le compte (étape 1).");
};

/** Étape 1 : envoi du code au numéro. Session (clé liée au code) stockée chiffrée, statut PENDING_CODE. */
export const telegramSendCode: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const phone = normalizePhone(str(input.phone));
  if (!phone) return fail("Numéro invalide : utilisez le format international, par exemple +33 6 12 34 56 78.", "invalid", "phone");
  const creds = await getTelegramUserApi();
  if (!creds) return fail("Renseignez d'abord l'application Telegram (api_id et api_hash) ci-dessus.");
  if (opts.dryRun) return preview({ summary: `J'envoie un code de connexion Telegram au ${phone}.` });
  try {
    const r = await sendCode(phone, creds);
    const data = {
      phone,
      sessionEncrypted: encrypt(r.session),
      status: "PENDING_CODE",
      phoneCodeHash: r.phoneCodeHash,
      connectedById: actor.userId,
      lastError: null,
    };
    await prisma.telegramUserSession.upsert({
      where: { id: TELEGRAM_SESSION_ID },
      create: { id: TELEGRAM_SESSION_ID, ...data },
      update: data,
    });
    await audit({
      userId: actor.userId,
      action: "telegram.session_code_sent",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: viaMeta(actor),
    });
  } catch (err) {
    await audit({
      userId: actor.userId,
      action: "telegram.session_code_failed",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { error: describeMtproto(err), ...viaMeta(actor) },
    });
    return fail(`Envoi du code impossible : ${describeMtproto(err)}`, "unavailable");
  }
  return ok("Code envoyé : ouvrez Telegram sur votre téléphone, copiez le code reçu et collez-le à l'étape 2.");
};

/** Étape 3 : mot de passe de validation en deux étapes → ACTIVE. */
export const telegramCheckPassword: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const password = str(input.password);
  if (!password) return fail("Entrez le mot de passe de validation en deux étapes.", "invalid", "password");
  const [creds, secret] = await Promise.all([getTelegramUserApi(), getTelegramSessionSecret()]);
  if (!creds) return fail("Application Telegram non configurée.");
  if (!secret || secret.status !== "PENDING_PASSWORD") return fail("Aucun mot de passe attendu : recommencez à l'étape 1.", "conflict");
  if (opts.dryRun) return preview({ summary: "Je termine la connexion du compte Telegram avec le mot de passe de validation en deux étapes." });
  try {
    const r = await checkPassword({ session: secret.session, password }, creds);
    await prisma.telegramUserSession.update({
      where: { id: TELEGRAM_SESSION_ID },
      data: { sessionEncrypted: encrypt(r.session), status: "ACTIVE", phoneCodeHash: null, lastError: null, lastUsedAt: new Date() },
    });
    await audit({
      userId: actor.userId,
      action: "telegram.session_connected",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { firstName: r.user.firstName, username: r.user.username, twoStep: true, ...viaMeta(actor) },
    });
  } catch (err) {
    await audit({
      userId: actor.userId,
      action: "telegram.session_password_failed",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { error: describeMtproto(err), ...viaMeta(actor) },
    });
    return fail(describeMtproto(err));
  }
  return ok("Compte Telegram connecté. Les vues seront relevées automatiquement (premier passage dans les 15 minutes).");
};

/** Déconnexion : révocation côté Telegram (si possible), session effacée, statut DISCONNECTED. */
export const telegramDisconnect: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun)
    return preview({
      summary: "Déconnexion du compte Telegram qui relève les vues.",
      impact: "La session est révoquée et effacée ; les vues ne seront plus relevées. Les vues déjà relevées restent.",
    });
  const [creds, secret] = await Promise.all([getTelegramUserApi(), getTelegramSessionSecret()]);
  let revoked = false;
  let note: string | null = null;
  if (creds && secret && secret.session) {
    try {
      // Même session que le relevé des vues du worker : une seule connexion à la fois (verrou partagé).
      revoked = await withMtprotoLock(getRedis(), () => logOut(secret.session, creds), { waitMs: 15_000, owner: "web:disconnect" });
    } catch (err) {
      note = describeMtproto(err);
    }
  }
  await prisma.telegramUserSession.updateMany({
    where: { id: TELEGRAM_SESSION_ID },
    data: { status: "DISCONNECTED", sessionEncrypted: "", phoneCodeHash: null, lastError: null },
  });
  await prisma.setting.deleteMany({ where: { key: "views.floodUntil" } });
  await audit({
    userId: actor.userId,
    action: "telegram.session_disconnected",
    entityType: "TelegramUserSession",
    entityId: TELEGRAM_SESSION_ID,
    metadata: { revoked, note, ...viaMeta(actor) },
  });
  return ok(
    revoked
      ? "Compte déconnecté et session révoquée côté Telegram. Les vues ne seront plus relevées."
      : "Compte déconnecté sur la plateforme. Si une session reste listée dans Telegram → Appareils, fermez-la depuis l'application.",
  );
};

/** Relevé immédiat : enfile un passage `sync-views`. */
export const telegramPollNow: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (opts.dryRun) return preview({ summary: "Je lance un relevé des vues des messages maintenant." });
  try {
    await enqueue("sync-views", { type: "tick" }, { jobId: `sync-views:manual:${Date.now()}` });
    await audit({ userId: actor.userId, action: "telegram.views_sync_requested", metadata: viaMeta(actor) });
  } catch (err) {
    return fail(`Impossible de lancer le relevé pour le moment (${describeMtproto(err)}). Réessayez dans une minute.`, "unavailable");
  }
  return ok("Relevé lancé : rechargez la page dans une minute pour voir la date du dernier relevé.");
};
