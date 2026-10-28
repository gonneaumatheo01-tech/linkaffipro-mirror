/**
 * Outils des tests du lecteur : pages `t.me/s` enregistrées (contenus inventés, `packages/agents/fixtures/channel-reader`),
 * fausse attente. Aucun réseau. Jamais importé par le code de production.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PreviewFetch } from "./types";

export const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "fixtures", "channel-reader");
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
export function fixtureFetch(): PreviewFetch & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const m = url.match(/^https:\/\/t\.me\/s\/([A-Za-z0-9_]+)(?:\?before=(\d+))?$/);
    if (!m) return { status: 404, body: "" };
    const file = join(FIXTURES_DIR, m[2] ? `${m[1]}.before-${m[2]}.html` : `${m[1]}.html`);
    if (!existsSync(file)) return { status: 404, body: "" };
    return { status: 200, body: readFileSync(file, "utf8") };
  }) as PreviewFetch & { urls: string[] };
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
