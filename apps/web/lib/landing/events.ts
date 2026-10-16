import { createHash, randomBytes } from "node:crypto";
import {
  detectInApp,
  detectLandingOs,
  hashIp,
  isLandingBotUserAgent,
  isLandingEventKind,
  isValidVisitId,
  normalizeLandingMethod,
  normalizeSourceKey,
  type LandingEventKind,
} from "@linkaffipro/core";
import { enqueue, enqueueLandingEvent, getRedis, type LandingEventInput } from "@linkaffipro/queue";
import { landingCache, type LandingCache } from "./cache";
import { clientIp, countryOfIp } from "./geo";

/**
 * Envoi des visites, clics et ouvertures par la page (`POST /j/_e`, `navigator.sendBeacon`), phase 15 (décision D4).
 * La route répond 204 tout de suite ; ce qui suit tourne APRÈS la réponse (`after()`) : jamais d'écriture en base,
 * l'événement part dans la file `landing-events` (écrit par le worker). L'adresse IP sert seulement à l'empreinte
 * (`hashIp`, sel `IP_HASH_SALT`), au pays (base locale) et à la limite d'envois (empreinte en mémoire, sel tiré au
 * démarrage) : elle n'est ni gardée ni mise en file.
 *
 * Garde-fous (un concurrent peut fabriquer des envois : l'identifiant de la page est dans son HTML public) : au plus
 * `LANDING_BEACON_LIMITS.perIpPerMinute` envois par minute et par adresse (IPv6 : par bloc /64), et par visite au plus
 * 3 VIEW, 10 CLICK, 10 OPENED, 10 HELP, 3 ESCAPED, 3 AUTO_OPEN (phase 16) ; au-delà, l'envoi est ignoré
 * (avertissement limité). Redis coupé : rien n'est empilé en mémoire (la connexion n'est pas prête, ou trop d'ajouts
 * attendent déjà) ; la page, elle, reste servie.
 */

/** Taille maximale lue d'un envoi (le script en envoie ~200 octets ; `ttclid` / `fbclid` peuvent être longs). */
export const LANDING_BEACON_MAX_BYTES = 4096;

/**
 * Ce que la page envoie (`JSON.stringify` dans `LANDING_SCRIPT`). Phase 16 : HELP (aide affichée, `method` = appli),
 * ESCAPED (page rouverte hors de l'appli, `visitId` = `vid` de l'adresse, `method` = TGO / VID ; sans `vid`,
 * TTCLID / FBCLID, rattachée par le worker à la visite de l'appli au même identifiant) et AUTO_OPEN (ouverture
 * automatique tentée, `method` = AUTO_TG / AUTO_INTENT).
 */
export type LandingBeacon = {
  pageId: string;
  /** Source retenue par la page ("" = défaut), telle qu'écrite dans le HTML. */
  sourceKey: string;
  visitId: string;
  type: LandingEventKind;
  method: string | null;
  /** `?src=` de l'adresse quand il n'a pas été suivi (diagnostic). */
  rawSrc: string | null;
  ttclid: string | null;
  fbclid: string | null;
};

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Lit un envoi ; null s'il est illisible ou incomplet (ignoré sans bruit). */
export function parseLandingBeacon(raw: string): LandingBeacon | null {
  if (!raw || raw.length > LANDING_BEACON_MAX_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const pageId = typeof o.p === "string" ? o.p : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) return null;
  if (!isValidVisitId(o.v) || !isLandingEventKind(o.t)) return null;
  // Clé de source : "" (défaut) ou une clé valide (en minuscules) ; sinon "" et la valeur reçue gardée pour le diagnostic.
  const rawKey = typeof o.s === "string" ? o.s : "";
  const key = rawKey === "" ? "" : normalizeSourceKey(rawKey);
  let params: URLSearchParams;
  try {
    const q = typeof o.q === "string" ? o.q.slice(0, 2048) : "";
    params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
  } catch {
    params = new URLSearchParams();
  }
  const srcParam = str(params.get("src"), 64);
  const sourceKey = key ?? "";
  const followed =
    srcParam !== null && normalizeSourceKey(srcParam) === sourceKey && sourceKey !== "";
  return {
    pageId,
    sourceKey,
    visitId: o.v,
    type: o.t,
    method: o.t === "VIEW" ? null : normalizeLandingMethod(o.m),
    rawSrc: key === null ? str(rawKey, 64) : srcParam && !followed ? srcParam : null,
    ttclid: str(params.get("ttclid"), 512),
    fbclid: str(params.get("fbclid"), 512),
  };
}

/** Corps d'un envoi, coupé à `LANDING_BEACON_MAX_BYTES` (un corps plus long est refusé). */
export async function readBeaconBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > LANDING_BEACON_MAX_BYTES) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > LANDING_BEACON_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** L'envoi vient-il d'une page servie par ce même site (en-tête `Origin` présent et d'un autre hôte : refusé) ? */
export function sameOriginBeacon(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return true;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Ce qui est gardé de la requête (lu avant la réponse : les en-têtes ne servent plus après). */
export type BeaconRequestInfo = {
  userAgent: string | null;
  ip: string | null;
  sameOrigin: boolean;
  receivedAt: Date;
};

export function beaconRequestInfo(req: Request, now: Date = new Date()): BeaconRequestInfo {
  return {
    userAgent: req.headers.get("user-agent"),
    ip: clientIp(req.headers),
    sameOrigin: sameOriginBeacon(req.headers),
    receivedAt: now,
  };
}

/** Ligne à mettre en file (sans adresse IP). */
export function landingEventInput(
  beacon: LandingBeacon,
  info: BeaconRequestInfo,
  extra: { country: string | null },
): LandingEventInput {
  const ua = info.userAgent;
  let ipHash: string | null = null;
  if (info.ip && process.env.IP_HASH_SALT) {
    try {
      ipHash = hashIp(info.ip);
    } catch {
      ipHash = null;
    }
  }
  return {
    landingPageId: beacon.pageId,
    // Les six types de `LandingEventType` (phase 16) ; la file les recopie tels quels (`landingEventData`).
    type: beacon.type as LandingEventInput["type"],
    visitId: beacon.visitId,
    sourceKey: beacon.sourceKey,
    rawSrc: beacon.rawSrc,
    os: detectLandingOs(ua),
    inApp: detectInApp(ua),
    method: beacon.method,
    country: extra.country,
    ipHash,
    isBot: isLandingBotUserAgent(ua),
    ttclid: beacon.ttclid,
    fbclid: beacon.fbclid,
    userAgent: ua,
    createdAt: info.receivedAt,
  };
}

export type RecordBeaconResult =
  "queued" | "ignored" | "rate-limited" | "unknown-page" | "queue-unavailable" | "queue-error";

// ─── Limite des envois ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Limites des envois `/j/_e` (une vraie visite en envoie 2 à 5 : VIEW, CLICK, HELP, parfois OPENED ; rouverte hors de
 * l'appli : ESCAPED, AUTO_OPEN, parfois CLICK et OPENED).
 */
export const LANDING_BEACON_LIMITS = {
  /** Envois par minute et par adresse (IPv6 : bloc /64) ; large pour les adresses partagées des opérateurs. */
  perIpPerMinute: 60,
  /** Envois gardés par visite (`visitId`) et par type. */
  perVisit: {
    VIEW: 3,
    CLICK: 10,
    OPENED: 10,
    HELP: 10,
    ESCAPED: 3,
    AUTO_OPEN: 3,
  } satisfies Record<LandingEventKind, number>,
  /** Durée pendant laquelle une visite est suivie. */
  visitMemoryMs: 30 * 60_000,
  /** Mémoire bornée : au-delà, les entrées expirées sont retirées, puis tout est oublié. */
  maxIps: 50_000,
  maxVisits: 200_000,
} as const;

/** Bloc d'une adresse pour la limite : l'IPv4 entière, les 4 premiers groupes d'une IPv6 (/64, un abonné). */
export function ipBucket(ip: string | null): string {
  if (!ip) return "?";
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":");
}

/**
 * Limiteur en mémoire du processus web (aucune écriture, aucune adresse en clair : empreinte salée par un sel tiré au
 * démarrage). Fenêtre fixe d'une minute par adresse, compteurs par visite gardés 30 minutes.
 */
export class LandingBeaconLimiter {
  private readonly salt = randomBytes(16).toString("hex");
  private ips = new Map<string, { start: number; count: number }>();
  private visits = new Map<string, { until: number; counts: Record<LandingEventKind, number> }>();

  /** L'envoi est-il accepté ? (compté même s'il est refusé ensuite pour une autre raison) */
  allow(
    ip: string | null,
    pageId: string,
    visitId: string,
    type: LandingEventKind,
    now = Date.now(),
  ): boolean {
    const L = LANDING_BEACON_LIMITS;
    const key = createHash("sha256")
      .update(`${this.salt}:${ipBucket(ip)}`)
      .digest("base64url")
      .slice(0, 22);
    let w = this.ips.get(key);
    if (!w || now - w.start >= 60_000) {
      if (!w && this.ips.size >= L.maxIps) this.prune(now);
      w = { start: now, count: 0 };
      this.ips.set(key, w);
    }
    w.count++;
    if (w.count > L.perIpPerMinute) return false;
    const vkey = `${pageId}:${visitId}`;
    let v = this.visits.get(vkey);
    if (!v || v.until <= now) {
      if (!v && this.visits.size >= L.maxVisits) this.prune(now);
      v = {
        until: now + L.visitMemoryMs,
        counts: { VIEW: 0, CLICK: 0, OPENED: 0, HELP: 0, ESCAPED: 0, AUTO_OPEN: 0 },
      };
      this.visits.set(vkey, v);
    }
    v.counts[type]++;
    return v.counts[type] <= L.perVisit[type];
  }

  private prune(now: number): void {
    for (const [k, w] of this.ips) if (now - w.start >= 60_000) this.ips.delete(k);
    for (const [k, v] of this.visits) if (v.until <= now) this.visits.delete(k);
    if (this.ips.size >= LANDING_BEACON_LIMITS.maxIps) this.ips.clear();
    if (this.visits.size >= LANDING_BEACON_LIMITS.maxVisits) this.visits.clear();
  }

  size(): { ips: number; visits: number } {
    return { ips: this.ips.size, visits: this.visits.size };
  }
}

const limiter = new LandingBeaconLimiter();

// ─── Redis coupé : rien d'empilé en mémoire ──────────────────────────────────────────────────────────────────────

/** Ajouts dans la file qui attendent encore Redis (la connexion garde les commandes tant que Redis est coupé). */
export const LANDING_MAX_PENDING_ADDS = 2000;
let pendingAdds = 0;

/** États de la connexion Redis où un ajout peut partir (démarrage compris) ; coupée : `reconnecting`, `close`, `end`. */
const REDIS_USABLE = new Set(["ready", "connect", "connecting", "wait"]);

function defaultQueueState(): string | null {
  try {
    return getRedis().status;
  } catch {
    // Pas de connexion possible (adresse absente) : l'ajout échouera de lui-même, sans rien empiler.
    return null;
  }
}

const skipped = { at: 0, count: 0 };
function warnSkipped(reason: string): void {
  skipped.count++;
  const now = Date.now();
  if (now - skipped.at < 60_000) return;
  console.warn("[landing] envois de visites ignorés", { reason, sinceLastWarning: skipped.count });
  skipped.at = now;
  skipped.count = 0;
}

export type RecordBeaconDeps = {
  cache?: LandingCache;
  country?: (ip: string | null) => Promise<string | null>;
  limiter?: LandingBeaconLimiter;
  /** État de la connexion Redis des files (par défaut `getRedis().status`). */
  queueState?: () => string | null;
  /** Ajout dans la file (par défaut `enqueue("landing-events", …)`). */
  enqueue?: typeof enqueue;
  maxPendingAdds?: number;
};

/**
 * Après la réponse : vérifie l'envoi (page connue, même site, limites), calcule pays et empreinte, met en file. Ne
 * lève jamais.
 */
export async function recordLandingBeacon(
  raw: string | null,
  info: BeaconRequestInfo,
  deps: RecordBeaconDeps = {},
): Promise<RecordBeaconResult> {
  try {
    if (!raw || !info.sameOrigin) return "ignored";
    const beacon = parseLandingBeacon(raw);
    if (!beacon) return "ignored";
    const now = info.receivedAt.getTime();
    if (
      !(deps.limiter ?? limiter).allow(info.ip, beacon.pageId, beacon.visitId, beacon.type, now)
    ) {
      warnSkipped("limite d'envois dépassée");
      return "rate-limited";
    }
    const cache = deps.cache ?? landingCache();
    if (!(await cache.knowsPage(beacon.pageId))) return "unknown-page";
    const state = (deps.queueState ?? defaultQueueState)();
    if (
      (state !== null && !REDIS_USABLE.has(state)) ||
      pendingAdds >= (deps.maxPendingAdds ?? LANDING_MAX_PENDING_ADDS)
    ) {
      warnSkipped(state !== null && !REDIS_USABLE.has(state) ? `Redis ${state}` : "Redis lent");
      return "queue-unavailable";
    }
    const country = await (deps.country ?? countryOfIp)(info.ip).catch(() => null);
    const add = deps.enqueue ?? enqueue;
    const res = await enqueueLandingEvent(landingEventInput(beacon, info, { country }), {
      add: (data, opts) => {
        pendingAdds++;
        const p = Promise.resolve().then(() => add("landing-events", data, opts));
        let released = false;
        const release = () => {
          if (!released) {
            released = true;
            pendingAdds--;
          }
        };
        p.then(release, release);
        return p;
      },
    });
    return res.ok ? "queued" : "queue-error";
  } catch (err) {
    console.error("[landing] envoi non traité", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "ignored";
  }
}

/** Ajouts en attente de Redis (tests et diagnostic). */
export function pendingLandingAdds(): number {
  return pendingAdds;
}
