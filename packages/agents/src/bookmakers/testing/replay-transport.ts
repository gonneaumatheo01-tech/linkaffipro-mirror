/**
 * Phase 35 (chantier B) — transport de REJEU pour les tests : sert un enregistrement de référence (pages et réponses
 * enregistrées) comme si c'était le site, sans navigateur ni réseau. `record` rend l'enregistrement (ou l'obstacle
 * demandé) ; `page` rend la première page enregistrée à cette adresse ; `fetchApi` la réponse enregistrée à cette
 * adresse (paramètres dans n'importe quel ordre). Surcharges possibles (cote qui change, structure modifiée…).
 * Jamais importé en production.
 */
import type { BookmakerTransport, SiteRecording } from "../contract";

export type ReplayCall = { kind: "record" | "page" | "api"; url: string };

export type ReplayOptions = {
  record?: SiteRecording | { obstacle: string };
  /** Réponse d'API imposée pour une adresse (null : comportement normal). */
  api?: (
    url: string,
  ) => { status: number; body: string } | { authExpired: true } | { obstacle: string } | null;
  /** Page imposée pour une adresse (null : comportement normal). */
  page?: (url: string) => { url: string; html: string; text: string } | { obstacle: string } | null;
};

/** Adresse normalisée (paramètres triés). Pur. */
export function normalizedUrl(u: string): string {
  try {
    const x = new URL(u);
    const q = [...x.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    return `${x.protocol}//${x.host}${x.pathname}?${q.map(([k, v]) => `${k}=${v}`).join("&")}`;
  } catch {
    return u;
  }
}

export function createReplayTransport(
  rec: SiteRecording,
  opts: ReplayOptions = {},
): BookmakerTransport & { calls: ReplayCall[] } {
  const calls: ReplayCall[] = [];
  return {
    target: "server",
    calls,
    async record(_siteKey, baseUrl) {
      calls.push({ kind: "record", url: baseUrl });
      return opts.record ?? rec;
    },
    async page(_siteKey, req) {
      calls.push({ kind: "page", url: req.url });
      const forced = opts.page?.(req.url);
      if (forced) return forced;
      const p = rec.pages.find((x) => normalizedUrl(x.url) === normalizedUrl(req.url));
      return p
        ? { url: p.url, html: p.html, text: p.text }
        : {
            url: req.url,
            html: "<html><body><h1>Introuvable</h1></body></html>",
            text: "Introuvable",
          };
    },
    async fetchApi(_siteKey, req) {
      calls.push({ kind: "api", url: req.url });
      const forced = opts.api?.(req.url);
      if (forced) return forced;
      const r = rec.responses.find(
        (x) =>
          x.method.toUpperCase() === req.method.toUpperCase() &&
          normalizedUrl(x.url) === normalizedUrl(req.url),
      );
      return r
        ? { status: r.status, body: r.body }
        : { status: 404, body: '{"error":"not_found"}' };
    },
  };
}
