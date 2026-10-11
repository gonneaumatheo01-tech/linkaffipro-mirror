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
  [/^member\./, "Membre"],
  [/^membership\./, "Adhésion"],
  // Exceptions selon la provenance (phase 11), avant la famille générale.
  [/^approval_rule\.exception_created$/, "Règle d'adhésion : exception ajoutée"],
  [/^approval_rule\.exception_updated$/, "Règle d'adhésion : exception modifiée"],
  [/^approval_rule\.exception_deleted$/, "Règle d'adhésion : exception supprimée"],
  [/^approval_rule\.exceptions_reordered$/, "Règle d'adhésion : ordre des exceptions modifié"],
  [/^approval_rule\./, "Règle d'adhésion"],
  [/^tag\./, "Étiquette"],
  [/^media\./, "Média"],
  [/^stats\./, "Statistiques"],
  [/^telegram\./, "Compte Telegram (vues)"],
  [/^broadcast\./, "Écrire à un groupe"],
  [/^post\./, "Message"],
  [/^channel\./, "Canal"],
  [/^bot\./, "Bot"],
  // Liens de partage (phase 11), avant la famille générale.
  [/^invite_link\.share_created$/, "Lien de partage créé"],
  [/^invite_link\.share_disabled$/, "Lien de partage désactivé"],
  [/^link\.|^invite_link\.|^tracking_link\./, "Lien"],
  [/^campaign\./, "Campagne"],
  [/^adset\.|^ad\.|^adcost\.|^import\.costs/, "Campagne pub"],
  [/^automation\./, "Relance automatique"],
  [/^postback\./, "Retour du casino"],
  [/^category\./, "Catégorie"],
  [/^ai\./, "Assistant IA"],
  [/^settings\./, "Réglage"],
  [/^alert\./, "Alerte"],
  [/^maintenance\./, "Maintenance"],
  [/^linkaffi\./, "Synchro Link Affi"],
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
  {
    value: "connector.",
    label: "Link Affi, Meta, TikTok et compte Telegram",
    prefixes: ["connector.", "linkaffi.", "telegram."],
  },
  { value: "member.", label: "Membres et étiquettes", prefixes: ["member.", "tag."] },
  { value: "sequence.", label: "Messages du bot", prefixes: ["sequence."] },
  { value: "post.", label: "Messages et médias", prefixes: ["post.", "media."] },
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
};

export function entityLabel(entityType: string | null | undefined): string {
  if (!entityType) return "—";
  return ENTITY_LABELS[entityType] ?? "Autre";
}
