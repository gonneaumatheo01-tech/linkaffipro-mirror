import { parseConditions, SPEND_LEVEL_LABELS } from "@linkaffipro/core";

export type NameMaps = { channels: Record<string, string>; campaigns: Record<string, string>; categories: Record<string, string> };

/** Conditions lisibles (interface). */
export function describeConditions(raw: unknown, names: NameMaps): string {
  let c;
  try { c = parseConditions(raw); } catch { return "conditions invalides"; }
  const parts: string[] = [];
  if (c.channelIds?.length) parts.push(`canal : ${c.channelIds.map((id) => names.channels[id] ?? id).join(", ")}`);
  if (c.campaignIds?.length) parts.push(`pub : ${c.campaignIds.map((id) => names.campaigns[id] ?? id).join(", ")}`);
  if (c.languages?.length) parts.push(`langue : ${c.languages.join(", ")}`);
  if (c.spendLevels?.length) parts.push(`niveau : ${c.spendLevels.map((l) => SPEND_LEVEL_LABELS[l]).join(", ")}`);
  if (c.inactiveDays) parts.push(`inactif ≥ ${c.inactiveDays} j`);
  if (c.categoryIds?.length) parts.push(`catégorie : ${c.categoryIds.map((id) => names.categories[id] ?? id).join(", ")}`);
  return parts.length ? parts.join(" · ") : "sans condition";
}
