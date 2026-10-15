import {
  UNKNOWN_PROVENANCE,
  provenanceFromJson,
  provenanceLabel,
  provenanceOfLink,
  type Provenance,
  type ProvenanceLink,
  type RuleScope,
} from "@linkaffipro/core";
import { delayLabel, stringList } from "./entry-rule";
import { frQuotes } from "./exceptions";
import { isQueuedForApproval } from "./requests";

/**
 * Provenance et règle appliquée d'une demande d'adhésion, en français (phase 11) : carte de l'onglet « Demandes »,
 * onglet « Membres » de la fiche canal et fiche membre. Fonctions pures, testées sans base.
 *
 * « Venu de « Tir Cadré » (canal obligatoire) · règle : 1 jour · acceptation prévue le 12 oct. à 10 h 14 »
 *
 * - Provenance : celle enregistrée par le bot (`Membership.source.provenance`) ; pour une demande d'avant la phase 11,
 *   déduite de son lien d'invitation (`provenanceOfLink`, même règle que le bot). Le texte est refait avec les titres
 *   actuels des canaux (canal renommé) ; un canal supprimé garde le texte enregistré.
 * - Règle : celle enregistrée (`source.appliedRule` + délai de `source.rule`), sinon la règle de la demande relue en
 *   base ; « aucune règle » pour un canal pas encore réglé.
 * - Heure de Paris, toujours.
 */

/** Lien d'invitation d'une demande, relu en base (provenance d'une ancienne demande et nom du lien). */
export type DisplayLink = ProvenanceLink & { name: string };

/** Règle d'adhésion relue en base (`Membership.approvalRule`), pour une demande sans règle enregistrée. */
export type DisplayRuleRow = {
  scope: RuleScope;
  isDefault: boolean;
  label: string | null;
  mode: "IMMEDIATE" | "DELAY" | "MANUAL";
  delaySeconds: number;
  gateMode: "NONE" | "REQUIRED" | "SOFT";
  gateChannelIds: unknown;
};

/** Ce qu'il faut d'une adhésion pour l'afficher. */
export type DisplayMembership = {
  channelId?: string;
  status: string;
  source: unknown;
  inviteLink?: DisplayLink | null;
  approvalRule?: DisplayRuleRow | null;
  approveAt?: Date | null;
  approvedAt?: Date | null;
  joinedAt?: Date | null;
};

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Provenance de l'adhésion (enregistrée, sinon déduite du lien) et son texte (« Venu de « Tir Cadré » … »).
 * Page d'atterrissage (phase 15) : « Venu de la page « Promo » (source « tk01 ») », refait avec le nom actuel de la
 * page (`landingPageNames`) ; page supprimée ou nom non fourni : le texte enregistré par le bot.
 */
export function membershipProvenance(
  m: Pick<DisplayMembership, "source" | "inviteLink">,
  titles: Readonly<Record<string, string>> = {},
  landingPageNames: Readonly<Record<string, string>> = {},
): { provenance: Provenance; label: string } {
  const s = rec(m.source);
  const stored = provenanceFromJson(s.provenance);
  const storedLabel = str(rec(s.provenance).label);
  const provenance = stored ?? (m.inviteLink ? provenanceOfLink(m.inviteLink) : UNKNOWN_PROVENANCE);
  const linkName = m.inviteLink?.name ?? str(rec(s.inviteLink).name);
  // Canal d'origine supprimé (titre inconnu) : le texte enregistré garde son ancien nom.
  if (
    storedLabel &&
    provenance.type === "GATE" &&
    (!provenance.sourceChannelId || !titles[provenance.sourceChannelId])
  )
    return { provenance, label: frQuotes(storedLabel) };
  if (
    storedLabel &&
    provenance.type === "LANDING" &&
    (!provenance.landing?.pageId || !landingPageNames[provenance.landing.pageId])
  )
    return { provenance, label: frQuotes(storedLabel) };
  return {
    provenance,
    label: frQuotes(provenanceLabel(provenance, titles, linkName, landingPageNames)),
  };
}

/** Règle appliquée à une demande, prête à afficher. */
export type AppliedRuleView =
  | { kind: "default"; timing: string }
  | { kind: "exception"; label: string | null; timing: string }
  | { kind: "none"; timing: string };

/** Délai d'une règle en mots : « tout de suite », « 1 jour », « 5 minutes après les canaux à rejoindre »… */
export function ruleTiming(rule: {
  mode: string;
  delaySeconds: number;
  gateMode: string;
  /** Canaux à rejoindre réellement demandés (0 : aucun, ou non imposés pour cette provenance). */
  gateCount: number;
}): string {
  if (rule.mode === "MANUAL") return "à valider à la main";
  const delay = rule.mode === "IMMEDIATE" ? 0 : Math.max(0, rule.delaySeconds);
  if (rule.gateMode === "REQUIRED" && rule.gateCount > 0)
    return delay === 0
      ? "dès les canaux rejoints"
      : `${delayLabel(delay)} après les canaux à rejoindre`;
  return delay === 0 ? "tout de suite" : delayLabel(delay);
}

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * Règle appliquée : celle enregistrée par le bot (phase 11), sinon la règle de la demande relue en base. Null : rien à
 * dire (entrée directe d'avant la phase 11, ou règle inconnue).
 */
export function appliedRuleView(
  m: Pick<DisplayMembership, "source" | "approvalRule" | "channelId">,
): AppliedRuleView | null {
  const s = rec(m.source);
  if (s.joinedDirectly === true) return null;
  if (s.noRule === "IMMEDIATE") return { kind: "none", timing: "entrée tout de suite" };
  if (s.noRule === "MANUAL") return { kind: "none", timing: "à valider à la main" };
  const snapshot = rec(s.rule);
  const applied = "appliedRule" in s ? s.appliedRule : undefined;
  if (applied && typeof applied === "object") {
    const a = rec(applied);
    const noGates = a.noGates === true;
    const gateCount = noGates ? 0 : count(s.gates) + count(s.gateLinksMissing);
    const row = m.approvalRule;
    const timing = ruleTiming({
      mode: str(snapshot.mode) ?? row?.mode ?? "DELAY",
      delaySeconds: Number(snapshot.delaySeconds ?? row?.delaySeconds ?? 0) || 0,
      gateMode: str(snapshot.gateMode) ?? row?.gateMode ?? "NONE",
      gateCount,
    });
    return a.scope === "DEFAULT" || !a.scope
      ? { kind: "default", timing }
      : { kind: "exception", label: a.label ? frQuotes(String(a.label)) : null, timing };
  }
  if (applied === null) return { kind: "none", timing: "à valider à la main" };
  // Demande d'avant la phase 11 : règle relue en base, délai enregistré s'il existe.
  const row = m.approvalRule;
  if (!row) return null;
  const gates = stringList(row.gateChannelIds).filter((id) => id !== m.channelId);
  const timing = ruleTiming({
    mode: str(snapshot.mode) ?? row.mode,
    delaySeconds: Number(snapshot.delaySeconds ?? row.delaySeconds) || 0,
    gateMode: str(snapshot.gateMode) ?? row.gateMode,
    gateCount: count(s.gates) || gates.length,
  });
  return row.isDefault || row.scope === "DEFAULT"
    ? { kind: "default", timing }
    : { kind: "exception", label: row.label ? frQuotes(row.label) : null, timing };
}

/** « règle : 1 jour », « règle par défaut : 5 minutes », « aucune règle : à valider à la main ». */
export function appliedRuleText(view: AppliedRuleView | null): string | null {
  if (!view) return null;
  switch (view.kind) {
    case "exception":
      return `règle : ${view.timing}`;
    case "default":
      return `règle par défaut : ${view.timing}`;
    default:
      return `aucune règle : ${view.timing}`;
  }
}

const PARIS_PARTS = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Paris",
});

/** Date et heure de Paris en toutes lettres : « le 12 oct. à 10 h 14 » (année ajoutée si ce n'est pas l'année en cours). */
export function parisDateTime(d: Date, now: Date = new Date()): string {
  const parts = (x: Date) =>
    Object.fromEntries(PARIS_PARTS.formatToParts(x).map((p) => [p.type, p.value]));
  const p = parts(d);
  const year = p.year !== parts(now).year ? ` ${p.year}` : "";
  return `le ${p.day} ${p.month}${year} à ${Number(p.hour)} h ${p.minute}`;
}

/** Date d'acceptation : prévue (demande programmée) ou faite ; null sinon (la suite est dite ailleurs). */
export function acceptanceText(
  m: Pick<DisplayMembership, "status" | "approveAt" | "approvedAt"> & { source?: unknown },
  now: Date = new Date(),
): string | null {
  // « Tout accepter » : l'heure enregistrée n'est qu'une heure de secours, l'acceptation est en cours.
  if (
    m.status === "SCHEDULED" &&
    isQueuedForApproval({ status: "SCHEDULED", approveAt: m.approveAt ?? null, source: m.source })
  )
    return "acceptation en cours";
  if (m.status === "SCHEDULED" && m.approveAt)
    return `acceptation prévue ${parisDateTime(m.approveAt, now)}`;
  if (m.approvedAt && ["APPROVED", "LEFT", "KICKED"].includes(m.status))
    return `acceptée ${parisDateTime(m.approvedAt, now)}`;
  return null;
}

/**
 * La ligne complète : « Venu de « Tir Cadré » (canal obligatoire) · règle : 1 jour · acceptation prévue le 12 oct. à
 * 10 h 14 ». `withAcceptance` : faux quand l'écran dit déjà la date (volet de l'onglet Membres) ;
 * `landingPageNames` : noms actuels des pages d'atterrissage (`landingPageIdsOf`), pour une page renommée.
 */
export function provenanceLine(
  m: DisplayMembership,
  titles: Readonly<Record<string, string>> = {},
  now: Date = new Date(),
  opts: { withAcceptance?: boolean; landingPageNames?: Readonly<Record<string, string>> } = {},
): string {
  const parts = [
    membershipProvenance(m, titles, opts.landingPageNames).label,
    appliedRuleText(appliedRuleView(m)),
    opts.withAcceptance === false ? null : acceptanceText(m, now),
  ];
  return parts.filter((p): p is string => Boolean(p)).join(" · ");
}

/**
 * Pages d'atterrissage à relire pour les textes (`landingPageNames` de `lib/landing/queries.ts`, phase 15) : page d'où
 * vient chaque personne, pour montrer son nom actuel (page renommée), comme les statistiques.
 */
export function landingPageIdsOf(
  rows: ReadonlyArray<Pick<DisplayMembership, "source" | "inviteLink">>,
): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const p = membershipProvenance(r).provenance;
    if (p.type === "LANDING" && p.landing?.pageId) ids.add(p.landing.pageId);
  }
  return [...ids];
}

/** Canaux d'origine à relire pour les textes (`titles`) : canal d'où vient chaque personne. */
export function sourceChannelIdsOf(
  rows: ReadonlyArray<Pick<DisplayMembership, "source" | "inviteLink">>,
): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const p = membershipProvenance(r).provenance;
    if (p.sourceChannelId) ids.add(p.sourceChannelId);
  }
  return [...ids];
}
