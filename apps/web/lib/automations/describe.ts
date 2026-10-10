import { parseConditions, SPEND_LEVEL_LABELS } from "@linkaffipro/core";

export type NameMaps = {
  channels: Record<string, string>;
  campaigns: Record<string, string>;
  categories: Record<string, string>;
};

/** Filtres du départ d'une relance, en français courant (« canal : Casino VIP · rien fait depuis 7 jours »). */
export function describeConditions(raw: unknown, names: NameMaps): string {
  let c;
  try {
    c = parseConditions(raw);
  } catch {
    return "filtres à corriger";
  }
  const list = (ids: string[], map: Record<string, string>, fallback: string) =>
    ids.map((id) => map[id] ?? fallback).join(", ");
  const parts: string[] = [];
  if (c.channelIds?.length)
    parts.push(
      `${c.channelIds.length > 1 ? "canaux" : "canal"} : ${list(c.channelIds, names.channels, "canal supprimé")}`,
    );
  if (c.campaignIds?.length)
    parts.push(
      `${c.campaignIds.length > 1 ? "campagnes" : "campagne"} : ${list(c.campaignIds, names.campaigns, "campagne supprimée")}`,
    );
  if (c.languages?.length) parts.push(`langue : ${c.languages.join(", ")}`);
  if (c.spendLevels?.length)
    parts.push(`niveau : ${c.spendLevels.map((l) => SPEND_LEVEL_LABELS[l]).join(", ")}`);
  if (c.inactiveDays)
    parts.push(`rien fait depuis ${c.inactiveDays} jour${c.inactiveDays > 1 ? "s" : ""}`);
  if (c.categoryIds?.length)
    parts.push(`catégorie : ${list(c.categoryIds, names.categories, "catégorie supprimée")}`);
  return parts.length ? parts.join(" · ") : "tous les membres";
}
