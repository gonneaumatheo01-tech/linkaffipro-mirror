import type { Prisma } from "@linkaffipro/db";
import { pageOf } from "@/components/admin/pagination";
import { parisDayRange } from "./events";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export type JournalFilters = {
  userId: string;
  action: string;
  from: string;
  to: string;
  page: number;
};

/** Filtres du journal lus depuis l'URL (conservés dans les liens de pagination et l'export). */
export function parseJournalFilters(sp: SP): JournalFilters {
  return {
    userId: one(sp.userId),
    action: one(sp.action).trim().slice(0, 60),
    from: one(sp.from),
    to: one(sp.to),
    page: pageOf(sp),
  };
}

/** Clause Prisma correspondant aux filtres (fonction pure). Dates lues en heure de Paris. */
export function journalWhere(f: Omit<JournalFilters, "page">): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (f.userId === "system") where.userId = null;
  else if (f.userId) where.userId = f.userId;
  const family = actionFamily(f.action);
  if (family) where.OR = family.prefixes.map((prefix) => ({ action: { startsWith: prefix } }));
  else if (f.action) where.action = { startsWith: f.action }; // ancien filtre mémorisé (code saisi à la main)
  // Jours saisis en heure de Paris (heure d'été comme d'hiver) : du minuit du premier jour au minuit du lendemain du dernier.
  const range = parisDayRange(f.from, f.to);
  if (range) where.createdAt = range;
  return where;
}

/** Libellés lisibles des actions du journal, sans jargon (le code technique reste dans le volet de détail et l'export). */
const ACTION_LABELS: Array<[RegExp, string]> = [
  [/^user\.login/, "Connexion au site"],
  [/^auth\.login_(failed|throttled)/, "Connexion au site refusée"],
  [/^auth\.login/, "Connexion au site"],
  [/^user\.password_changed/, "Mot de passe modifié"],
  [/^user\.(de)?activated/, "Compte activé ou désactivé"],
  [/^user\.role_changed/, "Rôle modifié"],
  [/^user\.telegram/, "Compte Telegram lié ou délié"],
  [/^invitation\./, "Invitation"],
  // Affiliés Link Affi (phase 13), avant la famille générale.
  [/^member\.affiliate_changed$/, "Membre : affilié Link Affi changé"],
  [/^member\.affiliate_removed$/, "Membre : affilié Link Affi retiré"],
  [/^member\./, "Membre"],
  // « Tout accepter » de l'onglet Demandes (phase 14), avant la famille générale.
  [/^membership\.approve_all$/, "Demandes : tout accepter"],
  [/^membership\./, "Adhésion"],
  // Exceptions selon la provenance (phase 11), avant la famille générale.
  [/^approval_rule\.exception_created$/, "Règle d'adhésion : exception ajoutée"],
  [/^approval_rule\.exception_updated$/, "Règle d'adhésion : exception modifiée"],
  [/^approval_rule\.exception_deleted$/, "Règle d'adhésion : exception supprimée"],
  [/^approval_rule\.exceptions_reordered$/, "Règle d'adhésion : ordre des exceptions modifié"],
  // Phase 14 : « Leur appliquer la nouvelle règle ».
  [/^approval_rule\.applied_to_pending$/, "Règle d'adhésion : appliquée aux demandes en attente"],
  [/^approval_rule\./, "Règle d'adhésion"],
  [/^tag\./, "Étiquette"],
  [/^media\./, "Média"],
  [/^stats\./, "Statistiques"],
  [/^telegram\./, "Compte Telegram (vues)"],
  // Emojis animés (phase 12).
  [/^custom_emoji\.pack_imported$/, "Emojis animés : pack ajouté"],
  [
    /^custom_emoji\.account_import_requested$/,
    "Emojis animés : import des packs du compte Telegram demandé",
  ],
  [/^custom_emoji\.hidden$/, "Emoji animé retiré de la bibliothèque"],
  [/^custom_emoji\.restored$/, "Emoji animé remis dans la bibliothèque"],
  [/^custom_emoji\./, "Emojis animés"],
  [/^broadcast\./, "Écrire à un groupe"],
  [/^post\.account_check_requested$/, "Message : vérification du compte Telegram demandée"],
  [/^post\./, "Message"],
  [/^channel\./, "Canal"],
  [/^bot\./, "Bot"],
  // Pages d'atterrissage (phase 15) et leurs liens Telegram, avant les familles générales.
  [/^landing\.page_created$/, "Page d'atterrissage créée"],
  [/^landing\.page_updated$/, "Page d'atterrissage modifiée"],
  [/^landing\.page_deleted$/, "Page d'atterrissage supprimée"],
  [/^landing\.test_page_created$/, "Page d'essai du canal TEST créée"],
  [/^landing\.test_page_updated$/, "Page d'essai du canal TEST remise à jour"],
  [/^landing\./, "Page d'atterrissage"],
  [/^invite_link\.landing_created$/, "Lien d'une page créé"],
  [/^invite_link\.landing_revoked$/, "Lien d'une page retiré"],
  [/^invite_link\.landing_failed$/, "Lien d'une page : refus de Telegram"],
  // Liens de partage (phase 11), avant la famille générale.
  [/^invite_link\.share_created$/, "Lien de partage créé"],
  [/^invite_link\.share_disabled$/, "Lien de partage désactivé"],
  [/^tracking_link\.text_offer_created$/, "Lien d'offre ajouté dans le texte d'un message"],
  [/^link\.|^invite_link\.|^tracking_link\./, "Lien"],
  [/^campaign\./, "Campagne"],
  [/^adset\.|^ad\.|^adcost\.|^import\.costs/, "Campagne pub"],
  [/^automation\./, "Relance automatique"],
  [/^postback\./, "Retour du casino"],
  [/^category\./, "Catégorie"],
  [/^ai\./, "Assistant IA"],
  // Assistant de conversation (phase 17) : réglages de l'IA de conversation, personas, conversations (équipe).
  [/^assistant\.settings_saved$/, "IA de conversation : réglages enregistrés"],
  [/^assistant\.key_verified$/, "IA de conversation : clé vérifiée"],
  [/^assistant\.key_removed$/, "IA de conversation : clé retirée"],
  [/^assistant\.activation_changed$/, "IA de conversation : activation modifiée"],
  [/^assistant\.bot_mode_changed$/, "Mode d'un bot changé (assistant de conversation)"],
  [/^assistant\./, "IA de conversation"],
  [/^persona\.created$/, "Persona créée"],
  [/^persona\.updated$/, "Persona modifiée"],
  [/^persona\.deleted$/, "Persona supprimée"],
  [/^persona\./, "Persona"],
  [/^conversation\.taken_over$/, "Conversation : reprise en main par l'équipe"],
  [/^conversation\.released$/, "Conversation : rendue à l'assistant"],
  [/^conversation\.message_sent$/, "Conversation : message envoyé par l'équipe"],
  [/^conversation\.blocked$/, "Conversation bloquée"],
  [/^conversation\.closed$/, "Conversation fermée"],
  [/^conversation\./, "Conversation"],
  [/^settings\./, "Réglage"],
  [/^alert\./, "Alerte"],
  [/^maintenance\./, "Maintenance"],
  [/^linkaffi\./, "Synchro Link Affi"],
  // Campagnes Telegram des affiliés Link Affi (phase 13) : appels de Link Affi et réglages de la connexion.
  [/^integration\.linkaffi\.get_channels$/, "Link Affi : liste des canaux demandée"],
  [
    /^integration\.linkaffi\.post_invite_links$/,
    "Link Affi : lien d'une campagne d'affilié demandé",
  ],
  [
    /^integration\.linkaffi\.patch_invite_link$/,
    "Link Affi : lien d'une campagne d'affilié désactivé",
  ],
  [/^integration\.linkaffi\.get_members$/, "Link Affi : membres d'une campagne relus"],
  [/^integration\.linkaffi\.unknown_route$/, "Link Affi : adresse ou méthode inconnue appelée"],
  [/^integration\.linkaffi\./, "Link Affi : appel de la connexion"],
  [/^integration\.linkaffi_key_generated$/, "Link Affi : clé de connexion générée"],
  [/^integration\.linkaffi_secret_generated$/, "Link Affi : secret de signature généré"],
  [/^integration\.linkaffi_events_url_changed$/, "Link Affi : adresse des événements modifiée"],
  [/^integration\.linkaffi_test_sent$/, "Link Affi : événement de test envoyé"],
  [/^integration\./, "Connexion Link Affi"],
  [/^connector\./, "Connexions Meta et TikTok"],
  [/^sequence\./, "Messages du bot"],
  [/^reports\./, "Rapport"],
  [/^system\./, "Système"],
];

/**
 * Familles proposées dans le filtre « Type d'action » du Journal, par ordre alphabétique : libellé du client,
 * codes techniques seulement en valeur. La valeur est le premier préfixe de la famille, pour qu'un ancien filtre
 * mémorisé (« broadcast. », « user. ») retombe sur sa famille.
 */
export const ACTION_FAMILIES: ReadonlyArray<{
  value: string;
  label: string;
  prefixes: readonly string[];
}> = [
  {
    value: "membership.",
    label: "Adhésions et règles d'adhésion",
    prefixes: ["membership.", "approval_rule."],
  },
  // Phase 17 : réglages de l'IA de conversation, personas et actions de l'équipe dans les conversations.
  {
    value: "assistant.",
    label: "Assistant de conversation",
    prefixes: ["assistant.", "persona.", "conversation."],
  },
  { value: "ai.", label: "Assistant IA", prefixes: ["ai."] },
  { value: "bot.", label: "Bots", prefixes: ["bot."] },
  {
    value: "campaign.",
    label: "Campagnes et liens",
    prefixes: ["campaign.", "link.", "invite_link.", "tracking_link."],
  },
  {
    value: "ad.",
    label: "Campagnes pub et dépenses",
    prefixes: ["ad.", "adset.", "adcost.", "import.costs"],
  },
  { value: "channel.", label: "Canaux", prefixes: ["channel."] },
  { value: "category.", label: "Catégories", prefixes: ["category."] },
  {
    value: "user.",
    label: "Comptes de l'équipe et invitations",
    prefixes: ["user.", "invitation."],
  },
  { value: "auth.", label: "Connexions au site", prefixes: ["auth.", "user.login"] },
  { value: "broadcast.", label: "Écrire à un groupe", prefixes: ["broadcast."] },
  { value: "custom_emoji.", label: "Emojis animés", prefixes: ["custom_emoji."] },
  {
    value: "connector.",
    label: "Link Affi, Meta, TikTok et compte Telegram",
    prefixes: ["connector.", "linkaffi.", "telegram.", "integration."],
  },
  { value: "member.", label: "Membres et étiquettes", prefixes: ["member.", "tag."] },
  { value: "sequence.", label: "Messages du bot", prefixes: ["sequence."] },
  { value: "post.", label: "Messages et médias", prefixes: ["post.", "media."] },
  // Phase 15 : les liens des pages sont aussi dans « Campagnes et liens » (même préfixe `invite_link.`).
  {
    value: "landing.",
    label: "Pages d'atterrissage",
    prefixes: ["landing.", "invite_link.landing_"],
  },
  {
    value: "settings.",
    label: "Réglages, alertes et rapports",
    prefixes: ["settings.", "alert.", "reports."],
  },
  { value: "automation.", label: "Relances automatiques", prefixes: ["automation."] },
  { value: "postback.", label: "Retours du casino", prefixes: ["postback."] },
  { value: "stats.", label: "Statistiques (recalculs)", prefixes: ["stats."] },
  { value: "system.", label: "Système et maintenance", prefixes: ["system.", "maintenance."] },
];

/** Famille choisie dans le filtre (`undefined` : aucune, ou ancien code saisi à la main). */
export function actionFamily(value: string) {
  return value ? ACTION_FAMILIES.find((a) => a.value === value) : undefined;
}

/**
 * Options du filtre « Type d'action » : les familles, plus le filtre en cours s'il n'en est pas une (ancien code
 * mémorisé), affiché par son libellé et jamais par son code.
 */
export function actionFilterOptions(current: string): Array<{ value: string; label: string }> {
  const options = ACTION_FAMILIES.map(({ value, label }) => ({ value, label }));
  if (current && !actionFamily(current))
    options.push({ value: current, label: `Filtre mémorisé : ${actionLabel(current)}` });
  return options;
}

export function actionLabel(action: string): string {
  for (const [re, label] of ACTION_LABELS) if (re.test(action)) return label;
  return "Autre";
}

/**
 * Appels de Link Affi (`integration.linkaffi.<route>`, phase 13) : ce que l'appel demandait, pour un libellé de refus
 * (« liste des canaux refusée »). `fem` : accord de « refusé ».
 */
const LINKAFFI_CALLS: Record<string, { what: string; fem: boolean }> = {
  get_channels: { what: "liste des canaux", fem: true },
  post_invite_links: { what: "demande de lien d'affilié", fem: true },
  patch_invite_link: { what: "modification d'un lien d'affilié", fem: true },
  get_members: { what: "lecture des membres d'une campagne", fem: true },
};

/** Raison d'un refus, d'après le code d'erreur de l'API d'intégration (`IntegrationErrorCode`). */
const LINKAFFI_REFUSALS: Record<string, string> = {
  unauthorized: "clé de connexion absente ou fausse",
  rate_limited: "trop de requêtes",
  invalid_json: "demande invalide",
  invalid_body: "demande invalide",
  invalid_query: "demande invalide",
  payload_too_large: "demande trop volumineuse",
  not_found: "adresse inconnue",
  method_not_allowed: "méthode non prévue",
  channel_not_found: "canal inconnu",
  campaign_not_found: "campagne inconnue",
  invite_link_not_found: "lien inconnu",
  affiliate_mismatch: "clé d'un autre affilié",
  invite_link_disabled: "lien désactivé",
  reactivation_refused: "un lien désactivé ne revient pas",
  no_bot: "aucun bot ne peut créer le lien",
  telegram_refused: "refus de Telegram",
  telegram_unavailable: "Telegram injoignable",
  internal_error: "erreur interne",
};

/** Raison lue d'après le code HTTP quand le code d'erreur manque (ancienne ligne). */
const STATUS_REASONS: Record<number, string> = {
  400: "demande invalide",
  401: "clé de connexion absente ou fausse",
  404: "introuvable",
  405: "méthode non prévue",
  413: "demande trop volumineuse",
  429: "trop de requêtes",
  500: "erreur interne",
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Libellé d'une ligne du journal avec ses détails : pour un appel de Link Affi, le statut journalisé décide (un appel
 * refusé — sans clé, clé fausse, trop de requêtes, demande invalide — ne se lit jamais comme une action réussie) ;
 * pour toute autre action, le libellé habituel (`actionLabel`).
 */
export function auditActionLabel(action: string, metadata: unknown): string {
  const m = /^integration\.linkaffi\.(.+)$/.exec(action);
  if (!m) return actionLabel(action);
  const meta = rec(metadata);
  const status = typeof meta.status === "number" ? meta.status : null;
  const route = m[1]!;
  if (status === null || status < 400) {
    if (route === "post_invite_links" && meta.created === true)
      return "Link Affi : lien d'une campagne d'affilié créé";
    if (route === "post_invite_links" && meta.created === false)
      return "Link Affi : lien d'une campagne d'affilié redemandé (déjà créé)";
    if (route === "patch_invite_link" && meta.changed === false)
      return meta.isActive === true
        ? "Link Affi : lien d'une campagne d'affilié laissé actif"
        : "Link Affi : lien d'une campagne d'affilié déjà désactivé";
    return actionLabel(action);
  }
  const call = LINKAFFI_CALLS[route] ?? { what: "appel", fem: false };
  const code = typeof meta.error === "string" ? meta.error : "";
  const reason = LINKAFFI_REFUSALS[code] ?? STATUS_REASONS[status] ?? `code ${status}`;
  const verb = status >= 500 ? "en échec" : call.fem ? "refusée" : "refusé";
  return `Link Affi : ${call.what} ${verb} (${reason})`;
}

/** Objets du journal (`AuditLog.entityType`) en français ; un type inconnu reste lisible (« Autre »). */
const ENTITY_LABELS: Record<string, string> = {
  User: "Compte",
  user: "Compte",
  Invitation: "Invitation",
  MessageCategory: "Catégorie",
  Campaign: "Campagne",
  TelegramUserSession: "Compte Telegram",
  Post: "Message",
  ConnectorApp: "Application (connexion)",
  AdAccountConnection: "Compte publicitaire",
  AutomationRule: "Relance automatique",
  Setting: "Réglage",
  Broadcast: "Message à un groupe",
  Sequence: "Messages du bot",
  Channel: "Canal",
  PostbackEndpoint: "Retour du casino",
  Member: "Membre",
  Membership: "Adhésion",
  Ad: "Pub",
  AdSet: "Groupe de pubs",
  TrackingLink: "Lien",
  Bot: "Bot",
  System: "Système",
  Job: "Tâche",
  AiSuggestion: "Suggestion de l'IA",
  MediaAsset: "Média",
  ImportBatch: "Import",
  ApprovalRule: "Règle d'adhésion",
  InviteLink: "Lien d'invitation",
  Alert: "Alerte",
  AffiliateProgram: "Programme",
  CustomEmoji: "Emoji animé",
  IntegrationKey: "Connexion Link Affi",
  LandingPage: "Page d'atterrissage",
  LandingSource: "Source d'une page",
  Persona: "Persona",
  Conversation: "Conversation",
};

export function entityLabel(entityType: string | null | undefined): string {
  if (!entityType) return "—";
  return ENTITY_LABELS[entityType] ?? "Autre";
}
