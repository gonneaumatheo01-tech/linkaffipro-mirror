"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import {
  disconnect,
  refresh,
  setActive,
  setPersona,
  startOnboarding,
  submitCode,
  submitPassword,
} from "@linkaffipro/userbot";
import { requireAdmin } from "@/lib/session";

const PATH = "/settings/accounts";

function back(params: Record<string, string>): never {
  redirect(`${PATH}?${new URLSearchParams(params).toString()}`);
}

/** Message lisible d'une erreur de Telegram (sans le préfixe technique de la bibliothèque). */
function reason(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const map: Record<string, string> = {
    PHONE_NUMBER_INVALID: "Ce numéro n'a pas l'air valide (forme attendue +33612345678).",
    PHONE_CODE_INVALID: "Ce code n'est pas le bon. Vérifiez dans Telegram.",
    PHONE_CODE_EXPIRED: "Le code a expiré. Demandez-en un nouveau.",
    PASSWORD_HASH_INVALID: "Mot de passe de validation en deux étapes incorrect.",
    FLOOD_WAIT: "Trop d'essais d'un coup : attendez un instant avant de réessayer.",
  };
  for (const [code, text] of Object.entries(map)) if (raw.includes(code)) return text;
  return raw || fallback;
}

const idSchema = z.string().min(1);

/** Ajouter un compte : envoie le code au numéro. */
export async function addAccountAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) back({ error: "Saisissez un numéro de téléphone." });
  try {
    const account = await startOnboarding(phone);
    await audit({
      userId: user.id,
      action: "userbot.account_added",
      entityType: "TelegramUserAccount",
      entityId: account.id,
    });
    revalidatePath(PATH);
    back({ ok: `Code envoyé au ${account.phone}. Ouvrez Telegram et recopiez-le.` });
  } catch (err) {
    back({ error: reason(err, "Impossible d'envoyer le code.") });
  }
}

/** Saisir le code reçu. */
export async function submitCodeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = idSchema.parse(formData.get("accountId"));
  const code = String(formData.get("code") ?? "").trim();
  if (!code) back({ error: "Saisissez le code reçu dans Telegram." });
  try {
    const account = await submitCode(id, code);
    revalidatePath(PATH);
    back({
      ok:
        account.status === "ACTIVE"
          ? "Compte connecté."
          : "Code accepté. Saisissez maintenant votre mot de passe de validation en deux étapes.",
    });
  } catch (err) {
    back({ error: reason(err, "Le code n'a pas été accepté.") });
  }
}

/** Saisir le mot de passe de validation en deux étapes. */
export async function submitPasswordAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = idSchema.parse(formData.get("accountId"));
  const password = String(formData.get("password") ?? "");
  if (!password) back({ error: "Saisissez le mot de passe de validation en deux étapes." });
  try {
    await submitPassword(id, password);
    revalidatePath(PATH);
    back({ ok: "Compte connecté." });
  } catch (err) {
    back({ error: reason(err, "Le mot de passe n'a pas été accepté.") });
  }
}

/** Relire la session : confirme qu'elle est toujours valable. */
export async function refreshAccountAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = idSchema.parse(formData.get("accountId"));
  const account = await refresh(id);
  revalidatePath(PATH);
  back(
    account.status === "ACTIVE"
      ? { ok: "Session toujours valable." }
      : { error: `Session perdue : ${account.lastError ?? "reconnectez le compte."}` },
  );
}

/** Activer / désactiver le compte (désactivé : le programme ne le démarre pas). */
export async function toggleAccountAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const id = idSchema.parse(formData.get("accountId"));
  const account = await prisma.telegramUserAccount.findUniqueOrThrow({ where: { id } });
  await setActive(id, !account.isActive);
  await audit({
    userId: user.id,
    action: account.isActive ? "userbot.account_deactivated" : "userbot.account_activated",
    entityType: "TelegramUserAccount",
    entityId: id,
  });
  revalidatePath(PATH);
  back({ ok: account.isActive ? "Compte désactivé." : "Compte activé." });
}

const personaSchema = z.object({
  accountId: z.string().min(1),
  personaId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => v || null),
});

/** Rattacher (ou détacher) une persona. */
export async function setAccountPersonaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = personaSchema.safeParse({
    accountId: formData.get("accountId"),
    personaId: formData.get("personaId") ?? undefined,
  });
  if (!parsed.success) back({ error: "Persona invalide." });
  await setPersona(parsed.data.accountId, parsed.data.personaId);
  revalidatePath(PATH);
  back({ ok: parsed.data.personaId ? "Persona liée." : "Persona détachée." });
}

/** Déconnecter (révoque la session côté Telegram). */
export async function disconnectAccountAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = idSchema.parse(formData.get("accountId"));
  try {
    await disconnect(id);
    revalidatePath(PATH);
    back({ ok: "Compte déconnecté." });
  } catch (err) {
    back({ error: reason(err, "Impossible de déconnecter le compte.") });
  }
}
