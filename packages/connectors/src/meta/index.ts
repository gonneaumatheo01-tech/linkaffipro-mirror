/**
 * Connecteur Meta (Marketing API, Graph API v25.0) : connexion Facebook Login, jeton utilisateur longue durée (60 jours),
 * comptes publicitaires visibles (`me/adaccounts`), rapports journaliers au niveau pub (`<act_id>/insights`).
 * Aucune dépendance : tout passe par `fetch` (injectable pour les tests). Les jetons vont dans l'en-tête `Authorization`,
 * jamais dans les URL que nous construisons (Meta en met un dans `paging.next` : ces URL ne sont ni journalisées ni renvoyées).
 */
import { ConnectorError } from "../errors";
import type {
  AdInsightRow,
  AdsProvider,
  AppCredentials,
  DateRange,
  ExternalAdAccount,
  TokenSet,
} from "../types";
import { metaErrorFromResponse, metaNetworkError } from "./errors";
import { INSIGHT_FIELDS, mapInsightRows, type MetaInsightRaw } from "./insights";

export const META_API_VERSION = "v25.0";
export const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;
export const META_DIALOG_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;
/** Permissions demandées : lecture des pubs et accès aux Business Manager (pour lister tous les comptes). */
export const META_SCOPES = ["ads_read", "business_management"] as const;

/** Statuts de compte publicitaire Meta (`account_status`). */
export const META_ACCOUNT_STATUS: Record<number, string> = {
  1: "Actif",
  2: "Désactivé",
  3: "Impayé",
  7: "Examen de risque en attente",
  8: "Règlement en attente",
  9: "Période de grâce",
  100: "Fermeture en attente",
  101: "Fermé",
};

const MAX_PAGES = 200;

type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number | string };
type Paged<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } };
type MetaAccountRaw = {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number | string;
  business?: { id?: string; name?: string };
};

function configId(app: AppCredentials): string | null {
  const v = app.extra?.configId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function expiresAtFrom(expiresIn: number | string | undefined, now: Date): Date | null {
  const secs = Number(expiresIn);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return new Date(now.getTime() + secs * 1000);
}

/** Appel GET à la Graph API ; erreurs classées (`ConnectorError`). `url` absolue (pagination) ou chemin relatif. */
async function graphGet<T>(
  pathOrUrl: string,
  params: Record<string, string>,
  opts: { fetchImpl?: typeof fetch; accessToken?: string | null },
): Promise<T> {
  const url = new URL(
    pathOrUrl.startsWith("http") ? pathOrUrl : `${META_GRAPH_URL}/${pathOrUrl.replace(/^\//, "")}`,
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), { method: "GET", headers });
  } catch (err) {
    throw metaNetworkError(err);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  const hasError = Boolean((body as { error?: unknown } | null)?.error);
  if (!res.ok || hasError) throw metaErrorFromResponse(res.status, body, res.headers);
  if (body === null) throw new ConnectorError("other", "réponse Meta vide ou illisible");
  return body as T;
}

/** Suit `paging.next` jusqu'à épuisement (borne de sécurité : 200 pages). */
async function graphGetAll<T>(
  path: string,
  params: Record<string, string>,
  opts: { fetchImpl?: typeof fetch; accessToken: string },
): Promise<T[]> {
  const out: T[] = [];
  let page = await graphGet<Paged<T>>(path, params, opts);
  let pages = 1;
  for (;;) {
    out.push(...(page.data ?? []));
    const next = page.paging?.next;
    if (!next || pages >= MAX_PAGES) break;
    page = await graphGet<Paged<T>>(next, {}, opts);
    pages++;
  }
  return out;
}

export function mapAccount(raw: MetaAccountRaw): ExternalAdAccount | null {
  const accountId = raw.account_id ?? (raw.id?.startsWith("act_") ? raw.id.slice(4) : raw.id);
  if (!accountId) return null;
  const status =
    raw.account_status === undefined || raw.account_status === null
      ? null
      : Number(raw.account_status);
  return {
    externalId: `act_${accountId}`,
    name: raw.name?.trim() || `Compte ${accountId}`,
    currency: (raw.currency || "EUR").toUpperCase(),
    timezone: raw.timezone_name ?? null,
    businessName: raw.business?.name ?? null,
    statusLabel: status === null ? null : (META_ACCOUNT_STATUS[status] ?? `Statut ${status}`),
    active: status === 1,
  };
}

export const metaProvider: AdsProvider = {
  platform: "META",

  async verifyApp(app, opts = {}) {
    try {
      const res = await graphGet<TokenResponse>(
        "oauth/access_token",
        {
          client_id: app.clientId.trim(),
          client_secret: app.secret,
          grant_type: "client_credentials",
        },
        { fetchImpl: opts.fetchImpl },
      );
      if (!res.access_token)
        return {
          ok: false,
          error: "Meta n'a pas renvoyé de jeton d'application : identifiants incomplets.",
        };
      return { ok: true, detail: `Identifiants acceptés par Meta (API ${META_API_VERSION}).` };
    } catch (err) {
      if (err instanceof ConnectorError) {
        if (err.kind === "auth" || err.kind === "other" || err.kind === "permission")
          return { ok: false, error: `App ID ou App Secret refusés par Meta : ${err.message}` };
        return { ok: false, error: err.message };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  authorizeUrl(app, redirectUri, state) {
    const url = new URL(META_DIALOG_URL);
    url.searchParams.set("client_id", app.clientId.trim());
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    const cfg = configId(app);
    if (cfg) url.searchParams.set("config_id", cfg);
    else url.searchParams.set("scope", META_SCOPES.join(","));
    return url.toString();
  },

  async exchangeCode(app, code, redirectUri, opts = {}) {
    const now = opts.now ?? new Date();
    const short = await graphGet<TokenResponse>(
      "oauth/access_token",
      {
        client_id: app.clientId.trim(),
        redirect_uri: redirectUri,
        client_secret: app.secret,
        code,
      },
      { fetchImpl: opts.fetchImpl },
    );
    if (!short.access_token)
      throw new ConnectorError("other", "Meta n'a pas renvoyé de jeton après la connexion");
    const long = await graphGet<TokenResponse>(
      "oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: app.clientId.trim(),
        client_secret: app.secret,
        fb_exchange_token: short.access_token,
      },
      { fetchImpl: opts.fetchImpl },
    );
    const accessToken = long.access_token ?? short.access_token;
    const expiresAt = long.access_token
      ? expiresAtFrom(long.expires_in, now)
      : expiresAtFrom(short.expires_in, now);
    return {
      accessToken,
      refreshToken: null,
      expiresAt,
      scopes: configId(app) ? null : META_SCOPES.join(","),
      raw: {
        tokenType: long.token_type ?? short.token_type ?? "bearer",
        longLived: Boolean(long.access_token),
      },
    };
  },

  /** Ré-échange le jeton longue durée tant qu'il est encore valide ; `null` s'il est déjà expiré ou refusé (reconnexion). */
  async refresh(app, tokens, opts = {}) {
    const now = opts.now ?? new Date();
    if (tokens.expiresAt && tokens.expiresAt.getTime() <= now.getTime()) return null;
    try {
      const long = await graphGet<TokenResponse>(
        "oauth/access_token",
        {
          grant_type: "fb_exchange_token",
          client_id: app.clientId.trim(),
          client_secret: app.secret,
          fb_exchange_token: tokens.accessToken,
        },
        { fetchImpl: opts.fetchImpl },
      );
      if (!long.access_token) return null;
      return {
        ...tokens,
        accessToken: long.access_token,
        expiresAt: expiresAtFrom(long.expires_in, now),
        raw: { ...(tokens.raw ?? {}), longLived: true, refreshedAt: now.toISOString() },
      };
    } catch (err) {
      if (err instanceof ConnectorError && (err.kind === "auth" || err.kind === "permission"))
        return null;
      throw err;
    }
  },

  async listAccounts(_app, tokens, opts = {}) {
    const rows = await graphGetAll<MetaAccountRaw>(
      "me/adaccounts",
      {
        fields: "id,account_id,name,currency,timezone_name,account_status,business{id,name}",
        limit: "100",
      },
      { fetchImpl: opts.fetchImpl, accessToken: tokens.accessToken },
    );
    const out: ExternalAdAccount[] = [];
    for (const r of rows) {
      const a = mapAccount(r);
      if (a) out.push(a);
    }
    return out.sort(
      (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "fr"),
    );
  },

  async fetchDailyInsights(
    _app,
    tokens,
    account,
    range: DateRange,
    opts = {},
  ): Promise<AdInsightRow[]> {
    const actId = account.externalId.startsWith("act_")
      ? account.externalId
      : `act_${account.externalId}`;
    const rows = await graphGetAll<MetaInsightRaw>(
      `${actId}/insights`,
      {
        level: "ad",
        fields: INSIGHT_FIELDS.join(","),
        time_range: JSON.stringify({ since: range.from, until: range.to }),
        time_increment: "1",
        limit: "500",
      },
      { fetchImpl: opts.fetchImpl, accessToken: tokens.accessToken },
    );
    return mapInsightRows(rows, account.currency);
  },
};

export type { TokenSet };
