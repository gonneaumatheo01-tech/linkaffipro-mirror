/**
 * Registre des capacités (phase 33, règle 2 : les capacités déclarées sont la seule vérité). Chaque Chef d'équipe y
 * déclare ce que son équipe sait faire (`orders/capabilities/<équipe>.ts`) ; Kevin ne promet rien qui n'y est pas.
 * Les équipes des phases 28 à 32 (Montage, Analystes, QA, Prospection) s'y branchent par `registerCapabilities`.
 * Une équipe absente du registre n'est pas « ordonnable » : `capability()` rend `null`.
 */
import type { Capability } from "./contract";
import { ADS_CAPABILITIES } from "./capabilities/ads";
import { ALGO_CAPABILITIES } from "./capabilities/algo";
import { BOOKMAKER_CAPABILITIES } from "./capabilities/bookmakers";
import { CASINO_CAPABILITIES } from "./capabilities/casino";
import { CONTROLE_CAPABILITIES } from "./capabilities/controle";
import { DATING_CAPABILITIES } from "./capabilities/dating";
import { INSPIRATION_CAPABILITIES } from "./capabilities/inspiration";
import { REDACTION_CAPABILITIES } from "./capabilities/redaction";
import { SPORTS_CAPABILITIES } from "./capabilities/sports";
import { TRANSVERSE_CAPABILITIES } from "./capabilities/transverse";
import { siteCapabilities } from "../site/capabilities";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCapability = Capability<any>;

const registry = new Map<string, AnyCapability>();

const keyOf = (teamKey: string, key: string) => `${teamKey}:${key}`;

/** Ajoute (ou remplace, même équipe et même clé) des capacités. Renvoie le nombre de capacités enregistrées. */
export function registerCapabilities(list: readonly AnyCapability[]): number {
  for (const c of list) registry.set(keyOf(c.teamKey, c.key), c);
  return list.length;
}

/** Toutes les capacités, dans l'ordre d'enregistrement. */
export function listCapabilities(): AnyCapability[] {
  return [...registry.values()];
}

/** Capacité d'une équipe, ou `null` (équipe absente du registre ou clé inconnue). */
export function capability(teamKey: string, key: string): AnyCapability | null {
  return registry.get(keyOf(teamKey, key)) ?? null;
}

/** Capacités qui passent par un agent (annuaire des agents, chantier C). */
export function capabilitiesForAgent(agentKey: string): AnyCapability[] {
  return listCapabilities().filter((c) => c.agents.includes(agentKey));
}

/** Équipes qui ont au moins une capacité (les seules à qui Kevin peut donner un ordre). */
export function orderableTeams(): string[] {
  return [...new Set(listCapabilities().map((c) => c.teamKey))];
}

export function isOrderableTeam(teamKey: string): boolean {
  return listCapabilities().some((c) => c.teamKey === teamKey);
}

/** Capacités d'une équipe (vide si l'équipe n'est pas encore là). */
export function capabilitiesOf(teamKey: string): AnyCapability[] {
  return listCapabilities().filter((c) => c.teamKey === teamKey);
}

export const BUILTIN_CAPABILITIES: readonly AnyCapability[] = [
  ...SPORTS_CAPABILITIES,
  // Phase 35 : bookmakers lus directement (équipe Paris sportifs, agent Cotes & sélection).
  ...BOOKMAKER_CAPABILITIES,
  ...DATING_CAPABILITIES,
  ...CASINO_CAPABILITIES,
  ...ALGO_CAPABILITIES,
  ...ADS_CAPABILITIES,
  ...INSPIRATION_CAPABILITIES,
  ...TRANSVERSE_CAPABILITIES,
  ...REDACTION_CAPABILITIES,
  ...CONTROLE_CAPABILITIES,
];

registerCapabilities(BUILTIN_CAPABILITIES);
// Phase 34 : les opérations du site (lectures, réglages, créations) enchaînables par le planificateur, équipe
// « transverse ». Suppressions, envois, secrets et connexions restent au déroulé de Kevin (`site/flow.ts`).
registerCapabilities(siteCapabilities());
