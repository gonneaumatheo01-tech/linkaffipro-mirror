/**
 * Règles d'approbation : fonctions pures (résolution, calcul des échéances, rappels, expiration).
 *
 * Phase 11 : la règle d'une demande dépend de sa provenance (lien d'invitation) : exception du lien précis, du canal
 * d'origine, du type de provenance, sinon règle par défaut du canal (`resolveRuleForProvenance`, règles partagées de
 * `@linkaffipro/core` provenance.ts). Les canaux à rejoindre retenus sont les canaux « effectifs » : jamais le canal
 * lui-même ni le canal d'où vient la personne, aucun pour une personne venue d'un canal obligatoire qui tombe sur la
 * règle par défaut (`withEffectiveGates`).
 */
import type { ApprovalMode, ExpireAction, GateMode, MembershipStatus } from "@linkaffipro/db";
import {
  effectiveGateChannelIds,
  noRuleOutcome,
  pickRuleForProvenance,
  provenanceFromJson,
  provenanceOfLink,
  type Provenance,
  type ProvenanceLink,
  type RuleScope,
  type SourceKind,
} from "@linkaffipro/core";
import { t, type Lang, type MessageKey } from "../i18n";

export type RuleData = {
  id: string | null;
  name: string;
  /** Portée (phase 11) : règle par défaut du canal ou exception selon la provenance. */
  scope: RuleScope;
  /** Texte lisible de l'exception (« Venu de « Tir Cadré » ») ; null pour la règle par défaut. */
  label: string | null;
  /**
   * Message privé à l'arrivée de la demande (accueil, ou court message pour une personne venue d'un canal
   * obligatoire). Toujours envoyé quand des canaux sont à rejoindre (`welcomeKindFor`).
   */
  sendWelcome: boolean;
  mode: ApprovalMode;
  delaySeconds: number;
  gateChannelIds: string[];
  gateMode: GateMode;
  reminderAfterMinutes: number[];
  maxReminders: number;
  expireAfterHours: number | null;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
  /**
   * Vrai : les canaux à rejoindre de la règle ne sont pas imposés pour cette provenance (personne venue du bouton
   * « canal à rejoindre » d'un autre canal qui tombe sur la règle par défaut). `gateChannelIds` est alors vide.
   */
  noGates?: boolean;
};

/**
 * Ancienne règle implicite (approbation immédiate, sans gate). Le flux d'adhésion ne l'applique plus à une nouvelle demande
 * (voir `NO_RULE`) ; elle reste le repli du worker pour les rappels et expirations d'anciennes demandes sans règle.
 */
export const IMPLICIT_RULE: RuleData = {
  id: null,
  name: "Règle implicite (immédiat)",
  scope: "DEFAULT",
  label: null,
  sendWelcome: true,
  mode: "DELAY",
  delaySeconds: 0,
  gateChannelIds: [],
  gateMode: "NONE",
  reminderAfterMinutes: [],
  maxReminders: 0,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: true,
};

/**
 * Canal sans règle d'adhésion active (cas d'un canal détecté automatiquement) : « approbation jamais automatique par défaut ».
 * La demande est enregistrée à valider à la main (mode MANUAL), sans message privé, tant que l'équipe n'a pas réglé le canal.
 */
export const NO_RULE: RuleData = {
  id: null,
  name: "Aucune règle : validation manuelle",
  scope: "DEFAULT",
  label: null,
  sendWelcome: false,
  mode: "MANUAL",
  delaySeconds: 0,
  gateChannelIds: [],
  gateMode: "NONE",
  reminderAfterMinutes: [],
  maxReminders: 0,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: false,
};

/**
 * Canal sans aucune règle, personne venue du bouton « canal à rejoindre » d'un de nos canaux (`noRuleOutcome`) : elle
 * entre tout de suite, sans aucun message (ni accueil, ni « Accepté »), comme avec les anciens liens à entrée directe.
 * Le worker l'accepte au balayage suivant (20 s au plus).
 */
export const NO_RULE_DIRECT: RuleData = {
  id: null,
  name: "Aucune règle : entrée directe (venu d'un canal obligatoire)",
  scope: "DEFAULT",
  label: null,
  sendWelcome: false,
  mode: "IMMEDIATE",
  delaySeconds: 0,
  gateChannelIds: [],
  gateMode: "NONE",
  reminderAfterMinutes: [],
  maxReminders: 0,
  expireAfterHours: null,
  expireAction: "KEEP",
  sendAcceptedMessage: false,
};

/** La règle appliquée est-elle l'absence de règle (canal pas encore réglé) ? */
export function isNoRule(rule: RuleData): boolean {
  return rule === NO_RULE || (rule.id === null && rule.mode === "MANUAL");
}

/** Entrée directe sans règle (personne venue d'un canal obligatoire, canal sans règle) ? */
export function isDirectEntry(rule: RuleData): boolean {
  return (
    rule === NO_RULE_DIRECT ||
    (rule.id === null &&
      rule.mode === "IMMEDIATE" &&
      !rule.sendWelcome &&
      !rule.sendAcceptedMessage)
  );
}

type RuleRow = {
  id: string;
  name: string;
  /** Colonnes de la phase 11 (facultatives : anciennes lignes et tests). */
  scope?: RuleScope;
  isDefault?: boolean;
  inviteLinkId?: string | null;
  label?: string | null;
  sendWelcome?: boolean;
  mode: ApprovalMode;
  delaySeconds: number;
  gateChannelIds: unknown;
  gateMode: GateMode;
  reminderAfterMinutes: unknown;
  maxReminders: number;
  expireAfterHours: number | null;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
  isActive: boolean;
};

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function numberList(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];
}

/**
 * Portée réelle d'une règle : une règle d'un lien précis enregistrée sans portée (`scope` laissé à DEFAULT par un
 * écrivain d'avant la phase 11, `isDefault` faux, `inviteLinkId` renseigné) est une règle de ce lien (INVITE_LINK),
 * jamais ignorée.
 */
export function scopeOfRow(row: Pick<RuleRow, "scope" | "isDefault" | "inviteLinkId">): RuleScope {
  if (row.inviteLinkId && row.isDefault !== true && (row.scope ?? "DEFAULT") === "DEFAULT")
    return "INVITE_LINK";
  return row.scope ?? "DEFAULT";
}

export function ruleFromRow(row: RuleRow): RuleData {
  return {
    id: row.id,
    name: row.name,
    scope: scopeOfRow(row),
    label: row.label ?? null,
    sendWelcome: row.sendWelcome ?? true,
    mode: row.mode,
    delaySeconds: Math.max(0, row.delaySeconds),
    gateChannelIds: stringList(row.gateChannelIds),
    gateMode: row.gateMode,
    reminderAfterMinutes: numberList(row.reminderAfterMinutes),
    maxReminders: Math.max(0, row.maxReminders),
    expireAfterHours: row.expireAfterHours,
    expireAction: row.expireAction,
    sendAcceptedMessage: row.sendAcceptedMessage,
  };
}

/**
 * Priorité : règle du lien, sinon règle par défaut du canal, sinon `NO_RULE` (validation manuelle, aucun message privé).
 * Les règles inactives sont ignorées. Avant la phase 11 ; le flux d'adhésion utilise `resolveRuleForProvenance`.
 */
export function resolveRule(
  linkRule: RuleRow | null | undefined,
  channelDefaultRule: RuleRow | null | undefined,
): RuleData {
  if (linkRule && linkRule.isActive) return ruleFromRow(linkRule);
  if (channelDefaultRule && channelDefaultRule.isActive) return ruleFromRow(channelDefaultRule);
  return NO_RULE;
}

/** Règle relue en base avec sa portée (phase 11) : ce qu'il faut pour la résolution selon la provenance. */
export type ScopedRuleRow = RuleRow & {
  scope: RuleScope;
  isDefault: boolean;
  inviteLinkId: string | null;
  sourceChannelId: string | null;
  sourceKind: SourceKind | null;
  sortOrder: number;
  /** Affilié visé par une exception « un affilié précis » (LINKAFFI_AFFILIATE, phase 13). */
  linkaffiAffiliateId?: string | null;
};

/**
 * Canaux à rejoindre effectifs d'une règle pour une provenance (`effectiveGateChannelIds`) : sans le canal lui-même ni
 * le canal d'où vient la personne (il compte comme rejoint : exigences croisées sans boucle), aucun pour une personne
 * venue d'un canal obligatoire qui tombe sur la règle par défaut. `keepNoGates` : décision mémorisée sur la demande à
 * son arrivée (`source.appliedRule.noGates`), qui l'emporte (jamais un canal que l'accueil n'a pas demandé).
 */
export function withEffectiveGates(
  rule: RuleData,
  provenance: Provenance,
  channelId: string,
  keepNoGates = false,
): RuleData {
  if (rule.id === null) return rule;
  const eff = effectiveGateChannelIds(rule, provenance, channelId);
  const noGates = keepNoGates || eff.noGates;
  return {
    ...rule,
    gateChannelIds: noGates ? [] : eff.gateChannelIds,
    ...(noGates ? { noGates } : {}),
  };
}

/**
 * Règle d'une demande selon sa provenance : la plus précise qui s'applique (lien précis → canal d'origine → type de
 * provenance → règle par défaut), avec ses canaux à rejoindre effectifs. Aucune règle : `NO_RULE` (validation à la
 * main, sans message), sauf pour une personne venue d'un canal obligatoire : `NO_RULE_DIRECT` (entrée tout de suite).
 */
export function resolveRuleForProvenance(
  rows: readonly ScopedRuleRow[],
  provenance: Provenance,
  channelId: string,
): RuleData {
  const picked = pickRuleForProvenance(
    rows.map((r) => ({ ...r, scope: scopeOfRow(r) })),
    provenance,
  );
  if (!picked) return noRuleOutcome(provenance) === "IMMEDIATE" ? NO_RULE_DIRECT : NO_RULE;
  return withEffectiveGates(ruleFromRow(picked), provenance, channelId);
}

/**
 * Provenance d'une demande enregistrée : celle mémorisée à son arrivée (`source.provenance`, phase 11), sinon déduite
 * de son lien d'invitation (anciennes demandes), sinon inconnue.
 */
export function provenanceOfMembership(
  source: Record<string, unknown> | null | undefined,
  link: ProvenanceLink | null | undefined,
): Provenance {
  return provenanceFromJson(source?.provenance) ?? provenanceOfLink(link);
}

/** Lectures nécessaires pour relire la règle d'une demande (base réelle : prisma-rules.ts ; tests : en mémoire). */
export type RuleLoaders = {
  ruleById(id: string): Promise<RuleRow | null>;
  /** Règles actives du canal (règle par défaut et exceptions). */
  channelRules(channelId: string): Promise<ScopedRuleRow[]>;
  linkById(id: string): Promise<ProvenanceLink | null>;
};

/** Ce qu'il faut d'une demande enregistrée pour relire sa règle. */
export type MembershipRuleInput = {
  channelId: string;
  approvalRuleId: string | null;
  inviteLinkId: string | null;
  source: unknown;
};

/**
 * Règle d'une demande enregistrée, avec ses canaux à rejoindre effectifs : la règle appliquée à son arrivée (même
 * inactive depuis), sinon (règle supprimée, ancienne demande) celle que sa provenance retient aujourd'hui. Les canaux à
 * rejoindre n'incluent jamais le canal d'où vient la personne, et aucun si l'accueil n'en a pas demandé
 * (`source.appliedRule.noGates`). Anciennes demandes sans provenance : déduite de leur lien d'invitation.
 */
export async function loadRuleForMembership(
  m: MembershipRuleInput,
  loaders: RuleLoaders,
): Promise<RuleData> {
  const source =
    m.source && typeof m.source === "object" ? (m.source as Record<string, unknown>) : {};
  const link =
    !provenanceFromJson(source.provenance) && m.inviteLinkId
      ? await loaders.linkById(m.inviteLinkId)
      : null;
  const provenance = provenanceOfMembership(source, link);
  const keep = noGatesOf(source);
  if (m.approvalRuleId) {
    const row = await loaders.ruleById(m.approvalRuleId);
    if (row) return withEffectiveGates(ruleFromRow(row), provenance, m.channelId, keep);
  }
  const rule = resolveRuleForProvenance(
    await loaders.channelRules(m.channelId),
    provenance,
    m.channelId,
  );
  return withEffectiveGates(rule, provenance, m.channelId, keep);
}

/** `noGates` mémorisé sur la demande (`source.appliedRule.noGates`). */
export function noGatesOf(source: Record<string, unknown> | null | undefined): boolean {
  const applied = source?.appliedRule;
  return (
    !!applied && typeof applied === "object" && (applied as { noGates?: unknown }).noGates === true
  );
}

/** Un gate est actif seulement s'il y a des canaux à rejoindre. */
export function hasGate(rule: RuleData): boolean {
  return rule.gateMode !== "NONE" && rule.gateChannelIds.length > 0;
}

export type InitialState = {
  status: MembershipStatus;
  approveAt: Date | null;
  expiresAt: Date | null;
};

/**
 * État initial d'une demande selon la règle. L'expiration ne concerne que les demandes qui attendent l'équipe
 * (REQUESTED) ou la personne (PENDING_GATE) : une demande planifiée dès son arrivée n'expire jamais (sinon une règle
 * « accepter dans 2 jours » avec « expiration 24 h → refuser » refuserait la personne à qui le bot a annoncé « accès
 * dans 2 jours » ; le worker applique la même règle aux demandes déjà enregistrées).
 */
export function computeInitialState(rule: RuleData, requestedAt: Date): InitialState {
  const expiresAt = rule.expireAfterHours
    ? new Date(requestedAt.getTime() + rule.expireAfterHours * 3600_000)
    : null;
  if (rule.mode === "MANUAL") return { status: "REQUESTED", approveAt: null, expiresAt };
  const delayMs = rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds * 1000;
  if (hasGate(rule) && rule.gateMode === "REQUIRED")
    return { status: "PENDING_GATE", approveAt: null, expiresAt };
  // NONE ou SOFT : on planifie dès la demande ; SOFT propose seulement les canaux.
  return {
    status: "SCHEDULED",
    approveAt: new Date(requestedAt.getTime() + delayMs),
    expiresAt: null,
  };
}

/** Échéance d'approbation une fois le gate satisfait. */
export function approveAtAfterGate(rule: RuleData, now: Date): Date {
  const delayMs = rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds * 1000;
  return new Date(now.getTime() + delayMs);
}

/** Un rappel est-il dû ? Retourne l'index du rappel à envoyer, ou null. */
export function dueReminderIndex(
  rule: RuleData,
  m: { requestedAt: Date; remindersSent: number },
  now: Date,
): number | null {
  if (m.remindersSent >= rule.maxReminders) return null;
  const minutes = rule.reminderAfterMinutes[m.remindersSent];
  if (minutes === undefined) return null;
  return now.getTime() >= m.requestedAt.getTime() + minutes * 60_000 ? m.remindersSent : null;
}

export type ExpirationOutcome = {
  status: MembershipStatus;
  approveNow: boolean;
  declineNow: boolean;
};

/** Que faire à l'expiration d'une demande non aboutie. */
export function expirationOutcome(rule: RuleData): ExpirationOutcome {
  switch (rule.expireAction) {
    case "APPROVE":
      return { status: "SCHEDULED", approveNow: true, declineNow: false };
    case "DECLINE":
      return { status: "DECLINED", approveNow: false, declineNow: true };
    default:
      return { status: "EXPIRED", approveNow: false, declineNow: false };
  }
}

/** Statuts non terminés (la demande est encore « vivante » côté Telegram). */
export const OPEN_STATUSES: MembershipStatus[] = ["REQUESTED", "PENDING_GATE", "SCHEDULED"];

/**
 * Texte du délai d'une règle (`{delai}` des messages du bot) : « par l'équipe » quand l'équipe valide chaque demande à
 * la main (aucune heure d'acceptation n'est promise, même si un délai est enregistré), « immédiatement » pour une
 * acceptation tout de suite, sinon « dans 1 jour ».
 */
export function ruleDelayText(
  rule: Pick<RuleData, "mode" | "delaySeconds">,
  lang: Lang = "fr",
): string {
  if (rule.mode === "MANUAL") return t(lang, "delayManual");
  return formatDelay(rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds, lang);
}

/** Texte lisible d'un délai. */
export function formatDelay(seconds: number, lang: Lang = "fr"): string {
  if (seconds <= 0) return t(lang, "delayNow");
  const units: Array<[number, MessageKey, MessageKey]> = [
    [86400, "unitDay", "unitDays"],
    [3600, "unitHour", "unitHours"],
    [60, "unitMinute", "unitMinutes"],
    [1, "unitSecond", "unitSeconds"],
  ];
  for (const [size, singular, plural] of units) {
    if (seconds >= size) {
      const n = Math.round(seconds / size);
      return t(lang, "delayIn", { n: String(n), unit: t(lang, n > 1 ? plural : singular) });
    }
  }
  return t(lang, "delayNow");
}
