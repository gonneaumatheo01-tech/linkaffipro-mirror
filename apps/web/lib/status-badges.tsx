import type {
  AdPlatform,
  AffiliateSource,
  AgentMissionKind,
  AgentMissionStatus,
  AgentValidationStatus,
  AlertSeverity,
  ApprovalMode,
  AutomationRunStatus,
  AutomationTrigger,
  BettingPickStatus,
  BotMode,
  BroadcastStatus,
  CampaignStatus,
  ChatType,
  CompliancePlatform,
  ConnectionStatus,
  ConversationAuthor,
  ConversationStage,
  ConversationStatus,
  CostSource,
  CustomEmojiSource,
  ExperimentKind,
  ExperimentStatus,
  ExpireAction,
  GateMode,
  HumanRequestKind,
  HumanRequestStatus,
  ImportKind,
  InviteLinkKind,
  LandingEventType,
  MembershipStatus,
  MontageJobStatus,
  OutboundKind,
  OutboundStatus,
  PlayerEventType,
  PostbackStatus,
  PostPublisher,
  PostStatus,
  RecommendationStatus,
  RiskLevel,
  ReferenceStatus,
  ReferenceVia,
  Role,
  SequenceTrigger,
  ShortClipStatus,
  StrategyReportType,
  TeamOrderKind,
  TeamOrderStatus,
  TrackingLinkKind,
  TrendCategory,
  TrendSentiment,
  TrendSourceType,
  Vertical,
} from "@linkaffipro/db";
import { StatusPill, type PillTone } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";

/**
 * Dictionnaire unique des libellés français et des couleurs de TOUS les statuts affichés dans l'interface.
 * Une notion = un libellé = une couleur, partout. Usage :
 *   statusLabel("post", "SENT")            → "Envoyé"
 *   <StatusBadge kind="post" value="SENT" />
 * Rendu : pastille `StatusPill` (fond doux, point coloré) ; les univers (`kind="vertical"`) sont rendus
 * avec leur couleur d'univers (`UniverseDot`, étiquette à bordure fine).
 */

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
/** Nuance facultative, en plus de la variante : vert (réussi) ou ambre (à surveiller), contraste AA. */
export type Tone = "success" | "warning";
/** `term` : terme technique montré au survol de la pastille (« Terme technique : FTD »), jamais en surface. */
export type StatusEntry = { label: string; variant: BadgeVariant; tone?: Tone; term?: string };

const ok = (label: string): StatusEntry => ({ label, variant: "outline", tone: "success" });
const warn = (label: string): StatusEntry => ({ label, variant: "outline", tone: "warning" });
const main = (label: string): StatusEntry => ({ label, variant: "default" });
const muted = (label: string): StatusEntry => ({ label, variant: "secondary" });
const bad = (label: string): StatusEntry => ({ label, variant: "destructive" });
const plain = (label: string): StatusEntry => ({ label, variant: "outline" });

/**
 * Statut de synchronisation (Link Affi…) : pas un enum Prisma, mais affiché au même endroit. « late » : la dernière
 * réussite est trop ancienne (`syncRowState`, lib/status/health.ts), affiché « En retard ».
 */
export type SyncStatus = "ok" | "late" | "error" | "running" | "never";
/** Statut de la connexion Telegram (webhook) d'un bot. */
export type WebhookStatus = "ok" | "check" | "off";
/** État d'un site de bookmaker lu directement (phase 35, `BookmakerSite.status` en texte libre). */
export type BookmakerSiteStatus = "NEW" | "LEARNING" | "READY" | "DEGRADED" | "BLOCKED";
/** État d'une lecture d'un site de bookmaker (phase 35, `BookmakerReadJob.status`). */
export type BookmakerJobStatus = "PENDING" | "CLAIMED" | "DONE" | "FAILED" | "NEEDS_HUMAN";
/** Actif / inactif (bots, liens, utilisateurs, catégories, règles). */
export type ActiveStatus = "active" | "inactive";
/** Statut du compte Telegram connecté pour les vues (TelegramUserSession.status, chaîne libre en base). */
export type TelegramSessionStatus =
  "PENDING_CODE" | "PENDING_PASSWORD" | "ACTIVE" | "ERROR" | "DISCONNECTED";
/** Passage d'un agent sur une mission (`AgentRun.status`, chaîne libre en base, phase 19). */
export type AgentRunStatus = "RUNNING" | "OK" | "ERROR" | "SKIPPED";
/** Action conseillée par l'Agent Ads (`Recommendation.action`, chaîne libre en base, phase 24). */
export type AdsActionKind = "STOP" | "SCALE" | "TEST" | "WATCH";
/** État d'une source de la veille (phase 29), déduit par `sourceState` (lib/agents/analyses.ts). */
export type TrendSourceState = "ACTIVE" | "INACTIVE" | "ERROR" | "PROPOSED";

export const STATUS_DICT = {
  membership: {
    REQUESTED: warn("Demande en attente"),
    PENDING_GATE: warn("Attend les canaux"),
    SCHEDULED: main("Acceptation programmée"),
    APPROVED: ok("Accepté"),
    DECLINED: bad("Refusé"),
    LEFT: muted("Parti"),
    KICKED: muted("Exclu"),
    EXPIRED: muted("Expiré"),
    FAILED: bad("Échec"),
  } satisfies Record<MembershipStatus, StatusEntry>,
  post: {
    DRAFT: plain("Brouillon"),
    SCHEDULED: main("Programmé"),
    SENDING: main("Envoi en cours"),
    SENT: ok("Envoyé"),
    FAILED: bad("Échec"),
    DELETED: muted("Supprimé"),
    CANCELLED: muted("Annulé"),
  } satisfies Record<PostStatus, StatusEntry>,
  broadcast: {
    DRAFT: plain("Brouillon"),
    SCHEDULED: main("Programmé"),
    SENDING: main("Envoi en cours"),
    SENT: ok("Envoyé"),
    CANCELLED: muted("Annulé"),
  } satisfies Record<BroadcastStatus, StatusEntry>,
  outbound: {
    QUEUED: warn("En file"),
    SENT: ok("Envoyé"),
    FAILED: bad("Échec"),
    BLOCKED: muted("Bloqué par le membre"),
  } satisfies Record<OutboundStatus, StatusEntry>,
  outboundKind: {
    WELCOME: plain("Accueil"),
    GATE_REMINDER: plain("Rappel canaux"),
    ACCEPTED: plain("Accepté"),
    OFFER_REPLY: plain("Réponse offre"),
    BROADCAST: plain("Message à un groupe"),
    AUTOMATION: plain("Relance automatique"),
    TEST: muted("Test"),
    ASSISTANT: plain("Assistant de conversation"),
  } satisfies Record<OutboundKind, StatusEntry>,
  alert: {
    INFO: muted("Info"),
    WARNING: warn("Attention"),
    CRITICAL: bad("Critique"),
  } satisfies Record<AlertSeverity, StatusEntry>,
  automationRun: {
    PENDING: warn("En attente"),
    RUNNING: main("En cours"),
    DONE: ok("Terminé"),
    FAILED: bad("Échec"),
    SKIPPED: muted("Ignoré"),
    CANCELLED: muted("Annulé"),
  } satisfies Record<AutomationRunStatus, StatusEntry>,
  automationTrigger: {
    JOINED: plain("Arrivée dans un canal"),
    OFFER_CLICKED: plain("Clic sur une offre"),
    REGISTERED: plain("Inscription"),
    DEPOSITED: plain("Dépôt"),
    INACTIVE: plain("Inactivité"),
    LEFT: plain("A quitté un canal"),
    SPEND_LEVEL_REACHED: plain("Niveau de dépense atteint"),
  } satisfies Record<AutomationTrigger, StatusEntry>,
  importKind: {
    TIKTOK_CSV: plain("Coûts TikTok (CSV)"),
    META_CSV: plain("Coûts Meta (CSV)"),
    COSTS_MANUAL: plain("Coûts saisis"),
    PLAYERS_CSV: plain("Joueurs (CSV)"),
  } satisfies Record<ImportKind, StatusEntry>,
  postback: {
    ACCEPTED: ok("Accepté"),
    IGNORED: muted("Ignoré"),
    ERROR: bad("Erreur"),
  } satisfies Record<PostbackStatus, StatusEntry>,
  campaign: {
    DRAFT: plain("Brouillon"),
    ACTIVE: ok("Active"),
    PAUSED: warn("En pause"),
    ENDED: muted("Terminée"),
  } satisfies Record<CampaignStatus, StatusEntry>,
  costSource: {
    CSV: plain("Import CSV"),
    MANUAL: plain("Saisie"),
    API: plain("Par API"),
  } satisfies Record<CostSource, StatusEntry>,
  playerEvent: {
    CLICK: plain("Clic"),
    REGISTRATION: plain("Inscription"),
    FTD: { ...ok("Premier dépôt"), term: "FTD" },
    DEPOSIT: ok("Dépôt"),
    REDEPOSIT: ok("Nouveau dépôt"),
    NGR: { ...plain("Revenu net"), term: "NGR" },
    CPA: { ...ok("Commission versée"), term: "commission CPA" },
    CPA_REVERSAL: { ...warn("Commission annulée"), term: "commission CPA annulée" },
    OTHER: muted("Autre"),
  } satisfies Record<PlayerEventType, StatusEntry>,
  affiliateSource: {
    LINKAFFI: plain("Link Affi"),
    CSV: plain("Fichier CSV"),
    API: plain("Par API"),
  } satisfies Record<AffiliateSource, StatusEntry>,
  role: {
    ADMIN: main("Administrateur"),
    MANAGER: plain("Manager"),
  } satisfies Record<Role, StatusEntry>,
  vertical: {
    CASINO: plain("Casino"),
    SPORTS: plain("Paris sportifs"),
    DATING: plain("Rencontres"),
  } satisfies Record<Vertical, StatusEntry>,
  chatType: {
    CHANNEL: plain("Canal"),
    GROUP: plain("Groupe"),
  } satisfies Record<ChatType, StatusEntry>,
  approvalMode: {
    IMMEDIATE: plain("Immédiat"),
    DELAY: plain("Après un délai"),
    MANUAL: plain("Validation manuelle"),
  } satisfies Record<ApprovalMode, StatusEntry>,
  gateMode: {
    NONE: plain("Aucun canal à rejoindre"),
    REQUIRED: plain("Canaux obligatoires"),
    SOFT: plain("Canaux proposés"),
  } satisfies Record<GateMode, StatusEntry>,
  expireAction: {
    DECLINE: plain("Refuser"),
    APPROVE: plain("Accepter quand même"),
    KEEP: plain("Laisser en attente"),
  } satisfies Record<ExpireAction, StatusEntry>,
  inviteLinkKind: {
    AD_ENTRY: plain("Entrée de pub"),
    GATE: plain("Canal à rejoindre"),
    MANUAL: plain("Manuel"),
    SHARE: plain("Lien de partage"),
    LINKAFFI: plain("Campagne d'affilié Link Affi"),
    LANDING: plain("Page d'atterrissage"),
  } satisfies Record<InviteLinkKind, StatusEntry>,
  adPlatform: {
    TIKTOK: plain("TikTok"),
    META: plain("Meta (Facebook / Instagram)"),
    OTHER: plain("Autre"),
  } satisfies Record<AdPlatform, StatusEntry>,
  trackingLinkKind: {
    AD_ENTRY: plain("Entrée de pub"),
    OFFER: plain("Offre"),
    BUTTON: plain("Bouton"),
    GENERIC: plain("Générique"),
  } satisfies Record<TrackingLinkKind, StatusEntry>,
  sequenceTrigger: {
    JOIN_REQUEST: plain("Accueil"),
    GATE_REMINDER: plain("Rappel canaux"),
    GATE_SATISFIED: plain("Canaux rejoints"),
    APPROVED: plain("Accepté"),
    START: plain("/start"),
    OFFER_REPLY: plain("Réponse offre"),
  } satisfies Record<SequenceTrigger, StatusEntry>,
  sync: {
    ok: ok("OK"),
    late: warn("En retard"),
    error: bad("Erreur"),
    running: main("En cours"),
    never: muted("Jamais"),
  } satisfies Record<SyncStatus, StatusEntry>,
  webhook: {
    ok: ok("Connecté"),
    check: bad("À vérifier"),
    off: muted("Inactif"),
  } satisfies Record<WebhookStatus, StatusEntry>,
  connection: {
    ACTIVE: ok("Connecté"),
    NEEDS_RECONNECT: bad("À reconnecter"),
    DISABLED: muted("Déconnecté"),
  } satisfies Record<ConnectionStatus, StatusEntry>,
  active: {
    active: ok("Actif"),
    inactive: muted("Inactif"),
  } satisfies Record<ActiveStatus, StatusEntry>,
  telegramSession: {
    PENDING_CODE: warn("Code attendu"),
    PENDING_PASSWORD: warn("Mot de passe attendu"),
    ACTIVE: ok("Connecté"),
    ERROR: bad("À reconnecter"),
    DISCONNECTED: muted("Déconnecté"),
  } satisfies Record<TelegramSessionStatus, StatusEntry>,
  postPublisher: {
    BOT: plain("Publié par le bot"),
    ACCOUNT: { ...plain("Publié par votre compte"), term: "emojis animés" },
  } satisfies Record<PostPublisher, StatusEntry>,
  customEmojiSource: {
    FORWARD: plain("Message transféré au bot"),
    PACK: plain("Lien d'un pack"),
    ACCOUNT: plain("Votre compte Telegram"),
  } satisfies Record<CustomEmojiSource, StatusEntry>,
  // Pages d'atterrissage (phase 15) : visite, clic sur le bouton, Telegram ouvert (page quittée juste après le clic) ;
  // phase 16 : aide « Ouvrir dans le navigateur » affichée dans une appli, visite rouverte hors de l'appli (Safari,
  // Chrome), ouverture automatique de Telegram tentée au chargement.
  landingEvent: {
    VIEW: plain("Visite"),
    CLICK: plain("Clic"),
    OPENED: ok("Telegram ouvert"),
    HELP: plain("Aide affichée"),
    ESCAPED: ok("Sorti de l'appli"),
    AUTO_OPEN: plain("Ouverture automatique"),
  } satisfies Record<LandingEventType, StatusEntry>,
  // Assistant de conversation (phase 17) : mode du bot, étape du parcours, qui répond, auteur d'un message.
  botMode: {
    STANDARD: plain("Bot normal"),
    ASSISTANT: main("Assistant de conversation"),
  } satisfies Record<BotMode, StatusEntry>,
  conversationStage: {
    WELCOME: plain("Accueil"),
    CHAT: main("Discussion"),
    PROPOSAL: main("Proposition"),
    LINK_SENT: main("Lien envoyé"),
    FOLLOW_UP: warn("Relance"),
    CONVERTED: ok("Inscrit"),
    CLOSED: muted("Fermée"),
  } satisfies Record<ConversationStage, StatusEntry>,
  conversationStatus: {
    BOT: ok("L'assistante répond"),
    HUMAN: warn("L'équipe a la main"),
    PAUSED: muted("En pause"),
    CLOSED: muted("Fermée"),
  } satisfies Record<ConversationStatus, StatusEntry>,
  conversationAuthor: {
    MEMBER: plain("Membre"),
    ASSISTANT: plain("Assistant"),
    TEAM: main("Équipe"),
    SYSTEM: muted("Message automatique"),
  } satisfies Record<ConversationAuthor, StatusEntry>,
  // Agents (phase 19) : missions, validations, demandes faites au client, passages des agents.
  agentMission: {
    PENDING: plain("À démarrer"),
    RUNNING: main("En cours"),
    WAITING_VALIDATION: warn("Attend votre validation"),
    WAITING_HUMAN: warn("Attend votre réponse"),
    DONE: ok("Terminée"),
    FAILED: bad("En échec"),
    CANCELLED: muted("Annulée"),
    BLOCKED_BUDGET: bad("Plafond atteint"),
  } satisfies Record<AgentMissionStatus, StatusEntry>,
  agentMissionKind: {
    POST: plain("Post"),
    BET: plain("Pari"),
    REPORT: plain("Rapport"),
    ANALYSIS: plain("Analyse"),
  } satisfies Record<AgentMissionKind, StatusEntry>,
  agentValidation: {
    PENDING: warn("À valider"),
    APPROVED: ok("Publication accordée"),
    REJECTED: muted("Refusée"),
    EDITED: ok("Corrigée"),
    EXPIRED: muted("Expirée"),
  } satisfies Record<AgentValidationStatus, StatusEntry>,
  humanRequest: {
    QUEUED: plain("En file"),
    PENDING: warn("Question posée"),
    ANSWERED: ok("Répondue"),
    SKIPPED: muted("Passée"),
    EXPIRED: muted("Expirée"),
  } satisfies Record<HumanRequestStatus, StatusEntry>,
  humanRequestKind: {
    SECRET: plain("Clé"),
    TEXT: plain("Texte"),
    CHOICE: plain("Choix"),
    MEDIA: plain("Médias"),
    CONFIRM: plain("Oui ou non"),
  } satisfies Record<HumanRequestKind, StatusEntry>,
  agentRun: {
    RUNNING: main("En cours"),
    OK: ok("Réussi"),
    ERROR: bad("En échec"),
    SKIPPED: muted("Passé"),
  } satisfies Record<AgentRunStatus, StatusEntry>,
  // Équipe Algorithme (phase 21) : tests A/B, leur type, propositions de réglages.
  experiment: {
    PROPOSED: plain("Proposé"),
    RUNNING: main("En cours"),
    CLOSED: ok("Clos"),
    CANCELLED: muted("Abandonné"),
  } satisfies Record<ExperimentStatus, StatusEntry>,
  experimentKind: {
    STYLE_LEGENDE: plain("Style de légende"),
    HORAIRE: plain("Heure d'envoi"),
    MELANGE: plain("Mélange vidéo / photo / texte"),
    REGLAGE_PERSONA: plain("Réglage de persona"),
  } satisfies Record<ExperimentKind, StatusEntry>,
  recommendation: {
    PROPOSED: warn("À décider"),
    APPLIED: ok("Appliqué"),
    UNDONE: muted("Annulé"),
    REJECTED: muted("Refusé"),
    // Phase 24 (Agent Ads) : le client dit l'avoir fait lui-même chez Meta / TikTok.
    DONE: ok("Fait"),
  } satisfies Record<RecommendationStatus, StatusEntry>,
  // Agent Ads (phase 24) : action conseillée sur une campagne, un groupe ou une pub (jamais appliquée par le code).
  adsAction: {
    STOP: bad("Arrêter"),
    SCALE: ok("Augmenter"),
    TEST: main("Tester"),
    WATCH: plain("Surveiller"),
  } satisfies Record<AdsActionKind, StatusEntry>,
  // Équipe Paris sportifs (phase 23) : état d'un pari retenu, puis son résultat après le match.
  bettingPick: {
    PROPOSED: warn("Proposé"),
    PUBLISHED: main("Publié"),
    SKIPPED: muted("Écarté"),
    WON: ok("Gagné"),
    LOST: bad("Perdu"),
    VOID: muted("Annulé"),
  } satisfies Record<BettingPickStatus, StatusEntry>,
  // Canal d'inspiration (phase 27) : état de la lecture et voie par laquelle Kevin lit le canal.
  referenceStatus: {
    READING: main("En lecture"),
    READY: ok("Prête"),
    UNAVAILABLE: bad("Illisible"),
  } satisfies Record<ReferenceStatus, StatusEntry>,
  referenceVia: {
    WEB: plain("Aperçu public"),
    ACCOUNT: plain("Compte réel"),
    FORWARDED: plain("Posts transférés"),
  } satisfies Record<ReferenceVia, StatusEntry>,
  // Ordres de Kevin aux équipes (phase 33) : état d'un ordre et son genre.
  teamOrder: {
    DRAFT: plain("En préparation"),
    WAITING_CONFIRM: warn("Attend votre OUI"),
    RUNNING: main("En cours"),
    DONE: ok("Fini"),
    CANCELLED: muted("Arrêté"),
    BLOCKED: bad("Bloqué"),
    FAILED: bad("En échec"),
  } satisfies Record<TeamOrderStatus, StatusEntry>,
  // Bookmakers lus directement (phase 35) : état d'un site et d'une lecture.
  bookmakerSite: {
    NEW: muted("Pas encore appris"),
    LEARNING: main("En apprentissage"),
    READY: ok("Se lit bien"),
    DEGRADED: warn("Se lit mal"),
    BLOCKED: bad("Ne se lit plus"),
  } satisfies Record<BookmakerSiteStatus, StatusEntry>,
  bookmakerJob: {
    PENDING: muted("En attente"),
    CLAIMED: main("En cours"),
    DONE: ok("Fait"),
    FAILED: bad("En échec"),
    NEEDS_HUMAN: warn("Attend votre aide"),
  } satisfies Record<BookmakerJobStatus, StatusEntry>,
  // Équipe Montage (phase 28) : un travail (vidéo longue découpée en shorts) et chacun de ses shorts.
  montageJob: {
    PENDING: muted("Reçue"),
    ANALYZING: main("Analyse en cours"),
    PLAN_SENT: warn("Plan à valider"),
    CUTTING: main("Montage en cours"),
    DRESSING: main("Sous-titres en cours"),
    QC: main("Contrôle qualité"),
    PREVIEW: warn("Aperçus à valider"),
    APPROVED: ok("Validé"),
    DONE: ok("Terminé"),
    FAILED: bad("En échec"),
    CANCELLED: muted("Annulé"),
  } satisfies Record<MontageJobStatus, StatusEntry>,
  shortClip: {
    PLANNED: muted("Prévu"),
    CUTTING: main("Montage en cours"),
    DRESSING: main("Sous-titres en cours"),
    QC: main("Contrôle qualité"),
    QC_FAILED: bad("Contrôle raté"),
    PREVIEW_SENT: warn("À valider"),
    APPROVED: ok("Validé"),
    REJECTED: muted("Refusé"),
    REDO: main("À refaire"),
    CANCELLED: muted("Annulé"),
  } satisfies Record<ShortClipStatus, StatusEntry>,
  // Équipe Analystes (phase 29) : veille, règles publicitaires, rapports, sources, recommandations du marché.
  trendCategory: {
    AD_STRATEGY: plain("Stratégie de pub qui marche"),
    AD_BAN: bad("Ce qui fait bannir"),
    AD_CREATIVE: plain("Format de pub qui marche"),
    PLATFORM_CHANGE: warn("Changement de règle d'une plateforme"),
    MARKET_TREND: plain("Tendance du marché"),
    REGULATION: plain("Réglementation (information)"),
    OFFER: plain("Offre d'un opérateur"),
    TOOL: plain("Outil d'affiliés"),
    DISCUSSION: plain("Discussion"),
    OTHER: plain("Autre"),
  } satisfies Record<TrendCategory, StatusEntry>,
  trendSentiment: {
    POSITIVE: ok("Positif"),
    NEGATIVE: bad("Négatif"),
    NEUTRAL: plain("Neutre"),
  } satisfies Record<TrendSentiment, StatusEntry>,
  trendSourceType: {
    FORUM: plain("Forum"),
    REDDIT: plain("Reddit"),
    TELEGRAM: plain("Canal Telegram public"),
    TWITTER: plain("X (Twitter)"),
    NEWS: plain("Site d'actualité"),
    OTHER: plain("Autre site"),
  } satisfies Record<TrendSourceType, StatusEntry>,
  trendSource: {
    ACTIVE: ok("Active"),
    INACTIVE: muted("Inactive"),
    ERROR: bad("En erreur"),
    PROPOSED: warn("À valider"),
  } satisfies Record<TrendSourceState, StatusEntry>,
  compliancePlatform: {
    META: plain("Meta (Facebook, Instagram)"),
    TIKTOK: plain("TikTok"),
    GOOGLE: plain("Google"),
    SNAP: plain("Snapchat"),
    X: plain("X (Twitter)"),
    TELEGRAM: plain("Telegram"),
    OTHER: plain("Autre plateforme"),
  } satisfies Record<CompliancePlatform, StatusEntry>,
  riskLevel: {
    LOW: ok("Risque faible"),
    MEDIUM: warn("Risque moyen"),
    HIGH: bad("Risque élevé"),
    BAN: bad("Fait bannir"),
  } satisfies Record<RiskLevel, StatusEntry>,
  strategyReport: {
    WEEKLY: plain("Rapport du lundi"),
    MONTHLY: plain("Rapport du mois"),
    ON_DEMAND: plain("À la demande"),
  } satisfies Record<StrategyReportType, StatusEntry>,
  // Recommandation du marché : « Accepter » = le client la retient et la met en place lui-même (rien n'est changé
  // chez Meta ni TikTok) ; état écrit `APPLIED` par un humain (site ou « garder » chez Kevin).
  marketRecommendation: {
    PROPOSED: warn("À décider"),
    APPLIED: ok("Acceptée"),
    UNDONE: muted("Annulée"),
    REJECTED: muted("Refusée"),
    DONE: ok("Acceptée"),
  } satisfies Record<RecommendationStatus, StatusEntry>,
  teamOrderKind: {
    PROGRAM: plain("Programme sur plusieurs jours"),
    ONE_SHOT: plain("Une seule fois"),
    ADJUST: plain("Réglage"),
    ASK: plain("Question"),
    WHAT_IF: plain("Faire comme si"),
  } satisfies Record<TeamOrderKind, StatusEntry>,
} as const;

export type StatusKind = keyof typeof STATUS_DICT;
export type StatusValue<K extends StatusKind> = keyof (typeof STATUS_DICT)[K] & string;

/** Entrée (libellé + couleur) d'un statut ; repli lisible si la valeur est inconnue. */
export function statusEntry<K extends StatusKind>(
  kind: K,
  value: StatusValue<K> | string,
): StatusEntry {
  const dict = STATUS_DICT[kind] as Record<string, StatusEntry>;
  return dict[value] ?? plain(String(value).toLowerCase().replace(/_/g, " "));
}

/** Libellé français d'un statut. */
export function statusLabel<K extends StatusKind>(kind: K, value: StatusValue<K> | string): string {
  return statusEntry(kind, value).label;
}

/** Variante de `Badge` d'un statut. */
export function statusVariant<K extends StatusKind>(
  kind: K,
  value: StatusValue<K> | string,
): BadgeVariant {
  return statusEntry(kind, value).variant;
}

/** Tous les libellés d'un genre (pour remplir un `<select>`). */
export function statusLabels<K extends StatusKind>(kind: K): Record<StatusValue<K>, string> {
  const out = {} as Record<StatusValue<K>, string>;
  for (const [k, v] of Object.entries(STATUS_DICT[kind] as Record<string, StatusEntry>))
    out[k as StatusValue<K>] = v.label;
  return out;
}

/** Nuance de pastille d'une entrée : réussi → vert, à surveiller → ambre, échec → rouge, en cours → bleu. */
export function entryTone(e: StatusEntry): PillTone {
  if (e.tone === "success") return "success";
  if (e.tone === "warning") return "warning";
  switch (e.variant) {
    case "destructive":
      return "danger";
    case "default":
      return "info";
    case "secondary":
      return "muted";
    default:
      return "neutral";
  }
}

/** Nuance de pastille d'un statut ; neutre si la valeur est inconnue. */
export function statusTone<K extends StatusKind>(
  kind: K,
  value: StatusValue<K> | string,
): PillTone {
  return entryTone(statusEntry(kind, value));
}

/** Badge de statut : même libellé et même couleur partout dans l'interface. */
export function StatusBadge<K extends StatusKind>({
  kind,
  value,
  className,
  title,
}: {
  kind: K;
  value: StatusValue<K> | string;
  className?: string;
  title?: string;
}) {
  const e = statusEntry(kind, value);
  const hover = title ?? (e.term ? `Terme technique : ${e.term}` : undefined);
  if (kind === "vertical") {
    return (
      <span title={title} className="inline-flex">
        <UniverseDot
          universe={String(value)}
          variant="pill"
          label={e.label}
          className={className}
        />
      </span>
    );
  }
  return (
    <StatusPill tone={entryTone(e)} className={className} title={hover}>
      {e.label}
    </StatusPill>
  );
}

/** Badge actif / inactif à partir d'un booléen. */
export function ActiveBadge({ active, className }: { active: boolean; className?: string }) {
  return <StatusBadge kind="active" value={active ? "active" : "inactive"} className={className} />;
}
