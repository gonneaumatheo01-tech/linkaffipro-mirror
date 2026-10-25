/**
 * Libellés en français, sans jargon, des éléments techniques que l'équipe voit sur le site (Réglages → Connexions,
 * État du système, Alertes) et dans les alertes et rapports Telegram du worker : types d'alerte, données lues chez
 * Link Affi, files de tâches du service d'arrière-plan. Un seul dictionnaire pour le site et le worker.
 * Un nom inconnu garde un libellé lisible (jamais le code technique).
 */

/** Types d'alerte (`Alert.kind`, type `AlertKind` du worker : apps/worker/src/maintenance/alert-rules.ts). */
export const ALERT_KIND_LABELS: Record<string, string> = {
  bot_webhook: "Bot en difficulté",
  sync_failed: "Synchro Link Affi en échec",
  queue_backlog: "Envois en retard",
  dm_blocked: "Messages privés bloqués en masse",
  subid_health: "Identifiant de suivi qui ne revient pas",
  worker_down: "Service d'arrière-plan arrêté",
  job_failures: "Erreurs répétées",
  backup_failed: "Sauvegarde en échec",
  registrations_drop: "Chute des inscriptions",
  spend_no_conversion: "Dépense sans inscription",
  channel_leak: "Canal qui perd ses membres",
  post_failed: "Message programmé en échec",
  offer_link_inactive: "Lien désactivé encore cliqué",
  connector_reconnect: "Compte publicitaire à reconnecter",
  gate_links_missing: "Liens de canaux à rejoindre impossibles à créer",
  custom_emoji_refused: "Emojis animés refusés par Telegram",
  telegram_account_reconnect: "Compte Telegram à reconnecter",
  linkaffi_events_stuck: "Événements Link Affi en attente",
  bot_blocked_rate: "Personnes qui bloquent le bot après l'accueil",
  assistant_ai_failing: "Assistant de conversation en panne",
  assistant_cap_reached: "Plafond de l'assistant de conversation atteint",
  agents_team_paused: "Équipe d'agents mise en pause",
  agents_channel_drop: "Canal qui décroche (vues ou clics)",
  agents_persona_drop: "Profil de conversation qui ne convertit plus",
  agents_media_low: "Vidéos casino en manque",
  ads_spend_spike: "Dépense pub anormale",
  ads_conversion_drop: "Chute des inscriptions d'une campagne",
  ads_cost_over_threshold: "Pub trop chère par inscription",
  ads_budget_exhausted: "Budget du jour d'une campagne atteint",
  webhook_repaired: "Connexion Telegram d'un bot réparée plusieurs fois",
  bookmaker_blocked: "Bookmaker qui ne se lit plus",
  bookmaker_degraded: "Bookmaker qui se lit mal",
};

export function alertKindLabel(kind: string): string {
  return ALERT_KIND_LABELS[kind] ?? "Autre alerte";
}

/** Données synchronisées depuis Link Affi (`SyncState.source` = nom de la table Link Affi). */
export const LINKAFFI_TABLE_LABELS: Record<string, string> = {
  casinos: "Programmes (casinos)",
  campaigns: "Offres Link Affi",
  currency_rates: "Taux de change",
  players: "Joueurs",
  player_events: "Événements joueurs",
  player_financials: "Commissions",
  revshare_snapshots: "Revenu net par joueur",
  deposit_snapshots: "Dépôts cumulés",
  ftd_invalidations: "Premiers dépôts annulés",
  clicks: "Clics Link Affi",
  stats: "Commissions par jour",
};

export function linkAffiTableLabel(table: string): string {
  return LINKAFFI_TABLE_LABELS[table] ?? "Autre donnée Link Affi";
}

/** Files de tâches du service d'arrière-plan (`QUEUE_NAMES` de `@linkaffipro/queue`). */
export const QUEUE_LABELS: Record<string, string> = {
  scheduler: "Messages programmés",
  "telegram-send": "Envois Telegram",
  approvals: "Adhésions",
  "sync-linkaffi": "Synchro Link Affi",
  "sync-ads": "Synchro des pubs (Meta, TikTok)",
  "sync-views": "Vues Telegram",
  "custom-emoji": "Emojis animés",
  "linkaffi-events": "Événements Link Affi",
  "landing-events": "Visites des pages",
  chat: "Assistant de conversation",
  stats: "Statistiques",
  maintenance: "Maintenance",
  automations: "Relances automatiques",
  "agents-orchestrator": "Grand Chef",
  "agents-dating": "Équipe Rencontres",
  "agents-casino": "Équipe Casino",
  "agents-sports": "Équipe Paris sportifs",
  "agents-algo": "Équipe Algorithme",
  "agents-ads": "Agent Ads",
  "agents-bookmakers": "Lecture des bookmakers",
};

export function queueLabel(name: string): string {
  return QUEUE_LABELS[name] ?? "Autre file";
}
