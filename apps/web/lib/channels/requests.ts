import type { MembershipStatus } from "@linkaffipro/db";

/**
 * Demandes et membres d'un canal (fiche canal, onglets « Demandes » et « Membres ») : règles d'affichage pures.
 */

/** Demandes encore en cours (listées dans l'onglet « Demandes », comptées dans son badge). */
export const OPEN_REQUEST_STATUSES = [
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "FAILED",
] as const satisfies readonly MembershipStatus[];

/** Adhésions abouties (onglet « Membres ») ; « présents » = APPROVED. */
export const MEMBER_STATUSES = [
  "APPROVED",
  "LEFT",
  "KICKED",
] as const satisfies readonly MembershipStatus[];

/** Temps restant avant une acceptation programmée : « 45 s », « 10 min », « 3 h », « 2 j », « imminent ». */
export function remaining(approveAt: Date | null, now: Date): string {
  if (!approveAt) return "—";
  const s = Math.round((approveAt.getTime() - now.getTime()) / 1000);
  if (s <= 0) return "imminent";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

/**
 * Ce qui va se passer pour une demande en cours, en une phrase courte. La pastille d'état de la carte dit déjà où en
 * est la demande (« Attente canaux requis », « Échec »…) : la phrase dit la suite, sans la répéter.
 */
export function requestNext(
  status: MembershipStatus,
  approveAt: Date | null,
  now: Date,
  /** Demande en cours d'acceptation après « Tout accepter » (`isQueuedForApproval`). */
  queued = false,
): string {
  switch (status) {
    case "SCHEDULED": {
      // « Tout accepter » (phase 14) : en file d'acceptation, au rythme permis par Telegram ; l'heure enregistrée n'est
      // que l'heure de secours (jamais « Acceptée dans 10 min »).
      if (queued || !approveAt) return "Acceptation en cours";
      const r = remaining(approveAt, now);
      return r === "imminent" ? "Acceptée dans un instant" : `Acceptée dans ${r}`;
    }
    case "PENDING_GATE":
      return "Acceptée toute seule une fois les canaux rejoints";
    case "REQUESTED":
      return "À valider à la main";
    case "FAILED":
      return "Réessayez « Accepter » ou refusez la demande";
    default:
      return "—";
  }
}

/**
 * Explication d'une origine inconnue pour le volet de détail (« Venu d'un autre lien ») ; null pour une provenance
 * connue (un de nos liens : bouton « canal à rejoindre », lien de partage, pub, lien du canal).
 */
export function sourceHint(provenanceType: string): string | null {
  return provenanceType === "UNKNOWN"
    ? "Demande faite par un lien d'invitation qui n'a pas été créé ici (lien principal du canal, lien d'un autre administrateur…) : on ne sait pas de quelle pub elle vient."
    : null;
}

/** En-tête de l'onglet Membres : « 65 membres présents · 12 partis · 1 exclu » (partis et exclus s'il y en a). */
export function membersSummary(c: { present: number; left: number; kicked: number }): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  const parts = [
    `${n(c.present)} ${c.present > 1 ? "membres présents" : "membre présent"}`,
    c.left > 0 ? `${n(c.left)} ${c.left > 1 ? "partis" : "parti"}` : null,
    c.kicked > 0 ? `${n(c.kicked)} ${c.kicked > 1 ? "exclus" : "exclu"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Nom affiché d'un membre : prénom et nom, sinon @nom, sinon « Membre sans nom ». */
export function memberName(m: {
  firstName: string | null;
  lastName: string | null;
  username?: string | null;
}): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (m.username) return `@${m.username}`;
  return "Membre sans nom";
}

/**
 * Ligne sous le nom d'une demande : le @nom, seulement s'il apporte quelque chose (rien quand la personne n'a pas de
 * nom d'utilisateur, ou quand le nom affiché est déjà le @nom). Jamais l'identifiant Telegram brut (illisible pour
 * l'équipe ; il reste au survol de la carte).
 */
export function memberHandle(m: {
  firstName: string | null;
  lastName: string | null;
  username?: string | null;
}): string | null {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  if (!full) return null;
  return m.username ? `@${m.username}` : null;
}

/**
 * « Membres suivis » : les adhésions que nos bots ont vues (demandes acceptées, entrées directes après l'ajout du
 * bot). Les abonnés entrés avant que nos bots gèrent le canal n'y sont pas : le chiffre n'est pas le nombre d'abonnés.
 */
export const TRACKED_MEMBERS_HELP =
  "Personnes entrées depuis qu'un de nos bots gère ce canal. Les abonnés plus anciens ne sont pas comptés.";

/** « 12 membres suivis », « 1 membre suivi », « 0 membre suivi ». */
export function trackedMembersLabel(count: number): string {
  return `${count.toLocaleString("fr-FR")} ${count > 1 ? "membres suivis" : "membre suivi"}`;
}

/** Libellé de l'onglet « Demandes » pour les lecteurs d'écran : « Demandes, 3 en attente ». */
export function requestsTabLabel(count: number): string {
  return count > 0 ? `Demandes, ${count} en attente` : "Demandes, aucune en attente";
}

/**
 * Petite ligne sous la suite d'une demande « Attend les canaux » (phase 14) : la demande passe toute seule en
 * acceptation programmée dès que le bot voit les canaux rejoints, ou dès que la personne appuie sur le bouton.
 */
export function requestNextNote(status: MembershipStatus): string | null {
  return status === "PENDING_GATE" ? "ou dès qu'elle appuie sur « ✅ J'ai rejoint »" : null;
}

/** Filtre de l'onglet « Demandes » (`?status=`, phase 14). */
export type RequestFilter = "all" | "gate" | "scheduled" | "manual";

/**
 * Filtres proposés, avec les statuts qu'ils montrent. « Toutes » montre aussi les acceptations en échec (elles n'ont
 * pas de filtre à elles : il y en a rarement).
 */
export const REQUEST_FILTERS: ReadonlyArray<{
  key: RequestFilter;
  label: string;
  statuses: readonly MembershipStatus[];
}> = [
  { key: "all", label: "Toutes", statuses: OPEN_REQUEST_STATUSES },
  { key: "gate", label: "Attend les canaux", statuses: ["PENDING_GATE"] },
  { key: "scheduled", label: "Acceptation programmée", statuses: ["SCHEDULED"] },
  { key: "manual", label: "À valider à la main", statuses: ["REQUESTED"] },
];

/** Filtre lu dans l'adresse ou un formulaire (inconnu : « Toutes »). */
export function parseRequestFilter(value: unknown): RequestFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return REQUEST_FILTERS.some((f) => f.key === v) ? (v as RequestFilter) : "all";
}

/** Statuts montrés (et acceptés par « Tout accepter ») pour un filtre. */
export function requestFilterStatuses(filter: RequestFilter): MembershipStatus[] {
  return [...(REQUEST_FILTERS.find((f) => f.key === filter) ?? REQUEST_FILTERS[0]!).statuses];
}

/** La demande fait-elle partie du filtre ? */
export function matchesRequestFilter(status: MembershipStatus, filter: RequestFilter): boolean {
  return requestFilterStatuses(filter).includes(status);
}

/** Nombre de demandes de chaque filtre, à partir des nombres exacts par statut (toute la liste, pas la page). */
export function requestFilterCounts(
  byStatus: Partial<Record<MembershipStatus, number>>,
): Record<RequestFilter, number> {
  const sum = (statuses: readonly MembershipStatus[]) =>
    statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  return Object.fromEntries(REQUEST_FILTERS.map((f) => [f.key, sum(f.statuses)])) as Record<
    RequestFilter,
    number
  >;
}

/** Adresse de l'onglet « Demandes » avec un filtre (« Toutes » : sans paramètre). */
export function requestsFilterHref(channelId: string, filter: RequestFilter): string {
  const base = `/channels/${encodeURIComponent(channelId)}?tab=requests`;
  return filter === "all" ? base : `${base}&status=${filter}`;
}

function filterLabel(filter: RequestFilter): string {
  return REQUEST_FILTERS.find((f) => f.key === filter)?.label ?? "Toutes";
}

function demandes(n: number): string {
  return `${n.toLocaleString("fr-FR")} demande${n > 1 ? "s" : ""}`;
}

/** Titre de la liste : « 37 demandes en cours », « 30 demandes « Attend les canaux » ». */
export function requestsCountLabel(count: number, filter: RequestFilter): string {
  if (filter === "all") return `${demandes(count)} en cours`;
  if (count === 0) return `Aucune demande « ${filterLabel(filter)} »`;
  return `${demandes(count)} « ${filterLabel(filter)} »`;
}

/** Fenêtre de confirmation de « Tout accepter » (le nombre exact de demandes acceptées). */
export function approveAllConfirm(
  filter: RequestFilter,
  count: number,
): { title: string; description: string; confirmLabel: string } {
  const which = filter === "all" ? "" : ` « ${filterLabel(filter)} »`;
  return {
    title:
      count === 1
        ? `Accepter la demande${which} ?`
        : `Accepter les ${count.toLocaleString("fr-FR")} demandes${which} ?`,
    description:
      "Elles entrent dans le canal dans les prochaines minutes, au rythme permis par Telegram. Le bot envoie le message « Accepté » aux personnes à qui il peut encore écrire.",
    confirmLabel: "Tout accepter",
  };
}

/**
 * Champs du formulaire « Tout accepter » : filtre, moment où la liste a été affichée (`asOf` : une demande arrivée
 * après n'est pas acceptée) et nombre annoncé dans la fenêtre de confirmation (`expected`). Date absente, illisible ou
 * future : maintenant ; nombre absent ou illisible : aucun.
 */
export function parseApproveAllForm(
  get: (name: string) => unknown,
  now: Date,
): { filter: RequestFilter; asOf: Date; expected: number | null } {
  const rawAsOf = get("asOf");
  const asOf = typeof rawAsOf === "string" && rawAsOf ? new Date(rawAsOf) : null;
  const rawExpected = get("expected");
  const expected =
    typeof rawExpected === "string" && /^\d+$/.test(rawExpected.trim())
      ? Number(rawExpected.trim())
      : null;
  return {
    filter: parseRequestFilter(get("filter")),
    asOf: asOf && Number.isFinite(asOf.getTime()) && asOf.getTime() <= now.getTime() ? asOf : now,
    expected,
  };
}

/**
 * La liste a-t-elle grossi depuis l'affichage ? Plus de demandes que la fenêtre de confirmation n'en annonçait : rien
 * n'est accepté (jamais plus que le nombre annoncé). Moins : celles qui restent sont acceptées.
 */
export function approveAllListGrew(found: number, expected: number | null): boolean {
  return expected !== null && found > expected;
}

/** Message quand la liste a grossi depuis l'affichage. */
export const APPROVE_ALL_LIST_CHANGED =
  "La liste a changé depuis l'affichage : vérifiez les demandes, puis cliquez à nouveau « Tout accepter ».";

/**
 * Identifiant de la tâche d'acceptation d'une demande (file telegram-send), propre à l'affichage de la liste (`asOf`) :
 * un double envoi du même formulaire ne crée qu'une tâche, mais un nouveau clic (liste réaffichée) en crée une nouvelle.
 * Un identifiant fixe par demande ferait ignorer par la file tout nouveau clic tant que l'ancienne tâche (terminée ou
 * en échec) y est gardée.
 */
export function approveJobId(membershipId: string, asOf: Date): string {
  return `approve:${membershipId}:${asOf.getTime()}`;
}

/**
 * Heure de secours d'une demande mise en file par « Tout accepter » : si la tâche d'acceptation n'aboutit pas (aucun
 * bot administrateur à ce moment-là, Telegram qui refuse trois fois de suite, ancien service d'arrière-plan pendant un
 * déploiement), le passage des 20 secondes accepte la demande à cette heure. Assez loin pour que la tâche passe
 * d'abord (au rythme de Telegram, quelques secondes en temps normal) : pas deux acceptations en même temps.
 */
export const APPROVE_ALL_FALLBACK_MS = 10 * 60_000;

export function approveAllFallbackAt(now: Date): Date {
  return new Date(now.getTime() + APPROVE_ALL_FALLBACK_MS);
}

/** Marque « Tout accepter » d'une demande (`Membership.source.approveAll`). */
export type ApproveAllMark = { at: string; byUserId: string | null; fallbackAt: string };

export function approveAllMark(now: Date, byUserId: string | null): ApproveAllMark {
  return {
    at: now.toISOString(),
    byUserId,
    fallbackAt: approveAllFallbackAt(now).toISOString(),
  };
}

/**
 * La demande est-elle en cours d'acceptation après « Tout accepter » ? Programmée, avec la marque, et pas reprogrammée
 * depuis plus tard que l'heure de secours. (Programmée sans heure : ancienne mise en file, même lecture.)
 */
export function isQueuedForApproval(m: {
  status: MembershipStatus;
  approveAt: Date | null;
  source: unknown;
}): boolean {
  if (m.status !== "SCHEDULED") return false;
  if (!m.approveAt) return true;
  const source =
    m.source && typeof m.source === "object" ? (m.source as Record<string, unknown>) : {};
  const mark = source.approveAll as Partial<ApproveAllMark> | undefined;
  const fallback = typeof mark?.fallbackAt === "string" ? Date.parse(mark.fallbackAt) : NaN;
  return Number.isFinite(fallback) && m.approveAt.getTime() <= fallback + 1000;
}

/** Cartes montrées au plus par filtre (les plus récentes) ; les nombres des filtres comptent toute la liste. */
export const REQUESTS_SHOWN_MAX = 200;

/**
 * Filtres dont les demandes les plus récentes ne sont pas toutes parmi les demandes déjà relues (les `max` plus
 * récentes, tous statuts confondus) : à relire à part, sinon un filtre montrerait « Aucune demande » alors que sa
 * pastille en compte. « Toutes » n'en a jamais besoin.
 */
export function requestFiltersToTopUp(
  shownStatuses: readonly MembershipStatus[],
  counts: Record<RequestFilter, number>,
  max: number = REQUESTS_SHOWN_MAX,
): RequestFilter[] {
  return REQUEST_FILTERS.filter((f) => f.key !== "all")
    .filter((f) => {
      const shown = shownStatuses.filter((s) => f.statuses.includes(s)).length;
      return shown < Math.min(counts[f.key], max);
    })
    .map((f) => f.key);
}

/** Cartes d'un filtre : les plus récentes (liste déjà triée de la plus récente à la plus ancienne), `max` au plus. */
export function visibleRequests<T extends { status: MembershipStatus }>(
  items: readonly T[],
  filter: RequestFilter,
  max: number = REQUESTS_SHOWN_MAX,
): T[] {
  return items.filter((r) => matchesRequestFilter(r.status, filter)).slice(0, max);
}

/** Message de retour après « Tout accepter ». */
export function approveAllDone(count: number): string {
  if (count === 0) return "Aucune demande à accepter : la liste a changé entre-temps.";
  return count === 1
    ? "1 demande sera acceptée dans les prochaines minutes, au rythme permis par Telegram."
    : `${demandes(count)} seront acceptées dans les prochaines minutes, au rythme permis par Telegram.`;
}
