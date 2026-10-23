/**
 * Équipes d'agents à l'écran (phase 19, docs/AGENTS-ARCHITECTURE.md) : libellés du client, chaîne de chaque équipe,
 * fournisseurs, niveaux d'autonomie, droits par rôle. Règles pures (testées dans teams.test.ts).
 * « Dating » ne s'affiche jamais : l'univers s'appelle « Rencontres » pour le client (docs/REFONTE-UX.md).
 */
import {
  AGENT_LABELS,
  IMPLEMENTED_AGENT_KEYS,
  TEAM_KEYS,
  isTeamKey,
  type AgentKey,
  type ProviderKey,
  type TeamKey,
} from "@linkaffipro/agents";

export { TEAM_KEYS, type TeamKey };

/** Nom affiché de chaque équipe. */
export const TEAM_NAMES: Record<TeamKey, string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
  algo: "Algorithme",
};

/** Ce que fait l'équipe, en une phrase. */
export const TEAM_PURPOSE: Record<TeamKey, string> = {
  dating: "Prépare et publie les posts des canaux Rencontres.",
  casino: "Prépare et publie les posts des canaux Casino.",
  sports: "Choisit les paris du jour et publie les posts des canaux Paris sportifs.",
  algo: "Ne publie rien : mesure ce qui marche et règle les trois autres équipes.",
};

/** Univers des canaux d'une équipe (l'équipe Algorithme n'a pas de canal). */
export const TEAM_VERTICAL: Record<TeamKey, "DATING" | "CASINO" | "SPORTS" | null> = {
  dating: "DATING",
  casino: "CASINO",
  sports: "SPORTS",
  algo: null,
};

/** Équipes qui ont un bouton « Créer une mission de test » (un post texte sur le canal Test). */
export const TEST_MISSION_TEAMS: readonly TeamKey[] = ["dating", "casino"];

/** Chaîne de production de chaque Chef d'équipe, dans l'ordre (tableau du plan validé). */
export const TEAM_CHAINS: Record<TeamKey, readonly AgentKey[]> = {
  dating: ["mediatheque", "media-ia", "redaction", "planification", "controle", "publication"],
  casino: ["mediatheque", "redaction", "planification", "controle", "publication"],
  sports: ["cotes", "capture", "redaction", "controle", "publication"],
  algo: ["posts", "horaires", "conversations", "experimentation", "synthese"],
};

/** Fournisseurs payants utilisés par chaque équipe (plafonds mensuels affichés). */
export const TEAM_PROVIDERS: Record<TeamKey, readonly ProviderKey[]> = {
  dating: ["llm", "video", "image"],
  casino: ["llm"],
  sports: ["llm", "odds", "screenshot"],
  algo: ["llm"],
};

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  llm: "IA d'écriture",
  video: "Vidéos IA",
  image: "Photos IA",
  odds: "Cotes sportives",
  screenshot: "Captures d'écran",
};

export function teamName(team: string): string {
  return isTeamKey(team) ? TEAM_NAMES[team] : team;
}

/** Équipe lue dans l'adresse (`/agents/<equipe>`), `null` si inconnue (la page renvoie 404). */
export function parseTeamParam(v: unknown): TeamKey | null {
  return isTeamKey(v) ? v : null;
}

export function agentLabel(key: string): string {
  return (AGENT_LABELS as Record<string, string>)[key] ?? key;
}

/** L'agent existe-t-il déjà (phase 19) ou arrive-t-il dans une phase suivante ? */
export function agentAvailable(key: AgentKey): boolean {
  return (IMPLEMENTED_AGENT_KEYS as readonly string[]).includes(key);
}

export type AutonomyLevel = 0 | 1 | 2;

export const AUTONOMY_LEVELS: ReadonlyArray<{
  value: AutonomyLevel;
  label: string;
  sentence: string;
}> = [
  {
    value: 0,
    label: "Niveau 0 : je valide tout",
    sentence: "Chaque post vous est montré avant de partir (Telegram et page Validations).",
  },
  {
    value: 1,
    label: "Niveau 1 : je valide les nouveautés",
    sentence:
      "Seules les nouveautés vous sont montrées (premier post d'un canal, nouvelle persona, nouveau thème, doute du Contrôle qualité).",
  },
  {
    value: 2,
    label: "Niveau 2 : autonomie totale",
    sentence: "Rien à valider : les posts partent seuls, vous recevez le rapport du matin.",
  },
];

export function parseLevel(v: unknown): AutonomyLevel | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v;
  return n === 0 || n === 1 || n === 2 ? n : null;
}

export function levelLabel(level: number): string {
  return AUTONOMY_LEVELS.find((l) => l.value === level)?.label ?? `Niveau ${level}`;
}

type Role = "ADMIN" | "MANAGER" | string;

/**
 * Droits (CLAUDE.md, phase 19) : un manager fait tout sauf les réglages de la rubrique, les suppressions, désactiver la
 * simulation et passer au niveau 2.
 */
export function canSetLevel(role: Role, level: AutonomyLevel): boolean {
  return level < 2 || role === "ADMIN";
}

export function canSetSimulation(role: Role, simulation: boolean): boolean {
  return simulation || role === "ADMIN";
}

export function canOpenAgentsSettings(role: Role): boolean {
  return role === "ADMIN";
}
