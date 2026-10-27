/**
 * Phase 31, chantier A (Sourceur) : source C, réseaux sociaux. Les tipsters et streamers casino renvoient souvent de
 * TikTok, Instagram, YouTube ou X vers Telegram : recherche `site:tiktok.com` / `instagram.com` / `youtube.com` /
 * `x.com` + gabarit + « telegram », puis liens `t.me` des bios et descriptions (1 page publique par résultat). Aucun
 * compte social n'est utilisé ; une page inaccessible (connexion demandée, blocage) est passée.
 */
import type { DiscoveryLot, ProspectionDeps } from "../../contract";
import { clockOf, type PoliteProspectDeps } from "../polite";
import type { SourceFindResult } from "./common";
import { buildQueries, searchAndDig } from "./web-search";

export const SOCIAL_FORMS = ["site:tiktok.com {q} telegram", "site:instagram.com {q} telegram", "site:youtube.com {q} telegram", "site:x.com {q} telegram"] as const;

/** Un gabarit par langue et par passage (4 réseaux chacun). */
export const SOCIAL_TEMPLATES_PER_LANGUAGE = 1;

export async function findSocialCandidates(deps: ProspectionDeps & PoliteProspectDeps, lot: DiscoveryLot): Promise<SourceFindResult> {
  const queries = buildQueries(lot, SOCIAL_FORMS, new Date(clockOf(deps)), SOCIAL_TEMPLATES_PER_LANGUAGE);
  return searchAndDig(deps, lot, { sourceType: "SOCIAL", queries, maxPages: 16 });
}
