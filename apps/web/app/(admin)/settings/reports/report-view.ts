/** Affichage de Réglages → Rapports automatiques (fonctions pures, testées). */

export type ReportsConfig = { daily: boolean; weekly: boolean; hour: number };

/** Réglage `reports.config` ; chaque champ absent ou invalide prend sa valeur par défaut (tout activé, 9 h). */
export function readReportsConfig(value: unknown): ReportsConfig {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    daily: typeof v.daily === "boolean" ? v.daily : true,
    weekly: typeof v.weekly === "boolean" ? v.weekly : true,
    hour: typeof v.hour === "number" && v.hour >= 0 && v.hour <= 23 ? Math.floor(v.hour) : 9,
  };
}

/** Heures proposées (0 à 23), avec leur libellé (« 9 h »). */
export const HOUR_OPTIONS: ReadonlyArray<{ value: number; label: string }> = Array.from(
  { length: 24 },
  (_, h) => ({ value: h, label: hourLabel(h) }),
);

export function hourLabel(hour: number): string {
  return `${hour} h`;
}

/** Rendu très simple du HTML Telegram (b, i, code) pour l'aperçu ; le reste est affiché tel quel. */
export function telegramToText(html: string): string {
  return html
    .replace(/<\/?(b|i|code)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Jour du dernier envoi automatique (`reports.lastDaily` : « 2026-10-09 ») → « 9 octobre 2026 » ; « jamais » sinon. */
export function lastSentLabel(dayKey: string | null): string {
  if (!dayKey) return "jamais";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return dayKey;
  const d = new Date(`${dayKey}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? dayKey : dayFmt.format(d);
}

/** Phrase d'état sous le titre : ce qui est activé et à quelle heure. */
export function reportsSummary(config: ReportsConfig): string {
  const on = [config.daily ? "le résumé quotidien" : "", config.weekly ? "le rapport du lundi" : ""]
    .filter(Boolean)
    .join(" et ");
  if (!on) return "Aucun rapport automatique : les deux sont désactivés.";
  return `Vous recevez ${on} à ${hourLabel(config.hour)} (heure de Paris).`;
}
