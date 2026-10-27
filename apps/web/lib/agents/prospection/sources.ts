/**
 * Phase 31 — vue « Sources » de la page Prospection : état de chaque source de découverte (active, en pause, en
 * erreur), prochain passage (chaque nuit de 2 h à 6 h, heure de Paris), et lecture des pauses
 * (`Setting prospection.source_pauses` : `{ [source]: { until, reason } }`). Règles pures.
 */
import type { DiscoverySource } from "@linkaffipro/agents";
import type { ProspectSourceState } from "@/lib/status-badges";

export const DISCOVERY_SOURCES: readonly DiscoverySource[] = ["directories", "web_search", "social", "graph", "analysts", "manual"];

export const DISCOVERY_SOURCE_LABELS: Record<string, string> = {
  directories: "Annuaires de canaux",
  web_search: "Recherche sur internet",
  social: "Réseaux sociaux",
  graph: "Canaux cités ou repris par d'autres",
  analysts: "Équipe Analystes",
  manual: "Ajouts à la main",
};

export const DISCOVERY_SOURCE_HINTS: Record<string, string> = {
  directories: "Pages publiques d'annuaires de canaux Telegram, une page toutes les 10 secondes au plus.",
  web_search: "Recherches dans toutes les langues d'Europe, à partir de requêtes écrites une fois pour toutes.",
  social: "Pages publiques de réseaux sociaux qui renvoient vers des canaux.",
  graph: "Canaux repris, cités ou rangés dans un dossier par un canal déjà trouvé.",
  analysts: "Canaux repérés par la veille du marché.",
  manual: "Canaux que vous ajoutez vous-même (ici ou en écrivant à Kevin).",
};

/** Types de provenance d'un prospect (`Prospect.sourceType`) couverts par chaque source. */
export const SOURCE_TYPES_OF: Record<string, readonly string[]> = {
  directories: ["DIRECTORY"],
  web_search: ["WEB_SEARCH"],
  social: ["SOCIAL"],
  graph: ["GRAPH_FORWARD", "GRAPH_MENTION", "FOLDER"],
  analysts: ["ANALYSTS"],
  manual: ["MANUAL"],
};

export function sourceOfType(sourceType: string): string | null {
  for (const [k, types] of Object.entries(SOURCE_TYPES_OF)) if (types.includes(sourceType)) return k;
  return null;
}

export type SourcePause = { until: string; reason: string };

export function pausesOf(v: unknown): Record<string, SourcePause> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, SourcePause> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
    if (!p || typeof p !== "object") continue;
    const until = (p as Record<string, unknown>).until;
    const reason = (p as Record<string, unknown>).reason;
    if (typeof until === "string" && !Number.isNaN(Date.parse(until))) out[k] = { until, reason: typeof reason === "string" ? reason : "" };
  }
  return out;
}

/** Une pause encore en cours (sa date de fin n'est pas passée). */
export function activePause(pauses: Record<string, SourcePause>, source: string, now: Date): SourcePause | null {
  const p = pauses[source];
  return p && Date.parse(p.until) > now.getTime() ? p : null;
}

export function sourceStatus(input: { enabled: boolean; paused: SourcePause | null; lastRunErrors: number }): ProspectSourceState {
  if (!input.enabled) return "OFF";
  if (input.paused) return "PAUSED";
  if (input.lastRunErrors > 0) return "ERROR";
  return "ACTIVE";
}

const PARIS_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });

/** Heure de Paris (0-23) d'un instant. */
export function parisHour(d: Date): number {
  return Number(PARIS_HOUR.format(d));
}

/**
 * Prochain passage d'une source de découverte : la prochaine heure pleine de 2 h à 6 h à Paris (la découverte tourne
 * par lots pendant cette fenêtre), et pas avant la fin d'une pause. Les ajouts à la main sont lus tout de suite.
 */
export function nextDiscoveryAt(now: Date, pausedUntil: Date | null): Date | null {
  let t = new Date(Math.max(now.getTime(), pausedUntil?.getTime() ?? 0));
  t = new Date(Math.ceil(t.getTime() / 3_600_000) * 3_600_000);
  for (let i = 0; i < 48; i++) {
    const h = parisHour(t);
    if (h >= 2 && h < 6) return t;
    t = new Date(t.getTime() + 3_600_000);
  }
  return null;
}

/** Durées de pause proposées par la page (jours). */
export const PAUSE_DAYS = [1, 7, 30] as const;
