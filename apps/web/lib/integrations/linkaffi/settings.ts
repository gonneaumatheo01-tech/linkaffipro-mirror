import {
  decrypt,
  encrypt,
  generateIntegrationApiKey,
  generateWebhookSecret,
  hashIntegrationApiKey,
  integrationApiKeyPrefix,
  isLinkaffiQueueStuck,
  LINKAFFI_EVENTS_URL_DEFAULT,
} from "@linkaffipro/core";
import { audit, prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { LINKAFFI_PROVIDER } from "./auth";
import { sendLinkaffiTestEvent, type LinkaffiTestResult } from "./test-event";

/**
 * Réglages → Connexions → « Campagnes Telegram des affiliés » (phase 13, ADMIN seulement) :
 * - clé de connexion (ce que Link Affi envoie pour appeler notre API) : générée ici, montrée UNE fois, stockée en
 *   empreinte (SHA-256) ; régénérer rend l'ancienne aussitôt invalide ;
 * - secret de signature (ce qui signe nos événements) : généré ici, montré UNE fois, stocké chiffré (AES-256-GCM,
 *   `APP_ENCRYPTION_KEY`) ; régénérer remplace l'ancien pour les prochains envois ;
 * - adresse de la fonction Link Affi `telegram-events` (par défaut `LINKAFFI_EVENTS_URL_DEFAULT`) ;
 * - état de la file des événements, et l'envoi d'un événement de test.
 * Journal : `integration.linkaffi_key_generated`, `integration.linkaffi_secret_generated`,
 * `integration.linkaffi_events_url_changed`, `integration.linkaffi_test_sent` (jamais la clé ni le secret).
 * Après un réglage corrigé (nouveau secret, nouvelle adresse, test reçu), les événements qui attendaient leur prochain
 * essai repartent aussitôt (`releaseWaitingLinkaffiEvents`).
 */

/** Clé anon de Link Affi (en-têtes `apikey` et `Authorization` des événements), variable d'environnement. */
export function linkaffiAnonKey(): string | null {
  return process.env.LINKAFFI_ANON_KEY?.trim() || null;
}

export type GeneratedValue = { value: string; prefix: string; regenerated: boolean };

/**
 * Marge au-delà de laquelle un prochain essai est une attente (et non un envoi en cours) : le service d'arrière-plan
 * réserve un événement 2 minutes pendant son envoi (`nextAttemptAt` = maintenant + 2 min) ; on ne touche jamais à une
 * réservation (aucun doublon). Les attentes courtes (30 s à 2 min) repartent d'elles-mêmes.
 */
const IN_FLIGHT_MARGIN_MS = 3 * 60_000;

/**
 * Le réglage vient d'être corrigé (nouveau secret, nouvelle adresse, test reçu) : les événements en attente de leur
 * prochain essai (attente croissante jusqu'à 2 h) repartent tout de suite, et un passage de la file est demandé (il
 * envoie du plus ancien au plus récent et s'arrête au premier refus général : sans risque). Renvoie leur nombre.
 * Ne lève jamais (un échec laisse simplement les essais prévus).
 */
export async function releaseWaitingLinkaffiEvents(now = new Date()): Promise<number> {
  try {
    const r = await prisma.linkaffiEvent.updateMany({
      where: {
        status: "PENDING",
        nextAttemptAt: { gt: new Date(now.getTime() + IN_FLIGHT_MARGIN_MS) },
      },
      data: { nextAttemptAt: now },
    });
    await enqueue("linkaffi-events", { type: "tick" }).catch((err: Error) =>
      console.warn("[integration linkaffi] passage de la file non demandé", { error: err.message }),
    );
    return r.count;
  } catch (err) {
    console.warn("[integration linkaffi] reprise des événements en attente impossible", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/** Nouvelle clé de connexion pour Link Affi : l'ancienne ne marche plus. Renvoie la clé (à montrer une seule fois). */
export async function generateLinkaffiApiKey(
  userId: string,
  auditMeta: Record<string, unknown> = {},
): Promise<GeneratedValue> {
  const key = generateIntegrationApiKey();
  const prefix = integrationApiKeyPrefix(key);
  const before = await prisma.integrationKey.findUnique({
    where: { provider: LINKAFFI_PROVIDER },
    select: { apiKeyHash: true },
  });
  const data = {
    apiKeyHash: hashIntegrationApiKey(key),
    apiKeyPrefix: prefix,
    apiKeyCreatedAt: new Date(),
    apiKeyCreatedById: userId,
  };
  await prisma.integrationKey.upsert({
    where: { provider: LINKAFFI_PROVIDER },
    create: { provider: LINKAFFI_PROVIDER, ...data },
    update: data,
  });
  const regenerated = !!before?.apiKeyHash;
  await audit({
    userId,
    action: "integration.linkaffi_key_generated",
    entityType: "IntegrationKey",
    entityId: LINKAFFI_PROVIDER,
    metadata: { prefix, regenerated, ...auditMeta },
  });
  return { value: key, prefix, regenerated };
}

/** Nouveau secret de signature des événements (stocké chiffré). Renvoie le secret (à montrer une seule fois). */
export async function generateLinkaffiWebhookSecret(
  userId: string,
  auditMeta: Record<string, unknown> = {},
): Promise<GeneratedValue> {
  const secret = generateWebhookSecret();
  const before = await prisma.integrationKey.findUnique({
    where: { provider: LINKAFFI_PROVIDER },
    select: { webhookSecretEncrypted: true },
  });
  const data = { webhookSecretEncrypted: encrypt(secret), webhookSecretCreatedAt: new Date() };
  await prisma.integrationKey.upsert({
    where: { provider: LINKAFFI_PROVIDER },
    create: { provider: LINKAFFI_PROVIDER, ...data },
    update: data,
  });
  const regenerated = !!before?.webhookSecretEncrypted;
  const released = await releaseWaitingLinkaffiEvents();
  await audit({
    userId,
    action: "integration.linkaffi_secret_generated",
    entityType: "IntegrationKey",
    entityId: LINKAFFI_PROVIDER,
    metadata: { regenerated, released, ...auditMeta },
  });
  return { value: secret, prefix: `${secret.slice(0, 14)}…`, regenerated };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Adresse saisie pour la fonction `telegram-events` : https obligatoire (http seulement vers cette machine, hors
 * production, pour les essais) ; vide = adresse d'origine (null). Message en français sinon.
 */
export function parseEventsUrl(
  raw: unknown,
  opts: { production?: boolean } = {},
): { url: string | null } | { error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { url: null };
  if (text.length > 500) return { error: "Adresse trop longue : 500 caractères au plus." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return {
      error: "Adresse illisible : collez l'adresse complète, qui commence par https://.",
    };
  }
  const local = LOCAL_HOSTS.has(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local && !opts.production))
    return { error: "L'adresse doit commencer par https:// (connexion chiffrée)." };
  if (u.username || u.password)
    return { error: "L'adresse ne doit pas contenir d'identifiant ni de mot de passe." };
  const url = u.toString();
  return { url: url === LINKAFFI_EVENTS_URL_DEFAULT ? null : url };
}

/** Enregistre l'adresse de la fonction `telegram-events` (vide = adresse d'origine). */
export async function saveLinkaffiEventsUrl(
  userId: string,
  raw: unknown,
  auditMeta: Record<string, unknown> = {},
): Promise<{ ok: true; url: string; isDefault: boolean } | { ok: false; error: string }> {
  const parsed = parseEventsUrl(raw, { production: process.env.NODE_ENV === "production" });
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const before = await prisma.integrationKey.findUnique({
    where: { provider: LINKAFFI_PROVIDER },
    select: { eventsUrl: true },
  });
  const from = before?.eventsUrl ?? null;
  if (from !== parsed.url) {
    await prisma.integrationKey.upsert({
      where: { provider: LINKAFFI_PROVIDER },
      create: { provider: LINKAFFI_PROVIDER, eventsUrl: parsed.url },
      update: { eventsUrl: parsed.url },
    });
    const released = await releaseWaitingLinkaffiEvents();
    await audit({
      userId,
      action: "integration.linkaffi_events_url_changed",
      entityType: "IntegrationKey",
      entityId: LINKAFFI_PROVIDER,
      metadata: {
        from: from ?? LINKAFFI_EVENTS_URL_DEFAULT,
        to: parsed.url ?? LINKAFFI_EVENTS_URL_DEFAULT,
        released,
        ...auditMeta,
      },
    });
  }
  return {
    ok: true,
    url: parsed.url ?? LINKAFFI_EVENTS_URL_DEFAULT,
    isDefault: parsed.url === null,
  };
}

export type LinkaffiQueueState = {
  pending: number;
  sent24h: number;
  failed7d: number;
  oldestPendingAt: Date | null;
  stuck: boolean;
};

/** Ce qu'affiche la sous-section (jamais la clé ni le secret : seulement leur début et leur date). */
export type LinkaffiIntegrationState = {
  keyPrefix: string | null;
  keyCreatedAt: Date | null;
  keyCreatedBy: string | null;
  hasSecret: boolean;
  secretCreatedAt: Date | null;
  eventsUrl: string;
  eventsUrlIsDefault: boolean;
  lastApiCallAt: Date | null;
  lastEventSentAt: Date | null;
  /** La clé anon de Link Affi est connue du site (sinon le test ne peut pas partir d'ici). */
  anonKeyReady: boolean;
  queue: LinkaffiQueueState;
};

export async function loadLinkaffiQueueState(now = new Date()): Promise<LinkaffiQueueState> {
  const [pending, sent24h, failed7d, oldest] = await Promise.all([
    prisma.linkaffiEvent.count({ where: { status: "PENDING" } }),
    prisma.linkaffiEvent.count({
      where: { status: "SENT", sentAt: { gte: new Date(now.getTime() - 86_400_000) } },
    }),
    prisma.linkaffiEvent.count({
      where: { status: "FAILED", updatedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
    }),
    prisma.linkaffiEvent.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const oldestPendingAt = oldest?.createdAt ?? null;
  return {
    pending,
    sent24h,
    failed7d,
    oldestPendingAt,
    stuck: isLinkaffiQueueStuck(oldestPendingAt, now),
  };
}

export async function loadLinkaffiIntegrationState(
  now = new Date(),
): Promise<LinkaffiIntegrationState> {
  const [row, queue] = await Promise.all([
    prisma.integrationKey.findUnique({
      where: { provider: LINKAFFI_PROVIDER },
      select: {
        apiKeyPrefix: true,
        apiKeyHash: true,
        apiKeyCreatedAt: true,
        apiKeyCreatedById: true,
        webhookSecretEncrypted: true,
        webhookSecretCreatedAt: true,
        eventsUrl: true,
        lastApiCallAt: true,
        lastEventSentAt: true,
      },
    }),
    loadLinkaffiQueueState(now),
  ]);
  const creator = row?.apiKeyCreatedById
    ? await prisma.user.findUnique({ where: { id: row.apiKeyCreatedById }, select: { name: true } })
    : null;
  return {
    keyPrefix: row?.apiKeyHash ? (row.apiKeyPrefix ?? "…") : null,
    keyCreatedAt: row?.apiKeyHash ? (row.apiKeyCreatedAt ?? null) : null,
    keyCreatedBy: creator?.name ?? null,
    hasSecret: !!row?.webhookSecretEncrypted,
    secretCreatedAt: row?.webhookSecretEncrypted ? (row.webhookSecretCreatedAt ?? null) : null,
    eventsUrl: row?.eventsUrl ?? LINKAFFI_EVENTS_URL_DEFAULT,
    eventsUrlIsDefault: !row?.eventsUrl,
    lastApiCallAt: row?.lastApiCallAt ?? null,
    lastEventSentAt: row?.lastEventSentAt ?? null,
    anonKeyReady: !!linkaffiAnonKey(),
    queue,
  };
}

/** « 3 événements en attente repartent maintenant. » */
export function releasedSentence(n: number): string {
  return n > 1
    ? `${n} événements en attente repartent maintenant.`
    : "1 événement en attente repart maintenant.";
}

/** Prérequis de l'événement de test (secret généré, clé publique connue), sans rien envoyer : sert aussi à l'essai à blanc. */
export async function linkaffiTestPrerequisites(): Promise<
  | { ok: false; error: string }
  | { ok: true; row: { webhookSecretEncrypted: string; eventsUrl: string | null }; anonKey: string }
> {
  const row = await prisma.integrationKey.findUnique({
    where: { provider: LINKAFFI_PROVIDER },
    select: { webhookSecretEncrypted: true, eventsUrl: true },
  });
  if (!row?.webhookSecretEncrypted)
    return {
      ok: false,
      error:
        "Générez d'abord le secret de signature (étape 1), collez-le dans Link Affi, puis envoyez le test.",
    };
  const anonKey = linkaffiAnonKey();
  if (!anonKey)
    return {
      ok: false,
      error:
        "Le site ne connaît pas encore la clé d'accès publique de Link Affi : l'administrateur technique doit l'ajouter au site. Les vrais événements, eux, partent quand même.",
    };
  return { ok: true, row: { webhookSecretEncrypted: row.webhookSecretEncrypted, eventsUrl: row.eventsUrl }, anonKey };
}

export type LinkaffiTestRun =
  | { ok: false; error: string }
  | ({ ok: true } & Pick<LinkaffiTestResult, "outcome" | "status" | "durationMs" | "message">);

/** « Envoyer un événement de test » : prérequis, envoi signé immédiat, journal. */
export async function runLinkaffiTestEvent(
  userId: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; auditMeta?: Record<string, unknown> } = {},
): Promise<LinkaffiTestRun> {
  const { auditMeta = {}, ...sendOpts } = opts;
  const pre = await linkaffiTestPrerequisites();
  if (!pre.ok) return pre;
  const { row, anonKey } = pre;
  let secret: string;
  try {
    secret = decrypt(row.webhookSecretEncrypted);
  } catch {
    return {
      ok: false,
      error:
        "Le secret de signature enregistré est illisible (clé de chiffrement changée) : générez-en un nouveau et collez-le dans Link Affi.",
    };
  }
  const url = row.eventsUrl ?? LINKAFFI_EVENTS_URL_DEFAULT;
  const r = await sendLinkaffiTestEvent({ url, secret, anonKey, ...sendOpts });
  // Link Affi accepte la signature : ce qui attendait un nouvel essai repart tout de suite.
  const released = r.outcome === "received" ? await releaseWaitingLinkaffiEvents() : 0;
  await audit({
    userId,
    action: "integration.linkaffi_test_sent",
    entityType: "IntegrationKey",
    entityId: LINKAFFI_PROVIDER,
    metadata: {
      outcome: r.outcome,
      status: r.status,
      durationMs: r.durationMs,
      eventId: r.eventId,
      url,
      released,
      ...auditMeta,
    },
  });
  return {
    ok: true,
    outcome: r.outcome,
    status: r.status,
    durationMs: r.durationMs,
    message: released > 0 ? `${r.message} ${releasedSentence(released)}` : r.message,
  };
}
