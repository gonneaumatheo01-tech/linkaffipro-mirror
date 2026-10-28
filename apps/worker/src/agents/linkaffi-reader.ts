/**
 * Phase 32, chantier B — lecteur Link Affi réel de la boucle de la prospection (`LinkAffiReader`), lecture seule.
 *
 * - Client `LinkAffiClient` de `packages/linkaffi` : GET seulement (le client n'a aucune méthode d'écriture), 1 requête
 *   par seconde, clés `LINKAFFI_API_URL`, `LINKAFFI_API_KEY`, `LINKAFFI_ANON_KEY` du worker.
 * - Tables lues : `stats` (`eq.affiliate_id`, `from` / `to`, `date_col=date`) pour les agrégats d'un affilié,
 *   `campaigns` pour les affiliés récents, `profiles` (`eq.id`) pour le NOM seulement (exception documentée de
 *   `docs/LINKAFFI-API.md`). Rien d'autre n'est gardé que l'identifiant, le nom et les agrégats.
 * - Variables absentes → `null` : la boucle dit « Link Affi non configuré ».
 */
import { LinkAffiClient } from "@linkaffipro/linkaffi";
import { aggregateAffiliateStats, profileNameOf, recentAffiliatesFrom, type LinkAffiReader } from "@linkaffipro/agents";

/** Seule partie du client utilisée : des lectures. */
export type LinkAffiReadClient = Pick<LinkAffiClient, "getPage" | "getAll">;

/** Campagnes lues pour trouver les affiliés récents (les plus récentes d'abord). */
export const RECENT_CAMPAIGNS_LIMIT = 300;

export function createLinkAffiReaderFrom(client: LinkAffiReadClient): LinkAffiReader {
  return {
    async affiliateStats(affiliateId, from, to) {
      const rows = await client.getAll("stats", { eq: { affiliate_id: affiliateId }, from, to, date_col: "date" });
      return aggregateAffiliateStats(rows);
    },
    async recentAffiliates(limit) {
      const page = await client.getPage("campaigns", { order: "-created_at", limit: RECENT_CAMPAIGNS_LIMIT });
      const recent = recentAffiliatesFrom(page.rows, limit);
      const out: Array<{ affiliateId: string; name: string | null; firstCampaignAt: string | null }> = [];
      for (const r of recent) {
        let name: string | null = null;
        try {
          const p = await client.getPage("profiles", { eq: { id: r.affiliateId }, limit: 1 });
          name = profileNameOf(p.rows[0]);
        } catch {
          name = null;
        }
        out.push({ affiliateId: r.affiliateId, name, firstCampaignAt: r.firstCampaignAt });
      }
      return out;
    },
  };
}

/** Lecteur réel, ou null si les variables `LINKAFFI_*` manquent. */
export function createLinkAffiReader(env: NodeJS.ProcessEnv = process.env): LinkAffiReader | null {
  if (!env.LINKAFFI_API_URL || !env.LINKAFFI_API_KEY || !env.LINKAFFI_ANON_KEY) return null;
  try {
    return createLinkAffiReaderFrom(new LinkAffiClient({ baseUrl: env.LINKAFFI_API_URL, apiKey: env.LINKAFFI_API_KEY, anonKey: env.LINKAFFI_ANON_KEY }));
  } catch {
    return null;
  }
}
