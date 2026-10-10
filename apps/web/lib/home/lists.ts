/**
 * Listes de l'accueil (fonctions pures, testées dans lists.test.ts) : « Prochains messages » (heure de Paris, début du
 * texte) et « Campagnes actives » (7 derniers jours).
 */
import { stripHtml } from "@linkaffipro/core";
import { dayKey } from "@/lib/dashboard/aggregate";
import { shiftDay } from "@/lib/periods";

const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});

/** Heure de Paris « 18:30 ». */
export function parisTime(d: Date): string {
  return timeFmt.format(d);
}

/** « Aujourd'hui 18:30 », « Demain 09:00 », sinon « sam. 17 oct. 10:00 » (heure de Paris). */
export function whenLabel(d: Date, now: Date): string {
  const key = dayKey(d);
  const today = dayKey(now);
  if (key === today) return `Aujourd'hui ${parisTime(d)}`;
  if (key === shiftDay(today, 1)) return `Demain ${parisTime(d)}`;
  return `${dayFmt.format(d)} ${parisTime(d)}`;
}

/**
 * Début du texte d'un message (HTML Telegram retiré, retours à la ligne remplacés par « · », espaces réduits), coupé
 * au mot près avec « … ».
 */
export function excerpt(html: string, max = 90): string {
  const plain = stripHtml(html)
    .split(/\s*\n\s*/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const kept = (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s·,;:.]+$/, "");
  return `${kept}…`;
}

/** Texte de remplacement d'un message sans texte (média seul). */
export function postPreview(html: string, mediaCount: number, max = 90): string {
  const text = excerpt(html, max);
  if (text) return text;
  if (mediaCount > 1) return `${mediaCount} médias sans texte`;
  return mediaCount === 1 ? "Média sans texte" : "Message sans texte";
}

export type CampaignRowLike = {
  id: string;
  name: string;
  vertical: string | null;
  status: string;
  importedFrom: string | null;
  metrics: { spend: number; members: number; profit: number };
};

export type ActiveCampaign = {
  id: string;
  name: string;
  vertical: string | null;
  spend: number;
  members: number;
  profit: number;
};

/** Campagnes listées sur l'accueil. */
export const HOME_CAMPAIGNS = 5;

/**
 * Campagnes actives (statut « Active », hors campagnes pub importées pas encore rattachées), celles qui rapportent le
 * plus d'abord (bénéfice = revenu net − dépense, définition des campagnes), puis par dépense et par nom.
 */
export function activeCampaigns(
  rows: readonly CampaignRowLike[],
  limit = HOME_CAMPAIGNS,
): { rows: ActiveCampaign[]; total: number } {
  const active = rows.filter((r) => r.status === "ACTIVE" && !r.importedFrom);
  const sorted = active
    .map((r) => ({
      id: r.id,
      name: r.name,
      vertical: r.vertical,
      spend: r.metrics.spend,
      members: r.metrics.members,
      profit: r.metrics.profit,
    }))
    .sort((a, b) => b.profit - a.profit || b.spend - a.spend || a.name.localeCompare(b.name, "fr"));
  return { rows: sorted.slice(0, limit), total: active.length };
}
