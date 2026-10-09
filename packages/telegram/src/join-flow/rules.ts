/**
 * Règles d'approbation : fonctions pures (résolution, calcul des échéances, rappels, expiration).
 */
import type { ApprovalMode, ExpireAction, GateMode, MembershipStatus } from "@linkaffipro/db";

export type RuleData = {
  id: string | null;
  name: string;
  mode: ApprovalMode;
  delaySeconds: number;
  gateChannelIds: string[];
  gateMode: GateMode;
  reminderAfterMinutes: number[];
  maxReminders: number;
  expireAfterHours: number | null;
  expireAction: ExpireAction;
  sendAcceptedMessage: boolean;
};

/** Règle implicite quand ni le lien ni le canal n'en définissent : approbation immédiate, sans gate. */
export const IMPLICIT_RULE: RuleData = {
  id: null,
  name: "Règle implicite (immédiat)",
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

type RuleRow = {
  id: string;
  name: string;
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

export function ruleFromRow(row: RuleRow): RuleData {
  return {
    id: row.id,
    name: row.name,
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

/** Priorité : règle du lien, sinon règle par défaut du canal, sinon règle implicite. Les règles inactives sont ignorées. */
export function resolveRule(linkRule: RuleRow | null | undefined, channelDefaultRule: RuleRow | null | undefined): RuleData {
  if (linkRule && linkRule.isActive) return ruleFromRow(linkRule);
  if (channelDefaultRule && channelDefaultRule.isActive) return ruleFromRow(channelDefaultRule);
  return IMPLICIT_RULE;
}

/** Un gate est actif seulement s'il y a des canaux à rejoindre. */
export function hasGate(rule: RuleData): boolean {
  return rule.gateMode !== "NONE" && rule.gateChannelIds.length > 0;
}

export type InitialState = { status: MembershipStatus; approveAt: Date | null; expiresAt: Date | null };

/** État initial d'une demande selon la règle. */
export function computeInitialState(rule: RuleData, requestedAt: Date): InitialState {
  const expiresAt = rule.expireAfterHours ? new Date(requestedAt.getTime() + rule.expireAfterHours * 3600_000) : null;
  if (rule.mode === "MANUAL") return { status: "REQUESTED", approveAt: null, expiresAt };
  const delayMs = rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds * 1000;
  if (hasGate(rule) && rule.gateMode === "REQUIRED") return { status: "PENDING_GATE", approveAt: null, expiresAt };
  // NONE ou SOFT : on planifie dès la demande ; SOFT propose seulement les canaux.
  return { status: "SCHEDULED", approveAt: new Date(requestedAt.getTime() + delayMs), expiresAt };
}

/** Échéance d'approbation une fois le gate satisfait. */
export function approveAtAfterGate(rule: RuleData, now: Date): Date {
  const delayMs = rule.mode === "IMMEDIATE" ? 0 : rule.delaySeconds * 1000;
  return new Date(now.getTime() + delayMs);
}

/** Un rappel est-il dû ? Retourne l'index du rappel à envoyer, ou null. */
export function dueReminderIndex(rule: RuleData, m: { requestedAt: Date; remindersSent: number }, now: Date): number | null {
  if (m.remindersSent >= rule.maxReminders) return null;
  const minutes = rule.reminderAfterMinutes[m.remindersSent];
  if (minutes === undefined) return null;
  return now.getTime() >= m.requestedAt.getTime() + minutes * 60_000 ? m.remindersSent : null;
}

export type ExpirationOutcome = { status: MembershipStatus; approveNow: boolean; declineNow: boolean };

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

/** Texte lisible d'un délai. */
export function formatDelay(seconds: number, lang: "fr" | "en" = "fr"): string {
  if (seconds <= 0) return lang === "fr" ? "immédiatement" : "immediately";
  const units: Array<[number, string, string, string, string]> = [
    [86400, "jour", "jours", "day", "days"],
    [3600, "heure", "heures", "hour", "hours"],
    [60, "minute", "minutes", "minute", "minutes"],
    [1, "seconde", "secondes", "second", "seconds"],
  ];
  for (const [size, frS, frP, enS, enP] of units) {
    if (seconds >= size) {
      const n = Math.round(seconds / size);
      const word = lang === "fr" ? (n > 1 ? frP : frS) : n > 1 ? enP : enS;
      return lang === "fr" ? `dans ${n} ${word}` : `in ${n} ${word}`;
    }
  }
  return lang === "fr" ? "immédiatement" : "immediately";
}
