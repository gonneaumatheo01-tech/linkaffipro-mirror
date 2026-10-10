"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { metaProvider } from "@linkaffipro/connectors";
import { audit } from "@linkaffipro/db";
import {
  clearPending,
  disconnectConnection,
  loadAppCredentials,
  loadPending,
  markAppVerified,
  requestSyncNow,
  saveAppCredentials,
  saveConnections,
} from "@/lib/connectors/common";
import { requireAdmin } from "@/lib/session";

const PAGE = "/settings/connectors/meta";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const appSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, "L'App ID est un nombre (entre 6 et 20 chiffres)."),
  secret: z.string().trim().max(200).optional(),
  configId: z.string().trim().regex(/^\d*$/, "Le config_id est un nombre (ou vide).").max(30),
});

/** Enregistre l'App ID, l'App Secret (vide = inchangé) et le config_id optionnel de l'application Meta. */
export async function saveMetaAppAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = appSchema.safeParse({
    clientId: formData.get("clientId"),
    secret: formData.get("secret") || undefined,
    configId: formData.get("configId") ?? "",
  });
  if (!parsed.success) back({ error: parsed.error.issues[0]?.message ?? "Valeurs invalides." });
  try {
    await saveAppCredentials(
      "META",
      {
        clientId: parsed.data.clientId,
        secret: parsed.data.secret || null,
        extra: { configId: parsed.data.configId || null },
      },
      admin.id,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: message(err) });
  }
  revalidatePath(PAGE);
  back({
    ok: "Application Meta enregistrée. Cliquez sur « Vérifier » pour tester les identifiants.",
  });
}

/** Teste l'App ID / App Secret auprès de Meta (jeton d'application), sans connecter de compte. */
export async function verifyMetaAppAction(): Promise<void> {
  const admin = await requireAdmin();
  const app = await loadAppCredentials("META");
  if (!app) back({ error: "Enregistrez d'abord l'App ID et l'App Secret." });
  const result = await metaProvider.verifyApp(app);
  await markAppVerified("META", result.ok ? { ok: true } : { ok: false, error: result.error });
  await audit({
    userId: admin.id,
    action: "connector.app_verified",
    entityType: "ConnectorApp",
    entityId: "META",
    metadata: { ok: result.ok, error: result.ok ? null : result.error },
  });
  revalidatePath(PAGE);
  if (result.ok)
    back({
      ok: `Identifiants vérifiés : ${result.detail ?? "acceptés par Meta"}. Vous pouvez connecter un compte.`,
    });
  back({ error: `Vérification refusée. ${result.error}` });
}

/** Lance une synchronisation (3 derniers jours) ou une resynchronisation de 28 jours pour une connexion. */
export async function syncMetaConnectionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("connectionId") ?? "");
  const full = formData.get("mode") === "full";
  if (!id) back({ error: "Connexion introuvable." });
  try {
    await requestSyncNow(id, admin.id, full ? "full" : "recent");
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Impossible de lancer la synchronisation pour le moment (${message(err)}). Réessayez dans une minute.`,
    });
  }
  revalidatePath(PAGE);
  back({
    ok: full
      ? "Resynchronisation des 28 derniers jours lancée : rechargez la page dans quelques minutes."
      : "Synchronisation lancée : rechargez la page dans une minute.",
  });
}

/** Déconnecte un compte : le jeton est effacé, les coûts déjà importés restent. */
export async function disconnectMetaConnectionAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("connectionId") ?? "");
  if (!id) back({ error: "Connexion introuvable." });
  try {
    await disconnectConnection(id, admin.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: message(err) });
  }
  revalidatePath(PAGE);
  back({ ok: "Compte déconnecté. Les dépenses déjà importées sont conservées." });
}

/** Enregistre les comptes cochés sur la page « Choisir les comptes » (jetons en attente, 15 min). */
export async function connectChosenMetaAccountsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const pending = await loadPending("META", admin.id);
  if (!pending)
    back({
      error:
        "La connexion Meta a expiré (15 minutes). Cliquez de nouveau sur « Connecter un compte Meta ».",
    });
  const chosen = new Set(formData.getAll("accounts").map(String));
  const accounts = pending.accounts.filter((a) => chosen.has(a.externalId));
  if (accounts.length === 0)
    redirect(
      `${PAGE}/choose?error=${encodeURIComponent("Cochez au moins un compte à connecter.")}`,
    );
  try {
    await saveConnections("META", admin.id, pending.tokens, accounts);
    await clearPending("META", admin.id);
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: `Enregistrement impossible : ${message(err)}` });
  }
  revalidatePath(PAGE);
  back({
    ok: `${accounts.length} compte${accounts.length > 1 ? "s" : ""} connecté${accounts.length > 1 ? "s" : ""}, l'historique de 90 jours se charge (quelques minutes).`,
  });
}

/** Abandonne la connexion en attente (bouton « Annuler » de la page de choix). */
export async function cancelPendingMetaAction(): Promise<void> {
  const admin = await requireAdmin();
  await clearPending("META", admin.id);
  back({ ok: "Connexion annulée : aucun compte n'a été ajouté." });
}
