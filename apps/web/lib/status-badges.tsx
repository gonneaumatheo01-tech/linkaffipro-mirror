import type {
  AdPlatform,
  AffiliateSource,
  AlertSeverity,
  ApprovalMode,
  AutomationRunStatus,
  AutomationTrigger,
  BroadcastStatus,
  CampaignStatus,
  ChatType,
  CostSource,
  ExpireAction,
  GateMode,
  ImportKind,
  InviteLinkKind,
  MembershipStatus,
  OutboundKind,
  OutboundStatus,
  PlayerEventType,
  PostbackStatus,
  PostStatus,
  Role,
  SequenceTrigger,
  TrackingLinkKind,
  Vertical,
} from "@linkaffipro/db";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Dictionnaire unique des libellés français et des couleurs de TOUS les statuts affichés dans l'interface.
 * Une notion = un libellé = une couleur, partout. Usage :
 *   statusLabel("post", "SENT")            → "Envoyé"
 *   <StatusBadge kind="post" value="SENT" />
 */

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
/** Nuance facultative, en plus de la variante : vert (réussi) ou ambre (à surveiller), contraste AA. */
export type Tone = "success" | "warning";
export type StatusEntry = { label: string; variant: BadgeVariant; tone?: Tone };

const ok = (label: string): StatusEntry => ({ label, variant: "outline", tone: "success" });
const warn = (label: string): StatusEntry => ({ label, variant: "outline", tone: "warning" });
const main = (label: string): StatusEntry => ({ label, variant: "default" });
const muted = (label: string): StatusEntry => ({ label, variant: "secondary" });
const bad = (label: string): StatusEntry => ({ label, variant: "destructive" });
const plain = (label: string): StatusEntry => ({ label, variant: "outline" });

/** Statut de synchronisation (Link Affi…) : pas un enum Prisma, mais affiché au même endroit. */
export type SyncStatus = "ok" | "error" | "running" | "never";
/** Statut de la connexion Telegram (webhook) d'un bot. */
export type WebhookStatus = "ok" | "check" | "off";
/** Actif / inactif (bots, liens, utilisateurs, catégories, règles). */
export type ActiveStatus = "active" | "inactive";

export const STATUS_DICT = {
  membership: {
    REQUESTED: warn("Demande en attente"),
    PENDING_GATE: warn("Attente canaux requis"),
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
    BROADCAST: plain("Envoi groupé"),
    AUTOMATION: plain("Automatisation"),
    TEST: muted("Test"),
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
    LEFT: plain("Départ"),
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
    FTD: ok("Premier dépôt (FTD)"),
    DEPOSIT: ok("Dépôt"),
    REDEPOSIT: ok("Nouveau dépôt"),
    NGR: plain("Revenu net (NGR)"),
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
    error: bad("Erreur"),
    running: main("En cours"),
    never: muted("Jamais"),
  } satisfies Record<SyncStatus, StatusEntry>,
  webhook: {
    ok: ok("Connecté"),
    check: bad("À vérifier"),
    off: muted("Inactif"),
  } satisfies Record<WebhookStatus, StatusEntry>,
  active: {
    active: ok("Actif"),
    inactive: muted("Inactif"),
  } satisfies Record<ActiveStatus, StatusEntry>,
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

const TONE_CLASS: Record<Tone, string> = {
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
};

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
  return (
    <Badge
      variant={e.variant}
      className={cn(e.tone ? TONE_CLASS[e.tone] : null, className)}
      title={title}
    >
      {e.label}
    </Badge>
  );
}

/** Badge actif / inactif à partir d'un booléen. */
export function ActiveBadge({ active, className }: { active: boolean; className?: string }) {
  return <StatusBadge kind="active" value={active ? "active" : "inactive"} className={className} />;
}
