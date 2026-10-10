/**
 * Lien entre une de nos campagnes et une campagne pub TikTok / Meta (règles pures).
 *
 * La colonne `Campaign.adExternalIds` (Json, libre jusqu'ici) porte un petit repère :
 * `{ source: "sync", platformName }` pour une campagne pub créée par la synchro d'un compte connecté (« coquille »
 * importée, sans offre ni canal), `{ source: "linked", platformName }` pour une de nos campagnes rattachée à une
 * campagne pub (par l'assistant, par « Rattacher une campagne pub importée » ou par adoption pendant la synchro).
 * `platformName` = nom de la campagne pub chez TikTok / Meta. Même lecture dans `apps/worker/src/ads/plan.ts`.
 */
import { jsonIds } from "./attribution";
import { normalizeName } from "./match";

export type AdCampaignLink = { source: "sync" | "linked"; platformName: string | null };

/** Lit le repère (null si absent ou illisible). */
export function readAdLink(value: unknown): AdCampaignLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.source !== "sync" && v.source !== "linked") return null;
  return {
    source: v.source,
    platformName: typeof v.platformName === "string" ? v.platformName : null,
  };
}

/** Repère à écrire quand une de nos campagnes est rattachée à une campagne pub. */
export function linkedAdLink(platformName: string | null): AdCampaignLink {
  return { source: "linked", platformName };
}

type CampaignLike = {
  externalCampaignId: string | null;
  adExternalIds: unknown;
  affiliateCampaignIds: unknown;
  channelIds: unknown;
};

/**
 * Vrai pour une campagne pub importée par la synchro et pas encore rattachée : identifiant externe présent, repère
 * « sync » (ou, pour les campagnes plus anciennes sans repère, aucune offre ni aucun canal) et toujours ni offre ni
 * canal. C'est ce qu'on peut « rattacher » à une de nos campagnes, et ce qui porte le badge « importée ».
 */
export function isImportedShell(c: CampaignLike): boolean {
  if (!c.externalCampaignId) return false;
  const link = readAdLink(c.adExternalIds);
  if (link?.source === "linked") return false;
  return jsonIds(c.affiliateCampaignIds).length === 0 && jsonIds(c.channelIds).length === 0;
}

/**
 * Rapprochement par le nom : parmi des campagnes pub importées libres, celle dont le nom est le même que celui de notre
 * campagne (casse, accents et espaces ignorés). Plusieurs candidates : ambigu, aucune (rattachement à faire à la main
 * depuis l'onglet Pubs). Même règle que l'adoption par la synchro (`apps/worker/src/ads/plan.ts`).
 */
export function pickShellByName<T extends { id: string; name: string }>(
  name: string,
  shells: readonly T[],
): T | null {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const hits = shells.filter((s) => normalizeName(s.name) === wanted);
  return hits.length === 1 ? hits[0]! : null;
}
