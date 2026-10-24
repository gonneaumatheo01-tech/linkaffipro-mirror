/**
 * Outils des tests de la lecture (phase 27, chantier A) : pages `t.me/s` enregistrées (contenus inventés,
 * `packages/agents/fixtures/inspiration`), fausse attente, faux lecteur par compte réel. Aucun réseau. Jamais importé
 * par le code de production.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountHistoryReader, InspirationFetch, ReferencePostInput } from "../contract";

export const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "inspiration");
/** Horloge des fixtures : les dates des pages sont calculées depuis cet instant. */
export const FIXTURE_NOW = new Date("2026-10-24T12:00:00Z");
export const FIXTURE_CHANNELS = {
  casino: "casino_lumiere_exemple",
  sports: "paris_cadres_exemple",
  dating: "rencontres_douces_exemple",
  private: "canal_prive_exemple",
  restricted: "canal_restreint_exemple",
  empty: "canal_vide_exemple",
} as const;

/** Accès réseau simulé : `t.me/s/<nom>[?before=N]` → fichier enregistré ; sinon 404. Garde la liste des adresses. */
export function fixtureFetch(): InspirationFetch & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const m = url.match(/^https:\/\/t\.me\/s\/([A-Za-z0-9_]+)(?:\?before=(\d+))?$/);
    if (!m) return { status: 404, body: "" };
    const file = join(FIXTURES_DIR, m[2] ? `${m[1]}.before-${m[2]}.html` : `${m[1]}.html`);
    if (!existsSync(file)) return { status: 404, body: "" };
    return { status: 200, body: readFileSync(file, "utf8") };
  }) as InspirationFetch & { urls: string[] };
  f.urls = urls;
  return f;
}

/** Attente simulée : rien n'attend, les durées demandées sont gardées. */
export function fakeSleep(): ((ms: number) => Promise<void>) & { calls: number[] } {
  const calls: number[] = [];
  const s = (async (ms: number) => {
    calls.push(ms);
  }) as ((ms: number) => Promise<void>) & { calls: number[] };
  s.calls = calls;
  return s;
}

/** Posts fabriqués pour le faux MTProto : numéros `from` → `from - count + 1`, un toutes les `stepHours` heures. */
export function fakePosts(from: number, count: number, now = FIXTURE_NOW, stepHours = 6): ReferencePostInput[] {
  return Array.from({ length: count }, (_, i) => ({
    externalId: from - i,
    postedAt: new Date(now.getTime() - (i + 1) * stepHours * 3_600_000),
    text: `Post numéro ${from - i} : la cote du soir et le récap`,
    mediaKind: i % 3 === 0 ? ("photo" as const) : ("text" as const),
    views: 1000 + i,
    hasButton: i % 2 === 0,
    linkCount: 0,
  }));
}

/**
 * Faux MTProto : historique en mémoire (du plus récent au plus ancien), `FLOOD_WAIT` programmables (une valeur par
 * appel, dans l'ordre), comptes membres choisis. Jamais de `JoinChannel` : `joinWithInvite` seulement compté.
 */
export function fakeAccountReader(opts: { posts?: ReferencePostInput[]; members?: string[]; floods?: number[]; title?: string } = {}) {
  const all = [...(opts.posts ?? [])].sort((a, b) => b.externalId - a.externalId);
  const floods = [...(opts.floods ?? [])];
  const calls: Array<{ accountId: string; limit: number; beforeId?: number }> = [];
  const joins: Array<{ accountId: string; inviteLink: string }> = [];
  const reader: AccountHistoryReader & {
    calls: typeof calls;
    joins: typeof joins;
    joinWithInvite(accountId: string, inviteLink: string): Promise<{ ok: true; chatId: bigint; title: string }>;
  } = {
    calls,
    joins,
    async memberAccounts() {
      return opts.members ?? ["acc1"];
    },
    async history(accountId, _channel, o) {
      calls.push({ accountId, limit: o.limit, ...(o.beforeId !== undefined ? { beforeId: o.beforeId } : {}) });
      const flood = floods.shift();
      if (flood) return { floodWaitSeconds: flood };
      const list = all.filter((p) => o.beforeId === undefined || p.externalId < o.beforeId).slice(0, o.limit);
      return { posts: list, title: opts.title ?? "Canal privé (exemple)", chatId: -100777n };
    },
    async joinWithInvite(accountId, inviteLink) {
      joins.push({ accountId, inviteLink });
      return { ok: true, chatId: -100777n, title: "Canal privé (exemple)" };
    },
  };
  return reader;
}
