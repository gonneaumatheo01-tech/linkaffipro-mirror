/**
 * Phase 34, chantier A — authentification de l'entrée interne `POST /api/internal/site-ops` (appelée par le worker
 * pour Kevin). Pas de session : une signature HMAC-SHA256 de `${horodatage}.${corps}` avec une clé dérivée de
 * `APP_ENCRYPTION_KEY` (HKDF, contexte `SITE_OPS_KEY_CONTEXT`), horodatage dans la fenêtre `SITE_OPS_MAX_SKEW_MS`,
 * comparaison à temps constant, et anti-rejeu : une signature déjà vue est refusée pendant 2 minutes (mémoire du
 * processus, plus longue que la fenêtre). Même code de signature que le client du worker (`@linkaffipro/agents`).
 */
import {
  SITE_OPS_SIGNATURE_HEADER,
  SITE_OPS_TIMESTAMP_HEADER,
  siteOpsKeyFrom,
  verifySiteOpsSignature,
  type SiteOpsSignatureCheck,
} from "@linkaffipro/agents";

export const REPLAY_TTL_MS = 2 * 60_000;
const REPLAY_MAX = 10_000;

export type ReplayGuard = {
  /** Vrai si la signature a déjà servi (et la note sinon). */
  seen(signature: string, now: number): boolean;
  size(): number;
};

export function createReplayGuard(ttlMs = REPLAY_TTL_MS): ReplayGuard {
  const seen = new Map<string, number>();
  return {
    seen(signature, now) {
      for (const [k, until] of seen) {
        if (until > now) break;
        seen.delete(k);
      }
      const until = seen.get(signature);
      if (until !== undefined && until > now) return true;
      if (seen.size >= REPLAY_MAX) seen.delete(seen.keys().next().value!);
      seen.set(signature, now + ttlMs);
      return false;
    },
    size: () => seen.size,
  };
}

const processReplay = createReplayGuard();

let cachedKey: { raw: string; key: Buffer } | null = null;

/** Clé de signature du processus (dérivée une fois de `APP_ENCRYPTION_KEY`). */
export function siteOpsKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.APP_ENCRYPTION_KEY ?? "";
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key;
  const key = siteOpsKeyFrom(raw);
  cachedKey = { raw, key };
  return key;
}

export type SiteOpsAuth = { ok: true } | { ok: false; reason: Exclude<SiteOpsSignatureCheck, { ok: true }>["reason"] | "replay" };

/** Vérifie une requête signée (en-têtes + corps brut). */
export function verifySiteOpsRequest(
  headers: Pick<Headers, "get">,
  body: string,
  opts: { key: Buffer; now?: number; replay?: ReplayGuard },
): SiteOpsAuth {
  const now = opts.now ?? Date.now();
  const signature = headers.get(SITE_OPS_SIGNATURE_HEADER);
  const r = verifySiteOpsSignature({ key: opts.key, timestamp: headers.get(SITE_OPS_TIMESTAMP_HEADER), signature, body, now });
  if (!r.ok) return r;
  // Anti-rejeu APRÈS la vérification : une signature fausse ne remplit jamais la mémoire.
  if ((opts.replay ?? processReplay).seen(signature!.trim().toLowerCase(), now)) return { ok: false, reason: "replay" };
  return { ok: true };
}
