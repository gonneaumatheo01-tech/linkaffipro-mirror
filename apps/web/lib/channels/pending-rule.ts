import type { ProvenanceLink } from "@linkaffipro/core";
import { prisma, recordEvent, toJsonValue, type MembershipStatus } from "@linkaffipro/db";
import {
  GATE_SATISFYING_STATUSES,
  approveAtAfterGate,
  computeInitialState,
  hasGate,
  noGatesOf,
  provenanceOfMembership,
  ruleFromRow,
  withEffectiveGates,
  type RuleData,
} from "@linkaffipro/telegram";
import { isQueuedForApproval } from "./requests";

/**
 * « Leur appliquer la nouvelle règle » (fiche canal → « Qui peut entrer et quand », phase 14).
 *
 * Une règle enregistrée ne s'applique qu'aux prochaines demandes : une demande déjà en cours garde l'état calculé à son
 * arrivée (« Attend les canaux », acceptation programmée à telle heure, à valider à la main). Ce module dit combien de
 * demandes en cours de la règle (règle appliquée à leur arrivée : `approvalRuleId`, sinon `source.appliedRule.id`)
 * changeraient avec la règle enregistrée, et les recalcule à la demande de l'équipe, comme si elles arrivaient
 * maintenant (canaux à rejoindre effectifs selon leur provenance, canal d'origine jamais demandé, `noGates` mémorisé),
 * avec leur date d'origine pour le délai :
 * - canaux proposés ou aucun canal → acceptation programmée à max(date de la demande + délai, maintenant) ;
 * - canaux obligatoires déjà rejoints (« ✅ J'ai rejoint » ou validation automatique) → max(date des canaux rejoints +
 *   délai, maintenant) ;
 * - canaux obligatoires pas encore rejoints → vérification immédiate avec nos données (dernière demande de la personne
 *   dans chaque canal obligatoire en cours ou acceptée, même règle que « ✅ J'ai rejoint ») : tous satisfaits →
 *   acceptation programmée (`approveAtAfterGate`), événement `membership.gate_satisfied` { auto: true, trigger:
 *   "rule_applied" } ; sinon « Attend les canaux ». Telegram n'est pas interrogé (le filet du service d'arrière-plan
 *   s'en charge) ;
 * - validation à la main → à valider à la main.
 * Les demandes déjà programmées sont recalculées comme les autres (décision E7) : délai allongé → acceptées plus tard,
 * validation à la main → à valider à la main, canaux obligatoires → « Attend les canaux » (sauf canaux déjà rejoints).
 * Garde-fous :
 * - une demande en train d'être acceptée n'est jamais touchée : heure d'acceptation passée (le service d'arrière-plan
 *   l'accepte en ce moment) ou acceptée par l'équipe (« Tout accepter », `isQueuedForApproval`) ;
 * - une demande ne passe en « Attend les canaux » que si l'accueil lui a déjà montré les canaux (`source.gates`), sinon
 *   elle resterait bloquée sans boutons : elle garde alors son état (`keptAsIs`, dit dans la fenêtre de confirmation) ;
 * - l'expiration n'est jamais recalculée (une nouvelle expiration courte ferait expirer ou refuser d'un coup les
 *   demandes anciennes) : la demande garde la sienne, effacée quand elle est programmée.
 * Aucun message n'est envoyé (ni accueil, ni « Canaux rejoints ») ; chaque demande modifiée reçoit l'événement
 * `membership.rule_applied`. Fonctions pures (plan, textes) testées sans base ; lecture et écriture en fin de fichier.
 */

/** Statuts des demandes en cours qu'une règle peut recalculer (pas les échecs d'acceptation). */
export const PENDING_RULE_STATUSES = [
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
] as const satisfies readonly MembershipStatus[];
export type PendingStatus = (typeof PENDING_RULE_STATUSES)[number];

/** Une demande en cours, telle que relue en base. */
export type PendingMembership = {
  id: string;
  memberId: string;
  channelId: string;
  status: PendingStatus;
  requestedAt: Date;
  approveAt: Date | null;
  expiresAt: Date | null;
  gateSatisfiedAt: Date | null;
  approvalRuleId: string | null;
  source: unknown;
  /** Lien d'invitation (provenance d'une demande d'avant la phase 11). */
  inviteLink?: ProvenanceLink | null;
  /** Garde-fou d'écriture : la demande n'a pas bougé depuis sa lecture. */
  updatedAt?: Date;
};

/** Règle d'adhésion relue en base (`ApprovalRule`). */
export type PendingRuleRow = Parameters<typeof ruleFromRow>[0] & {
  id: string;
  channelId: string;
  isDefault: boolean;
};

/** État d'une demande d'après la règle (date d'acceptation pas encore ramenée à maintenant). */
export type PendingTarget = {
  status: PendingStatus;
  approveAt: Date | null;
  /** Canaux obligatoires effectifs encore à vérifier (« Attend les canaux » seulement). */
  gateChannelIds: string[];
};

/** Une demande dont l'état pourrait changer : sa règle effective et l'état d'après la règle. */
export type PendingPlan = {
  membership: PendingMembership;
  ruleId: string;
  rule: RuleData;
  target: PendingTarget;
};

/** Ce qui sera écrit pour une demande. */
export type PendingWrite = {
  status: PendingStatus;
  approveAt: Date | null;
  expiresAt: Date | null;
  /** Canaux obligatoires satisfaits d'après nos données au moment du recalcul. */
  gateSatisfiedAt: Date | null;
};

/** Canaux obligatoires satisfaits d'après nos données (`latestStatusLookup`). */
export type SatisfiedLookup = (memberId: string, channelIds: readonly string[]) => boolean;

/** Nombre de demandes par état d'arrivée (après la vérification des canaux obligatoires). */
export type PendingByStatus = Record<PendingStatus, number>;

/** Résumé d'une règle : demandes en cours qui changeraient. */
export type PendingSummary = {
  ruleId: string;
  count: number;
  byStatus: PendingByStatus;
  /** Demandes qui seraient acceptées tout de suite (délai déjà écoulé). */
  acceptNow: number;
  /** Demandes de la règle qui gardent leur état : canaux obligatoires que l'accueil ne leur a pas montrés. */
  kept?: number;
};

/** Ce que l'écran montre pour une règle (textes prêts, calculés par le serveur). */
export type PendingRuleView = {
  ruleId: string;
  count: number;
  sentence: string;
  confirmTitle: string;
  confirmDescription: string;
};

type Rec = Record<string, unknown>;
function rec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

/** Écart toléré entre deux dates (arrondis de la base) avant de parler de changement. */
const SAME_TIME_MS = 1000;

function emptyByStatus(): PendingByStatus {
  return { REQUESTED: 0, PENDING_GATE: 0, SCHEDULED: 0 };
}

/** Règle appliquée à l'arrivée de la demande : `approvalRuleId`, sinon `source.appliedRule.id`. */
export function ruleIdOf(m: Pick<PendingMembership, "approvalRuleId" | "source">): string | null {
  if (m.approvalRuleId) return m.approvalRuleId;
  const id = rec(rec(m.source).appliedRule).id;
  return typeof id === "string" && id ? id : null;
}

/**
 * Règle enregistrée telle qu'elle s'applique à cette demande : canaux à rejoindre effectifs selon sa provenance (jamais
 * le canal lui-même ni celui d'où vient la personne, aucun si l'accueil n'en a pas demandé), comme le bot.
 */
export function effectiveRuleOf(m: PendingMembership, row: PendingRuleRow): RuleData {
  const source = rec(m.source);
  const provenance = provenanceOfMembership(source, m.inviteLink ?? null);
  return withEffectiveGates(ruleFromRow(row), provenance, m.channelId, noGatesOf(source));
}

/** État de la demande d'après la règle, avec sa date d'origine pour le délai. */
export function targetFor(m: PendingMembership, rule: RuleData): PendingTarget {
  const initial = computeInitialState(rule, m.requestedAt);
  if (initial.status === "PENDING_GATE") {
    // Canaux obligatoires déjà rejoints (bouton ou validation automatique) : le délai part de ce moment.
    if (m.gateSatisfiedAt)
      return {
        status: "SCHEDULED",
        approveAt: approveAtAfterGate(rule, m.gateSatisfiedAt),
        gateChannelIds: [],
      };
    return {
      status: "PENDING_GATE",
      approveAt: null,
      gateChannelIds: hasGate(rule) ? [...rule.gateChannelIds] : [],
    };
  }
  return {
    status: initial.status === "REQUESTED" ? "REQUESTED" : "SCHEDULED",
    approveAt: initial.approveAt,
    gateChannelIds: [],
  };
}

/** L'accueil a-t-il montré à la personne les boutons des canaux à rejoindre (`source.gates`) ? */
export function channelsShown(source: unknown): boolean {
  const gates = rec(source).gates;
  return Array.isArray(gates) && gates.length > 0;
}

/**
 * Demande programmée en train d'être acceptée : heure d'acceptation passée (le passage des 20 secondes la prend en ce
 * moment) ou acceptée par l'équipe (« Tout accepter ») ; jamais recalculée.
 */
export function beingAccepted(
  m: Pick<PendingMembership, "status" | "approveAt" | "source">,
  now: Date,
): boolean {
  if (m.status !== "SCHEDULED") return false;
  return !m.approveAt || m.approveAt.getTime() <= now.getTime() || isQueuedForApproval(m);
}

/** Heure d'acceptation d'après la règle, jamais avant maintenant. */
function atLeastNow(at: Date, now: Date): Date {
  return at.getTime() > now.getTime() ? at : now;
}

/** Même heure, aux arrondis de la base près. */
function sameTime(current: Date | null, next: Date): boolean {
  return !!current && Math.abs(current.getTime() - next.getTime()) <= SAME_TIME_MS;
}

/**
 * La demande peut-elle changer avec cette règle (avant la vérification des canaux) ? Une demande qui garde son état
 * (« Attend les canaux » → « Attend les canaux », à valider → à valider), une demande programmée à la même heure, ou
 * une demande en train d'être acceptée, ne change pas.
 */
export function mayChange(m: PendingMembership, t: PendingTarget, now: Date): boolean {
  if (beingAccepted(m, now)) return false;
  if (t.status === "REQUESTED") return m.status !== "REQUESTED";
  if (t.status === "PENDING_GATE") return m.status !== "PENDING_GATE";
  if (m.status !== "SCHEDULED") return true;
  return !sameTime(m.approveAt, atLeastNow(t.approveAt!, now));
}

/**
 * Demandes en cours qui pourraient changer, règle par règle : seulement celles d'une règle active du canal. Une règle
 * désactivée (exception coupée) n'est jamais réappliquée.
 */
export function planPending(
  memberships: readonly PendingMembership[],
  rows: readonly (PendingRuleRow & { isActive: boolean })[],
  now: Date,
): PendingPlan[] {
  const byId = new Map(rows.filter((r) => r.isActive).map((r) => [r.id, r]));
  const out: PendingPlan[] = [];
  for (const m of memberships) {
    const ruleId = ruleIdOf(m);
    const row = ruleId ? byId.get(ruleId) : undefined;
    if (!ruleId || !row || row.channelId !== m.channelId) continue;
    const rule = effectiveRuleOf(m, row);
    const target = targetFor(m, rule);
    if (mayChange(m, target, now)) out.push({ membership: m, ruleId, rule, target });
  }
  return out;
}

/**
 * Canaux obligatoires satisfaits d'après nos données : la DERNIÈRE demande de la personne dans chaque canal est en
 * cours ou acceptée (`GATE_SATISFYING_STATUSES`, comme « ✅ J'ai rejoint » ; une entrée sans demande est une
 * adhésion acceptée). `rows` : demandes de ces personnes dans ces canaux, de la plus récente à la plus ancienne.
 */
export function latestStatusLookup(
  rows: ReadonlyArray<{ memberId: string; channelId: string; status: MembershipStatus }>,
): SatisfiedLookup {
  const latest = new Map<string, MembershipStatus>();
  for (const r of rows) {
    const key = `${r.memberId}:${r.channelId}`;
    if (!latest.has(key)) latest.set(key, r.status);
  }
  return (memberId, channelIds) =>
    channelIds.length > 0 &&
    channelIds.every((id) => {
      const st = latest.get(`${memberId}:${id}`);
      return st !== undefined && GATE_SATISFYING_STATUSES.includes(st);
    });
}

/**
 * Ce qui sera écrit (null : la demande garde son état) : heure d'acceptation ramenée à maintenant, canaux
 * obligatoires vérifiés avec nos données, garde-fous de l'en-tête (jamais une demande en train d'être acceptée,
 * jamais d'attente sans boutons, expiration gardée).
 */
export function writeFor(
  plan: PendingPlan,
  satisfied: SatisfiedLookup,
  now: Date,
): PendingWrite | null {
  const { membership: m, target: t } = plan;
  if (beingAccepted(m, now)) return null;
  const scheduled = (at: Date, gateSatisfiedAt: Date | null): PendingWrite | null => {
    const next = atLeastNow(at, now);
    if (m.status === "SCHEDULED" && sameTime(m.approveAt, next)) return null;
    return { status: "SCHEDULED", approveAt: next, expiresAt: null, gateSatisfiedAt };
  };
  if (t.status === "SCHEDULED") return scheduled(t.approveAt!, null);
  if (t.status === "PENDING_GATE") {
    if (t.gateChannelIds.length > 0 && satisfied(m.memberId, t.gateChannelIds))
      return scheduled(approveAtAfterGate(plan.rule, now), now);
    if (m.status !== "PENDING_GATE" && channelsShown(m.source))
      return {
        status: "PENDING_GATE",
        approveAt: null,
        expiresAt: m.expiresAt,
        gateSatisfiedAt: null,
      };
    return null;
  }
  return m.status !== "REQUESTED"
    ? { status: "REQUESTED", approveAt: null, expiresAt: m.expiresAt, gateSatisfiedAt: null }
    : null;
}

/**
 * Demande que la règle mettrait en « Attend les canaux » mais qui garde son état (programmée ou à valider à la main) :
 * l'accueil ne lui a pas montré les canaux, elle resterait bloquée sans boutons. Dite à l'équipe.
 */
export function keptAsIs(plan: PendingPlan, write: PendingWrite | null): boolean {
  return (
    write === null &&
    plan.target.status === "PENDING_GATE" &&
    plan.membership.status !== "PENDING_GATE"
  );
}

/**
 * Source d'une demande recalculée : une demande qui n'attend plus les canaux n'a plus besoin des marques « lien
 * manquant » ni « vérification impossible » (le point « À faire » de l'accueil disparaît).
 */
export function sourceAfterRecalc(source: Record<string, unknown>, status: PendingStatus): Rec {
  if (status === "PENDING_GATE") return source;
  const out: Rec = { ...source };
  if (Array.isArray(source.gateLinksMissing) && source.gateLinksMissing.length > 0)
    out.gateLinksMissing = [];
  if (Array.isArray(source.gateCheckFailed) && source.gateCheckFailed.length > 0)
    out.gateCheckFailed = [];
  return out;
}

/** Résumé d'une règle à partir de ce qui serait écrit (`kept` : demandes gardées telles quelles, `keptAsIs`). */
export function summarize(
  ruleId: string,
  writes: readonly PendingWrite[],
  now: Date,
  kept = 0,
): PendingSummary {
  const byStatus = emptyByStatus();
  let acceptNow = 0;
  for (const w of writes) {
    byStatus[w.status]++;
    if (w.status === "SCHEDULED" && w.approveAt && w.approveAt.getTime() <= now.getTime())
      acceptNow++;
  }
  return { ruleId, count: writes.length, byStatus, acceptNow, kept };
}

/** Phrase sur les demandes gardées telles quelles (vide s'il n'y en a pas). */
function keptSentence(kept: number | undefined): string {
  if (!kept) return "";
  return kept === 1
    ? " 1 autre demande garde son état : l'accueil du bot ne lui a pas montré les canaux à rejoindre."
    : ` ${n(kept)} autres demandes gardent leur état : l'accueil du bot ne leur a pas montré les canaux à rejoindre.`;
}

function n(v: number): string {
  return v.toLocaleString("fr-FR");
}

/**
 * Phrase sous « Enregistrer la règle » : « 37 demandes déjà en attente suivent l'ancienne règle. » ; pour une
 * exception, la provenance d'abord (« Personnes venues de « Tir Cadré » : 3 demandes… »).
 */
export function pendingSentence(count: number, who?: string | null): string {
  const core =
    count === 1
      ? "1 demande déjà en attente suit l'ancienne règle."
      : `${n(count)} demandes déjà en attente suivent l'ancienne règle.`;
  return who ? `${who} : ${core.charAt(0).toLowerCase()}${core.slice(1)}` : core;
}

/** Ce que deviendront les demandes, en une liste lisible (« 30 seront acceptées (25 tout de suite), … »). */
function outcomeParts(
  s: Pick<PendingSummary, "byStatus" | "acceptNow">,
  future: boolean,
): string[] {
  const parts: string[] = [];
  const { SCHEDULED: sch, PENDING_GATE: gate, REQUESTED: manual } = s.byStatus;
  if (sch > 0) {
    const verb = future
      ? sch > 1
        ? "seront acceptées"
        : "sera acceptée"
      : sch > 1
        ? "acceptations programmées"
        : "acceptation programmée";
    const now =
      s.acceptNow === 0
        ? ""
        : s.acceptNow === sch
          ? " tout de suite"
          : ` (${n(s.acceptNow)} tout de suite)`;
    parts.push(`${n(sch)} ${verb}${now}`);
  }
  if (gate > 0)
    parts.push(
      future
        ? `${n(gate)} ${gate > 1 ? "attendront" : "attendra"} encore les canaux obligatoires`
        : `${n(gate)} ${gate > 1 ? "attendent" : "attend"} encore les canaux obligatoires`,
    );
  if (manual > 0)
    parts.push(
      future
        ? `${n(manual)} ${manual > 1 ? "seront" : "sera"} à valider à la main`
        : `${n(manual)} à valider à la main`,
    );
  return parts;
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} et ${parts.at(-1)}`;
}

/** Fenêtre de confirmation de « Leur appliquer la nouvelle règle ». */
export function applyConfirmText(s: PendingSummary): { title: string; description: string } {
  const title =
    s.count === 1
      ? "Appliquer la nouvelle règle à 1 demande ?"
      : `Appliquer la nouvelle règle à ${n(s.count)} demandes ?`;
  const outcome = joinParts(outcomeParts(s, true));
  return {
    title,
    description: `Chaque demande est recalculée comme si elle arrivait maintenant, avec sa date d'origine pour le délai${outcome ? ` : ${outcome}` : ""}. Aucun message d'accueil n'est renvoyé.${keptSentence(s.kept)}`,
  };
}

/** Ce que l'écran montre pour une règle (null : aucune demande à recalculer). */
export function pendingRuleView(
  s: PendingSummary | null | undefined,
  who?: string | null,
): PendingRuleView | null {
  if (!s || s.count === 0) return null;
  const confirm = applyConfirmText(s);
  return {
    ruleId: s.ruleId,
    count: s.count,
    sentence: pendingSentence(s.count, who),
    confirmTitle: confirm.title,
    confirmDescription: confirm.description,
  };
}

/**
 * Ajout au message « Règle enregistrée » quand des demandes en cours suivent encore l'ancienne version de la règle
 * (vide sinon) : où trouver le bouton (sous « Enregistrer la règle », ou au-dessus des exceptions).
 */
export function pendingFlash(count: number, where: "default" | "exception"): string {
  if (count <= 0) return "";
  const head =
    count === 1
      ? "1 demande déjà en attente suit encore l'ancienne règle"
      : `${n(count)} demandes déjà en attente suivent encore l'ancienne règle`;
  const place =
    where === "default"
      ? "est sous le bouton « Enregistrer la règle »"
      : "est juste au-dessus des exceptions";
  return `${head} : « Leur appliquer la nouvelle règle » ${place}.`;
}

/** Résultat d'une application. */
export type ApplyResult =
  | {
      status: "ok";
      count: number;
      byStatus: PendingByStatus;
      acceptNow: number;
      /** Demandes passées en acceptation programmée parce que leurs canaux obligatoires étaient déjà satisfaits. */
      gateSatisfied: number;
      /** Demandes modifiées entre-temps (par le bot ou le service d'arrière-plan) : laissées telles quelles. */
      skipped: number;
      /** Demandes gardées telles quelles (canaux obligatoires que l'accueil ne leur a pas montrés). */
      kept?: number;
    }
  | { status: "not_found" }
  | { status: "inactive" };

/** Message de retour après « Leur appliquer la nouvelle règle ». */
export function appliedMessage(r: Extract<ApplyResult, { status: "ok" }>): string {
  if (r.count === 0)
    return "Aucune demande en attente à recalculer : elles suivent déjà la règle enregistrée.";
  const head =
    r.count === 1
      ? "Nouvelle règle appliquée à 1 demande en attente"
      : `Nouvelle règle appliquée à ${n(r.count)} demandes en attente`;
  const outcome = joinParts(outcomeParts(r, false));
  const skipped =
    r.skipped === 0
      ? ""
      : r.skipped === 1
        ? " 1 demande a changé entre-temps : elle n'a pas été modifiée."
        : ` ${n(r.skipped)} demandes ont changé entre-temps : elles n'ont pas été modifiées.`;
  return `${head}${outcome ? ` : ${outcome}` : ""}. Aucun message n'a été envoyé.${keptSentence(r.kept)}${skipped}`;
}

// ============================================================
// Lecture et écriture en base
// ============================================================

/** Demandes relues au plus par canal (bien au-delà d'un trafic réel : 48 demandes en une nuit sur Zone Interdite). */
const MAX_PENDING = 5000;

const pendingSelect = {
  id: true,
  memberId: true,
  channelId: true,
  status: true,
  requestedAt: true,
  approveAt: true,
  expiresAt: true,
  gateSatisfiedAt: true,
  approvalRuleId: true,
  source: true,
  updatedAt: true,
  inviteLink: {
    select: {
      id: true,
      kind: true,
      sourceChannelId: true,
      adPlatform: true,
      linkaffiCampaignKey: true,
      linkaffiCampaignName: true,
      linkaffiAffiliateId: true,
      linkaffiAffiliateName: true,
    },
  },
} as const;

async function loadPending(channelId: string): Promise<PendingMembership[]> {
  const rows = await prisma.membership.findMany({
    where: { channelId, status: { in: [...PENDING_RULE_STATUSES] } },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    take: MAX_PENDING,
    select: pendingSelect,
  });
  return rows.map((r) => ({ ...r, status: r.status as PendingStatus }));
}

/** Canaux obligatoires satisfaits d'après nos données, pour toutes les demandes à vérifier (une seule lecture). */
async function satisfiedLookupFor(plans: readonly PendingPlan[]): Promise<SatisfiedLookup> {
  const need = plans.filter(
    (p) => p.target.status === "PENDING_GATE" && p.target.gateChannelIds.length > 0,
  );
  if (need.length === 0) return () => false;
  const rows = await prisma.membership.findMany({
    where: {
      memberId: { in: [...new Set(need.map((p) => p.membership.memberId))] },
      channelId: { in: [...new Set(need.flatMap((p) => p.target.gateChannelIds))] },
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    select: { memberId: true, channelId: true, status: true },
  });
  return latestStatusLookup(rows);
}

/** Plans et écritures prévues pour les règles d'un canal (toutes, ou une seule). */
async function planChannel(
  channelId: string,
  now: Date,
  ruleId?: string,
): Promise<{ plans: PendingPlan[]; writes: PendingWrite[]; kept: Map<string, number> }> {
  const [rows, memberships] = await Promise.all([
    prisma.approvalRule.findMany({ where: { channelId, ...(ruleId ? { id: ruleId } : {}) } }),
    loadPending(channelId),
  ]);
  const candidates = planPending(
    ruleId ? memberships.filter((m) => ruleIdOf(m) === ruleId) : memberships,
    rows,
    now,
  );
  const satisfied = await satisfiedLookupFor(candidates);
  // Seulement les demandes qui changent vraiment (après la vérification des canaux obligatoires).
  const plans: PendingPlan[] = [];
  const writes: PendingWrite[] = [];
  const kept = new Map<string, number>();
  for (const p of candidates) {
    const w = writeFor(p, satisfied, now);
    if (w) {
      plans.push(p);
      writes.push(w);
    } else if (keptAsIs(p, w)) kept.set(p.ruleId, (kept.get(p.ruleId) ?? 0) + 1);
  }
  return { plans, writes, kept };
}

/** Résumé de chaque règle active du canal qui a des demandes en cours à recalculer (par identifiant de règle). */
export async function pendingRuleSummaries(
  channelId: string,
  now: Date = new Date(),
): Promise<Record<string, PendingSummary>> {
  const { plans, writes, kept } = await planChannel(channelId, now);
  const byRule = new Map<string, PendingWrite[]>();
  plans.forEach((p, i) => {
    const list = byRule.get(p.ruleId) ?? [];
    list.push(writes[i]!);
    byRule.set(p.ruleId, list);
  });
  return Object.fromEntries(
    [...byRule.entries()].map(([id, ws]) => [id, summarize(id, ws, now, kept.get(id) ?? 0)]),
  );
}

/** Résumé d'une règle (après son enregistrement), ou null si aucune demande n'est à recalculer. */
export async function pendingSummaryForRule(
  channelId: string,
  ruleId: string,
  now: Date = new Date(),
): Promise<PendingSummary | null> {
  const { writes, kept } = await planChannel(channelId, now, ruleId);
  return writes.length > 0 ? summarize(ruleId, writes, now, kept.get(ruleId) ?? 0) : null;
}

/**
 * Applique la règle enregistrée aux demandes en cours qui la suivent (voir l'en-tête du fichier). Chaque écriture
 * vérifie que la demande n'a pas bougé depuis sa lecture (bot, service d'arrière-plan) ; sinon elle est laissée.
 */
export async function applyRuleToPending(input: {
  channelId: string;
  ruleId: string;
  userId: string | null;
  now?: Date;
}): Promise<ApplyResult> {
  const now = input.now ?? new Date();
  const row = await prisma.approvalRule.findFirst({
    where: { id: input.ruleId, channelId: input.channelId },
  });
  if (!row) return { status: "not_found" };
  if (!row.isActive) return { status: "inactive" };
  const { plans, writes, kept } = await planChannel(input.channelId, now, input.ruleId);
  const done: PendingWrite[] = [];
  let gateSatisfied = 0;
  let skipped = 0;
  for (const [i, plan] of plans.entries()) {
    const w = writes[i]!;
    const m = plan.membership;
    const source: Rec = {
      ...sourceAfterRecalc(rec(m.source), w.status),
      // Règle relue sur la carte de la demande (« règle par défaut : 5 minutes ») : celle qui s'applique désormais.
      rule: {
        id: row.id,
        name: row.name,
        mode: row.mode,
        delaySeconds: row.delaySeconds,
        gateMode: row.gateMode,
      },
      ruleAppliedAt: now.toISOString(),
    };
    const botId = typeof source.botId === "string" ? source.botId : null;
    const res = await prisma.membership.updateMany({
      where: {
        id: m.id,
        status: m.status,
        ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
      },
      data: {
        status: w.status,
        approveAt: w.approveAt,
        expiresAt: w.expiresAt,
        ...(w.gateSatisfiedAt ? { gateSatisfiedAt: w.gateSatisfiedAt } : {}),
        source: toJsonValue(source),
      },
    });
    if (res.count === 0) {
      skipped++;
      continue;
    }
    done.push(w);
    // Mêmes champs que le moteur du bot (`applyRuleToPendingMembership`, `autoSatisfyGate`).
    await recordEvent({
      type: "membership.rule_applied",
      memberId: m.memberId,
      channelId: m.channelId,
      botId,
      payload: toJsonValue({
        membershipId: m.id,
        ruleId: row.id,
        previousStatus: m.status,
        status: w.status,
        approveAt: w.approveAt?.toISOString() ?? null,
        byUserId: input.userId,
      }),
    });
    if (w.gateSatisfiedAt) {
      gateSatisfied++;
      await recordEvent({
        type: "membership.gate_satisfied",
        memberId: m.memberId,
        channelId: m.channelId,
        botId,
        payload: toJsonValue({
          membershipId: m.id,
          approveAt: w.approveAt?.toISOString() ?? null,
          auto: true,
          trigger: "rule_applied",
          // Canaux satisfaits par une demande à nous (sans appel à Telegram).
          requested: plan.target.gateChannelIds,
        }),
      });
    }
  }
  const s = summarize(row.id, done, now);
  return {
    status: "ok",
    count: s.count,
    byStatus: s.byStatus,
    acceptNow: s.acceptNow,
    gateSatisfied,
    skipped,
    kept: kept.get(row.id) ?? 0,
  };
}
