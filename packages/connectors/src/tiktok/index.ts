/**
 * Connecteur TikTok — Marketing API v1.3 (https://business-api.tiktok.com/portal/docs).
 * Aucune dépendance : `fetch` injectable pour les tests. Aucun jeton n'est journalisé.
 *
 * Parcours : `authorizeUrl` (portail d'autorisation) → retour `?auth_code=` → `exchangeCode`
 * (`/oauth2/access_token/`) → `listAccounts` (`/oauth2/advertiser/get/` puis `/advertiser/info/`)
 * → `fetchDailyInsights` (`/report/integrated/get/`, niveau pub, par jour, paginé).
 * Le jeton Marketing API est en pratique de longue durée (pas d'expiration tant que l'annonceur ne révoque pas) ;
 * si TikTok renvoie `refresh_token` + `expires_in`, on les conserve et `refresh` les utilise.
 *
 * Bac à sable (sandbox) : mêmes chemins sur `https://sandbox-ads.tiktok.com` quand `extra.sandbox` ou `opts.sandbox` est vrai.
 * Dans le bac à sable, TikTok ne passe pas par OAuth : le jeton est généré dans le portail (Tools → Sandbox) ;
 * le site propose alors un formulaire « jeton + identifiant annonceur » qui appelle `listAccountsByIds`.
 */
import { ConnectorError } from "../errors";
import type {
  AdInsightRow,
  AdsProvider,
  AppCredentials,
  ExternalAdAccount,
  FetchOptions,
  TokenSet,
} from "../types";
import { isAuthCode, tiktokError, tiktokHttpError, type TikTokEnvelope } from "./errors";
import {
  hasNextPage,
  mapReportPage,
  REPORT_PATH,
  reportQuery,
  type TikTokReportPage,
} from "./report";

export const TIKTOK_API_BASE = "https://business-api.tiktok.com";
export const TIKTOK_SANDBOX_BASE = "https://sandbox-ads.tiktok.com";
export const TIKTOK_AUTH_URL = "https://business-api.tiktok.com/portal/auth";
const API_PREFIX = "/open_api/v1.3";
/** Nombre maximal de pages d'un rapport (1000 lignes par page) : garde-fou contre une pagination infinie. */
const MAX_REPORT_PAGES = 200;
/** `advertiser/info` accepte jusqu'à 100 identifiants par appel. */
const INFO_CHUNK = 100;

export function isSandbox(app: AppCredentials, opts?: FetchOptions): boolean {
  if (opts?.sandbox !== undefined) return Boolean(opts.sandbox);
  return Boolean((app.extra as { sandbox?: unknown } | undefined)?.sandbox);
}

export function apiBase(app: AppCredentials, opts?: FetchOptions): string {
  return isSandbox(app, opts) ? TIKTOK_SANDBOX_BASE : TIKTOK_API_BASE;
}

/** Statuts d'annonceur TikTok → libellé français. */
export const ADVERTISER_STATUS_LABELS: Record<string, { label: string; active: boolean }> = {
  STATUS_ENABLE: { label: "Actif", active: true },
  STATUS_DISABLE: { label: "Désactivé", active: false },
  STATUS_PENDING_CONFIRM: { label: "En attente de validation", active: false },
  STATUS_PENDING_VERIFIED: { label: "En attente de vérification", active: false },
  STATUS_CONFIRM_FAIL: { label: "Validation refusée", active: false },
  STATUS_CONFIRM_FAIL_END: { label: "Validation refusée (définitif)", active: false },
  STATUS_PENDING_CONFIRM_MODIFY: { label: "Modification en attente", active: true },
  STATUS_CONFIRM_MODIFY_FAIL: { label: "Modification refusée", active: true },
  STATUS_LIMIT: { label: "Limité", active: true },
  STATUS_PUNISH: { label: "Sanctionné", active: false },
  STATUS_SELF_SERVICE_UNAUDITED: { label: "Non audité", active: true },
  STATUS_CONTRACT_PENDING: { label: "Contrat en attente", active: false },
};

type Json = Record<string, unknown>;

async function call<T>(
  url: string,
  init: RequestInit,
  opts?: FetchOptions,
): Promise<{ code: number; message: string; data: T | undefined; requestId?: string }> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ConnectorError("network", err instanceof Error ? err.message : "réseau indisponible");
  }
  const text = await res.text();
  if (!res.ok) throw tiktokHttpError(res.status, text);
  let body: TikTokEnvelope<T>;
  try {
    body = JSON.parse(text) as TikTokEnvelope<T>;
  } catch {
    throw new ConnectorError("network", "réponse TikTok illisible");
  }
  const code = typeof body.code === "number" ? body.code : Number(body.code ?? NaN);
  if (!Number.isFinite(code)) throw new ConnectorError("other", "réponse TikTok sans code");
  return { code, message: body.message ?? "", data: body.data, requestId: body.request_id };
}

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) h["Access-Token"] = token;
  return h;
}

async function get<T>(
  app: AppCredentials,
  path: string,
  params: URLSearchParams,
  token: string | null,
  opts?: FetchOptions,
): Promise<T> {
  const url = `${apiBase(app, opts)}${path}?${params.toString()}`;
  const r = await call<T>(url, { method: "GET", headers: headers(token) }, opts);
  if (r.code !== 0) throw tiktokError(r.code, r.message, r.requestId);
  return (r.data ?? {}) as T;
}

async function post<T>(
  app: AppCredentials,
  path: string,
  body: Json,
  opts?: FetchOptions,
): Promise<T> {
  const url = `${apiBase(app, opts)}${path}`;
  const r = await call<T>(
    url,
    { method: "POST", headers: headers(), body: JSON.stringify(body) },
    opts,
  );
  if (r.code !== 0) throw tiktokError(r.code, r.message, r.requestId);
  return (r.data ?? {}) as T;
}

type TokenData = {
  access_token?: string;
  advertiser_ids?: unknown[];
  scope?: unknown;
  refresh_token?: string;
  expires_in?: number | string;
  refresh_token_expires_in?: number | string;
};

function toTokenSet(data: TokenData, now: Date): TokenSet {
  if (!data.access_token)
    throw new ConnectorError("other", "TikTok n'a pas renvoyé de jeton d'accès");
  const expiresIn =
    data.expires_in === undefined || data.expires_in === null ? NaN : Number(data.expires_in);
  const scopes = Array.isArray(data.scope)
    ? data.scope.map(String).join(",")
    : typeof data.scope === "string"
      ? data.scope
      : null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(now.getTime() + expiresIn * 1000)
        : null,
    scopes,
    raw: { advertiser_ids: (data.advertiser_ids ?? []).map(String) },
  };
}

type AdvertiserListData = { list?: { advertiser_id?: unknown; advertiser_name?: unknown }[] };
type AdvertiserInfoData = {
  list?: {
    advertiser_id?: unknown;
    name?: unknown;
    currency?: unknown;
    timezone?: unknown;
    status?: unknown;
    company?: unknown;
  }[];
};

/** Devise, fuseau et statut des annonceurs (`/advertiser/info/`), indexés par identifiant. */
async function advertiserInfo(
  app: AppCredentials,
  token: string,
  ids: string[],
  opts?: FetchOptions,
): Promise<
  Map<
    string,
    {
      name: string | null;
      currency: string | null;
      timezone: string | null;
      status: string | null;
      company: string | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      name: string | null;
      currency: string | null;
      timezone: string | null;
      status: string | null;
      company: string | null;
    }
  >();
  for (let i = 0; i < ids.length; i += INFO_CHUNK) {
    const chunk = ids.slice(i, i + INFO_CHUNK);
    const data = await get<AdvertiserInfoData>(
      app,
      `${API_PREFIX}/advertiser/info/`,
      new URLSearchParams({ advertiser_ids: JSON.stringify(chunk) }),
      token,
      opts,
    );
    for (const row of data.list ?? []) {
      const id =
        row.advertiser_id === undefined || row.advertiser_id === null
          ? ""
          : String(row.advertiser_id);
      if (!id) continue;
      out.set(id, {
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
        currency:
          typeof row.currency === "string" && row.currency.trim()
            ? row.currency.trim().toUpperCase()
            : null,
        timezone:
          typeof row.timezone === "string" && row.timezone.trim() ? row.timezone.trim() : null,
        status: typeof row.status === "string" ? row.status : null,
        company: typeof row.company === "string" && row.company.trim() ? row.company.trim() : null,
      });
    }
  }
  return out;
}

/** Comptes externes à partir d'une liste d'identifiants (+ noms connus) et des infos annonceur. */
async function buildAccounts(
  app: AppCredentials,
  token: string,
  base: { id: string; name: string | null }[],
  opts?: FetchOptions,
): Promise<ExternalAdAccount[]> {
  if (base.length === 0) return [];
  let info: Awaited<ReturnType<typeof advertiserInfo>> | null = null;
  try {
    info = await advertiserInfo(
      app,
      token,
      base.map((b) => b.id),
      opts,
    );
  } catch (err) {
    // Un jeton refusé doit remonter (reconnexion) ; un simple échec d'info ne bloque pas la liste.
    if (err instanceof ConnectorError && (err.kind === "auth" || err.kind === "rate_limit"))
      throw err;
    info = null;
  }
  return base.map((b) => {
    const i = info?.get(b.id);
    const st = i?.status ? ADVERTISER_STATUS_LABELS[i.status] : undefined;
    const name = b.name || i?.name || `Annonceur ${b.id}`;
    if (!i) {
      return {
        externalId: b.id,
        name,
        currency: "USD",
        timezone: null,
        businessName: null,
        statusLabel: "devise à vérifier",
        active: true,
      };
    }
    return {
      externalId: b.id,
      name,
      currency: i.currency ?? "USD",
      timezone: i.timezone,
      businessName: i.company,
      statusLabel: i.currency ? (st?.label ?? i.status ?? null) : "devise à vérifier",
      active: st ? st.active : true,
    };
  });
}

/**
 * Comptes à partir d'identifiants d'annonceur connus (sans `/oauth2/advertiser/get/`) : sert au bac à sable,
 * où le jeton vient du portail développeur et n'est lié qu'à un annonceur de test.
 */
export async function listAccountsByIds(
  app: AppCredentials,
  tokens: TokenSet,
  advertiserIds: string[],
  opts?: FetchOptions,
): Promise<ExternalAdAccount[]> {
  const ids = Array.from(new Set(advertiserIds.map((s) => s.trim()).filter(Boolean)));
  return buildAccounts(
    app,
    tokens.accessToken,
    ids.map((id) => ({ id, name: null })),
    opts,
  );
}

export const tiktokProvider: AdsProvider = {
  platform: "TIKTOK",

  /**
   * Il n'existe pas d'appel « identifiants d'application seuls » chez TikTok. Heuristique documentée :
   * on appelle `/oauth2/advertiser/get/?app_id=&secret=` SANS jeton. Si TikTok répond par un code
   * d'authentification (jeton manquant / incorrect : 40105, 401xx) sans mentionner l'app dans le message,
   * c'est que l'app_id et le secret ont passé la première vérification ; si le message parle de l'app
   * (« app_id », « secret », « application »), les identifiants sont refusés. La preuve définitive viendra
   * à la première connexion de compte.
   */
  async verifyApp(app, opts) {
    const clientId = app.clientId.trim();
    if (!/^\d{5,}$/.test(clientId))
      return {
        ok: false,
        error:
          "L'App ID TikTok est un nombre (ex. 7123456789012345678) : vérifiez la valeur copiée dans My Apps → Basic Information.",
      };
    if (!app.secret.trim()) return { ok: false, error: "Le secret de l'application est vide." };
    const url = `${apiBase(app, opts)}${API_PREFIX}/oauth2/advertiser/get/?${new URLSearchParams({ app_id: clientId, secret: app.secret })}`;
    try {
      const r = await call<AdvertiserListData>(url, { method: "GET", headers: headers() }, opts);
      if (r.code === 0) return { ok: true, detail: "TikTok a accepté les identifiants." };
      const mentionsApp = /app[_ ]?id|secret|application|app\b/i.test(r.message);
      if (isAuthCode(r.code) && !mentionsApp) {
        return {
          ok: true,
          detail: `Identifiants acceptés par TikTok (réponse ${r.code} : jeton attendu, ce qui est normal avant la première connexion de compte).`,
        };
      }
      return {
        ok: false,
        error: `TikTok a refusé les identifiants (code ${r.code}) : ${r.message || "sans détail"}.`,
      };
    } catch (err) {
      if (err instanceof ConnectorError && err.kind === "auth")
        return {
          ok: true,
          detail:
            "Identifiants acceptés par TikTok (jeton attendu, normal avant la première connexion).",
        };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  authorizeUrl(app, redirectUri, state) {
    const params = new URLSearchParams({
      app_id: app.clientId.trim(),
      state,
      redirect_uri: redirectUri,
    });
    return `${TIKTOK_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(app, code, _redirectUri, opts) {
    const now = opts?.now ?? new Date();
    const data = await post<TokenData>(
      app,
      `${API_PREFIX}/oauth2/access_token/`,
      {
        app_id: app.clientId.trim(),
        secret: app.secret,
        auth_code: code,
        grant_type: "authorization_code",
      },
      opts,
    );
    return toTokenSet(data, now);
  },

  async refresh(app, tokens, opts) {
    if (!tokens.refreshToken) return null;
    const now = opts?.now ?? new Date();
    const data = await post<TokenData>(
      app,
      `${API_PREFIX}/oauth2/refresh_token/`,
      {
        app_id: app.clientId.trim(),
        secret: app.secret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      },
      opts,
    );
    const next = toTokenSet(data, now);
    return {
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      scopes: next.scopes ?? tokens.scopes ?? null,
      raw: { ...(tokens.raw ?? {}), ...(next.raw ?? {}) },
    };
  },

  async listAccounts(app, tokens, opts) {
    const data = await get<AdvertiserListData>(
      app,
      `${API_PREFIX}/oauth2/advertiser/get/`,
      new URLSearchParams({ app_id: app.clientId.trim(), secret: app.secret }),
      tokens.accessToken,
      opts,
    );
    const base = (data.list ?? [])
      .map((row) => ({
        id:
          row.advertiser_id === undefined || row.advertiser_id === null
            ? ""
            : String(row.advertiser_id),
        name: typeof row.advertiser_name === "string" ? row.advertiser_name.trim() : null,
      }))
      .filter((b) => b.id);
    return buildAccounts(app, tokens.accessToken, base, opts);
  },

  async fetchDailyInsights(app, tokens, account, range, opts) {
    const rows: AdInsightRow[] = [];
    for (let page = 1; page <= MAX_REPORT_PAGES; page++) {
      const data = await get<TikTokReportPage>(
        app,
        REPORT_PATH,
        reportQuery(account.externalId, range, page),
        tokens.accessToken,
        opts,
      );
      rows.push(...mapReportPage(data, account.currency));
      if (!hasNextPage(data, page)) break;
    }
    return rows;
  },
};
