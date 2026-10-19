/**
 * Comptes Telegram REELS (pas des bots) — phase 18, etape 1.
 * Le paquet mtproto ne connait ni la base ni la cle de chiffrement : ce module fait le lien.
 * La session GramJS est chiffree AES-256-GCM (comme la session `main` de TelegramUserSession).
 */
import { decrypt, encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  checkPassword,
  getMe,
  logOut,
  normalizePhone,
  parseTelegramUserApi,
  sendCode,
  signIn,
  TELEGRAM_USER_API_SETTING,
  type MtprotoCredentials,
} from "@linkaffipro/mtproto";

export const USERBOT_ACCOUNT_STATUSES = [
  "PENDING_CODE",
  "PENDING_PASSWORD",
  "ACTIVE",
  "ERROR",
  "DISCONNECTED",
] as const;
export type UserbotAccountStatus = (typeof USERBOT_ACCOUNT_STATUSES)[number];

/** Identifiants de l'application Telegram (my.telegram.org), lus dans les reglages et dechiffres. */
async function credentials(): Promise<MtprotoCredentials> {
  const row = await prisma.setting.findUnique({ where: { key: TELEGRAM_USER_API_SETTING } });
  const parsed = parseTelegramUserApi(row?.value);
  if (!parsed) throw new Error("Identifiants Telegram (my.telegram.org) absents des reglages.");
  return { apiId: parsed.apiId, apiHash: decrypt(parsed.apiHashEncrypted) };
}

export function listAccounts() {
  return prisma.telegramUserAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: { persona: { select: { id: true, name: true } } },
  });
}

export function getAccount(id: string) {
  return prisma.telegramUserAccount.findUniqueOrThrow({ where: { id } });
}

/** Session en clair d'un compte (jamais renvoyee telle quelle au navigateur). */
export async function sessionOf(id: string): Promise<string> {
  return decrypt((await getAccount(id)).sessionEncrypted);
}

/** Etape 1 : envoie le code au numero et garde la session intermediaire (elle porte la cle liee au code). */
export async function startOnboarding(rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Numero invalide : forme attendue +33612345678.");
  const creds = await credentials();
  const { phoneCodeHash, session } = await sendCode(phone, creds);
  const data = {
    phoneCodeHash,
    sessionEncrypted: encrypt(session),
    status: "PENDING_CODE",
    lastError: null,
  };
  const existing = await prisma.telegramUserAccount.findUnique({ where: { phone } });
  if (existing) return prisma.telegramUserAccount.update({ where: { id: existing.id }, data });
  return prisma.telegramUserAccount.create({ data: { label: phone, phone, ...data } });
}

/** Etape 2 : valide le code. ACTIVE, ou PENDING_PASSWORD si la validation en deux etapes est active. */
export async function submitCode(id: string, code: string) {
  const account = await getAccount(id);
  if (!account.phoneCodeHash) throw new Error("Aucun code en attente pour ce compte.");
  const creds = await credentials();
  const res = await signIn(
    {
      session: decrypt(account.sessionEncrypted),
      phone: account.phone,
      phoneCodeHash: account.phoneCodeHash,
      code: code.trim(),
    },
    creds,
  );
  if (res.status === "password_needed") {
    return prisma.telegramUserAccount.update({
      where: { id },
      data: { sessionEncrypted: encrypt(res.session), status: "PENDING_PASSWORD", lastError: null },
    });
  }
  return prisma.telegramUserAccount.update({
    where: { id },
    data: {
      sessionEncrypted: encrypt(res.session),
      status: "ACTIVE",
      telegramUserId: BigInt(res.user.id),
      telegramUsername: res.user.username,
      phoneCodeHash: null,
      lastError: null,
      lastActiveAt: new Date(),
    },
  });
}

/** Etape 3 : mot de passe de validation en deux etapes. */
export async function submitPassword(id: string, password: string) {
  const account = await getAccount(id);
  const creds = await credentials();
  const res = await checkPassword({ session: decrypt(account.sessionEncrypted), password }, creds);
  return prisma.telegramUserAccount.update({
    where: { id },
    data: {
      sessionEncrypted: encrypt(res.session),
      status: "ACTIVE",
      telegramUserId: BigInt(res.user.id),
      telegramUsername: res.user.username,
      phoneCodeHash: null,
      lastError: null,
      lastActiveAt: new Date(),
    },
  });
}

/** Relecture de la session : confirme qu'elle est encore valable et rafraichit l'identite. */
export async function refresh(id: string) {
  const account = await getAccount(id);
  const creds = await credentials();
  try {
    const me = await getMe(decrypt(account.sessionEncrypted), creds);
    return await prisma.telegramUserAccount.update({
      where: { id },
      data: {
        status: "ACTIVE",
        telegramUserId: BigInt(me.id),
        telegramUsername: me.username,
        lastActiveAt: new Date(),
        lastError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return prisma.telegramUserAccount.update({
      where: { id },
      data: { status: "ERROR", lastError: message.slice(0, 500) },
    });
  }
}

/** Revoque la session cote Telegram. */
export async function disconnect(id: string) {
  const account = await getAccount(id);
  const creds = await credentials();
  await logOut(decrypt(account.sessionEncrypted), creds).catch(() => undefined);
  return prisma.telegramUserAccount.update({
    where: { id },
    data: { status: "DISCONNECTED", isActive: false, phoneCodeHash: null },
  });
}

/** Active ou desactive le compte (desactive : le process ne le demarre pas). */
export function setActive(id: string, isActive: boolean) {
  return prisma.telegramUserAccount.update({ where: { id }, data: { isActive } });
}

/** Rattache (ou detache) une persona. */
export function setPersona(id: string, personaId: string | null) {
  return prisma.telegramUserAccount.update({ where: { id }, data: { personaId } });
}
