/**
 * Phase 34, chantier A — client du worker pour les opérations du site (Kevin) : `POST <SITE_OPS_URL ?? APP_BASE_URL>
 * /api/internal/site-ops`, corps `{ op, input, actor, dryRun }` signé (HMAC-SHA256 de `${horodatage}.${corps}`, clé
 * dérivée de `APP_ENCRYPTION_KEY` : même code que la vérification du site, `@linkaffipro/agents`). Délai 30 s ; UNE
 * reprise sur erreur réseau, seulement pour un essai à blanc (jamais une exécution : elle a pu passer).
 * Ne lève jamais : erreur → `{ ok: false, code: "unavailable" }`.
 */
import {
  SITE_OPS_PATH,
  SITE_OPS_SIGNATURE_HEADER,
  SITE_OPS_TIMESTAMP_HEADER,
  signSiteOpsBody,
  siteOpsKeyFrom,
  type SiteOpResult,
  type SiteOpsClient,
} from "@linkaffipro/agents";

export const SITE_OPS_TIMEOUT_MS = 30_000;

export type SiteOpsClientOptions = {
  baseUrl: string;
  /** Clé de signature dérivée (`siteOpsKeyFrom(APP_ENCRYPTION_KEY)`). */
  key: Buffer;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  logger?: { warn(o: object, m?: string): void };
};

const UNAVAILABLE: SiteOpResult = { ok: false, code: "unavailable", error: "" };

function isResult(v: unknown): v is SiteOpResult {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (o.ok === true && typeof o.message === "string") || (o.ok === false && typeof o.error === "string");
}

class NetworkError extends Error {}

export function createSiteOpsClient(opts: SiteOpsClientOptions): SiteOpsClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${SITE_OPS_PATH}`;
  const timeout = opts.timeoutMs ?? SITE_OPS_TIMEOUT_MS;
  const now = opts.now ?? Date.now;

  async function once(payload: string): Promise<SiteOpResult> {
    // Signature neuve à chaque envoi (une reprise n'est jamais prise pour un rejeu).
    const ts = String(now());
    const sig = signSiteOpsBody(opts.key, ts, payload);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", [SITE_OPS_TIMESTAMP_HEADER]: ts, [SITE_OPS_SIGNATURE_HEADER]: sig },
        body: payload,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new NetworkError((err as Error).message);
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => null);
    if (isResult(body)) return body;
    opts.logger?.warn({ status: res.status }, "[site-ops] réponse illisible du site");
    return UNAVAILABLE;
  }

  return async (req) => {
    const payload = JSON.stringify({ op: req.op, input: req.input ?? {}, actor: req.actor, dryRun: req.dryRun === true }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    // Essai à blanc seulement : certaines « lectures » agissent (test d'un bookmaker, vérification d'une clé qui
    // dépense) et ne doivent jamais partir deux fois.
    const retryable = req.dryRun === true;
    for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt++) {
      try {
        return await once(payload);
      } catch (err) {
        opts.logger?.warn({ err: (err as Error).message, op: req.op, attempt }, "[site-ops] site injoignable");
      }
    }
    return UNAVAILABLE;
  };
}

/** Client de production : adresse `SITE_OPS_URL` (réseau privé Railway) sinon `APP_BASE_URL` ; null sans clé. */
export function siteOpsClientFromEnv(env: Record<string, string | undefined> = process.env, logger?: SiteOpsClientOptions["logger"]): SiteOpsClient | null {
  const baseUrl = (env.SITE_OPS_URL ?? env.APP_BASE_URL ?? "").trim();
  if (!baseUrl || !env.APP_ENCRYPTION_KEY?.trim()) return null;
  return createSiteOpsClient({ baseUrl, key: siteOpsKeyFrom(env.APP_ENCRYPTION_KEY), logger });
}
