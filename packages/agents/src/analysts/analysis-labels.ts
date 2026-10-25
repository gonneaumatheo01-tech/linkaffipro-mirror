/**
 * Phase 29, chantier B — libellés français des marchés, plateformes et pays (textes de Kevin, rapports).
 */
import type { CompliancePlatform, Market } from "./contract";

export const MARKETS: readonly Market[] = ["CASINO", "SPORTS", "DATING"];
export const MARKET_LABELS: Readonly<Record<Market, string>> = { CASINO: "casino", SPORTS: "paris sportifs", DATING: "rencontres" };
export const PLATFORM_LABELS: Readonly<Record<CompliancePlatform, string>> = { META: "Meta", TIKTOK: "TikTok", GOOGLE: "Google", SNAP: "Snapchat", X: "X", TELEGRAM: "Telegram", OTHER: "une autre plateforme" };
export const COUNTRY_LABELS: Readonly<Record<string, string>> = {
  ALL: "toute l'Europe", FR: "France", BE: "Belgique", LU: "Luxembourg", CH: "Suisse", DE: "Allemagne", AT: "Autriche", ES: "Espagne", IT: "Italie",
  PT: "Portugal", NL: "Pays-Bas", PL: "Pologne", SE: "Suède", NO: "Norvège", DK: "Danemark", FI: "Finlande", CZ: "Tchéquie", RO: "Roumanie",
  GR: "Grèce", HU: "Hongrie", BG: "Bulgarie", HR: "Croatie", SK: "Slovaquie", SI: "Slovénie", EE: "Estonie", LV: "Lettonie", LT: "Lituanie",
  IE: "Irlande", GB: "Royaume-Uni", MT: "Malte", CY: "Chypre",
};
export const countryLabel = (c: string) => COUNTRY_LABELS[c.toUpperCase()] ?? c.toUpperCase();
