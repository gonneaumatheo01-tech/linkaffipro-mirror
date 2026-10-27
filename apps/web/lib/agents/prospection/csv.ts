/**
 * Phase 31 — export CSV des canaux trouvés (lignes filtrées de la page Prospection, ou lien donné par Kevin). Les
 * canaux hors Europe n'y sont jamais (même condition que la page : `prospectWhere`) ; par sécurité, une ligne
 * `NON_EU` reçue hors du périmètre élargi est retirée ici aussi. Jamais le texte d'un post : chiffres, classements,
 * marques, contact public, statut. Règles pures.
 */
import { countryName } from "@/lib/agents/analyses";
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { statusLabel } from "@/lib/status-badges";
import {
  COMPETITION_LABELS,
  SOURCE_TYPE_LABELS,
  VERTICAL_LABELS,
  brandList,
  countryList,
  extraScopeCountries,
  languageName,
  opennessText,
  publicChannelUrl,
} from "./display";

export type ProspectCsvRow = {
  id: string;
  username: string | null;
  channelUrl: string;
  title: string;
  kind: string;
  tier: string | null;
  score: number | null;
  vertical: string;
  region: string;
  countries: unknown;
  language: string | null;
  subscribers: number | null;
  medianViews: number | null;
  viewRate: number | null;
  postsPerDay: number | null;
  competitiveState: string | null;
  brands: unknown;
  monetization: unknown;
  contactConfidence: string;
  bestContact: string | null;
  status: string;
  sourceType: string;
  statusChangedAt: Date | null;
  discoveredAt: Date;
  tierReason: string | null;
};

export const PROSPECTS_CSV_HEADERS = [
  "Canal",
  "Lien",
  "Niveau",
  "Note sur 100",
  "Marché",
  "Pays",
  "Langue",
  "Abonnés",
  "Vues par post (médiane)",
  "Part des abonnés qui lisent (%)",
  "Posts par jour",
  "Concurrence",
  "Marques",
  "Ouverture",
  "Contact",
  "Fiabilité du contact",
  "Statut",
  "Source",
  "Dernière action (Paris)",
  "Trouvé le (Paris)",
  "Pourquoi ce niveau",
  "Identifiant",
];

/** Ligne affichable dans l'export : jamais hors Europe, sauf pays ajouté au périmètre. */
export function exportable(row: Pick<ProspectCsvRow, "region" | "countries">, scope: readonly string[]): boolean {
  if (row.region !== "NON_EU") return true;
  const extra = new Set(extraScopeCountries(scope));
  return countryList(row.countries).some((c) => extra.has(c));
}

export function prospectsCsv(rows: readonly ProspectCsvRow[], scope: readonly string[]): string {
  return toCsv(
    PROSPECTS_CSV_HEADERS,
    rows
      .filter((r) => exportable(r, scope))
      .map((r) => [
        r.title || (r.username ? `@${r.username}` : ""),
        publicChannelUrl(r) ?? "",
        r.tier ?? "",
        r.score ?? "",
        VERTICAL_LABELS[r.vertical] ?? r.vertical,
        countryList(r.countries).map(countryName).join(", "),
        r.language ? languageName(r.language) : "",
        r.subscribers ?? "",
        r.medianViews ?? "",
        r.viewRate == null ? "" : csvNumber(r.viewRate * 100, 1),
        r.postsPerDay == null ? "" : csvNumber(r.postsPerDay, 1),
        r.competitiveState ? (COMPETITION_LABELS[r.competitiveState] ?? r.competitiveState) : "",
        brandList(r.brands)
          .map((b) => (b.promoCode ? `${b.brand} (code ${b.promoCode})` : b.brand))
          .join(", "),
        opennessText(r.monetization).replace(/^—$/, ""),
        r.bestContact ?? "",
        statusLabel("contactConfidence", r.contactConfidence),
        statusLabel("prospectStatus", r.status),
        SOURCE_TYPE_LABELS[r.sourceType] ?? r.sourceType,
        csvDate(r.statusChangedAt),
        csvDate(r.discoveredAt),
        r.tierReason ?? "",
        r.id,
      ]),
  );
}
