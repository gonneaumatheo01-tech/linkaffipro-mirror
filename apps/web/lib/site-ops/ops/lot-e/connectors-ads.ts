/**
 * Phase 34, lot E — cœurs des connecteurs publicitaires (Réglages → Connexions → Meta / TikTok). Appelés par
 * `app/(admin)/settings/connectors/{meta,tiktok}/actions.ts` et par Kevin : mêmes validations, mêmes textes, même
 * journal (+ `via`). Administrateurs seulement. Le démarrage de l'autorisation (navigateur obligatoire) n'est pas ici :
 * `metaConnect` / `tiktokConnect` vérifient seulement les prérequis de la page de départ ; Kevin envoie ensuite le lien
 * d'autorisation (`createAuthLink`, purpose `oauth_meta` / `oauth_tiktok`) et le choix des comptes se fait par boutons
 * (`*ChooseAccounts`, comptes proposés lus par `*PendingAccounts`).
 */
import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { describeConnectorError, metaProvider, tiktokProvider } from "@linkaffipro/connectors";
import { listAccountsByIds } from "@linkaffipro/connectors/tiktok";
import {
  clearPending,
  disconnectConnection,
  loadAppCredentials,
  loadAppState,
  loadPending,
  markAppVerified,
  requestSyncNow,
  saveAppCredentials,
  saveConnections,
  type ConnectorPlatform,
} from "@/lib/connectors/common";
import {
  adminOnly,
  fail,
  needUser,
  ok,
  optBool,
  plural,
  preview,
  resolveNamed,
  str,
  viaMeta,
  type CoreRun,
  type Fail,
} from "./common";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Connexion désignée par son identifiant (site) ou par le nom du compte publicitaire (Kevin). */
async function findConnection(
  platform: ConnectorPlatform,
  input: Record<string, unknown>,
  notFound: string,
): Promise<{ ok: true; conn: { id: string; platform: string; status: string; name: string } } | { ok: false; result: Fail }> {
  const id = str(input.connectionId).trim();
  const select = { id: true, platform: true, status: true, name: true } as const;
  if (id) {
    const conn = await prisma.adAccountConnection.findUnique({ where: { id }, select });
    if (!conn) return { ok: false, result: fail(notFound, "not_found") };
    return { ok: true, conn };
  }
  const raw = str(input.account).trim();
  if (!raw) return { ok: false, result: fail(notFound, "not_found", "connectionId") };
  const rows = await prisma.adAccountConnection.findMany({ where: { platform }, select: { ...select, externalId: true } });
  const ref = await resolveNamed(
    { plural: "comptes publicitaires", one: "le compte publicitaire" },
    raw,
    rows.map((r) => ({ id: r.id, name: r.name, extra: [r.externalId] })),
  );
  if (!ref.ok) return ref;
  return { ok: true, conn: rows.find((r) => r.id === ref.id)! };
}

/** Comptes cochés parmi les comptes en attente (identifiant externe du site, ou nom donné à Kevin). */
function chosenAccounts<T extends { externalId: string; name: string }>(accounts: readonly T[], raw: unknown): T[] {
  const list = (Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw]).map((v) => str(v).trim()).filter(Boolean);
  const chosen = new Set(list);
  const lower = new Set(list.map((v) => v.toLowerCase()));
  return accounts.filter((a) => chosen.has(a.externalId) || lower.has(a.name.toLowerCase()));
}

// ---------------------------------------------------------------------------------------------- TikTok

/** Enregistre App ID, secret (vide = inchangé) et le mode bac à sable de l'application TikTok. */
export const tiktokSaveApp: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const clientId = str(input.clientId).trim();
  const secret = str(input.secret).trim();
  if (!/^\d{5,}$/.test(clientId))
    return fail("L'App ID TikTok est un nombre (copiez-le dans My Apps → Basic Information).", "invalid", "clientId");
  const state = await loadAppState("TIKTOK");
  // Kevin peut ne pas parler du bac à sable : le réglage actuel est gardé (le formulaire du site l'envoie toujours).
  const sandbox = optBool(input.sandbox) ?? Boolean((state?.extra as { sandbox?: boolean } | undefined)?.sandbox);
  if (opts.dryRun) {
    if (!secret && !state?.hasSecret) return fail("Le secret de l'application est obligatoire la première fois.", "invalid", "secret");
    return preview({
      summary: `Application TikTok : App ID ${clientId}, secret ${secret ? "remplacé" : "inchangé"}${sandbox ? ", mode bac à sable" : ""}.`,
    });
  }
  try {
    await saveAppCredentials("TIKTOK", { clientId, secret: secret || null, extra: { sandbox } }, actor.userId!, viaMeta(actor));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Enregistrement impossible.");
  }
  return ok(
    `Application TikTok enregistrée${sandbox ? " (mode bac à sable)" : ""}. Cliquez sur « Vérifier » pour tester les identifiants.`,
  );
};

/** Teste les identifiants de l'application auprès de TikTok, sans rien connecter. */
export const tiktokVerify: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const app = await loadAppCredentials("TIKTOK");
  if (!app) return fail("Enregistrez d'abord l'App ID et le secret.", "invalid");
  if (opts.dryRun) return preview({ summary: "Je teste les identifiants de l'application TikTok auprès de TikTok (rien n'est connecté)." });
  const result = await tiktokProvider.verifyApp(app);
  await markAppVerified("TIKTOK", result.ok ? { ok: true } : { ok: false, error: result.error });
  await audit({
    userId: actor.userId,
    action: "connector.app_verified",
    entityType: "ConnectorApp",
    entityId: "TIKTOK",
    metadata: { platform: "TIKTOK", ok: result.ok, ...viaMeta(actor) },
  });
  if (result.ok) return ok(result.detail ?? "Identifiants acceptés par TikTok.");
  return fail(result.error, "invalid");
};

/** Lance une synchronisation (3 derniers jours, ou 28 jours avec `mode=full`). */
export const tiktokSync: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const found = await findConnection("TIKTOK", input, "Connexion TikTok introuvable.");
  if (!found.ok) return found.result;
  const conn = found.conn;
  if (conn.platform !== "TIKTOK") return fail("Connexion TikTok introuvable.", "not_found");
  if (conn.status !== "ACTIVE")
    return fail(`« ${conn.name} » n'est pas active : reconnectez le compte avant de synchroniser.`, "conflict");
  const mode = input.mode === "full" ? "full" : "recent";
  if (opts.dryRun)
    return preview({
      summary: mode === "full" ? `Resynchronisation des 28 derniers jours de « ${conn.name} ».` : `Synchronisation de « ${conn.name} » (3 derniers jours).`,
    });
  try {
    await requestSyncNow(conn.id, actor.userId!, mode, viaMeta(actor));
  } catch (err) {
    return fail(
      `Impossible de lancer la synchronisation pour le moment (${err instanceof Error ? err.message : "erreur"}). Réessayez dans une minute.`,
      "unavailable",
    );
  }
  return ok(
    mode === "full"
      ? `Resynchronisation des 28 derniers jours lancée pour « ${conn.name} » : rechargez la page dans quelques minutes.`
      : `Synchronisation lancée pour « ${conn.name} » : rechargez la page dans une minute.`,
    { connectionId: conn.id },
  );
};

/** Efface le jeton du compte ; les coûts déjà importés restent. */
export const tiktokDisconnect: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const found = await findConnection("TIKTOK", input, "Connexion TikTok introuvable.");
  if (!found.ok) return found.result;
  const conn = found.conn;
  if (conn.platform !== "TIKTOK") return fail("Connexion TikTok introuvable.", "not_found");
  if (opts.dryRun)
    return preview({
      summary: `Déconnexion du compte TikTok « ${conn.name} ».`,
      impact: "Le jeton est effacé ; les dépenses déjà importées sont conservées.",
    });
  await disconnectConnection(conn.id, actor.userId!, viaMeta(actor));
  return ok(`« ${conn.name} » déconnecté. Les dépenses déjà importées sont conservées.`, { connectionId: conn.id });
};

/** Comptes proposés par TikTok après l'autorisation (en attente 15 minutes), pour les boutons de Kevin. */
export const tiktokPendingAccounts: CoreRun = async (_input, actor) => pendingAccounts("TIKTOK", actor);

/** Enregistre les comptes cochés sur la page de choix (après le retour de TikTok). */
export const tiktokChooseAccounts: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const pending = await loadPending("TIKTOK", actor.userId!);
  if (!pending)
    return fail("La connexion a expiré (15 minutes) : recommencez depuis « Connecter un compte TikTok ».", "conflict");
  const accounts = chosenAccounts(pending.accounts, input.accounts);
  if (accounts.length === 0) return fail("Cochez au moins un compte.", "invalid", "accounts");
  if (opts.dryRun)
    return preview({ summary: `Je connecte ${accounts.length} compte${plural(accounts.length, "")} TikTok : ${accounts.map((a) => a.name).join(", ")}.` });
  const ids = await saveConnections("TIKTOK", actor.userId!, pending.tokens, accounts, viaMeta(actor));
  await clearPending("TIKTOK", actor.userId!);
  return ok(
    `${ids.length} compte${ids.length > 1 ? "s" : ""} TikTok connecté${ids.length > 1 ? "s" : ""}. L'historique des 90 derniers jours arrive dans les minutes qui viennent.`,
    { connectionIds: ids },
  );
};

/** Abandonne le choix des comptes (jetons en attente effacés). */
export const tiktokCancelPending: CoreRun = async (_input, actor, opts = {}) => cancelPending("TIKTOK", actor, opts.dryRun);

/**
 * Bac à sable TikTok : pas de page de connexion ; le jeton et l'identifiant d'annonceur de test sont générés dans le
 * portail développeur (Tools → Sandbox). Le jeton arrive par formulaire (jamais dans l'URL) ou en privé à Kevin, chiffré.
 */
export const tiktokSandbox: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const app = await loadAppCredentials("TIKTOK");
  if (!app) return fail("Enregistrez d'abord l'application TikTok.");
  if (!(app.extra as { sandbox?: boolean } | undefined)?.sandbox)
    return fail("Cochez « Mode bac à sable » dans l'application, puis Enregistrer, avant d'utiliser ce formulaire.", "conflict");
  const token = str(input.token).trim();
  const rawIds = Array.isArray(input.advertiserIds) ? input.advertiserIds.map(str).join(",") : str(input.advertiserIds);
  const ids = rawIds
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{3,}$/.test(s));
  if (!token) return fail("Collez le jeton (Access Token) généré dans le portail TikTok, page Sandbox.", "invalid", "token");
  if (ids.length === 0) return fail("Indiquez au moins un identifiant d'annonceur de test (un nombre).", "invalid", "advertiserIds");
  if (opts.dryRun) return preview({ summary: `Connexion bac à sable TikTok : ${ids.length} annonceur${plural(ids.length, "")} de test (${ids.join(", ")}).` });
  try {
    const accounts = await listAccountsByIds(app, { accessToken: token }, ids, { sandbox: true });
    if (accounts.length === 0) return fail("Aucun annonceur trouvé avec ce jeton.", "not_found");
    const saved = await saveConnections(
      "TIKTOK",
      actor.userId!,
      { accessToken: token, refreshToken: null, expiresAt: null, scopes: "sandbox" },
      accounts,
      viaMeta(actor),
    );
    return ok(
      `${saved.length} compte${saved.length > 1 ? "s" : ""} bac à sable connecté${saved.length > 1 ? "s" : ""}. La première synchronisation démarre dans les minutes qui viennent.`,
      { connectionIds: saved },
    );
  } catch (err) {
    return fail(`Connexion bac à sable impossible : ${describeConnectorError(err).slice(0, 300)}`, "unavailable");
  }
};

/** Prérequis du départ de l'autorisation TikTok (mêmes refus que `/api/connectors/tiktok/start`), sans rien écrire. */
export const tiktokConnect: CoreRun = async (_input, actor) => {
  const denied = adminOnly(actor, "Seuls les administrateurs peuvent connecter un compte TikTok.") ?? needUser(actor);
  if (denied) return denied;
  const app = await loadAppCredentials("TIKTOK");
  if (!app) return fail("Enregistrez d'abord l'App ID et le secret de l'application TikTok.");
  if ((app.extra as { sandbox?: boolean } | undefined)?.sandbox)
    return fail(
      "En mode bac à sable, TikTok ne passe pas par la page de connexion : utilisez le formulaire « Connecter un compte bac à sable » avec le jeton généré dans le portail.",
      "conflict",
    );
  return ok("Ouvre le lien d'autorisation TikTok, puis choisis les comptes à suivre.", {
    authPurpose: "oauth_tiktok",
    startPath: "/api/connectors/tiktok/start",
  });
};

// ---------------------------------------------------------------------------------------------- Meta

const metaAppSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, "L'App ID est un nombre (entre 6 et 20 chiffres)."),
  secret: z.string().trim().max(200).optional(),
  configId: z.string().trim().regex(/^\d*$/, "Le config_id est un nombre (ou vide).").max(30),
});

/** Enregistre l'App ID, l'App Secret (vide = inchangé) et le config_id optionnel de l'application Meta. */
export const metaSaveApp: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  // Kevin peut ne pas parler du config_id : il est alors gardé (le formulaire du site l'envoie toujours, vide ou non).
  const keepConfig = input.configId === undefined;
  const parsed = metaAppSchema.safeParse({
    clientId: input.clientId,
    secret: input.secret || undefined,
    configId: keepConfig ? "" : (input.configId ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Valeurs invalides.");
  if (opts.dryRun) {
    const state = await loadAppState("META");
    if (!parsed.data.secret && !state?.hasSecret)
      return fail("Le secret de l'application est obligatoire la première fois.", "invalid", "secret");
    return preview({
      summary: `Application Meta : App ID ${parsed.data.clientId}, secret ${parsed.data.secret ? "remplacé" : "inchangé"}${keepConfig ? "" : `, config_id ${parsed.data.configId || "vide"}`}.`,
    });
  }
  try {
    await saveAppCredentials(
      "META",
      {
        clientId: parsed.data.clientId,
        secret: parsed.data.secret || null,
        extra: keepConfig ? {} : { configId: parsed.data.configId || null },
      },
      actor.userId!,
      viaMeta(actor),
    );
  } catch (err) {
    return fail(message(err));
  }
  return ok("Application Meta enregistrée. Cliquez sur « Vérifier » pour tester les identifiants.");
};

/** Teste l'App ID / App Secret auprès de Meta (jeton d'application), sans connecter de compte. */
export const metaVerify: CoreRun = async (_input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const app = await loadAppCredentials("META");
  if (!app) return fail("Enregistrez d'abord l'App ID et l'App Secret.");
  if (opts.dryRun) return preview({ summary: "Je teste les identifiants de l'application Meta auprès de Meta (rien n'est connecté)." });
  const result = await metaProvider.verifyApp(app);
  await markAppVerified("META", result.ok ? { ok: true } : { ok: false, error: result.error });
  await audit({
    userId: actor.userId,
    action: "connector.app_verified",
    entityType: "ConnectorApp",
    entityId: "META",
    metadata: { ok: result.ok, error: result.ok ? null : result.error, ...viaMeta(actor) },
  });
  if (result.ok) return ok(`Identifiants vérifiés : ${result.detail ?? "acceptés par Meta"}. Vous pouvez connecter un compte.`);
  return fail(`Vérification refusée. ${result.error}`);
};

/** Lance une synchronisation (3 derniers jours) ou une resynchronisation de 28 jours pour une connexion. */
export const metaSync: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const full = input.mode === "full";
  let id = str(input.connectionId);
  let name: string | null = null;
  if (!id && input.account) {
    const found = await findConnection("META", input, "Connexion introuvable.");
    if (!found.ok) return found.result;
    id = found.conn.id;
    name = found.conn.name;
  }
  if (!id) return fail("Connexion introuvable.", "not_found", "connectionId");
  if (opts.dryRun)
    return preview({
      summary: full ? `Resynchronisation des 28 derniers jours${name ? ` de « ${name} »` : ""}.` : `Synchronisation${name ? ` de « ${name} »` : ""} (3 derniers jours).`,
    });
  try {
    await requestSyncNow(id, actor.userId!, full ? "full" : "recent", viaMeta(actor));
  } catch (err) {
    return fail(`Impossible de lancer la synchronisation pour le moment (${message(err)}). Réessayez dans une minute.`, "unavailable");
  }
  return ok(
    full
      ? "Resynchronisation des 28 derniers jours lancée : rechargez la page dans quelques minutes."
      : "Synchronisation lancée : rechargez la page dans une minute.",
    { connectionId: id },
  );
};

/** Déconnecte un compte : le jeton est effacé, les coûts déjà importés restent. */
export const metaDisconnect: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  let id = str(input.connectionId);
  let name: string | null = null;
  if (!id && input.account) {
    const found = await findConnection("META", input, "Connexion introuvable.");
    if (!found.ok) return found.result;
    id = found.conn.id;
    name = found.conn.name;
  }
  if (!id) return fail("Connexion introuvable.", "not_found", "connectionId");
  if (opts.dryRun) {
    const conn = name ? null : await prisma.adAccountConnection.findUnique({ where: { id }, select: { name: true } });
    if (!name && !conn) return fail("Connexion introuvable.", "not_found");
    return preview({
      summary: `Déconnexion du compte Meta « ${name ?? conn!.name} ».`,
      impact: "Le jeton est effacé ; les dépenses déjà importées sont conservées.",
    });
  }
  try {
    await disconnectConnection(id, actor.userId!, viaMeta(actor));
  } catch (err) {
    return fail(message(err), "not_found");
  }
  return ok("Compte déconnecté. Les dépenses déjà importées sont conservées.", { connectionId: id });
};

/** Comptes proposés par Meta après l'autorisation (en attente 15 minutes), pour les boutons de Kevin. */
export const metaPendingAccounts: CoreRun = async (_input, actor) => pendingAccounts("META", actor);

/** Enregistre les comptes cochés sur la page « Choisir les comptes » (jetons en attente, 15 min). */
export const metaChooseAccounts: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const pending = await loadPending("META", actor.userId!);
  if (!pending)
    return fail("La connexion Meta a expiré (15 minutes). Cliquez de nouveau sur « Connecter un compte Meta ».", "conflict");
  const accounts = chosenAccounts(pending.accounts, input.accounts);
  if (accounts.length === 0) return fail("Cochez au moins un compte à connecter.", "invalid", "accounts");
  if (opts.dryRun)
    return preview({ summary: `Je connecte ${accounts.length} compte${plural(accounts.length, "")} Meta : ${accounts.map((a) => a.name).join(", ")}.` });
  let ids: string[] = [];
  try {
    ids = await saveConnections("META", actor.userId!, pending.tokens, accounts, viaMeta(actor));
    await clearPending("META", actor.userId!);
  } catch (err) {
    return fail(`Enregistrement impossible : ${message(err)}`, "unavailable");
  }
  return ok(
    `${accounts.length} compte${accounts.length > 1 ? "s" : ""} connecté${accounts.length > 1 ? "s" : ""}, l'historique de 90 jours se charge (quelques minutes).`,
    { connectionIds: ids },
  );
};

/** Abandonne la connexion en attente (bouton « Annuler » de la page de choix). */
export const metaCancelPending: CoreRun = async (_input, actor, opts = {}) => cancelPending("META", actor, opts.dryRun);

/** Prérequis du départ de l'autorisation Meta (mêmes refus que `/api/connectors/meta/start`), sans rien écrire. */
export const metaConnect: CoreRun = async (_input, actor) => {
  const denied = adminOnly(actor, "Action réservée aux administrateurs.") ?? needUser(actor);
  if (denied) return denied;
  const app = await loadAppCredentials("META");
  if (!app)
    return fail("Enregistrez d'abord l'App ID et l'App Secret de votre application Meta (bloc « Application Meta »).");
  return ok("Ouvre le lien d'autorisation Meta, puis choisis les comptes à suivre.", {
    authPurpose: "oauth_meta",
    startPath: "/api/connectors/meta/start",
  });
};

// ---------------------------------------------------------------------------------------------- communs

async function pendingAccounts(platform: ConnectorPlatform, actor: Parameters<CoreRun>[1]) {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  const pending = await loadPending(platform, actor.userId!);
  const label = platform === "META" ? "Meta" : "TikTok";
  if (!pending) return ok(`Aucune connexion ${label} en attente de choix.`, { accounts: [] });
  return ok(`${pending.accounts.length} compte${plural(pending.accounts.length, "")} ${label} proposé${plural(pending.accounts.length, "")}.`, {
    accounts: pending.accounts.map((a) => ({ externalId: a.externalId, name: a.name, currency: a.currency ?? null })),
    createdAt: pending.createdAt,
  });
}

async function cancelPending(platform: ConnectorPlatform, actor: Parameters<CoreRun>[1], dryRun?: boolean) {
  const denied = adminOnly(actor) ?? needUser(actor);
  if (denied) return denied;
  if (dryRun) return preview({ summary: `J'abandonne la connexion ${platform === "META" ? "Meta" : "TikTok"} en attente (aucun compte ajouté).` });
  await clearPending(platform, actor.userId!);
  await audit({
    userId: actor.userId,
    action: "connector.pending_cancelled",
    entityType: "ConnectorApp",
    entityId: platform,
    metadata: { platform, ...viaMeta(actor) },
  });
  return ok("Connexion annulée : aucun compte n'a été ajouté.");
}

