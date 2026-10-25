/**
 * Phase 29, chantier C — état de Kevin pour l'équipe Analystes, rangé dans `Setting` (aucune table de plus) :
 * - réglages de l'équipe (`analysts.enabled`, jour et heure du rapport, seuil des alertes) ;
 * - questions en attente de réponse (`analysts.request.<id>`) : posées à Kevin, traitées par le worker, réponse envoyée
 *   dans la même conversation ;
 * - choix numérotés des recommandations (`analysts.choice.<conversation>`, 24 heures) ;
 * - repères anti-doublon des alertes (`analysts.alerted.<rule|entry>.<id>`) et des sources en panne déjà signalées.
 */
import { randomUUID } from "node:crypto";
import { adminTelegramId, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { AdminButton, AgentsDeps } from "../types";
import { ANALYSTS_SETTINGS, type CompliancePlatform, type Market, type RiskLevel } from "./contract";

// ------------------------------------------------------------------------------------------------ réglages

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function asInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** `analysts.enabled` (vrai par défaut). Faux : rien ne tourne, Kevin le dit. */
export async function analystsEnabled(deps: Pick<AgentsDeps, "prisma">): Promise<boolean> {
  return asBool(await readSetting(deps, ANALYSTS_SETTINGS.enabled.key), ANALYSTS_SETTINGS.enabled.value);
}

export type AnalystsScheduleSettings = { weeklyDay: number; weeklyHour: number; alertRisk: RiskLevel; relevance: number };

export async function analystsScheduleSettings(deps: Pick<AgentsDeps, "prisma">): Promise<AnalystsScheduleSettings> {
  const [day, hour, risk, relevance] = await Promise.all([
    readSetting(deps, ANALYSTS_SETTINGS.weeklyReportDay.key),
    readSetting(deps, ANALYSTS_SETTINGS.weeklyReportHour.key),
    readSetting(deps, ANALYSTS_SETTINGS.alertRiskLevel.key),
    readSetting(deps, ANALYSTS_SETTINGS.relevanceThreshold.key),
  ]);
  return {
    weeklyDay: asInt(day, ANALYSTS_SETTINGS.weeklyReportDay.value, 1, 7),
    weeklyHour: asInt(hour, ANALYSTS_SETTINGS.weeklyReportHour.value, 0, 23),
    alertRisk: risk === "LOW" || risk === "MEDIUM" || risk === "HIGH" || risk === "BAN" ? risk : ANALYSTS_SETTINGS.alertRiskLevel.value,
    relevance: asInt(relevance, ANALYSTS_SETTINGS.relevanceThreshold.value, 1, 10),
  };
}

// ------------------------------------------------------------------------------------------------ questions

export type AnalystsRequestKind = "analysis" | "strategy" | "briefing";

export type AnalystsRequest = {
  id: string;
  kind: AnalystsRequestKind;
  question: string;
  market: Market | null;
  countries: string[];
  platform: CompliancePlatform | null;
  /** Conversation où répondre (chaîne d'un BigInt) ; null = privé de l'admin. */
  chatId: string | null;
  /** Qui a demandé : « admin » ou l'identifiant Telegram d'un membre présenté. */
  askedBy: string;
  createdAt: string;
  answeredAt: string | null;
};

export const ANALYSTS_REQUEST_PREFIX = "analysts.request.";

export async function createAnalystsRequest(
  deps: AgentsDeps,
  input: Omit<AnalystsRequest, "id" | "createdAt" | "answeredAt">,
): Promise<AnalystsRequest> {
  const req: AnalystsRequest = { ...input, id: randomUUID().replace(/-/g, "").slice(0, 16), createdAt: nowOf(deps).toISOString(), answeredAt: null };
  await writeSetting(deps, `${ANALYSTS_REQUEST_PREFIX}${req.id}`, req);
  return req;
}

export async function readAnalystsRequest(deps: Pick<AgentsDeps, "prisma">, id: string): Promise<AnalystsRequest | null> {
  const v = (await readSetting(deps, `${ANALYSTS_REQUEST_PREFIX}${id}`)) as AnalystsRequest | undefined;
  return v && typeof v === "object" && typeof v.question === "string" ? v : null;
}

export async function markAnalystsRequestAnswered(deps: AgentsDeps, req: AnalystsRequest): Promise<void> {
  await writeSetting(deps, `${ANALYSTS_REQUEST_PREFIX}${req.id}`, { ...req, answeredAt: nowOf(deps).toISOString() });
}

// ------------------------------------------------------------------------------------------------ envoi

/**
 * Envoie un message de Kevin dans la conversation de la demande : le privé de l'admin (ou conversation inconnue) par
 * `admin.send`, une autre conversation (groupe de l'équipe, privé d'un membre) par `admin.sendTo`. Rend l'identifiant
 * du message, ou null si rien n'est parti.
 */
export async function sendKevin(
  deps: AgentsDeps,
  chatId: string | null,
  html: string,
  opts: { buttons?: AdminButton[][] } = {},
): Promise<number | null> {
  if (!deps.admin) return null;
  const adminId = await adminTelegramId(deps);
  try {
    if (chatId && /^-?\d+$/.test(chatId) && (!adminId || BigInt(chatId) !== adminId) && deps.admin.sendTo) {
      const r = await deps.admin.sendTo(BigInt(chatId), html, opts.buttons ? { buttons: opts.buttons } : {});
      return r?.messageId ?? null;
    }
    const r = await deps.admin.send(html, opts.buttons ? { buttons: opts.buttons } : {});
    return r?.messageId ?? null;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[analystes] message de Kevin non envoyé");
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ choix numéroté

export const ANALYSTS_CHOICE_PREFIX = "analysts.choice.";
/** Le choix numéroté vaut accord 24 heures. */
export const ANALYSTS_CHOICE_TTL_MS = 24 * 3600_000;

export type AnalystsChoice = {
  items: { n: number; recommendationId: string; label: string }[];
  chatId: string | null;
  askedBy: string;
  createdAt: string;
  answeredAt: string | null;
};

export const choiceKeyOf = (chatKey: string | null) => `${ANALYSTS_CHOICE_PREFIX}${chatKey ?? "admin"}`;

export async function readAnalystsChoice(deps: Pick<AgentsDeps, "prisma">, chatKey: string | null): Promise<AnalystsChoice | null> {
  const v = (await readSetting(deps, choiceKeyOf(chatKey))) as AnalystsChoice | undefined;
  return v && typeof v === "object" && Array.isArray(v.items) ? v : null;
}

export async function writeAnalystsChoice(deps: AgentsDeps, choice: AnalystsChoice): Promise<void> {
  await writeSetting(deps, choiceKeyOf(choice.chatId), choice);
}

/** Choix ouvert (sans réponse, de moins de 24 h) posé à l'admin (pur). */
export function analystsChoiceOpen(c: AnalystsChoice | null, now: Date): c is AnalystsChoice {
  return !!c && !c.answeredAt && c.items.length > 0 && c.askedBy === "admin" && now.getTime() - new Date(c.createdAt).getTime() < ANALYSTS_CHOICE_TTL_MS;
}

// ------------------------------------------------------------------------------------------------ anti-doublon

export const ANALYSTS_ALERTED_PREFIX = "analysts.alerted.";
export const ANALYSTS_SOURCE_WARNED_PREFIX = "analysts.sourceWarned.";

/** Réserve l'envoi d'une alerte (une seule par règle ou par entrée). Faux = déjà envoyée. */
export async function claimAlert(deps: AgentsDeps, kind: "rule" | "entry", id: string): Promise<boolean> {
  const key = `${ANALYSTS_ALERTED_PREFIX}${kind}.${id}`;
  if ((await readSetting(deps, key)) !== undefined) return false;
  await writeSetting(deps, key, { at: nowOf(deps).toISOString() });
  return true;
}

/** Libère une réservation (message non parti : l'alerte repartira au passage suivant). */
export async function releaseAlert(deps: AgentsDeps, kind: "rule" | "entry", id: string): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: `${ANALYSTS_ALERTED_PREFIX}${kind}.${id}` } });
}
