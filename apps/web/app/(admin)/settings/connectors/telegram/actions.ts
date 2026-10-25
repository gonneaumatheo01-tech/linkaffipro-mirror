"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { encrypt } from "@linkaffipro/core";
import { prisma, audit } from "@linkaffipro/db";
import { signIn, TELEGRAM_SESSION_ID } from "@linkaffipro/mtproto";
import { requireAdmin } from "@/lib/session";
import { getTelegramSessionSecret, getTelegramUserApi } from "@/lib/views/session";
import {
  describeMtproto as describe,
  telegramCheckPassword,
  telegramDisconnect,
  telegramPollNow,
  telegramSaveUserApi,
  telegramSendCode,
} from "@/lib/site-ops/ops/lot-e/connectors-telegram";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";

/**
 * Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/connectors-telegram.ts`), comme Kevin.
 * Exception documentée : l'étape « code reçu » (`signInAction`) reste propre au site, car Telegram annule un code de
 * connexion recopié dans une conversation Telegram (Kevin envoie le lien direct de cette page).
 */
const PAGE = "/settings/connectors/telegram";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}
function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

/** Identifiants de l'application Telegram (my.telegram.org) → Setting `telegram.userApi` (hash chiffré). */
export async function saveUserApiAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await telegramSaveUserApi({ apiId: formData.get("apiId"), apiHash: formData.get("apiHash") }, webActor(admin));
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Étape 1 : envoi du code au numéro. Session (clé liée au code) stockée chiffrée, statut PENDING_CODE. */
export async function sendCodeAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await telegramSendCode({ phone: String(formData.get("phone") ?? "") }, webActor(admin));
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
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
  const r = await telegramCheckPassword({ password: String(formData.get("password") ?? "") }, webActor(admin));
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Déconnexion : révocation côté Telegram (si possible), session effacée, statut DISCONNECTED. */
export async function disconnectAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await telegramDisconnect({}, webActor(admin));
  revalidatePath(PAGE);
  back(backParams(r));
}

/** Relevé immédiat : enfile un passage `sync-views`. */
export async function pollNowAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await telegramPollNow({}, webActor(admin));
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}
