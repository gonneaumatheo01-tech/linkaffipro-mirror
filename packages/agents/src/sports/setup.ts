/**
 * Questions de mise en route de l'équipe Paris sportifs (phase 23), posées une seule fois par le bot (`Setting`
 * `agents.sportsSetupAsked`, marqué avant), une à la fois (file `HumanRequest`) :
 * 1. SECRET clé SportsGameOdds (vérifiée aussitôt par `GET /account/usage`) ;
 * 2. TEXTE catégories à activer, par numéros (plusieurs possibles) → `BetCategory.active`.
 * Les sites des bookmakers ne sont plus lus (28 octobre 2026) : aucun identifiant de compte bookmaker demandé.
 */
import type { AgentsDeps } from "../types";
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { ODDS_SECRET_KEY } from "../providers/odds-registry";
import { APIFOOTBALL_SECRET_KEY } from "../providers/apifootball";
import { APIFOOTBALL_KEY_ASKED_SETTING } from "./stats-source";

export const SPORTS_SETUP_SETTING = "agents.sportsSetupAsked";
export const SPORTS_CATEGORIES_REQUEST_KEY = "sports.categories";

/** Numéros d'une réponse (« 1, 3 », « 1 et 4 », « 2 ») dans 1..max (pur) ; vide si rien de lisible. */
export function parseNumberList(text: string, max: number): number[] {
  const nums = [...text.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= max);
  return [...new Set(nums)].sort((a, b) => a - b);
}

export async function ensureSportsSetupQuestions(deps: AgentsDeps): Promise<{ queued: number }> {
  if ((await readSetting(deps, SPORTS_SETUP_SETTING)) !== undefined) return { queued: 0 };
  await writeSetting(deps, SPORTS_SETUP_SETTING, { askedAt: nowOf(deps).toISOString() });
  const cats = await deps.prisma.betCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } });
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: ODDS_SECRET_KEY,
    question:
      "Équipe Paris sportifs : il me faut la clé de l'API des cotes SportsGameOdds. Crée un compte gratuit sur https://sportsgameodds.com (offre gratuite), copie la clé API et colle-la ici. Je la vérifie tout de suite et j'efface ton message.",
    onAnswer: { resume: false },
  });
  let queued = 1;
  if (cats.length) {
    await askHuman(deps, {
      teamKey: "sports",
      kind: "TEXT",
      key: SPORTS_CATEGORIES_REQUEST_KEY,
      question: `Quelles catégories de paris activer ? ${cats.map((c, i) => `${i + 1} ${c.name}`).join(", ")}. Réponds par les numéros (ex. « 1, 3 »), ou « plus tard ».`,
      onAnswer: { action: "sports-categories", categoryIds: cats.map((c) => c.id), resume: false },
    });
    queued++;
  }
  await writeSetting(deps, SPORTS_SETUP_SETTING, { askedAt: nowOf(deps).toISOString(), queued });
  await agentEvent(deps, "agents.sports.setup_queued", { queued });
  return { queued };
}

/**
 * 28 octobre 2026 : clé API-Football (statistiques des matchs, offre gratuite) demandée une seule fois, quand un pari doit
 * être choisi (les sites des bookmakers ne sont jamais lus) (`Setting` `agents.sports.apifootballKeyAsked`, marqué avant).
 */
export async function askApiFootballKeyOnce(deps: AgentsDeps): Promise<boolean> {
  if ((await readSetting(deps, APIFOOTBALL_KEY_ASKED_SETTING)) !== undefined) return false;
  await writeSetting(deps, APIFOOTBALL_KEY_ASKED_SETTING, { askedAt: nowOf(deps).toISOString() });
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: APIFOOTBALL_SECRET_KEY,
    question:
      "Paris sportifs : je choisis les paris sur les statistiques des matchs, puis je te demande la capture et la cote sur le site du bookmaker. Crée un compte gratuit sur https://dashboard.api-football.com, copie ta clé API et colle-la ici. Je la vérifie et j'efface ton message.",
    onAnswer: { resume: false },
  });
  await agentEvent(deps, "agents.sports.apifootball_key_asked", {});
  return true;
}

registerAnswerAction("sports-categories", async (deps, { value, actor, onAnswer }) => {
  const ids = Array.isArray(onAnswer.categoryIds) ? (onAnswer.categoryIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const picked = parseNumberList(value, ids.length).map((n) => ids[n - 1]!);
  if (!picked.length) return `Je n'ai lu aucun numéro entre 1 et ${ids.length} : rien n'est changé. Tu peux choisir les catégories dans Agents → Paris sportifs.`;
  const before = await deps.prisma.betCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, active: true } });
  await deps.prisma.betCategory.updateMany({ where: { id: { in: picked } }, data: { active: true, updatedById: actor.userId ?? null } });
  await deps.prisma.betCategory.updateMany({ where: { id: { in: ids.filter((id) => !picked.includes(id)) } }, data: { active: false, updatedById: actor.userId ?? null } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.sports.categories",
    entityType: "BetCategory",
    metadata: { before: before.filter((c) => c.active).map((c) => c.id), after: picked, via: actor.via },
  });
  const names = before.filter((c) => picked.includes(c.id)).map((c) => c.name);
  return `Catégories actives : ${names.join(", ")} ✅`;
});

// Ancienne question « parade anti-blocage des captures » (retirée le 28 octobre 2026) : une réponse tardive ne change rien.
registerAnswerAction("sports-capture-workaround", async () => "Les captures automatiques des sites sont retirées : c'est l'équipe qui m'envoie la capture et la cote. Rien à régler.");
