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
  ConnectionStatus,
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
/** Actif / inactif (bots, liens, utilisateurs, catégories, règles). */
export type ActiveStatus = "active" | "inactive";
/** Statut du compte Telegram connecté pour les vues (TelegramUserSession.status, chaîne libre en base). */
export type TelegramSessionStatus =
  "PENDING_CODE" | "PENDING_PASSWORD" | "ACTIVE" | "ERROR" | "DISCONNECTED";

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
