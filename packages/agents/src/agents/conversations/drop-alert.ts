/**
 * Alerte `agents_persona_drop` : profil de conversation dont le taux de réponse ou d'inscription des 7 derniers jours
 * chute de plus de 30 % par rapport aux 7 jours précédents, avec assez de données des deux côtés. Règle pure +
 * calcul ; la création de l'alerte (une fois par 24 h et par profil, interrupteur) est faite par le Chef Algorithme.
 */
import type { ConversationProfileStats } from "../../algo/contracts";
import type { AgentsDeps } from "../../types";
import { computeProfiles } from "./compute";
import { profileLabel } from "./profiles";

export const PERSONA_DROP_ALERT_KIND = "agents_persona_drop";
export const PERSONA_DROP_THRESHOLD = 0.3;
/** Inscriptions minimales sur les 7 jours précédents pour juger une chute du taux d'inscription. */
export const PERSONA_DROP_MIN_REGISTRATIONS = 5;

export type PersonaDropMetric = "replyRate" | "registrationRate";

export type PersonaDropCandidate = {
  kind: typeof PERSONA_DROP_ALERT_KIND;
  /** Cible de l'anti-doublon (une alerte par 24 h et par profil). */
  key: string;
  personaId: string | null;
  label: string;
  metric: PersonaDropMetric;
  previous: number;
  current: number;
  /** Baisse relative (0,42 = −42 %). */
  drop: number;
  message: string;
};

const pct = (r: number) => `${Math.round(r * 100)} %`;

function rateOf(p: ConversationProfileStats, metric: PersonaDropMetric): number | null {
  if (metric === "replyRate") return p.replyRate;
  return p.conversations > 0 ? p.registrations / p.conversations : null;
}

/** Texte de l'alerte : chiffres seulement, jamais un texte de conversation. */
export function personaDropMessage(c: Pick<PersonaDropCandidate, "label" | "metric" | "previous" | "current" | "drop">): string {
  const what = c.metric === "replyRate" ? "taux de réponse" : "taux d'inscription";
  return `Conversations ${c.label} : ${what} en baisse de ${Math.round(c.drop * 100)} % sur 7 jours (${pct(c.previous)} → ${pct(c.current)}).`;
}

/** Profils en chute (pur). `minConversations` s'applique à chacune des deux semaines. */
export function personaDropAlerts(
  current: readonly ConversationProfileStats[],
  previous: readonly ConversationProfileStats[],
  opts: { minConversations: number; threshold?: number; minRegistrations?: number },
): PersonaDropCandidate[] {
  const threshold = opts.threshold ?? PERSONA_DROP_THRESHOLD;
  const minReg = opts.minRegistrations ?? PERSONA_DROP_MIN_REGISTRATIONS;
  const before = new Map(previous.map((p) => [p.key, p]));
  const out: PersonaDropCandidate[] = [];
  for (const cur of current) {
    const prev = before.get(cur.key);
    if (!prev || cur.conversations < opts.minConversations || prev.conversations < opts.minConversations) continue;
    for (const metric of ["replyRate", "registrationRate"] as const) {
      if (metric === "registrationRate" && prev.registrations < minReg) continue;
      const a = rateOf(prev, metric);
      const b = rateOf(cur, metric);
      if (a === null || b === null || a <= 0) continue;
      const drop = (a - b) / a;
      if (drop <= threshold) continue;
      const base = { label: profileLabel(cur), metric, previous: a, current: b, drop };
      out.push({ kind: PERSONA_DROP_ALERT_KIND, key: cur.key, personaId: cur.personaId, ...base, message: personaDropMessage(base) });
    }
  }
  return out;
}

const DAY_MS = 86_400_000;

/** Calcul complet : 7 derniers jours contre les 7 précédents (seuil de conversations : réglage de l'équipe Algorithme). */
export async function computePersonaDropAlerts(
  deps: AgentsDeps,
  opts: { minConversations?: number; threshold?: number } = {},
): Promise<PersonaDropCandidate[]> {
  const now = (deps.now ?? (() => new Date()))();
  const [current, previous] = await Promise.all([
    computeProfiles(deps, { days: 7, end: now }),
    computeProfiles(deps, { days: 7, end: new Date(now.getTime() - 7 * DAY_MS) }),
  ]);
  return personaDropAlerts(current.profiles, previous.profiles, {
    minConversations: opts.minConversations ?? current.minConversations,
    ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}),
  });
}
