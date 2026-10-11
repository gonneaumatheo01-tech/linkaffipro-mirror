/**
 * Libellés en français des événements bruts (`Event.type`) : bots, membres, adhésions, clics, envois, joueurs.
 * Utilisés par le Journal (vue « Événements »), Réglages → État du système (activité des bots sur 24 h) et le bloc
 * « Derniers événements » du tableau de bord. Un type inconnu garde un libellé générique, jamais le code brut seul.
 */

export const EVENT_TYPE_LABELS: Record<string, string> = {
  "member.start": "A démarré le bot (/start)",
  "member.blocked": "A bloqué le bot",
  "member.unblocked": "A débloqué le bot",
  "member.anonymized": "Données anonymisées",
  "member.tags_changed": "Étiquettes modifiées",
  "membership.requested": "Demande d'adhésion",
  "membership.gate_satisfied": "Canaux requis rejoints",
  "membership.approved": "Demande acceptée",
  "membership.declined": "Demande refusée",
  "membership.expired": "Demande expirée",
  "membership.failed": "Acceptation en échec",
  "membership.joined": "Entrée dans le canal",
  "membership.left": "Départ du canal",
  "membership.kicked": "Exclu du canal",
  "membership.reminder_sent": "Rappel envoyé",
  "membership.gate_links_missing": "Liens de canaux à rejoindre impossibles à créer",
  "membership.gate_check_failed": "Vérification des canaux rejoints impossible",
  "membership.welcome_resent": "Accueil renvoyé avec les liens",
  "membership.gate_links_ready": "Liens de canaux prêts",
  "channel.gate_links_checked": "Liens des canaux à rejoindre vérifiés",
  "click.offer": "Clic sur une offre",
  "tracking.redirect": "Clic sur un lien traqué",
  "link.created": "Lien d'entrée créé",
  "dm.sent": "Message privé envoyé",
  "dm.failed": "Message privé en échec",
  "dm.blocked": "Message privé refusé (bot bloqué)",
  "post.sent": "Message publié",
  "post.failed": "Message en échec",
  "post.deleted": "Message supprimé",
  "channel.bot_admin_detected": "Bot ajouté comme administrateur",
  "channel.bot_admin_revoked": "Bot retiré des administrateurs",
  "channel.primary_bot_set": "Bot principal choisi automatiquement",
  "offer.campaign_fallback": "Bouton Offre : offre remplacée par celle de la campagne",
  "ads.campaign_adopted": "Campagne pub reprise par une campagne",
  "broadcast.expanded": "Message à un groupe préparé",
  "automation.run": "Relance automatique exécutée",
  "automation.notify_team": "Relance automatique : équipe prévenue",
  "player.registered": "Inscription",
  "player.ftd": "Premier dépôt",
  "player.deposit": "Dépôt",
  "player.ngr_updated": "Revenu net mis à jour",
  "player.ftd_invalidated": "Premier dépôt annulé",
};

/** Mises à jour Telegram reçues par les bots (`telegram.<type>`). */
const TELEGRAM_UPDATE_LABELS: Record<string, string> = {
  message: "Message reçu par un bot",
  edited_message: "Message modifié reçu par un bot",
  channel_post: "Publication dans un canal",
  edited_channel_post: "Publication modifiée dans un canal",
  chat_join_request: "Demande d'adhésion reçue",
  chat_member: "Arrivée ou départ d'un membre",
  my_chat_member: "Droits d'un bot modifiés",
  callback_query: "Clic sur un bouton d'un bot",
  message_reaction: "Réaction d'un membre",
  message_reaction_count: "Réactions sur une publication",
  inline_query: "Recherche en ligne",
};

/** Libellé lisible d'un type d'événement. */
export function eventLabel(type: string): string {
  const direct = EVENT_TYPE_LABELS[type];
  if (direct) return direct;
  if (type.startsWith("telegram."))
    return TELEGRAM_UPDATE_LABELS[type.slice("telegram.".length)] ?? "Mise à jour Telegram";
  if (type.startsWith("player.")) return "Événement joueur";
  if (type.startsWith("membership.")) return "Adhésion";
  if (type.startsWith("member.")) return "Membre";
  return "Autre événement";
}

/** Familles d'événements proposées dans le filtre « Type » du Journal (préfixe du type). */
export const EVENT_FAMILIES: Array<{ prefix: string; label: string }> = [
  { prefix: "telegram.", label: "Mises à jour Telegram reçues" },
  { prefix: "membership.", label: "Adhésions" },
  { prefix: "member.", label: "Membres" },
  { prefix: "click.", label: "Clics sur une offre" },
  { prefix: "tracking.", label: "Clics sur un lien traqué" },
  { prefix: "dm.", label: "Messages privés" },
  { prefix: "post.", label: "Messages de canal" },
  { prefix: "channel.", label: "Canaux et droits des bots" },
  { prefix: "player.", label: "Joueurs (nos joueurs)" },
  { prefix: "broadcast.", label: "Messages à un groupe" },
  { prefix: "automation.", label: "Relances automatiques" },
  { prefix: "link.", label: "Liens" },
  { prefix: "offer.", label: "Boutons Offre" },
  { prefix: "ads.", label: "Campagnes pub (synchro)" },
];
