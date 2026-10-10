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
  if (f.action) where.action = { startsWith: f.action };
  // Jours saisis en heure de Paris (heure d'été comme d'hiver) : du minuit du premier jour au minuit du lendemain du dernier.
  const range = parisDayRange(f.from, f.to);
  if (range) where.createdAt = range;
  return where;
}

/** Libellés lisibles des actions les plus courantes du journal (le code technique reste affiché à côté). */
const ACTION_LABELS: Array<[RegExp, string]> = [
  [/^user\.login/, "Connexion"],
  [/^user\.password_changed/, "Mot de passe modifié"],
  [/^user\.(de)?activated/, "Compte activé ou désactivé"],
  [/^user\.role_changed/, "Rôle modifié"],
  [/^user\.telegram/, "Compte Telegram lié ou délié"],
  [/^invitation\./, "Invitation"],
  [/^member\./, "Membre"],
  [/^broadcast\./, "Envoi groupé"],
  [/^post\./, "Message"],
  [/^channel\./, "Canal"],
  [/^bot\./, "Bot"],
  [/^link\.|^invite_link\.|^tracking_link\./, "Lien"],
  [/^campaign\./, "Campagne"],
  [/^adset\.|^ad\.|^adcost\.|^import\.costs/, "Campagne pub"],
  [/^automation\./, "Automatisation"],
  [/^postback\./, "Postback"],
  [/^category\./, "Catégorie"],
  [/^ai\./, "Assistant IA"],
  [/^settings\./, "Réglage"],
  [/^alert\./, "Alerte"],
  [/^maintenance\./, "Maintenance"],
  [/^linkaffi\./, "Synchro Link Affi"],
  [/^reports\./, "Rapport"],
  [/^system\./, "Système"],
];

export function actionLabel(action: string): string {
  for (const [re, label] of ACTION_LABELS) if (re.test(action)) return label;
  return "Autre";
}
