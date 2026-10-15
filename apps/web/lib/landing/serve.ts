import { escapeLandingHtml } from "@linkaffipro/core";
import { landingCache, type LandingCache } from "./cache";
import {
  MISS_CACHE_CONTROL,
  PHOTO_CACHE_CONTROL,
  PHOTO_SHORT_CACHE_CONTROL,
  ROBOTS,
  etagMatches,
  pageHeaders,
} from "./headers";

/**
 * Réponses de la page publique `/j/<slug>` et de la photo `/j/_p/<channelId>.jpg` (phase 15). Depuis la mémoire
 * (`cache.ts`), sans requête à la base pour une page connue, sans aucune redirection, sans écriture : une page affichée
 * n'est comptée que par l'envoi de la visite (`/j/_e`), jamais ici. Le corps ne dépend que de la page, de sa version,
 * du titre du canal et de la source : jamais de l'agent utilisateur, de l'adresse IP ni d'un autre en-tête.
 */

type Method = "GET" | "HEAD";

/** Petite page neutre (page inconnue ou indisponible), même texte pour tous. */
function plainPage(status: 404 | 503, title: string, text: string, method: Method): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeLandingHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#536471"><p>${escapeLandingHtml(text)}</p></body></html>`;
  const body = Buffer.from(html, "utf8");
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(body.length),
      "Cache-Control": MISS_CACHE_CONTROL,
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Robots-Tag": ROBOTS,
      "X-Content-Type-Options": "nosniff",
      ...(status === 503 ? { "Retry-After": "30" } : {}),
    },
  });
}

/**
 * Page demandée sur un hôte qui ne sert pas les pages (adresse du site en production, `landingAllowedForRequest`) :
 * même réponse qu'une page inconnue (deuxième barrière derrière `proxy.ts`).
 */
export function landingNotOnThisHost(method: Method): Response {
  return plainPage(404, "Page introuvable", "Cette page n'existe pas.", method);
}

/** Page d'atterrissage d'une adresse ; `src` = paramètre `?src=` (source inconnue : lien par défaut). */
export async function serveLandingPage(
  slug: string,
  src: string | null,
  ifNoneMatch: string | null,
  method: Method,
  cache: LandingCache = landingCache(),
): Promise<Response> {
  const found = await cache.lookup(slug, src);
  if (found.kind === "missing") {
    return plainPage(404, "Page introuvable", "Cette page n'existe pas.", method);
  }
  if (found.kind === "unavailable") {
    return plainPage(503, "Bientôt disponible", "Revenez dans un instant.", method);
  }
  const page = found.page;
  const headers = pageHeaders({ etag: page.etag, csp: page.csp, length: page.body.length });
  if (etagMatches(ifNoneMatch, page.etag)) {
    const { "Content-Length": _length, "Content-Type": _type, ...rest } = headers;
    return new Response(null, { status: 304, headers: rest });
  }
  return new Response(method === "HEAD" ? null : new Uint8Array(page.body), {
    status: 200,
    headers,
  });
}

/** Photo du canal (`/j/_p/<channelId>.jpg?v=…`), seulement pour un canal dont une page active affiche la photo. */
export async function serveLandingPhoto(
  file: string,
  version: string | null,
  ifNoneMatch: string | null,
  method: Method,
  cache: LandingCache = landingCache(),
): Promise<Response> {
  const m = /^([A-Za-z0-9_-]{1,64})\.jpg$/.exec(file);
  const photo = m ? await cache.photo(m[1]!) : null;
  if (!photo) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": MISS_CACHE_CONTROL, "X-Robots-Tag": ROBOTS },
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": "image/jpeg",
    "Content-Length": String(photo.bytes.length),
    "Cache-Control": version === photo.v ? PHOTO_CACHE_CONTROL : PHOTO_SHORT_CACHE_CONTROL,
    ETag: photo.etag,
    "X-Robots-Tag": ROBOTS,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (etagMatches(ifNoneMatch, photo.etag)) {
    const { "Content-Length": _length, "Content-Type": _type, ...rest } = headers;
    return new Response(null, { status: 304, headers: rest });
  }
  return new Response(method === "HEAD" ? null : new Uint8Array(photo.bytes), {
    status: 200,
    headers,
  });
}
