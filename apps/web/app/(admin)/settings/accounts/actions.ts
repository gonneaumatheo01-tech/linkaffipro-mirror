"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@linkaffipro/db";
import { ensureShadowBot, submitCode } from "@linkaffipro/userbot";
import {
  accountAdd,
  accountDisconnect,
  accountRefresh,
  accountSetPersona,
  accountSubmitPassword,
  accountToggle,
} from "@/lib/site-ops/ops/lot-e/accounts";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/**
 * Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/accounts.ts`), comme Kevin. Exception
 * documentée : l'étape « code reçu » (`submitCodeAction`) reste propre au site, car Telegram annule un code de
 * connexion recopié dans une conversation Telegram (Kevin envoie le lien direct de cette page).
 */
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
  const r = await accountAdd(
    { phone: String(formData.get("phone") ?? ""), label: String(formData.get("label") ?? "") },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
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
  const r = await accountSubmitPassword(
    { accountId: String(formData.get("accountId") ?? ""), password: String(formData.get("password") ?? "") },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

export async function toggleAccountAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await accountToggle(
    { accountId: String(formData.get("accountId") ?? ""), active: formData.get("active") === "1" },
    webActor(admin),
  );
  revalidatePath(PAGE);
  back(backParams(r));
}

/** Persona d'un compte : Rencontres seulement (refus côté serveur, quelle que soit la liste affichée). */
export async function setAccountPersonaAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await accountSetPersona(
    { accountId: String(formData.get("accountId") ?? ""), personaId: String(formData.get("personaId") ?? "") || null },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

export async function refreshAccountAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await accountRefresh({ accountId: String(formData.get("accountId") ?? "") }, webActor(admin));
  revalidatePath(PAGE);
  back(backParams(r));
}

export async function disconnectAccountAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await accountDisconnect({ accountId: String(formData.get("accountId") ?? "") }, webActor(admin));
  revalidatePath(PAGE);
  back(backParams(r));
}
