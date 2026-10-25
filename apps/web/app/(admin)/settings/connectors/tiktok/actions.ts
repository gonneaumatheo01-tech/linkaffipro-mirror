"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  tiktokCancelPending,
  tiktokChooseAccounts,
  tiktokDisconnect,
  tiktokSandbox,
  tiktokSaveApp,
  tiktokSync,
  tiktokVerify,
} from "@/lib/site-ops/ops/lot-e/connectors-ads";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/connectors-ads.ts`), comme Kevin. */
const PAGE = "/settings/connectors/tiktok";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/** Enregistre App ID, secret (vide = inchangé) et le mode bac à sable de l'application TikTok. */
export async function saveTikTokAppAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await tiktokSaveApp(
    { clientId: formData.get("clientId") ?? "", secret: formData.get("secret") ?? "", sandbox: formData.get("sandbox") === "1" },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Teste les identifiants de l'application auprès de TikTok, sans rien connecter. */
export async function verifyTikTokAppAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await tiktokVerify({}, webActor(admin));
  revalidatePath(PAGE);
  back(backParams(r));
}

/** Lance une synchronisation (3 derniers jours, ou 28 jours avec `mode=full`). */
export async function syncTikTokNowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await tiktokSync(
    { connectionId: String(formData.get("connectionId") ?? ""), mode: formData.get("mode") === "full" ? "full" : "recent" },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Efface le jeton du compte ; les coûts déjà importés restent. */
export async function disconnectTikTokAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await tiktokDisconnect({ connectionId: String(formData.get("connectionId") ?? "") }, webActor(admin));
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Enregistre les comptes cochés sur la page de choix (après le retour de TikTok). */
export async function connectChosenAccountsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await tiktokChooseAccounts({ accounts: formData.getAll("accounts").map(String) }, webActor(admin));
  if (!r.ok && r.field === "accounts") redirect(`${PAGE}/choose?${new URLSearchParams({ error: r.error })}`);
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Abandonne le choix des comptes (jetons en attente effacés). */
export async function cancelPendingAction(): Promise<void> {
  const admin = await requireAdmin();
  back(backParams(await tiktokCancelPending({}, webActor(admin))));
}

/**
 * Bac à sable TikTok : pas de page de connexion ; le jeton et l'identifiant d'annonceur de test sont générés
 * dans le portail développeur (Tools → Sandbox). Le jeton arrive par formulaire (jamais dans l'URL) et est chiffré.
 */
export async function connectSandboxAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await tiktokSandbox(
    { token: String(formData.get("token") ?? ""), advertiserIds: String(formData.get("advertiserIds") ?? "") },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}
