/**
 * Résumé de supervision en 8 lignes au plus (commande « agents » du bot, `pnpm agents:status`). Texte brut (sans
 * balise) : l'appelant échappe pour le HTML Telegram. Pur.
 */
import type { AgentsOverview, TeamOverview } from "./overview-contract";

export const OVERVIEW_MAX_LINES = 8;

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** « il y a 12 min », « il y a 3 h », « il y a 2 j ». */
export function agoLabel(iso: string | null, now: Date): string {
  if (!iso) return "jamais";
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`;
  return `il y a ${Math.round(min / 1440)} j`;
}

/**
 * Texte envoyé par Kevin (commande « agents ») : voix de Kevin (`docs/KEVIN-VOIX.md`) — un seul emoji au plus,
 * « pour de faux » plutôt que « simulation », jamais « mission » ni « Grand Chef ». Le site a ses propres libellés.
 */
function teamLine(t: TeamOverview): string {
  const state = t.paused ? "en pause" : !t.enabled ? "désactivée" : "active";
  const head = `${t.label} : ${state}, ${t.simulation ? "pour de faux" : "en vrai"}, niveau ${t.autonomyLevel}.`;
  const d = t.today;
  const today = [
    `${d.created} créé${d.created > 1 ? "s" : ""}`,
    `${d.published} publié${d.published > 1 ? "s" : ""}`,
    `${d.waiting} en attente`,
    ...(d.rejected ? [`${d.rejected} refusé${d.rejected > 1 ? "s" : ""}`] : []),
    ...(d.failed ? [`${d.failed} raté${d.failed > 1 ? "s" : ""}`] : []),
    ...(d.fallbacks ? [plural(d.fallbacks, "repli")] : []),
  ].join(", ");
  const spent = t.spend.reduce((s, p) => s + p.cents, 0);
  const caps = t.spend.map((p) => p.capCents).filter((c): c is number => c !== null);
  const spend = caps.length ? `${eur(spent)} dépensés sur ${eur(caps.reduce((a, b) => a + b, 0))} ce mois.` : `${eur(spent)} dépensés ce mois.`;
  const r = t.results.d7;
  const results = r.posts ? ` Sur 7 jours : ${plural(r.posts, "post")}, ${plural(r.registrations, "inscription")}, ${eur(Math.round(r.commissions * 100))}.` : "";
  return `${head} Aujourd'hui ${today}. ${spend}${results}`;
}

export function overviewLinesImpl(o: AgentsOverview): string[] {
  const now = new Date(o.at);
  const lines: string[] = [];
  lines.push(`${o.pausedAll ? "Pause générale en cours. " : ""}À valider : ${o.pendingValidations}, demandes : ${o.openHumanRequests}, alertes : ${o.openAlerts}.`);
  for (const t of o.teams) lines.push(teamLine(t));
  const adsReport = o.ads.lastReportAt ? `dernier rapport ${agoLabel(o.ads.lastReportAt, now)}` : "aucun rapport encore";
  lines.push(`Ads : ${o.ads.paused ? "en pause" : "active"}, ${plural(o.ads.openRecommendations, "recommandation ouverte", "recommandations ouvertes")}, ${adsReport}.`);
  lines.push(
    `Algorithme cette semaine : ${plural(o.algoAppliedThisWeek.length, "réglage appliqué", "réglages appliqués")}, ${plural(o.experimentsRunning, "test A/B en cours", "tests A/B en cours")}.`,
  );
  const missing = o.health.providers.filter((p) => !p.keyPresent).map((p) => p.label.replace(/ \(.*\)$/, ""));
  const errors = o.health.providers.reduce((s, p) => s + p.errors24h, 0);
  const health = [
    o.health.lastGrandChefAt ? `dernier tour des équipes ${agoLabel(o.health.lastGrandChefAt, now)}` : "aucun tour des équipes encore",
    plural(o.health.stuckMissions, "post bloqué", "posts bloqués"),
    `${plural(errors, "erreur")} chez les fournisseurs (24 h)`,
    ...(missing.length ? [`sans clé : ${missing.join(", ")}`] : []),
  ];
  lines.push(`Santé : ${health.join(", ")}.`);
  return lines.slice(0, OVERVIEW_MAX_LINES);
}
