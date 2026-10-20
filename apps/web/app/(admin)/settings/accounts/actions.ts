"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, audit } from "@linkaffipro/db";
import {
  disconnect,
  ensureShadowBot,
  refresh,
  setActive,
  setPersona,
  startOnboarding,
  submitCode,
  submitPassword,
} from "@linkaffipro/userbot";
import { requireAdmin } from "@/lib/session";

const PAGE = "/settings/accounts";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}
function describe(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur inconnue.";
}

/** Etape 1 : numero -> code envoye, compte en PENDING_CODE. */
export async function addAccountAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const phone = String(formData.get("phone") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  let id = "";
  try {
    const account = await startOnboarding(phone);
    id = account.id;
    if (label) await prisma.telegramUserAccount.update({ where: { id }, data: { label } });
  } catch (err) {
    back({ error: `Envoi du code impossible : ${describe(err)}` });
  }
  await audit({
    userId: admin.id,
    action: "userbot.account_code_sent",
    entityType: "TelegramUserAccount",
    entityId: id,
  });
  revalidatePath(PAGE);
  back({ ok: "Code envoye sur Telegram. Saisissez-le pour terminer la connexion." });
}

/** Etape 2 : code -> ACTIVE, ou PENDING_PASSWORD si la validation en deux etapes est active. */
export async function submitCodeAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("accountId") ?? "");
  const code = String(formData.get("code") ?? "");
  let status = "ACTIVE";
  try {
    const account = await submitCode(id, code);
    status = account.status;
  } catch (err) {
    back({ error: describe(err) });
  }
  if (status === "ACTIVE") await ensureShadowBot(id).catch(() => undefined);
  await audit({
    userId: admin.id,
    action: "userbot.account_code_ok",
    entityType: "TelegramUserAccount",
    entityId: id,
  });
  revalidatePath(PAGE);
  back(
    status === "PENDING_PASSWORD"
      ? { ok: "Code accepte. Ce compte a la validation en deux etapes : entrez le mot de passe." }
      : { ok: "Compte connecte." },
  );
}

/** Etape 3 : mot de passe de validation en deux etapes. */
export async function submitPasswordAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("accountId") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await submitPassword(id, password);
  } catch (err) {
    back({ error: describe(err) });
  }
  await ensureShadowBot(id).catch(() => undefined);
  await audit({
    userId: admin.id,
    action: "userbot.account_connected",
    entityType: "TelegramUserAccount",
    entityId: id,
  });
  revalidatePath(PAGE);
  back({ ok: "Compte connecte." });
}

export async function toggleAccountAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("accountId") ?? "");
  await setActive(id, formData.get("active") === "1");
  revalidatePath(PAGE);
  back({ ok: "Mis a jour. Redemarrez le userbot pour appliquer." });
}

export async function setAccountPersonaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("accountId") ?? "");
  await setPersona(id, String(formData.get("personaId") ?? "") || null);
  revalidatePath(PAGE);
  back({ ok: "Persona mise a jour." });
}

export async function refreshAccountAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("accountId") ?? "");
  const account = await refresh(id);
  revalidatePath(PAGE);
  back(
    account.status === "ACTIVE"
      ? { ok: "Session valide." }
      : { error: account.lastError ?? "Session invalide." },
  );
}

export async function disconnectAccountAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("accountId") ?? "");
  await disconnect(id).catch(() => undefined);
  revalidatePath(PAGE);
  back({ ok: "Compte deconnecte." });
}
