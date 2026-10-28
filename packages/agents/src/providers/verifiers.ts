/**
 * Vérification des clés fal.ai et Magic Hour (bouton « Vérifier » du site, réponse à la question du bot) : un appel
 * gratuit, l'état d'un travail qui n'existe pas. 401 / 403 = clé refusée ; 404 (ou toute autre réponse authentifiée)
 * = clé acceptée. Jamais la clé dans le message rendu.
 */
import { registerSecretVerifier, type SecretVerifier } from "../human/secrets";
import { MAGICHOUR_BASE } from "./magichour";
import { FAL_QUEUE_BASE, FAL_IMAGE_MODEL, falAppPath } from "./fal";
import { FAL_SECRET_KEY, MAGICHOUR_SECRET_KEY } from "./registry";
import { ODDS_SECRET_KEY } from "./odds-registry";
import { verifySportsGameOddsKey } from "./sportsgameodds";
import { APIFOOTBALL_SECRET_KEY, verifyApiFootballKey } from "./apifootball";

const ZERO_ID = "00000000-0000-0000-0000-000000000000";

async function probe(label: string, url: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<{ ok: boolean; message: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers });
  } catch {
    return { ok: false, message: `${label} injoignable pour le moment : réessaie dans une minute` };
  }
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 401 || res.status === 403) return { ok: false, message: `clé refusée par ${label}` };
  if (res.status === 429) return { ok: false, message: `${label} limite le débit : réessaie dans une minute` };
  if (res.status >= 500) return { ok: false, message: `${label} indisponible (${res.status}) : réessaie plus tard` };
  return { ok: true, message: `clé acceptée par ${label}` };
}

export function falKeyVerifier(fetchImpl: typeof fetch = fetch): SecretVerifier {
  return (key) => probe("fal.ai", `${FAL_QUEUE_BASE}/${falAppPath(FAL_IMAGE_MODEL)}/requests/${ZERO_ID}/status`, { Authorization: `Key ${key.trim()}` }, fetchImpl);
}

export function magicHourKeyVerifier(fetchImpl: typeof fetch = fetch): SecretVerifier {
  return (key) => probe("Magic Hour", `${MAGICHOUR_BASE}/v1/video-projects/inexistant`, { Authorization: `Bearer ${key.trim()}` }, fetchImpl);
}

/** Clé SportsGameOdds (phase 23) : `GET /account/usage`, gratuit. */
export function oddsKeyVerifier(fetchImpl: typeof fetch = fetch): SecretVerifier {
  return (key) => verifySportsGameOddsKey(key, fetchImpl);
}

/** Enregistre les vérificateurs (appelé au chargement du paquet ; `fetch` imposé par les tests). */
export function registerMediaKeyVerifiers(fetchImpl?: typeof fetch): void {
  registerSecretVerifier(FAL_SECRET_KEY, falKeyVerifier(fetchImpl));
  registerSecretVerifier(MAGICHOUR_SECRET_KEY, magicHourKeyVerifier(fetchImpl));
  registerSecretVerifier(ODDS_SECRET_KEY, oddsKeyVerifier(fetchImpl));
  registerSecretVerifier(APIFOOTBALL_SECRET_KEY, (key) => verifyApiFootballKey(key, fetchImpl));
}
