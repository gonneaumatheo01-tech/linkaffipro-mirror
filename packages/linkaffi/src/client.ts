/**
 * Client typé de l'API de lecture Link Affi (voir docs/LINKAFFI-API.md).
 * - GET uniquement ; en-têtes x-api-key et apikey.
 * - Une requête par seconde au maximum (file d'attente interne).
 * - Pagination par offset jusqu'à `total` ; reprises avec attente croissante sur 429 / 5xx / réseau.
 */

export type LinkAffiRow = Record<string, unknown>;

export type LinkAffiPage<T = LinkAffiRow> = {
  table: string;
  total: number;
  offset: number;
  limit: number;
  count: number;
  rows: T[];
};

export type LinkAffiQuery = {
  from?: string;
  to?: string;
  date_col?: string;
  limit?: number;
  offset?: number;
  order?: string;
  /** Filtres d'égalité : { affiliate_id: "uuid" } → eq.affiliate_id=uuid */
  eq?: Record<string, string | number | boolean>;
};

export type LinkAffiClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  anonKey?: string;
  /** Intervalle minimal entre deux requêtes (ms). Défaut : 1000. */
  minIntervalMs?: number;
  /** Nombre maximal de tentatives par requête. Défaut : 4. */
  maxAttempts?: number;
  /** Délai d'attente d'une requête (ms). Défaut : 30 000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export class LinkAffiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LinkAffiError";
  }
}

export const MAX_LIMIT = 5000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LinkAffiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly anonKey: string;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(opts: LinkAffiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.LINKAFFI_API_URL ?? "").replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? process.env.LINKAFFI_API_KEY ?? "";
    this.anonKey = opts.anonKey ?? process.env.LINKAFFI_ANON_KEY ?? "";
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? (() => Date.now());
    if (!this.baseUrl) throw new LinkAffiError("LINKAFFI_API_URL manquante", null, false);
    if (!this.apiKey || !this.anonKey)
      throw new LinkAffiError("LINKAFFI_API_KEY ou LINKAFFI_ANON_KEY manquante", null, false);
  }

  /** Liste des tables exposées par l'API. */
  async listTables(): Promise<string[]> {
    const data = await this.request<unknown>("");
    if (Array.isArray(data)) return data.map(String);
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const key of ["tables", "available_tables", "data"]) {
        if (Array.isArray(obj[key])) return (obj[key] as unknown[]).map(String);
      }
      const keys = Object.keys(obj);
      if (keys.length > 0 && keys.every((k) => typeof obj[k] !== "object")) return keys;
    }
    throw new LinkAffiError("Réponse inattendue pour la liste des tables", null, false);
  }

  /** Lit une page d'une table. */
  async getPage<T = LinkAffiRow>(
    table: string,
    query: LinkAffiQuery = {},
  ): Promise<LinkAffiPage<T>> {
    const params = new URLSearchParams();
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.date_col) params.set("date_col", query.date_col);
    if (query.limit !== undefined) params.set("limit", String(Math.min(query.limit, MAX_LIMIT)));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    if (query.order) params.set("order", query.order);
    for (const [k, v] of Object.entries(query.eq ?? {})) params.set(`eq.${k}`, String(v));
    const qs = params.toString();
    const data = await this.request<LinkAffiPage<T>>(
      `/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`,
    );
    if (!data || !Array.isArray(data.rows))
      throw new LinkAffiError(`Réponse inattendue pour la table ${table}`, null, false);
    return data;
  }

  /** Parcourt toutes les pages d'une table (générateur asynchrone). */
  async *iterate<T = LinkAffiRow>(
    table: string,
    query: Omit<LinkAffiQuery, "offset"> = {},
  ): AsyncGenerator<T[], void, void> {
    const limit = Math.min(query.limit ?? MAX_LIMIT, MAX_LIMIT);
    let offset = 0;
    for (;;) {
      const page = await this.getPage<T>(table, { ...query, limit, offset });
      if (page.rows.length > 0) yield page.rows;
      offset += page.rows.length;
      if (page.rows.length === 0 || offset >= page.total || page.rows.length < limit) return;
    }
  }

  /** Lit toutes les lignes (attention au volume). */
  async getAll<T = LinkAffiRow>(
    table: string,
    query: Omit<LinkAffiQuery, "offset"> = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const rows of this.iterate<T>(table, query)) out.push(...rows);
    return out;
  }

  /** Nombre total de lignes d'une table (une requête, limit=1). */
  async count(table: string, query: Omit<LinkAffiQuery, "offset" | "limit"> = {}): Promise<number> {
    const page = await this.getPage(table, { ...query, limit: 1 });
    return page.total;
  }

  private request<T>(path: string): Promise<T> {
    const run = async (): Promise<T> => {
      let attempt = 0;
      let lastErr: LinkAffiError | null = null;
      while (attempt < this.maxAttempts) {
        attempt++;
        await this.throttle();
        try {
          return await this.once<T>(path);
        } catch (err) {
          const e = err instanceof LinkAffiError ? err : new LinkAffiError(String(err), null, true);
          lastErr = e;
          if (!e.retryable || attempt >= this.maxAttempts) throw e;
          await this.sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
        }
      }
      throw lastErr ?? new LinkAffiError("Échec inconnu", null, false);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  private async once<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: { "x-api-key": this.apiKey, apikey: this.anonKey, accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      throw new LinkAffiError(`Erreur réseau : ${(err as Error).message}`, null, true);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403)
      throw new LinkAffiError(
        `Accès refusé (${res.status}) : vérifier les clés`,
        res.status,
        false,
      );
    if (res.status === 404) throw new LinkAffiError(`Introuvable (404) : ${path}`, 404, false);
    if (res.status === 429 || res.status >= 500)
      throw new LinkAffiError(`Réponse ${res.status}`, res.status, true);
    if (!res.ok) throw new LinkAffiError(`Réponse ${res.status}`, res.status, false);
    try {
      return (await res.json()) as T;
    } catch {
      throw new LinkAffiError("Réponse non JSON", res.status, false);
    }
  }
}

/** Tables que la plateforme a le droit de lire (voir docs/LINKAFFI-API.md). */
export const LINKAFFI_ALLOWED_TABLES = [
  "campaigns",
  "casinos",
  "clicks",
  "players",
  "player_events",
  "player_financials",
  "deposit_snapshots",
  "revshare_snapshots",
  "ftd_invalidations",
  "postback_logs",
  "untracked_postbacks",
  "stats",
  "landing_events_daily",
  "currency_rates",
  // Phase 13 (campagnes Telegram des affiliés) : annoncées par Link Affi, lues seulement si elles existent.
  "telegram_members",
  "telegram_member_events",
  "telegram_campaigns",
] as const;

export type LinkAffiTable = (typeof LINKAFFI_ALLOWED_TABLES)[number];
