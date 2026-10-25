"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  metaCancelPending,
  metaChooseAccounts,
  metaDisconnect,
  metaSaveApp,
  metaSync,
  metaVerify,
} from "@/lib/site-ops/ops/lot-e/connectors-ads";
import { backParams, webActor } from "@/lib/site-ops/ops/lot-e/common";
import { requireAdmin } from "@/lib/session";

/** Phase 34 : chaque action appelle le cœur unique (`lib/site-ops/ops/lot-e/connectors-ads.ts`), comme Kevin. */
const PAGE = "/settings/connectors/meta";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

/** Enregistre l'App ID, l'App Secret (vide = inchangé) et le config_id optionnel de l'application Meta. */
export async function saveMetaAppAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await metaSaveApp(
    { clientId: formData.get("clientId"), secret: formData.get("secret") || undefined, configId: formData.get("configId") ?? "" },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Teste l'App ID / App Secret auprès de Meta (jeton d'application), sans connecter de compte. */
export async function verifyMetaAppAction(): Promise<void> {
  const admin = await requireAdmin();
  const r = await metaVerify({}, webActor(admin));
  revalidatePath(PAGE);
  back(backParams(r));
}

/** Lance une synchronisation (3 derniers jours) ou une resynchronisation de 28 jours pour une connexion. */
export async function syncMetaConnectionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await metaSync(
    { connectionId: String(formData.get("connectionId") ?? ""), mode: formData.get("mode") === "full" ? "full" : "recent" },
    webActor(admin),
  );
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Déconnecte un compte : le jeton est effacé, les coûts déjà importés restent. */
export async function disconnectMetaConnectionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await metaDisconnect({ connectionId: String(formData.get("connectionId") ?? "") }, webActor(admin));
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Enregistre les comptes cochés sur la page « Choisir les comptes » (jetons en attente, 15 min). */
export async function connectChosenMetaAccountsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const r = await metaChooseAccounts({ accounts: formData.getAll("accounts").map(String) }, webActor(admin));
  if (!r.ok && r.field === "accounts") redirect(`${PAGE}/choose?error=${encodeURIComponent(r.error)}`);
  if (r.ok) revalidatePath(PAGE);
  back(backParams(r));
}

/** Abandonne la connexion en attente (bouton « Annuler » de la page de choix). */
export async function cancelPendingMetaAction(): Promise<void> {
  const admin = await requireAdmin();
  back(backParams(await metaCancelPending({}, webActor(admin))));
}
