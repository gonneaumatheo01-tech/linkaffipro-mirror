/**
 * Questions de mise en route de l'équipe Paris sportifs (phase 23), posées une seule fois par le bot (`Setting`
 * `agents.sportsSetupAsked`, marqué avant), une à la fois (file `HumanRequest`) :
 * 1. SECRET clé SportsGameOdds (vérifiée aussitôt par `GET /account/usage`) ;
 * 2. SECRET identifiant du compte Sportaza, puis 3. SECRET mot de passe (le vérificateur du chantier B lance le test
 *    de connexion et répond par message) ;
 * 4. TEXTE catégories à activer, par numéros (plusieurs possibles) → `BetCategory.active`.
 * Si le test de connexion dit « bloqué » (`captureBlocked`), `askCaptureWorkaround` pose le CHOICE adresse IP
 * résidentielle / capture depuis le Mac (puis SECRET adresse du proxy).
 */
import type { AgentsDeps } from "../types";
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { setCaptureMode } from "../providers/screenshot/settings";
import { ODDS_SECRET_KEY } from "../providers/odds-registry";

export const SPORTS_SETUP_SETTING = "agents.sportsSetupAsked";
export const SPORTS_CATEGORIES_REQUEST_KEY = "sports.categories";
export const SPORTS_WORKAROUND_REQUEST_KEY = "sports.captureWorkaround";
export const PROXY_SECRET_KEY = "providers.screenshotProxy";
export const WORKAROUND_OPTIONS = ["Adresse IP résidentielle (service à souscrire)", "Capture depuis mon Mac"] as const;

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
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: "providers.bookmakers.sportaza.login",
    question: "Pour les captures d'écran des paris : envoie l'identifiant (e-mail ou nom d'utilisateur) du compte Sportaza. J'efface ton message aussitôt.",
    onAnswer: { resume: false },
  });
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: "providers.bookmakers.sportaza.password",
    question: "Maintenant le mot de passe du compte Sportaza. J'efface ton message aussitôt et je teste la connexion (aucune mise, jamais).",
    onAnswer: { resume: false },
  });
  let queued = 3;
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

/** Le site du bookmaker bloque le serveur : choix de la parade (appelé par le test de connexion du chantier B). */
export async function askCaptureWorkaround(deps: AgentsDeps): Promise<{ requestId: string }> {
  const r = await askHuman(deps, {
    teamKey: "sports",
    kind: "CHOICE",
    key: SPORTS_WORKAROUND_REQUEST_KEY,
    question: "Le site du bookmaker bloque notre serveur pour les captures. Que préfères-tu ? Réponds 1 ou 2 (ou « plus tard »).",
    options: [...WORKAROUND_OPTIONS],
    onAnswer: { action: "sports-capture-workaround", resume: false },
  });
  return { requestId: r.requestId };
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

registerAnswerAction("sports-capture-workaround", async (deps, { value, actor }) => {
  if (value === WORKAROUND_OPTIONS[1]) {
    await setCaptureMode(deps.prisma, "mac");
    await agentAudit(deps, { userId: actor.userId ?? null, action: "agents.sports.capture_mode", entityType: "AgentTeamConfig", entityId: "sports", metadata: { after: "mac", via: actor.via } });
    return "D'accord : les captures se feront depuis ton Mac. Les instructions (une commande à lancer) sont dans la liste « à faire ».";
  }
  await setCaptureMode(deps.prisma, "server");
  await askHuman(deps, {
    teamKey: "sports",
    kind: "SECRET",
    key: PROXY_SECRET_KEY,
    question: "Envoie l'adresse du service d'IP résidentielle, sous la forme http://utilisateur:motdepasse@adresse:port. J'efface ton message aussitôt.",
    onAnswer: { resume: false },
  });
  return "D'accord : envoie-moi l'adresse du service quand tu l'as.";
});
