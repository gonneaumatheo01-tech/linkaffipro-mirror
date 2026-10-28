/**
 * Phase 32, chantier C — Source « recherche par compte réel » (règle 5 : lecture seule, plafonnée, jamais sur un
 * compte qui converse, désactivée par défaut, activée seulement par CONFIRM du client via Kevin).
 *
 * Le worker ne se connecte JAMAIS à un compte réel (une seconde connexion ferait révoquer la session) : il dépose ses
 * demandes dans la boîte aux lettres du service `apps/userbot` (`Setting userbot.request.<id>`, même voie que la phase
 * 27), sorte `prospect-search`, deux opérations et UN appel Telegram chacune :
 * - `search` : recherche globale par mots-clés (gabarits versionnés de `dict/queries.json`, langue × verticale ; aucune
 *   IA : 130 gabarits par verticale suffisent à la rotation) ;
 * - `profile` : fiche publique d'un canal trouvé (abonnés, description, groupe lié).
 * Aucune adhésion, aucun message, aucun lien d'invitation : ce module n'importe ni n'appelle rien qui rejoigne ou écrive
 * (test adverse `account-search.test.ts`, et `prospection/no-contact.test.ts`).
 *
 * Débit (`ACCOUNT_SEARCH`) : 1 demande toutes les 5 s (toutes demandes confondues, repère `lastAt` gardé entre deux
 * lots), 100 par jour et par compte, 20 par lot ; comptes libres seulement (`freeReaderAccounts` : actifs, sans
 * persona, sans bot fantôme, sans DM depuis 7 jours), le moins utilisé du jour d'abord. Premier FLOOD_WAIT ou premier
 * avertissement de Telegram → arrêt du lot, source coupée (`enabled = false`) et Kevin prévient l'admin. Une lecture
 * à la fois (`Setting prospection.account_search.lock`) : un second lot est remis 6 minutes plus tard.
 *
 * Les candidats (`sourceType = ACCOUNT_SEARCH`) passent par `upsertCandidates` du Sourceur, puis la chaîne normale
 * (l'Enrichisseur lit `t.me/s/`, jamais le compte).
 */
import { agentEvent, readSetting, writeSetting } from "../../../admin/journal";
import { pick } from "../../../boss/voice";
import { freeReaderAccounts } from "../../../inspiration/sources/account";
import { askUserbot, USERBOT_SHORT_TIMEOUT_MS, userbotMailboxAlive, UserbotTimeout } from "../../../inspiration/sources/userbot-mailbox";
import { parisDay } from "../../../rules/time";
import type { AgentsPrisma } from "../../../types";
import { ACCOUNT_SEARCH, type ProspectionAdvancedJob } from "../../contract-advanced";
import { PROSPECTION_SETTINGS, type Candidate } from "../../contract";
import { QUERY_LANGUAGES, queriesFor } from "../../dict";
import type { ProspectionKevinDeps } from "../../kevin-port";
import { PROSPECTION_ADVANCED_KEVIN_VARIANTS as V } from "../../kevin-advanced-texts";
import { upsertCandidates } from "../dedupe";
import { prospectionClockOf } from "../polite";

type Lot = Extract<ProspectionAdvancedJob, { type: "prospection.account-search" }>["lot"];

// ------------------------------------------------------------------------------------------------ protocole

export const PROSPECT_SEARCH_KIND = "prospect-search";

export type FoundChannel = { id: string; accessHash: string | null; username: string; title: string | null; subscribers: number | null };
export type ChannelProfile = {
  id: string;
  username: string | null;
  title: string | null;
  subscribers: number | null;
  about: string | null;
  linkedChat: { username: string | null; title: string | null } | null;
};

/** Demande déposée pour le userbot (copie structurelle dans `apps/userbot/src/prospect-search.ts`). */
export type ProspectSearchWireRequest =
  | { kind: "prospect-search"; accountId: string; op: "search"; query: string; limit: number }
  | { kind: "prospect-search"; accountId: string; op: "profile"; channel: { id: string; accessHash: string | null; username: string | null } };
export type ProspectSearchWireResponse =
  | { ok: true; calls: number; channels?: FoundChannel[]; profile?: ChannelProfile }
  | { ok: false; error: string }
  | { ok: false; floodWaitSeconds: number }
  | { ok: false; warning: string };

/** Résultat d'une demande vu par le lot. `unavailable` : le service des comptes ne répond plus (arrêt du lot). */
export type SearchOutcome<T> =
  | { ok: true; value: T; calls: number }
  | { ok: false; floodWaitSeconds: number }
  | { ok: false; warning: string }
  | { ok: false; error: string; unavailable?: boolean };

/** Transport vers les sessions des comptes réels : le userbot (réel), un faux en test. LECTURE SEULE. */
export type AccountSearchTransport = {
  search(accountId: string, query: string, limit: number): Promise<SearchOutcome<FoundChannel[]>>;
  profile(accountId: string, channel: { id: string; accessHash: string | null; username: string | null }): Promise<SearchOutcome<ChannelProfile>>;
};

export type AccountSearchDeps = ProspectionKevinDeps & {
  accountSearch?: {
    /** Transport imposé (tests) ; null = indisponible. Absent : boîte aux lettres du userbot. */
    transport?: AccountSearchTransport | null;
    /** Comptes libres imposés (tests). Absent : `freeReaderAccounts`. */
    accounts?: (now: Date) => Promise<string[]>;
  };
};

function fromWire<T>(r: ProspectSearchWireResponse, value: (r: Extract<ProspectSearchWireResponse, { ok: true }>) => T | undefined): SearchOutcome<T> {
  if (r.ok) {
    const v = value(r);
    return v === undefined ? { ok: false, error: "réponse vide du service des comptes réels" } : { ok: true, value: v, calls: Math.max(1, Number(r.calls) || 1) };
  }
  if ("floodWaitSeconds" in r) return { ok: false, floodWaitSeconds: r.floodWaitSeconds };
  if ("warning" in r) return { ok: false, warning: r.warning };
  return { ok: false, error: r.error };
}

/**
 * Transport réel par la boîte aux lettres du userbot ; null si sa boucle ne s'est pas signalée depuis une minute.
 * Pas de réponse à temps → `unavailable` (le lot s'arrête, jamais d'autre essai ici).
 */
export async function createUserbotSearchTransport(
  prisma: AgentsPrisma,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => Date } = {},
): Promise<AccountSearchTransport | null> {
  if (!(await userbotMailboxAlive(prisma, opts.now?.() ?? new Date()))) return null;
  const ask = async (req: ProspectSearchWireRequest): Promise<ProspectSearchWireResponse | { timeout: true }> => {
    try {
      return await askUserbot<ProspectSearchWireRequest, ProspectSearchWireResponse>(prisma, req, { timeoutMs: USERBOT_SHORT_TIMEOUT_MS, ...opts });
    } catch (err) {
      if (err instanceof UserbotTimeout) return { timeout: true };
      throw err;
    }
  };
  const unavailable = { ok: false as const, error: "le service des comptes réels n'a pas répondu à temps", unavailable: true };
  return {
    async search(accountId, query, limit) {
      const r = await ask({ kind: PROSPECT_SEARCH_KIND, accountId, op: "search", query, limit: Math.min(ACCOUNT_SEARCH.perLot, limit) });
      return "timeout" in r ? unavailable : fromWire(r, (x) => x.channels);
    },
    async profile(accountId, channel) {
      const r = await ask({ kind: PROSPECT_SEARCH_KIND, accountId, op: "profile", channel });
      return "timeout" in r ? unavailable : fromWire(r, (x) => x.profile);
    },
  };
}

// ------------------------------------------------------------------------------------------------ réglages et compteurs

export const ACCOUNT_SEARCH_LOCK_KEY = "prospection.account_search.lock";
/** Verrou plus vieux que 15 minutes : abandonné (lot tué). */
const LOCK_STALE_MS = 15 * 60_000;
/** Lot remis à plus tard quand un autre tourne. */
const BUSY_RETRY_MS = 6 * 60_000;
/** Profils lus après chaque recherche (le reste des demandes du lot sert aux recherches suivantes). */
const PROFILES_PER_SEARCH = 3;

export type AccountSearchCounters = {
  day: string;
  perAccount: Record<string, number>;
  flood?: { at: string; seconds?: number; warning?: string } | null;
  /** Dernière demande (toutes demandes confondues) : 5 s au moins avant la suivante. */
  lastAt?: string | null;
  /** Rotation des gabarits par verticale. */
  cursor?: Record<string, number>;
};

export async function accountSearchEnabled(deps: Pick<ProspectionKevinDeps, "prisma">): Promise<boolean> {
  return (await readSetting(deps, ACCOUNT_SEARCH.enabled.key)) === true;
}

/** Compteurs du jour (Paris) ; un nouveau jour remet les comptes à zéro (rotation et dernier appel gardés). */
export async function readAccountSearchCounters(deps: Pick<ProspectionKevinDeps, "prisma">, now: Date): Promise<AccountSearchCounters> {
  const raw = (await readSetting(deps, ACCOUNT_SEARCH.countersKey)) as Partial<AccountSearchCounters> | undefined | null;
  const day = parisDay(now);
  const base: AccountSearchCounters = { day, perAccount: {}, flood: null, lastAt: raw?.lastAt ?? null, cursor: raw?.cursor ?? {} };
  if (!raw || typeof raw !== "object" || raw.day !== day) return base;
  return { ...base, perAccount: { ...(raw.perAccount ?? {}) }, flood: raw.flood ?? null };
}

/** Demandes faites aujourd'hui (tous comptes). */
export function requestsToday(c: AccountSearchCounters): number {
  return Object.values(c.perAccount).reduce((s, n) => s + (Number(n) || 0), 0);
}

/**
 * Pose l'interrupteur (Kevin après le OUI, ou coupure). Une activation efface la trace du dernier FLOOD_WAIT du jour ;
 * les compteurs du jour restent (le plafond de 100 par compte tient toujours).
 */
export async function setAccountSearchEnabled(deps: ProspectionKevinDeps, on: boolean, now: Date): Promise<void> {
  await writeSetting(deps, ACCOUNT_SEARCH.enabled.key, on);
  if (on) {
    const c = await readAccountSearchCounters(deps, now);
    await writeSetting(deps, ACCOUNT_SEARCH.countersKey, { ...c, flood: null });
  }
}

/** Requêtes du lot (pur) : gabarits des langues, à tour de rôle (une langue après l'autre), à partir du curseur. */
export function accountSearchQueries(vertical: "SPORTS" | "CASINO", languages: readonly string[], cursor: number, count: number): Array<{ language: string; query: string }> {
  const langs = (languages.length ? languages : QUERY_LANGUAGES).filter((l) => queriesFor(l, vertical).length);
  const all: Array<{ language: string; query: string }> = [];
  const longest = Math.max(0, ...langs.map((l) => queriesFor(l, vertical).length));
  for (let i = 0; i < longest; i++) for (const l of langs) {
    const q = queriesFor(l, vertical)[i];
    if (q) all.push({ language: l, query: q });
  }
  if (!all.length) return [];
  const out: Array<{ language: string; query: string }> = [];
  for (let i = 0; i < Math.min(count, all.length); i++) out.push(all[(((cursor + i) % all.length) + all.length) % all.length]!);
  return out;
}

async function claimLock(deps: ProspectionKevinDeps, now: Date): Promise<boolean> {
  const value = { at: now.toISOString() };
  try {
    await deps.prisma.setting.create({ data: { key: ACCOUNT_SEARCH_LOCK_KEY, value } });
    return true;
  } catch {
    const cur = (await readSetting(deps, ACCOUNT_SEARCH_LOCK_KEY)) as { at?: string } | undefined;
    const at = Date.parse(String(cur?.at ?? ""));
    if (Number.isFinite(at) && now.getTime() - at < LOCK_STALE_MS) return false;
    await deps.prisma.setting.deleteMany({ where: { key: ACCOUNT_SEARCH_LOCK_KEY } });
    try {
      await deps.prisma.setting.create({ data: { key: ACCOUNT_SEARCH_LOCK_KEY, value } });
      return true;
    } catch {
      return false;
    }
  }
}

async function releaseLock(deps: ProspectionKevinDeps): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: ACCOUNT_SEARCH_LOCK_KEY } }).catch(() => undefined);
}

/** Coupe la source et prévient l'admin (premier FLOOD_WAIT ou avertissement de Telegram). */
async function stopForTelegram(deps: ProspectionKevinDeps, counters: AccountSearchCounters, now: Date, why: { seconds?: number; warning?: string }): Promise<void> {
  await writeSetting(deps, ACCOUNT_SEARCH.enabled.key, false);
  counters.flood = { at: now.toISOString(), ...(why.seconds !== undefined ? { seconds: why.seconds } : {}), ...(why.warning ? { warning: why.warning } : {}) };
  await writeSetting(deps, ACCOUNT_SEARCH.countersKey, counters);
  await agentEvent(deps, "prospection.account_search.stopped", { seconds: why.seconds ?? null, warning: why.warning ?? null });
  const text = why.warning ? pick(V.accountWarningStopped, "prospection.account.warning") : pick(V.accountFloodStopped({ seconds: why.seconds ?? 0 }), "prospection.account.flood");
  await deps.admin?.send(text).catch(() => null);
}

export type AccountSearchResult = { ok: boolean; requests: number; found: number; newCount: number; stopped?: string | null };

/** Un lot de recherche (20 demandes au plus) ; refusé si la source n'est pas activée. Ne lève pas sur une erreur réseau. */
export async function runAccountSearch(deps0: ProspectionKevinDeps, lot: Lot): Promise<AccountSearchResult> {
  const deps = deps0 as AccountSearchDeps;
  const nowOf = () => new Date(prospectionClockOf(deps));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out = (stopped: string | null, extra: Partial<AccountSearchResult> = {}): AccountSearchResult => ({ ok: stopped === null, requests: 0, found: 0, newCount: 0, stopped, ...extra });

  if (!(await accountSearchEnabled(deps))) return out("désactivée");
  const enabled = await readSetting(deps, PROSPECTION_SETTINGS.enabled.key);
  if (enabled === false) return out("prospection en pause");
  if (!(await claimLock(deps, nowOf()))) {
    const day = parisDay(nowOf());
    await deps.prospection?.enqueue?.({ type: "prospection.account-search", lot }, { jobId: `prospection.account-search:${day}:${lot.vertical}:suite`, delayMs: BUSY_RETRY_MS });
    return out("une recherche par compte tourne déjà");
  }
  try {
    const transport =
      deps.accountSearch && "transport" in deps.accountSearch ? (deps.accountSearch.transport ?? null) : await createUserbotSearchTransport(deps.prisma, { now: nowOf, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
    if (!transport) return out("service des comptes réels indisponible");
    const accounts = await (deps.accountSearch?.accounts ?? ((now: Date) => freeReaderAccounts(deps.prisma, now, { allowPersona: false })))(nowOf());
    if (!accounts.length) return out("aucun compte réel libre");

    const counters = await readAccountSearchCounters(deps, nowOf());
    const cursor = counters.cursor?.[lot.vertical] ?? 0;
    const queries = accountSearchQueries(lot.vertical, lot.languages, cursor, ACCOUNT_SEARCH.perLot);
    if (!queries.length) return out("aucune requête pour ces langues");

    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const errors: string[] = [];
    let requests = 0;
    let searches = 0;
    let found = 0;
    let stopped: string | null = null;

    const nextAccount = (): string | null => {
      const free = accounts.filter((a) => (counters.perAccount[a] ?? 0) < ACCOUNT_SEARCH.perAccountPerDay);
      if (!free.length) return null;
      return free.reduce((best, a) => ((counters.perAccount[a] ?? 0) < (counters.perAccount[best] ?? 0) ? a : best), free[0]!);
    };

    /** Une demande, au rythme (5 s depuis la précédente), comptée avant l'appel ; rend l'issue ou null si arrêt. */
    const request = async <T>(call: (accountId: string) => Promise<SearchOutcome<T>>): Promise<SearchOutcome<T> | null> => {
      if (requests >= ACCOUNT_SEARCH.perLot) return null;
      const account = nextAccount();
      if (!account) {
        stopped = "plafond du jour atteint (100 par compte)";
        return null;
      }
      const last = Date.parse(String(counters.lastAt ?? ""));
      if (Number.isFinite(last)) {
        const wait = last + ACCOUNT_SEARCH.rateMs - nowOf().getTime();
        if (wait > 0) await sleep(wait);
      }
      requests++;
      counters.perAccount[account] = (counters.perAccount[account] ?? 0) + 1;
      counters.lastAt = nowOf().toISOString();
      let r: SearchOutcome<T>;
      try {
        r = await call(account);
      } catch (err) {
        r = { ok: false, error: String((err as Error)?.message ?? err).slice(0, 160) };
      }
      if (r.ok && r.calls > 1) counters.perAccount[account] = (counters.perAccount[account] ?? 0) + (r.calls - 1);
      await writeSetting(deps, ACCOUNT_SEARCH.countersKey, counters);
      if (!r.ok && "floodWaitSeconds" in r) {
        stopped = "FLOOD_WAIT";
        await stopForTelegram(deps, counters, nowOf(), { seconds: r.floodWaitSeconds });
        return null;
      }
      if (!r.ok && "warning" in r) {
        stopped = "avertissement de Telegram";
        await stopForTelegram(deps, counters, nowOf(), { warning: r.warning });
        return null;
      }
      if (!r.ok) {
        errors.push(r.error);
        if (r.unavailable) {
          stopped = "service des comptes réels sans réponse";
          return null;
        }
      }
      return r;
    };

    for (const q of queries) {
      if (stopped || requests >= ACCOUNT_SEARCH.perLot) break;
      const res = await request((acc) => transport.search(acc, q.query, ACCOUNT_SEARCH.perLot));
      searches++;
      if (!res) break;
      if (!res.ok) continue;
      const fresh = res.value.filter((c) => c.username && !seen.has(c.username.toLowerCase()));
      for (const c of fresh) seen.add(c.username.toLowerCase());
      found += fresh.length;
      // Canaux déjà connus : pas de fiche à relire (le dédoublonnage du Sourceur compte la citation).
      const known = fresh.length
        ? new Set(
            ((await deps.prisma.prospect.findMany({ where: { username: { in: fresh.map((c) => c.username) } } as never, select: { username: true } as never })) as Array<{ username: string | null }>)
              .map((p) => (p.username ?? "").toLowerCase())
              .filter(Boolean),
          )
        : new Set<string>();
      let profiles = 0;
      for (const c of fresh) {
        let profile: ChannelProfile | null = null;
        if (!known.has(c.username.toLowerCase()) && profiles < PROFILES_PER_SEARCH && !stopped && requests < ACCOUNT_SEARCH.perLot) {
          profiles++;
          const p = await request((acc) => transport.profile(acc, { id: c.id, accessHash: c.accessHash, username: c.username }));
          if (p?.ok) profile = p.value;
        }
        const linked = profile?.linkedChat?.username ? `, groupe lié @${profile.linkedChat.username}` : "";
        candidates.push({
          url: `https://t.me/${c.username}`,
          sourceType: "ACCOUNT_SEARCH",
          sourceDetail: `compte réel «\u00a0${q.query}\u00a0» (${q.language})${linked}`.slice(0, 300),
          title: profile?.title ?? c.title,
          announcedSubscribers: profile?.subscribers ?? c.subscribers,
          kind: "CHANNEL",
          vertical: lot.vertical,
          language: q.language,
        });
      }
    }

    counters.cursor = { ...(counters.cursor ?? {}), [lot.vertical]: cursor + searches };
    await writeSetting(deps, ACCOUNT_SEARCH.countersKey, counters);
    const run = await upsertCandidates(
      deps,
      candidates,
      { sourceType: "ACCOUNT_SEARCH", sourceDetail: `compte réel ${lot.vertical} ${[...new Set(queries.slice(0, searches).map((q) => q.language))].join(",")}${lot.requestId ? ` demande ${lot.requestId}` : ""}`, languages: [...new Set(queries.map((q) => q.language))], vertical: lot.vertical },
      { errors: stopped ? [...errors, `Arrêt : ${stopped}`] : errors },
    );
    await agentEvent(deps, "prospection.account_search.lot", { vertical: lot.vertical, requests, found, newCount: run.newCount, stopped });
    return { ok: stopped === null, requests, found, newCount: run.newCount, stopped };
  } finally {
    await releaseLock(deps);
  }
}
