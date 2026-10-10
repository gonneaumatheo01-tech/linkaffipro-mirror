/**
 * Libellés en français des éléments techniques montrés dans Réglages → Connexions et Réglages → État du système :
 * données lues chez Link Affi, files de tâches du service d'arrière-plan, types d'alerte. Le nom technique reste
 * visible dans le détail (volet ou bloc « Avancé ») ; un nom inconnu garde un libellé lisible.
 */

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
};

export function linkAffiTableLabel(table: string): string {
  return LINKAFFI_TABLE_LABELS[table] ?? "Autre donnée Link Affi";
}

/** Files de tâches du service d'arrière-plan (`QUEUE_NAMES`). */
export const QUEUE_LABELS: Record<string, string> = {
  scheduler: "Messages programmés",
  "telegram-send": "Envois Telegram",
  approvals: "Adhésions",
  "sync-linkaffi": "Synchro Link Affi",
  "sync-ads": "Synchro des pubs (Meta, TikTok)",
  "sync-views": "Vues Telegram",
  stats: "Statistiques",
  maintenance: "Maintenance",
  automations: "Relances automatiques",
};

export function queueLabel(name: string): string {
  return QUEUE_LABELS[name] ?? "Autre file";
}

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
};

export function alertKindLabel(kind: string): string {
  return ALERT_KIND_LABELS[kind] ?? "Autre alerte";
}

/** Taille d'un fichier en français (« 12,4 Mo », « 512 Ko », « 80 o »). */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024)
    return `${(n / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024).toLocaleString("fr-FR")} Ko`;
  return `${n} o`;
}

/** Âge d'un battement en secondes, en français (« il y a 20 s », « il y a 3 min », « il y a 2 h ») ; « — » sinon. */
export function fmtAgeSec(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `il y a ${sec} s`;
  if (sec < 3600) return `il y a ${Math.round(sec / 60)} min`;
  return `il y a ${Math.round(sec / 3600)} h`;
}
