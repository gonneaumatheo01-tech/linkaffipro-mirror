import { createHash } from "node:crypto";
import {
  LANDING_HEAD_SCRIPT,
  LANDING_PIXEL_SCRIPT,
  LANDING_SCRIPT,
  LANDING_STYLE,
} from "@linkaffipro/core";

/**
 * En-têtes des pages d'atterrissage (phase 15) : type, cache, ETag, robots, politique de sécurité (CSP) propre à la
 * page. Les chiffres (visites, clics) sont comptés par l'envoi de la page (`/j/_e`), jamais par la requête de la
 * page : la mise en cache ne fausse rien.
 */

/** Empreinte CSP (`'sha256-…'`) d'un morceau en ligne. */
export function cspHash(content: string): string {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

/** ETag fort d'un corps (même corps → même ETag, pour tous les processus). */
export function etagOf(body: Uint8Array | string): string {
  return `"lj-${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
}

const STYLE_HASH = cspHash(LANDING_STYLE);
/** Script du début du `<head>` (navigateur, ouverture automatique) puis script de fin de page. */
const SCRIPT_HASHES = `${cspHash(LANDING_HEAD_SCRIPT)} ${cspHash(LANDING_SCRIPT)}`;
const PIXEL_SCRIPT_HASH = cspHash(LANDING_PIXEL_SCRIPT);

/**
 * CSP d'une page : seuls le CSS et les scripts de la page (empreintes) s'exécutent ; images et envois vers le site
 * seulement ; cadre caché d'ouverture de Telegram (phase 16, navigateurs intégrés) vers `tg:` seulement (les demandes
 * des applis Meta, `tg://` sur iPhone et `intent://` sur Android, sont des navigations de la page, passées au
 * téléphone par l'appli, pas des cadres : aucune directive de la CSP ne les concerne).
 * Avec un pixel : le script des pixels (empreinte) et `'strict-dynamic'`, qui le laisse charger celui du pixel (et ce
 * que ce dernier charge), envois, images et cadres des pixels en https (TikTok et Meta changent leurs adresses sans
 * prévenir ; `https:` reste le repli des navigateurs sans `'strict-dynamic'`).
 */
export function landingCsp(opts: { pixels: boolean; script: boolean }): string {
  const script = opts.script
    ? opts.pixels
      ? `script-src ${SCRIPT_HASHES} ${PIXEL_SCRIPT_HASH} 'strict-dynamic' https:`
      : `script-src ${SCRIPT_HASHES}`
    : "script-src 'none'";
  return [
    "default-src 'none'",
    script,
    `style-src ${STYLE_HASH}`,
    opts.pixels ? "img-src 'self' data: https:" : "img-src 'self'",
    opts.pixels ? "connect-src 'self' https:" : "connect-src 'self'",
    ...(opts.script ? [opts.pixels ? "frame-src tg: https:" : "frame-src tg:"] : []),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Cache d'une page connue : 60 s dans le navigateur (retour arrière, rechargement), puis revalidation par l'ETag (304
 * sans corps). Le HTML en mémoire du serveur est, lui, vidé dès qu'une page est enregistrée (Redis
 * `landing:invalidate`) : une modification est visible partout en moins d'une minute.
 */
export const PAGE_CACHE_CONTROL = "public, max-age=60";
/** Page inconnue ou indisponible : jamais gardée (une page créée juste après doit apparaître tout de suite). */
export const MISS_CACHE_CONTROL = "no-store";
/** Photo dont l'adresse porte sa version (`?v=`) : gardée un an. */
export const PHOTO_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Photo demandée sans la bonne version : courte durée. */
export const PHOTO_SHORT_CACHE_CONTROL = "public, max-age=300";

export const ROBOTS = "noindex, nofollow";

/** En-têtes d'une page affichée (corps identique pour tous). */
export function pageHeaders(opts: {
  etag: string;
  csp: string;
  length: number;
}): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(opts.length),
    "Cache-Control": PAGE_CACHE_CONTROL,
    ETag: opts.etag,
    "Content-Security-Policy": opts.csp,
    "X-Robots-Tag": ROBOTS,
    "X-Content-Type-Options": "nosniff",
  };
}

/** L'ETag reçu (`If-None-Match`) correspond-il ? (liste, `*`, préfixe faible `W/` acceptés). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const want = etag.replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === want);
}
