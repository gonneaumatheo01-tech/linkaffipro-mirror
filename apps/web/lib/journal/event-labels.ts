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
  // Affiliés Link Affi (phase 13).
  "member.affiliate_attributed": "Rattaché à un affilié Link Affi",
  "member.affiliate_changed": "Affilié Link Affi changé par un administrateur",
  "member.affiliate_removed": "Affilié Link Affi retiré par un administrateur",
  "membership.affiliate_not_attributed":
    "Pas rattaché à l'affilié (déjà rattaché à un autre, ou déjà dans le canal)",
  "linkaffi_event.sent": "Événement transmis à Link Affi",
  "linkaffi_event.failed": "Événement non transmis à Link Affi (abandonné après 24 h)",
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
  "membership.welcome_skipped": "Accueil non renvoyé (déjà envoyé il y a moins de 10 minutes)",
  "membership.rescheduled": "Demande replanifiée (reprise de la phase 11)",
  // Phase 14 : nouvelle règle appliquée aux demandes en attente (bouton de l'équipe).
  "membership.rule_applied": "Nouvelle règle appliquée à la demande",
  "invite_link.legacy_revoked": "Ancien lien de canal à rejoindre retiré",
  // Phase 15 : liens Telegram des sources des pages d'atterrissage (créés, refusés par Telegram, retirés).
  "invite_link.landing_created": "Lien d'une page d'atterrissage créé",
  "invite_link.landing_failed": "Lien d'une page d'atterrissage : refus de Telegram",
  "invite_link.landing_revoked": "Lien d'une page d'atterrissage retiré",
  "channel.gate_links_checked": "Liens des canaux à rejoindre vérifiés",
  "player.cpa_credited": "Commission créditée",
  "player.cpa_reversed": "Commission annulée",
  "click.offer": "Clic sur une offre",
  "tracking.redirect": "Clic sur un lien traqué",
  "link.created": "Lien d'entrée créé",
  "dm.sent": "Message privé envoyé",
  "dm.failed": "Message privé en échec",
  "dm.blocked": "Message privé refusé (bot bloqué)",
  // Phase 14 : Telegram refuse le message sans que la personne ait bloqué le bot (jamais démarré le bot et 5 minutes
  // passées, compte supprimé, chat introuvable…), ou le bot ne l'envoie pas (personne injoignable). Libellés neutres :
  // la raison précise vient du détail de l'événement (`dmLabel`).
  "dm.unreachable": "Message privé refusé : le bot ne peut plus écrire à cette personne",
  "dm.skipped_unreachable":
    "Message privé non envoyé : le bot ne peut plus écrire à cette personne",
  "dm.custom_emoji_fallback":
    "Message privé renvoyé avec des emojis normaux (emojis animés refusés)",
  "post.sent": "Message publié",
  "post.failed": "Message en échec",
  "post.deleted": "Message supprimé",
  "post.deferred": "Publication reportée (compte Telegram occupé, attente imposée ou réseau)",
  "post.custom_emoji_fallback": "Message publié avec des emojis normaux (emojis animés refusés)",
  "custom_emoji.added": "Emojis animés ajoutés à la bibliothèque",
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
  // Assistant de conversation (phase 17) : chaque événement d'une conversation, sans aucun texte de la conversation.
  "conversation.stage_changed": "Conversation : étape du parcours changée",
  "conversation.offer_sent": "Conversation : lien de l'offre envoyé",
  "conversation.offer_opened": "Conversation : lien de l'offre ouvert",
  "conversation.follow_up_sent": "Conversation : relance envoyée après un silence",
  "conversation.stopped": "Conversation arrêtée par la personne (/stop)",
  "conversation.reset": "Conversation effacée par la personne (/reset)",
  "conversation.minor": "Conversation fermée : la personne a moins de 18 ans",
  "conversation.taken_over": "Conversation reprise en main par l'équipe",
  "conversation.released": "Conversation rendue à l'assistant",
  "conversation.blocked": "Conversation bloquée (plus aucun envoi)",
  "conversation.closed": "Conversation fermée",
  "conversation.ai_failed": "Assistant : l'IA n'a pas pu répondre",
  "conversation.cap_reached": "Assistant : plafond mensuel atteint, aucune réponse",
  "conversation.daily_limit": "Assistant : limite de réponses du jour atteinte",
  "conversation.converted": "Conversation : inscription obtenue",
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

/** Types dont le libellé dépend du détail de l'événement (`eventLabel(type, payload)`). */
export const PAYLOAD_LABEL_TYPES: ReadonlySet<string> = new Set([
  "membership.gate_satisfied",
  "dm.unreachable",
  "dm.skipped_unreachable",
]);

function payloadField(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

/** Refus de Telegram (`dm.unreachable`) selon son erreur exacte (`telegramError`, gardée depuis la phase 14). */
const DM_REFUSED_REASONS: Array<[RegExp, string]> = [
  [
    /can'?t initiate conversation|can not initiate conversation|cannot initiate conversation/i,
    "Message privé refusé : la personne n'a jamais démarré le bot (5 minutes passées)",
  ],
  [/user is deactivated/i, "Message privé refusé : compte Telegram supprimé"],
  [/chat not found/i, "Message privé refusé : chat privé introuvable"],
];

/** Message non envoyé par le bot (`dm.skipped_unreachable`) selon la raison enregistrée (`reachability`). */
const DM_SKIPPED_REASONS: Record<string, string> = {
  blocked: "Message privé non envoyé : la personne a bloqué le bot",
  never_started: "Message privé non envoyé : la personne n'a jamais démarré le bot",
  unreachable: "Message privé non envoyé : Telegram a refusé un message précédent",
};

/** Libellé précis d'un message privé refusé ou non envoyé, d'après le détail de l'événement ; null sinon. */
function dmLabel(type: string, payload: unknown): string | null {
  if (type === "dm.unreachable") {
    const error = payloadField(payload, "telegramError");
    if (typeof error !== "string") return null;
    return DM_REFUSED_REASONS.find(([re]) => re.test(error))?.[1] ?? null;
  }
  if (type === "dm.skipped_unreachable") {
    const reason = payloadField(payload, "reason");
    return typeof reason === "string" ? (DM_SKIPPED_REASONS[reason] ?? null) : null;
  }
  return null;
}

/**
 * Libellé lisible d'un type d'événement. `payload` (facultatif, détail de l'événement) précise certains libellés :
 * canaux rejoints vus par le bot tout seul (`membership.gate_satisfied` avec `auto: true`, phase 14) plutôt qu'au
 * bouton « ✅ J'ai rejoint » ; raison d'un message privé refusé par Telegram (`dm.unreachable`) ou non envoyé
 * (`dm.skipped_unreachable` : a bloqué le bot, n'a jamais démarré le bot…). Sans détail : libellé neutre du type.
 */
export function eventLabel(type: string, payload?: unknown): string {
  if (type === "membership.gate_satisfied" && payloadField(payload, "auto") === true)
    return "Canaux requis rejoints (vérifié automatiquement)";
  const dm = dmLabel(type, payload);
  if (dm) return dm;
  const direct = EVENT_TYPE_LABELS[type];
  if (direct) return direct;
  if (type.startsWith("telegram."))
    return TELEGRAM_UPDATE_LABELS[type.slice("telegram.".length)] ?? "Mise à jour Telegram";
  if (type.startsWith("player.")) return "Événement joueur";
  if (type.startsWith("membership.")) return "Adhésion";
  if (type.startsWith("invite_link.")) return "Lien d'invitation";
  if (type.startsWith("member.")) return "Membre";
  if (type.startsWith("custom_emoji.")) return "Emojis animés";
  if (type.startsWith("linkaffi_event.")) return "Événement pour Link Affi";
  if (type.startsWith("conversation.")) return "Assistant de conversation";
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
  { prefix: "custom_emoji.", label: "Emojis animés" },
  { prefix: "channel.", label: "Canaux et droits des bots" },
  { prefix: "player.", label: "Joueurs (nos joueurs)" },
  { prefix: "broadcast.", label: "Messages à un groupe" },
  { prefix: "automation.", label: "Relances automatiques" },
  { prefix: "link.", label: "Liens" },
  { prefix: "invite_link.", label: "Liens d'invitation" },
  { prefix: "offer.", label: "Boutons Offre" },
  { prefix: "ads.", label: "Campagnes pub (synchro)" },
  { prefix: "linkaffi_event.", label: "Événements envoyés à Link Affi" },
  { prefix: "conversation.", label: "Assistant de conversation" },
];
