/**
 * Questions de mise en route de l'équipe Algorithme (fin de phase 21), posées une seule fois par le bot
 * (`Setting` `agents.algoSetupAsked`, marqué avant) : niveau de l'équipe, puis quota maximum de posts par jour et par
 * canal. Appelé par le passage du Grand Chef.
 */
import type { AgentsDeps } from "../types";
import { nowOf, readSetting, writeSetting } from "../admin/journal";
import { setAutonomyLevel } from "../admin/team";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { patchAlgoSettings } from "./settings";

export const ALGO_SETUP_SETTING = "agents.algoSetupAsked";
export const ALGO_LEVEL_OPTIONS = ["tout me proposer", "appliquer les petits réglages seuls (conseillé)", "tout appliquer dans les bornes"];
export const ALGO_QUOTA_OPTIONS = ["4", "6", "8"];

export async function ensureAlgoSetupQuestions(deps: AgentsDeps): Promise<{ queued: number }> {
  if ((await readSetting(deps, ALGO_SETUP_SETTING)) !== undefined) return { queued: 0 };
  await writeSetting(deps, ALGO_SETUP_SETTING, { askedAt: nowOf(deps).toISOString() });
  await askHuman(deps, {
    teamKey: "algo",
    kind: "CHOICE",
    key: "agents.team.algo.level",
    question:
      "Niveau de l'équipe Algorithme : 1) tout me proposer 2) appliquer les petits réglages seuls (conseillé) 3) tout appliquer dans les bornes. Réponds 1, 2 ou 3 (« plus tard » = 2).",
    options: ALGO_LEVEL_OPTIONS,
    onAnswer: { action: "algo-level", skipAnswer: ALGO_LEVEL_OPTIONS[1], resume: false },
  });
  // TEXT et non CHOICE : une demande à choix refuse un chiffre libre (« 10 ») ; 1, 2 ou 3 restent lus comme des choix.
  await askHuman(deps, {
    teamKey: "algo",
    kind: "TEXT",
    key: "agents.team.algo.maxPostsPerDay",
    question:
      "Quota maximum de posts par jour et par canal que les réglages ne peuvent pas dépasser : 1) 4 2) 6 3) 8 ou un chiffre. « plus tard » = 6.",
    options: ALGO_QUOTA_OPTIONS,
    onAnswer: { action: "algo-max-posts", skipAnswer: "6", resume: false },
  });
  return { queued: 2 };
}

/** Réponse au niveau → autonomie 0 / 1 / 2 (pur). */
export function algoLevelOf(value: string): 0 | 1 | 2 {
  const i = ALGO_LEVEL_OPTIONS.indexOf(value);
  return (i === 0 ? 0 : i === 2 ? 2 : 1) as 0 | 1 | 2;
}

/** Réponse au quota : « 1 » / « 2 » / « 3 » = 4 / 6 / 8, sinon le chiffre écrit (1 à 48), 6 par défaut (pur). */
export function algoQuotaOf(value: string): number {
  const t = value.trim().replace(/[).]$/, "");
  if (/^[123]$/.test(t)) return Number(ALGO_QUOTA_OPTIONS[Number(t) - 1]);
  const n = Number((/\d+/.exec(t) ?? ["6"])[0]);
  return Number.isInteger(n) && n >= 1 && n <= 48 ? n : 6;
}

registerAnswerAction("algo-level", async (deps, { value, actor }) => {
  const level = algoLevelOf(value);
  const r = await setAutonomyLevel(deps, "algo", level, actor);
  return r.ok ? `Équipe Algorithme : ${ALGO_LEVEL_OPTIONS[level]} ✅` : r.message;
});

registerAnswerAction("algo-max-posts", async (deps, { value }) => {
  const n = algoQuotaOf(value);
  await patchAlgoSettings(deps.prisma, { maxPostsPerDay: n });
  return `Quota maximum : ${n} posts par jour et par canal ✅`;
});
