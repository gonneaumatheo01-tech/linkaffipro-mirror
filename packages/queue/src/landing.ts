import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { enqueue, getRedis } from "./client";
import type { JobOf, LandingEventData } from "./jobs";

/**
 * Pages d'atterrissage (phase 15) : mise en file des visites et clics (`landing-events`) et invalidation du HTML gardé en
 * mémoire par le service web (canal Redis `landing:invalidate`). Contrat : `docs/PAGES-ATTERRISSAGE.md`.
 *
 * Rien ici ne lève d'erreur pour l'appelant : la page publique répond toujours tout de suite, même si Redis est coupé.
 */

// ─── Visites, clics, ouvertures : file `landing-events` ──────────────────────────────────────────────────────────

/** Ce que le site met en file ; `id` et `createdAt` sont complétés s'ils manquent, les champs absents valent null. */
export type LandingEventInput = Pick<
  LandingEventData,
  "landingPageId" | "type" | "visitId" | "sourceKey" | "isBot"
> &
  Partial<
    Omit<
      LandingEventData,
      "landingPageId" | "type" | "visitId" | "sourceKey" | "isBot" | "createdAt"
    >
  > & {
    createdAt?: Date | string;
  };

/** Longueurs maximales gardées (le reste est coupé) : aucune ligne démesurée, même avec un envoi trafiqué. */
const MAX = {
  id: 64,
  landingPageId: 64,
  visitId: 64,
  sourceKey: 32,
  rawSrc: 64,
  os: 16,
  inApp: 16,
  method: 32,
  ipHash: 128,
  ttclid: 512,
  fbclid: 512,
  userAgent: 512,
} as const;

function cut(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Identifiant aléatoire d'une ligne `LandingEvent` (« le_… », 24 octets en base64url). */
function newEventId(): string {
  return `le_${randomBytes(18).toString("base64url")}`;
}

function isoOr(v: Date | string | undefined, now: Date): string {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : now.toISOString();
}

/**
 * Ligne `LandingEvent` prête à écrire : identifiant fixé (une reprise n'écrit jamais deux fois), heure de réception,
 * champs coupés à une longueur raisonnable, pays en deux lettres majuscules ou null. Ne recopie que les champs connus
 * (une adresse IP passée par erreur n'est jamais gardée).
 */
export function landingEventData(
  input: LandingEventInput,
  now: Date = new Date(),
): LandingEventData {
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  return {
    id: cut(input.id, MAX.id) ?? newEventId(),
    landingPageId: cut(input.landingPageId, MAX.landingPageId) ?? "",
    type: input.type,
    visitId: cut(input.visitId, MAX.visitId) ?? "",
    sourceKey:
      typeof input.sourceKey === "string" ? input.sourceKey.trim().slice(0, MAX.sourceKey) : "",
    rawSrc: cut(input.rawSrc, MAX.rawSrc),
    os: cut(input.os, MAX.os),
    inApp: cut(input.inApp, MAX.inApp),
    method: cut(input.method, MAX.method),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    ipHash: cut(input.ipHash, MAX.ipHash),
    isBot: input.isBot === true,
    ttclid: cut(input.ttclid, MAX.ttclid),
    fbclid: cut(input.fbclid, MAX.fbclid),
    userAgent: cut(input.userAgent, MAX.userAgent),
    createdAt: isoOr(input.createdAt, now),
  };
}

export type EnqueueLandingEventResult = { ok: true; id: string } | { ok: false; error: string };

export type EnqueueLandingEventDeps = {
  /** Ajout dans la file (par défaut `enqueue("landing-events", …)`). */
  add?: (
    data: JobOf<"landing-events">,
    opts: { jobId: string; removeOnComplete: number; removeOnFail: number },
  ) => unknown;
  now?: () => Date;
  /** Délai maximal d'attente de Redis (par défaut 2 s) : au-delà, `{ ok: false }` (la commande peut encore partir). */
  timeoutMs?: number;
};

/** Journal limité : au plus un avertissement par minute et par sujet (Redis coupé = des milliers de visites). */
const lastWarn = new Map<string, { at: number; skipped: number }>();
function warnThrottled(topic: string, message: string, detail: Record<string, unknown>): void {
  const now = Date.now();
  const w = lastWarn.get(topic);
  if (w && now - w.at < 60_000) {
    w.skipped += 1;
    return;
  }
  console.warn(message, {
    ...detail,
    ...(w?.skipped ? { skippedSinceLastWarning: w.skipped } : {}),
  });
  lastWarn.set(topic, { at: now, skipped: 0 });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis ne répond pas (${ms} ms)`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Met en file une visite, un clic ou une ouverture (file `landing-events`, écrite par le worker). Ne lève jamais ;
 * à appeler SANS l'attendre dans la réponse de `/j/_e` (204 tout de suite). Identifiant de tâche
 * `landing-event:<id>` : un même événement n'est jamais mis deux fois en file.
 */
export async function enqueueLandingEvent(
  input: LandingEventInput,
  deps: EnqueueLandingEventDeps = {},
): Promise<EnqueueLandingEventResult> {
  try {
    const event = landingEventData(input, deps.now?.() ?? new Date());
    const add =
      deps.add ??
      ((
        data: JobOf<"landing-events">,
        opts: { jobId: string; removeOnComplete: number; removeOnFail: number },
      ) => enqueue("landing-events", data, opts));
    await withTimeout(
      Promise.resolve().then(() =>
        add(
          { type: "event", event },
          { jobId: `landing-event:${event.id}`, removeOnComplete: 200, removeOnFail: 2000 },
        ),
      ),
      deps.timeoutMs ?? 2000,
    );
    return { ok: true, id: event.id };
  } catch (err) {
    const error = errorText(err);
    warnThrottled("enqueue", "[landing-events] visite ou clic non mis en file", { error });
    return { ok: false, error };
  }
}

// ─── Invalidation du HTML en mémoire : canal Redis `landing:invalidate` ──────────────────────────────────────────

/** Canal Redis de l'invalidation des pages gardées en mémoire par le service web. */
export const LANDING_INVALIDATE_CHANNEL = "landing:invalidate";

/**
 * Ce qui a changé : une page (`pageId`), toutes les pages d'un canal (`channelId` : titre ou photo du canal), ou tout
 * (`all`). Plusieurs champs à la fois sont permis ; un message sans rien de lisible vaut « tout ».
 */
export type LandingInvalidateMessage = { pageId?: string; channelId?: string; all?: boolean };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeMessage(m: Record<string, unknown>): LandingInvalidateMessage {
  const out: LandingInvalidateMessage = {};
  if (typeof m.pageId === "string" && ID_RE.test(m.pageId)) out.pageId = m.pageId;
  if (typeof m.channelId === "string" && ID_RE.test(m.channelId)) out.channelId = m.channelId;
  if (m.all === true || (!out.pageId && !out.channelId)) return { all: true };
  return out;
}

/** Lit un message reçu sur le canal (null : illisible, ignoré). */
export function parseLandingInvalidate(raw: string): LandingInvalidateMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return normalizeMessage(v as Record<string, unknown>);
}

export type PublishLandingInvalidateDeps = {
  /** Connexion qui publie (par défaut la connexion partagée `getRedis()`). */
  redis?: { publish(channel: string, message: string): Promise<unknown> };
  getRedis?: () => { publish(channel: string, message: string): Promise<unknown> };
  timeoutMs?: number;
};

/**
 * Publie une invalidation (à chaque enregistrement d'une page ou d'une source, à chaque changement de titre ou de photo
 * d'un canal). Ne lève jamais : renvoie false si Redis n'a pas répondu (les pages en mémoire expirent de toute façon).
 */
export async function publishLandingInvalidate(
  msg: LandingInvalidateMessage,
  deps: PublishLandingInvalidateDeps = {},
): Promise<boolean> {
  try {
    const redis = deps.redis ?? (deps.getRedis ?? getRedis)();
    const body = JSON.stringify(normalizeMessage(msg as Record<string, unknown>));
    await withTimeout(
      Promise.resolve().then(() => redis.publish(LANDING_INVALIDATE_CHANNEL, body)),
      deps.timeoutMs ?? 2000,
    );
    return true;
  } catch (err) {
    warnThrottled("publish", "[landing] invalidation non publiée", { error: errorText(err) });
    return false;
  }
}

/** Client d'abonnement (sous-ensemble d'ioredis) : facile à simuler dans les tests. */
export type LandingSubscriberClient = {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  on(event: "ready", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  quit(): Promise<unknown>;
};

export type LandingInvalidateSubscription = { close(): Promise<void> };

export type SubscribeLandingInvalidateOptions = {
  /** Client fourni (tests) ; fermé par `close()`. Par défaut : une connexion Redis dédiée (`REDIS_URL`). */
  client?: LandingSubscriberClient;
  /** Adresse Redis (par défaut `REDIS_URL`) ; vide : abonnement inactif. */
  url?: string;
};

/**
 * S'abonne aux invalidations, sur une connexion Redis DÉDIÉE (une connexion abonnée ne sert à rien d'autre), avec
 * reconnexion automatique. Après chaque abonnement confirmé (démarrage et chaque reconnexion), `handler({ all: true })`
 * est appelé : les messages publiés pendant une coupure sont perdus, tout ce qui est en mémoire est donc vidé. Une erreur
 * du gestionnaire ou de Redis ne lève jamais. À appeler une seule fois par processus (garder l'abonnement dans
 * `globalThis` côté Next.js, le rechargement à chaud du développement réexécute les modules).
 */
export function subscribeLandingInvalidate(
  handler: (msg: LandingInvalidateMessage) => void,
  opts: SubscribeLandingInvalidateOptions = {},
): LandingInvalidateSubscription {
  let client = opts.client;
  if (!client) {
    const url = opts.url ?? process.env.REDIS_URL;
    if (!url) {
      console.warn(
        "[landing] REDIS_URL manquante : pages en mémoire sans invalidation (expiration seulement)",
      );
      return { close: async () => undefined };
    }
    client = new Redis(url, {
      maxRetriesPerRequest: null,
      family: 0,
      autoResubscribe: true,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    }) as unknown as LandingSubscriberClient;
  }
  const sub = client;
  let closed = false;

  const deliver = (msg: LandingInvalidateMessage) => {
    if (closed) return;
    try {
      handler(msg);
    } catch (err) {
      warnThrottled("handler", "[landing] invalidation non appliquée", { error: errorText(err) });
    }
  };
  // Un abonnement en cours (démarrage : la commande attend la connexion) n'est pas doublé par l'événement « ready ».
  let inFlight = false;
  const subscribe = () => {
    if (closed || inFlight) return;
    inFlight = true;
    Promise.resolve()
      .then(() => sub.subscribe(LANDING_INVALIDATE_CHANNEL))
      .then(
        () => deliver({ all: true }),
        (err: unknown) =>
          warnThrottled(
            "subscribe",
            "[landing] abonnement aux invalidations impossible pour le moment",
            {
              error: errorText(err),
            },
          ),
      )
      .finally(() => {
        inFlight = false;
      });
  };

  sub.on("message", (channel, message) => {
    if (channel !== LANDING_INVALIDATE_CHANNEL) return;
    const msg = parseLandingInvalidate(message);
    if (msg) deliver(msg);
  });
  sub.on("ready", subscribe);
  sub.on("error", (err) =>
    warnThrottled("redis", "[landing] Redis (abonnement)", { error: errorText(err) }),
  );
  subscribe();

  return {
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.resolve()
        .then(() => sub.quit())
        .catch(() => undefined);
    },
  };
}
