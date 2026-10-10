"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, audit } from "@linkaffipro/db";
import { describeConnectorError, tiktokProvider } from "@linkaffipro/connectors";
import { listAccountsByIds } from "@linkaffipro/connectors/tiktok";
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

const PAGE = "/settings/connectors/tiktok";

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

function isRedirect(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

/** Enregistre App ID, secret (vide = inchangé) et le mode bac à sable de l'application TikTok. */
export async function saveTikTokAppAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();
  const sandbox = formData.get("sandbox") === "1";
  if (!/^\d{5,}$/.test(clientId))
    back({ error: "L'App ID TikTok est un nombre (copiez-le dans My Apps → Basic Information)." });
  try {
    await saveAppCredentials(
      "TIKTOK",
      { clientId, secret: secret || null, extra: { sandbox } },
      admin.id,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({ error: err instanceof Error ? err.message : "Enregistrement impossible." });
  }
  revalidatePath(PAGE);
  back({
    ok: `Application TikTok enregistrée${sandbox ? " (mode bac à sable)" : ""}. Cliquez sur « Vérifier » pour tester les identifiants.`,
  });
}

/** Teste les identifiants de l'application auprès de TikTok, sans rien connecter. */
export async function verifyTikTokAppAction(): Promise<void> {
  const admin = await requireAdmin();
  const app = await loadAppCredentials("TIKTOK");
  if (!app) back({ error: "Enregistrez d'abord l'App ID et le secret." });
  const result = await tiktokProvider.verifyApp(app);
  await markAppVerified("TIKTOK", result.ok ? { ok: true } : { ok: false, error: result.error });
  await audit({
    userId: admin.id,
    action: "connector.app_verified",
    entityType: "ConnectorApp",
    entityId: "TIKTOK",
    metadata: { platform: "TIKTOK", ok: result.ok },
  });
  revalidatePath(PAGE);
  if (result.ok) back({ ok: result.detail ?? "Identifiants acceptés par TikTok." });
  back({ error: result.error });
}

async function tiktokConnection(id: string) {
  const conn = await prisma.adAccountConnection.findUnique({
    where: { id },
    select: { id: true, platform: true, status: true, name: true },
  });
  if (!conn || conn.platform !== "TIKTOK") back({ error: "Connexion TikTok introuvable." });
  return conn;
}

/** Lance une synchronisation (3 derniers jours, ou 28 jours avec `mode=full`). */
export async function syncTikTokNowAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const conn = await tiktokConnection(String(formData.get("connectionId") ?? ""));
  if (conn.status !== "ACTIVE")
    back({
      error: `« ${conn.name} » n'est pas active : reconnectez le compte avant de synchroniser.`,
    });
  const mode = formData.get("mode") === "full" ? "full" : "recent";
  try {
    await requestSyncNow(conn.id, admin.id, mode);
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Impossible de lancer la synchronisation pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
    });
  }
  revalidatePath(PAGE);
  back({
    ok:
      mode === "full"
        ? `Resynchronisation des 28 derniers jours lancée pour « ${conn.name} » : rechargez la page dans quelques minutes.`
        : `Synchronisation lancée pour « ${conn.name} » : rechargez la page dans une minute.`,
  });
}

/** Efface le jeton du compte ; les coûts déjà importés restent. */
export async function disconnectTikTokAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const conn = await tiktokConnection(String(formData.get("connectionId") ?? ""));
  await disconnectConnection(conn.id, admin.id);
  revalidatePath(PAGE);
  back({ ok: `« ${conn.name} » déconnecté. Les dépenses déjà importées sont conservées.` });
}

/** Enregistre les comptes cochés sur la page de choix (après le retour de TikTok). */
export async function connectChosenAccountsAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const pending = await loadPending("TIKTOK", admin.id);
  if (!pending)
    back({
      error:
        "La connexion a expiré (15 minutes) : recommencez depuis « Connecter un compte TikTok ».",
    });
  const chosen = new Set(formData.getAll("accounts").map(String));
  const accounts = pending.accounts.filter((a) => chosen.has(a.externalId));
  if (accounts.length === 0)
    redirect(`${PAGE}/choose?${new URLSearchParams({ error: "Cochez au moins un compte." })}`);
  const ids = await saveConnections("TIKTOK", admin.id, pending.tokens, accounts);
  await clearPending("TIKTOK", admin.id);
  revalidatePath(PAGE);
  back({
    ok: `${ids.length} compte${ids.length > 1 ? "s" : ""} TikTok connecté${ids.length > 1 ? "s" : ""}. L'historique des 90 derniers jours arrive dans les minutes qui viennent.`,
  });
}

/** Abandonne le choix des comptes (jetons en attente effacés). */
export async function cancelPendingAction(): Promise<void> {
  const admin = await requireAdmin();
  await clearPending("TIKTOK", admin.id);
  back({ ok: "Connexion annulée : aucun compte n'a été ajouté." });
}

/**
 * Bac à sable TikTok : pas de page de connexion ; le jeton et l'identifiant d'annonceur de test sont générés
 * dans le portail développeur (Tools → Sandbox). Le jeton arrive par formulaire (jamais dans l'URL) et est chiffré.
 */
export async function connectSandboxAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const app = await loadAppCredentials("TIKTOK");
  if (!app) back({ error: "Enregistrez d'abord l'application TikTok." });
  if (!(app.extra as { sandbox?: boolean } | undefined)?.sandbox)
    back({
      error:
        "Cochez « Mode bac à sable » dans l'application, puis Enregistrer, avant d'utiliser ce formulaire.",
    });
  const token = String(formData.get("token") ?? "").trim();
  const ids = String(formData.get("advertiserIds") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{3,}$/.test(s));
  if (!token)
    back({ error: "Collez le jeton (Access Token) généré dans le portail TikTok, page Sandbox." });
  if (ids.length === 0)
    back({ error: "Indiquez au moins un identifiant d'annonceur de test (un nombre)." });
  try {
    const accounts = await listAccountsByIds(app, { accessToken: token }, ids, { sandbox: true });
    if (accounts.length === 0) back({ error: "Aucun annonceur trouvé avec ce jeton." });
    const saved = await saveConnections(
      "TIKTOK",
      admin.id,
      { accessToken: token, refreshToken: null, expiresAt: null, scopes: "sandbox" },
      accounts,
    );
    revalidatePath(PAGE);
    back({
      ok: `${saved.length} compte${saved.length > 1 ? "s" : ""} bac à sable connecté${saved.length > 1 ? "s" : ""}. La première synchronisation démarre dans les minutes qui viennent.`,
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    back({
      error: `Connexion bac à sable impossible : ${describeConnectorError(err).slice(0, 300)}`,
    });
  }
}
