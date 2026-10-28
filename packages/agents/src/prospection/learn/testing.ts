/**
 * Phase 32, chantier B — faux lecteur Link Affi des tests (réponses simulées de `fixtures/prospection/learn/`, aucun
 * réseau). Même agrégation que le lecteur réel du worker. Jamais importé par le code de production.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LinkAffiReader } from "../contract-advanced";
import { aggregateAffiliateStats, profileNameOf, recentAffiliatesFrom } from "./linkaffi-rows";

type Row = Record<string, unknown>;
const FIX = fileURLToPath(new URL("../../../fixtures/prospection/learn/", import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(`${FIX}${name}`, "utf8")) as T;

/** Lignes simulées : `stats` par affilié et par mois, `campaigns`, `profiles`. */
export function learnFixtures() {
  return {
    stats: load<Record<string, Record<string, Row[]>>>("stats.json"),
    campaigns: load<Row[]>("campaigns.json"),
    profiles: load<Row[]>("profiles.json"),
  };
}

/** Faux lecteur ; `override` remplace les lignes `stats` d'un affilié (ex. aucun clic). Les appels sont notés. */
export function createFakeLinkAffiReader(override: Record<string, Row[]> = {}) {
  const fx = learnFixtures();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const statsOf = (id: string) => override[id] ?? Object.values(fx.stats[id] ?? {}).flat();
  const reader: LinkAffiReader & { calls: typeof calls } = {
    calls,
    async affiliateStats(affiliateId, from, to) {
      calls.push({ method: "affiliateStats", args: [affiliateId, from, to] });
      return aggregateAffiliateStats(statsOf(affiliateId).filter((r) => String(r.date) >= from && String(r.date) <= to));
    },
    async recentAffiliates(limit) {
      calls.push({ method: "recentAffiliates", args: [limit] });
      return recentAffiliatesFrom(fx.campaigns, limit).map((r) => ({ ...r, name: profileNameOf(fx.profiles.find((p) => p.id === r.affiliateId)) }));
    },
  };
  return reader;
}
