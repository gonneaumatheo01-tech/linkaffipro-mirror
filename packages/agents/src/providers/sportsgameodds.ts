/**
 * Client SportsGameOdds v2 (`fetch` injectable). Base `https://api.sportsgameodds.com/v2`, clé dans l'en-tête
 * `x-api-key`, réponses `{ success, data, error?, nextCursor? }`. Pagination par `cursor` (5 pages au plus) ;
 * 429 / 5xx / coupure = erreurs passagères ; autre 4xx = erreur claire ; la clé n'apparaît jamais dans un message.
 * `beforeRequest` est appelé avant CHAQUE appel HTTP (comptage `AgentUsage.odds` et plafond mensuel).
 * Un marché inconnu du fournisseur ne lève rien : il ne renvoie simplement aucune sélection.
 */
import { ProviderError, requestJson, type HttpDeps } from "./http";
import type { OddsEvent, OddsResult, OddsSelection } from "./odds";
import type { BatchOddsProvider } from "./odds-batch";
import { mapEvent, mapResult, mapSelections, type SgoEvent, type SgoResponse } from "./sportsgameodds-map";

export const SGO_BASE = "https://api.sportsgameodds.com/v2";
export const SGO_LABEL = "SportsGameOdds";
export const SGO_MAX_PAGES = 5;
/** Identifiants de matchs par appel groupé. */
export const SGO_IDS_PER_CALL = 25;

export type SportsGameOddsOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  beforeRequest?: () => Promise<void>;
  limit?: number;
  maxPages?: number;
};

export type SportsGameOddsProvider = BatchOddsProvider & { name: "sportsgameodds" };

export function createSportsGameOddsProvider(opts: SportsGameOddsOptions): SportsGameOddsProvider {
  const http: HttpDeps = { fetch: opts.fetch ?? fetch, label: SGO_LABEL, secret: opts.apiKey };
  const base = (opts.baseUrl ?? SGO_BASE).replace(/\/$/, "");
  const maxPages = opts.maxPages ?? SGO_MAX_PAGES;
  // Événements lus pendant la vie du client (une étape) : getMarkets juste après listEvents ne rappelle pas l'API.
  const memo = new Map<string, SgoEvent>();

  async function get<T>(path: string, params: Record<string, string | undefined>): Promise<SgoResponse<T>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, v);
    await opts.beforeRequest?.();
    const body = await requestJson<SgoResponse<T>>(http, `${base}${path}${qs.size ? `?${qs}` : ""}`, {
      method: "GET",
      headers: { "x-api-key": opts.apiKey, accept: "application/json" },
    });
    if (body.success === false) throw new ProviderError(`${SGO_LABEL} : ${String(body.error ?? "demande refusée").slice(0, 160)}`, false);
    return body;
  }

  /** Toutes les pages d'une liste d'événements. */
  async function events(params: Record<string, string | undefined>): Promise<SgoEvent[]> {
    const out: SgoEvent[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await get<SgoEvent[]>("/events", { ...params, limit: String(opts.limit ?? 50), cursor });
      const data = Array.isArray(res.data) ? res.data : [];
      for (const e of data) if (e && typeof e.eventID === "string") {
        out.push(e);
        memo.set(e.eventID, e);
      }
      cursor = res.nextCursor || undefined;
      if (!cursor || !data.length) break;
    }
    return out;
  }

  async function byIds(ids: string[], extra: Record<string, string | undefined> = {}): Promise<SgoEvent[]> {
    const out: SgoEvent[] = [];
    for (let i = 0; i < ids.length; i += SGO_IDS_PER_CALL) out.push(...(await events({ eventIDs: ids.slice(i, i + SGO_IDS_PER_CALL).join(","), ...extra })));
    return out;
  }

  return {
    name: "sportsgameodds",
    async listEvents(q): Promise<OddsEvent[]> {
      const raw = await events({
        sportID: q.sport,
        leagueID: q.leagues.length ? q.leagues.join(",") : undefined,
        startsAfter: q.from.toISOString(),
        startsBefore: q.to.toISOString(),
        oddsAvailable: "true",
        finalized: "false",
        cancelled: "false",
      });
      return raw.map(mapEvent).filter((e): e is OddsEvent => e !== null);
    },
    async getMarkets(eventId, marketTypes): Promise<OddsSelection[]> {
      const e = memo.get(eventId) ?? (await byIds([eventId]))[0];
      return e ? mapSelections(e, marketTypes) : [];
    },
    async getMarketsMany(eventIds, marketTypes) {
      const missing = eventIds.filter((id) => !memo.has(id));
      if (missing.length) await byIds(missing);
      const out = new Map<string, OddsSelection[]>();
      for (const id of eventIds) {
        const e = memo.get(id);
        out.set(id, e ? mapSelections(e, marketTypes) : []);
      }
      return out;
    },
    async getMarketsFresh(eventId, marketTypes) {
      memo.delete(eventId);
      const e = (await byIds([eventId]))[0];
      return e ? mapSelections(e, marketTypes) : [];
    },
    async getResult(eventId): Promise<OddsResult | null> {
      const e = (await byIds([eventId], { expandResults: "true" }))[0];
      return e ? mapResult(e) : null;
    },
    async listBookmakers(): Promise<string[]> {
      const res = await get<unknown[]>("/bookmakers", {});
      const data = Array.isArray(res.data) ? res.data : [];
      return data
        .map((b) => (typeof b === "string" ? b : b && typeof b === "object" ? String((b as { bookmakerID?: unknown }).bookmakerID ?? "") : ""))
        .filter(Boolean);
    },
  };
}

/** Vérification gratuite d'une clé : `GET /account/usage`. 401 / 403 = refusée. Jamais la clé dans le message. */
export async function verifySportsGameOddsKey(key: string, fetchImpl: typeof fetch = fetch, baseUrl = SGO_BASE): Promise<{ ok: boolean; message: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/account/usage`, { method: "GET", headers: { "x-api-key": key.trim(), accept: "application/json" } });
  } catch {
    return { ok: false, message: `${SGO_LABEL} injoignable pour le moment : réessaie dans une minute` };
  }
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 401 || res.status === 403) return { ok: false, message: `clé refusée par ${SGO_LABEL}` };
  if (res.status === 429) return { ok: false, message: `${SGO_LABEL} limite le débit : réessaie dans une minute` };
  if (res.status >= 500) return { ok: false, message: `${SGO_LABEL} indisponible (${res.status}) : réessaie plus tard` };
  if (!res.ok) return { ok: false, message: `${SGO_LABEL} a refusé la vérification (${res.status})` };
  return { ok: true, message: `clé acceptée par ${SGO_LABEL}` };
}
