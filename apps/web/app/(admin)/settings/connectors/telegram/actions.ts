"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
  signIn,
  TELEGRAM_SESSION_ID,
  TELEGRAM_USER_API_SETTING,
} from "@linkaffipro/mtproto";
import { enqueue, getRedis, withMtprotoLock } from "@linkaffipro/queue";
import { requireAdmin } from "@/lib/session";
import { getTelegramSessionSecret, getTelegramUserApi } from "@/lib/views/session";

const PAGE = "/settings/connectors/telegram";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}
/** Message d'erreur lisible (jamais de session ni de secret dedans). */
function describe(err: unknown): string {
  if (err instanceof MtprotoFloodWait)
    return `Telegram demande d'attendre ${err.seconds} seconde${err.seconds > 1 ? "s" : ""} avant de réessayer.`;
  if (err instanceof Error) return err.message;
  return "Erreur inconnue.";
}

/** Identifiants de l'application Telegram (my.telegram.org) → Setting `telegram.userApi` (hash chiffré). */
export async function saveUserApiAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ apiId: z.coerce.number().int().positive(), apiHash: z.string().trim() })
    .safeParse({ apiId: formData.get("apiId"), apiHash: formData.get("apiHash") });
  if (!parsed.success || !isValidApiHash(parsed.data.apiHash))
    back({
      error:
        "Vérifiez les deux champs : api_id est un nombre, api_hash fait 32 caractères (lettres et chiffres).",
    });
  const value = {
    apiId: parsed.data.apiId,
    apiHashEncrypted: encrypt(parsed.data.apiHash.toLowerCase()),
  };
  await prisma.setting.upsert({
    where: { key: TELEGRAM_USER_API_SETTING },
    create: { key: TELEGRAM_USER_API_SETTING, value },
    update: { value },
  });
  await audit({
    userId: admin.id,
    action: "telegram.userapi_saved",
    entityType: "Setting",
    entityId: TELEGRAM_USER_API_SETTING,
    metadata: { apiId: parsed.data.apiId },
  });
  revalidatePath(PAGE);
  back({ ok: "Application Telegram enregistrée. Vous pouvez connecter le compte (étape 1)." });
}

/** Étape 1 : envoi du code au numéro. Session (clé liée au code) stockée chiffrée, statut PENDING_CODE. */
export async function sendCodeAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone)
    back({
      error: "Numéro invalide : utilisez le format international, par exemple +33 6 12 34 56 78.",
    });
  const creds = await getTelegramUserApi();
  if (!creds)
    back({ error: "Renseignez d'abord l'application Telegram (api_id et api_hash) ci-dessus." });
  try {
    const r = await sendCode(phone, creds);
    const data = {
      phone,
      sessionEncrypted: encrypt(r.session),
      status: "PENDING_CODE",
      phoneCodeHash: r.phoneCodeHash,
      connectedById: admin.id,
      lastError: null,
    };
    await prisma.telegramUserSession.upsert({
      where: { id: TELEGRAM_SESSION_ID },
      create: { id: TELEGRAM_SESSION_ID, ...data },
      update: data,
    });
    await audit({
      userId: admin.id,
      action: "telegram.session_code_sent",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    await audit({
      userId: admin.id,
      action: "telegram.session_code_failed",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { error: describe(err) },
    });
    back({ error: `Envoi du code impossible : ${describe(err)}` });
  }
  revalidatePath(PAGE);
  back({
    ok: "Code envoyé : ouvrez Telegram sur votre téléphone, copiez le code reçu et collez-le à l'étape 2.",
  });
}

/** Étape 2 : code reçu → ACTIVE, ou PENDING_PASSWORD si la validation en deux étapes est activée. */
export async function signInAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length < 4)
    back({ error: "Entrez le code reçu dans Telegram (5 chiffres en général)." });
  const [creds, secret] = await Promise.all([getTelegramUserApi(), getTelegramSessionSecret()]);
  if (!creds) back({ error: "Application Telegram non configurée." });
  if (!secret || secret.status !== "PENDING_CODE" || !secret.phoneCodeHash)
    back({ error: "Aucun code en attente : recommencez à l'étape 1." });
  try {
    const r = await signIn(
      { session: secret.session, phone: secret.phone, phoneCodeHash: secret.phoneCodeHash, code },
      creds,
    );
    if (r.status === "password_needed") {
      await prisma.telegramUserSession.update({
        where: { id: TELEGRAM_SESSION_ID },
        data: { sessionEncrypted: encrypt(r.session), status: "PENDING_PASSWORD", lastError: null },
      });
      await audit({
        userId: admin.id,
        action: "telegram.session_password_needed",
        entityType: "TelegramUserSession",
        entityId: TELEGRAM_SESSION_ID,
      });
      revalidatePath(PAGE);
      back({
        ok: "Code accepté. Ce compte a la validation en deux étapes : entrez son mot de passe (étape 3).",
      });
    }
    await prisma.telegramUserSession.update({
      where: { id: TELEGRAM_SESSION_ID },
      data: {
        sessionEncrypted: encrypt(r.session),
        status: "ACTIVE",
        phoneCodeHash: null,
        lastError: null,
        lastUsedAt: new Date(),
      },
    });
    await audit({
      userId: admin.id,
      action: "telegram.session_connected",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { firstName: r.user.firstName, username: r.user.username },
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    const message = describe(err);
    const expired = /expiré|AUTH_RESTART|recommencez/i.test(message);
    if (expired)
      await prisma.telegramUserSession.update({
        where: { id: TELEGRAM_SESSION_ID },
        data: {
          status: "DISCONNECTED",
          sessionEncrypted: "",
          phoneCodeHash: null,
          lastError: message,
        },
      });
    await audit({
      userId: admin.id,
      action: "telegram.session_signin_failed",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { error: message },
    });
    back({ error: message });
  }
  revalidatePath(PAGE);
  back({
    ok: "Compte Telegram connecté. Les vues seront relevées automatiquement (premier passage dans les 15 minutes).",
  });
}

/** Étape 3 : mot de passe de validation en deux étapes → ACTIVE. */
export async function checkPasswordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (!password) back({ error: "Entrez le mot de passe de validation en deux étapes." });
  const [creds, secret] = await Promise.all([getTelegramUserApi(), getTelegramSessionSecret()]);
  if (!creds) back({ error: "Application Telegram non configurée." });
  if (!secret || secret.status !== "PENDING_PASSWORD")
    back({ error: "Aucun mot de passe attendu : recommencez à l'étape 1." });
  try {
    const r = await checkPassword({ session: secret.session, password }, creds);
    await prisma.telegramUserSession.update({
      where: { id: TELEGRAM_SESSION_ID },
      data: {
        sessionEncrypted: encrypt(r.session),
        status: "ACTIVE",
        phoneCodeHash: null,
        lastError: null,
        lastUsedAt: new Date(),
      },
    });
    await audit({
      userId: admin.id,
      action: "telegram.session_connected",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { firstName: r.user.firstName, username: r.user.username, twoStep: true },
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    await audit({
      userId: admin.id,
      action: "telegram.session_password_failed",
      entityType: "TelegramUserSession",
      entityId: TELEGRAM_SESSION_ID,
      metadata: { error: describe(err) },
    });
    back({ error: describe(err) });
  }
  revalidatePath(PAGE);
  back({
    ok: "Compte Telegram connecté. Les vues seront relevées automatiquement (premier passage dans les 15 minutes).",
  });
}

/** Déconnexion : révocation côté Telegram (si possible), session effacée, statut DISCONNECTED. */
export async function disconnectAction(): Promise<void> {
  const admin = await requireAdmin();
  const [creds, secret] = await Promise.all([getTelegramUserApi(), getTelegramSessionSecret()]);
  let revoked = false;
  let note: string | null = null;
  if (creds && secret && secret.session) {
    try {
      // Même session que le relevé des vues du worker : une seule connexion à la fois (verrou partagé).
      revoked = await withMtprotoLock(getRedis(), () => logOut(secret.session, creds), {
        waitMs: 15_000,
        owner: "web:disconnect",
      });
    } catch (err) {
      note = describe(err);
    }
  }
  await prisma.telegramUserSession.updateMany({
    where: { id: TELEGRAM_SESSION_ID },
    data: { status: "DISCONNECTED", sessionEncrypted: "", phoneCodeHash: null, lastError: null },
  });
  await prisma.setting.deleteMany({ where: { key: "views.floodUntil" } });
  await audit({
    userId: admin.id,
    action: "telegram.session_disconnected",
    entityType: "TelegramUserSession",
    entityId: TELEGRAM_SESSION_ID,
    metadata: { revoked, note },
  });
  revalidatePath(PAGE);
  back({
    ok: revoked
      ? "Compte déconnecté et session révoquée côté Telegram. Les vues ne seront plus relevées."
      : "Compte déconnecté sur la plateforme. Si une session reste listée dans Telegram → Appareils, fermez-la depuis l'application.",
  });
}

/** Relevé immédiat : enfile un passage `sync-views`. */
export async function pollNowAction(): Promise<void> {
  const admin = await requireAdmin();
  try {
    await enqueue("sync-views", { type: "tick" }, { jobId: `sync-views:manual:${Date.now()}` });
    await audit({ userId: admin.id, action: "telegram.views_sync_requested" });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Impossible de lancer le relevé pour le moment (${describe(err)}). Réessayez dans une minute.`,
    });
  }
  revalidatePath(PAGE);
  back({
    ok: "Relevé lancé : rechargez la page dans une minute pour voir la date du dernier relevé.",
  });
}
