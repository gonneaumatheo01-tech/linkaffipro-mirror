/**
 * Phase 26 (chantier C) — démarrage guidé du Boss (« commencer », « par où je commence », « aide-moi à démarrer »).
 *
 * Les étapes suivent l'ordre de `docs/A-FAIRE-HUMAIN.md` (« Mettre les agents en route ») et chacune est calculée
 * depuis les DONNÉES (aucune case à cocher) : bot Boss, rapport du matin, clé fal.ai, médias de chaque persona
 * Rencontres, plafond vidéo, plan Rencontres, vidéos et plan Casino (seulement s'il existe un canal casino), clé des
 * cotes, compte bookmaker, catégories de paris, niveau de l'équipe Algorithme, seuils et dépenses pub ; le passage en
 * vrai d'une équipe est facultatif et ne compte pas dans l'avancement.
 *
 * `bossStartReply` : 3 lignes d'état, l'avancement « 3/14 », puis « On commence par … ? » et LA question
 * correspondante par `askHuman` (envoyée après la réponse, `followUp`), mêmes clés et mêmes suites que les questions
 * de mise en route des phases 20 à 24 (une demande ouverte de même clé n'est jamais doublée). Une étape impossible par
 * Telegram (créer un bot, brancher un compte pub) est décrite en clics exacts, en une ligne.
 */
import { agentEvent, esc } from "../admin/journal";
import { askHuman, currentHumanRequest, formatQuestion, type AskHumanInput } from "../human/requests";
import {
  BUDGET_OPTIONS,
  datingPersonas,
  DEFAULT_VIDEO_BUDGET_EUROS,
  FAL_SECRET_KEY,
  SOURCE_VIDEOS_WANTED,
} from "../human/dating-setup";
import { DAILY_REPORT_KEY, DAILY_REPORT_QUESTION } from "../human/site";
import { secretSettingKey, secretSummary } from "../human/secrets";
import { personaTagOf } from "../library/tags";
import { isAgentsPausedAll } from "../missions/settings";
import { ODDS_SECRET_KEY } from "../providers/odds-registry";
import { ALGO_LEVEL_OPTIONS } from "../algo/setup";
import { SPORTS_CATEGORIES_REQUEST_KEY } from "../sports/setup";
import { ADS_THRESHOLDS_KEY } from "../agents/ads/thresholds";
import { TEAM_KEYS, TEAM_LABELS, type AgentsDeps, type TeamKey } from "../types";
import type { BossReply, BossSetupStep } from "./contract";

/** Étape enrichie (reste un `BossSetupStep` du contrat). */
export type BossGuideStep = BossSetupStep & {
  /** Équipe concernée (ligne « Il manque ») ; null = général. */
  team: TeamKey | "ads" | null;
  /** Mot court de la ligne « Il manque » (« clé », « médias », « plan »…). */
  short: string;
  /** Facultative : ne compte pas dans l'avancement (passage en vrai). */
  optional?: boolean;
  /** Questions à poser par Telegram (une à la fois, dans l'ordre) ; absentes = étape faite sur le site ou dans Telegram. */
  asks?: AskHumanInput[];
  /** Étape impossible par une réponse : les clics exacts, en une ligne. */
  howTo?: string;
};

/** Dépendances : la base suffit pour les étapes ; `admin` sert à poser la question (`bossStartReply`). */
export type BossGuideDeps = AgentsDeps;

const ANSWERED = ["ANSWERED", "SKIPPED"] as const;

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function idsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function closedRequest(deps: BossGuideDeps, key: string): Promise<boolean> {
  return (await deps.prisma.humanRequest.count({ where: { key, status: { in: [...ANSWERED] } } })) > 0;
}

/** Un compte bookmaker complet (identifiant ET mot de passe enregistrés) : nom du premier trouvé, ou null. */
async function bookmakerWithCredentials(deps: BossGuideDeps): Promise<string | null> {
  const prefix = secretSettingKey("providers.bookmakers.");
  const rows = await deps.prisma.setting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } });
  const keys = new Set(rows.map((r) => r.key));
  for (const k of keys) {
    const m = /^agents\.secret\.providers\.bookmakers\.([^.]+)\.login$/.exec(k);
    if (m && keys.has(secretSettingKey(`providers.bookmakers.${m[1]}.password`))) return m[1]!;
  }
  return null;
}

/** Questions des médias d'une persona Rencontres (mêmes clés et suites que `ensureDatingSetupQuestions`). */
function personaAsks(
  p: { id: string; name: string; loraUrl: string | null; loraTrigger: string | null; referenceImageIds: unknown },
  sources: number,
): AskHumanInput[] {
  const tag = personaTagOf(p.name);
  const out: AskHumanInput[] = [];
  if (!p.loraUrl)
    out.push({
      teamKey: "dating",
      kind: "TEXT",
      key: `persona.${p.id}.loraUrl`,
      question: `Réponds avec l'adresse du fichier LoRA de ${p.name} (elle commence par https:// et finit souvent par .safetensors), ou « plus tard ».`,
      onAnswer: { action: "persona-lora-url", personaId: p.id, resume: false },
    });
  if (!p.loraTrigger)
    out.push({
      teamKey: "dating",
      kind: "TEXT",
      key: `persona.${p.id}.loraTrigger`,
      question: `Réponds avec le mot déclencheur du LoRA de ${p.name} (le mot qui fait apparaître ${p.name} sur les photos), ou « plus tard ».`,
      onAnswer: { action: "persona-lora-trigger", personaId: p.id, resume: false },
    });
  if (idsOf(p.referenceImageIds).length === 0)
    out.push({
      teamKey: "dating",
      kind: "MEDIA",
      key: `persona.${p.id}.referenceImages`,
      question: `Envoie 1 à 3 photos de ${p.name} avec la légende #dating #reference #${tag} (la première sert de modèle pour les vidéos). Réponds « plus tard » pour passer.`,
      expected: { count: 1, tags: ["dating", "reference", tag] },
      onAnswer: { resume: false },
    });
  if (sources < SOURCE_VIDEOS_WANTED)
    out.push({
      teamKey: "dating",
      kind: "MEDIA",
      key: `persona.${p.id}.sourceVideos`,
      question: `Envoie 5 à 10 vidéos sources pour ${p.name} avec la légende #dating #source #${tag} (une personne bien visible, en entier). Réponds « plus tard » pour passer.`,
      expected: { count: SOURCE_VIDEOS_WANTED, tags: ["dating", "source", tag] },
      onAnswer: { resume: false },
    });
  return out;
}

/** Question des seuils Ads (mêmes clés et suites que `ensureAdsSetupQuestions`) ; null si les chiffres sont illisibles. */
async function adsAsks(deps: BossGuideDeps): Promise<AskHumanInput[] | null> {
  try {
    const [{ loadAdsContext }, { adsSetupQuestion }] = await Promise.all([import("../agents/ads/analysis"), import("../agents/ads/setup")]);
    const { medians } = (await loadAdsContext(deps.prisma, deps.now ? deps.now() : new Date(), { cohorts: false })).thresholds;
    if (!medians) return null;
    return (["cpr", "roas"] as const).map((kind) => {
      const q = adsSetupQuestion(kind, medians);
      return {
        kind: "TEXT" as const,
        key: kind === "cpr" ? "agents.ads.targetCostPerRegistration" : "agents.ads.minRoas",
        question: q.question,
        options: q.options,
        onAnswer: { action: kind === "cpr" ? "ads-cpr" : "ads-roas", skipAnswer: q.skip, resume: false },
      };
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] seuils pubs illisibles");
    return null;
  }
}

/**
 * Étapes de mise en route, dans l'ordre de `docs/A-FAIRE-HUMAIN.md`, chacune calculée depuis la base. Les questions
 * coûteuses à préparer (seuils pubs) ne sont calculées que pour la première étape manquante (`bossStartReply`).
 */
export async function bossSetupSteps(deps: BossGuideDeps): Promise<BossGuideStep[]> {
  const p = deps.prisma;
  const [bossBot, dailyReport, falKey, personas, datingConfig, datingPlans, casinoChannels, casinoPlans, oddsKey, bookmaker] =
    await Promise.all([
      p.bot.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true, username: true } }),
      p.setting.findUnique({ where: { key: DAILY_REPORT_KEY } }),
      secretSummary(p, FAL_SECRET_KEY),
      datingPersonas(deps),
      p.agentTeamConfig.findUnique({ where: { teamKey: "dating" } }),
      p.channelAgentPlan.count({ where: { teamKey: "dating", enabled: true } }),
      p.channel.count({ where: { vertical: "CASINO", isActive: true, isTest: false } }),
      p.channelAgentPlan.count({ where: { teamKey: "casino", enabled: true } }),
      secretSummary(p, ODDS_SECRET_KEY),
      bookmakerWithCredentials(deps),
    ]);
  const steps: BossGuideStep[] = [];

  // 0. Le Boss lui-même, puis le rapport du matin.
  steps.push({
    key: "boss",
    label: "créer ton bot Boss",
    team: null,
    short: "Boss",
    done: !!bossBot,
    why: "C'est à lui que tu parles : un bot rien que pour toi, qui ne gère aucun canal.",
    howTo:
      "Dans Telegram : ouvre @BotFather → /newbot → choisis un nom → un identifiant qui finit par « bot » → copie le jeton → envoie-moi « jeton boss » suivi du jeton.",
  });
  steps.push({
    key: "dailyReport",
    label: "le rapport du matin",
    team: null,
    short: "rapport du matin",
    done: (dailyReport !== null && dailyReport !== undefined) || (await closedRequest(deps, DAILY_REPORT_KEY)),
    why: "Chaque matin à 9 h, une ligne par équipe. Réponds oui ou non.",
    asks: [{ kind: "CONFIRM", key: DAILY_REPORT_KEY, question: DAILY_REPORT_QUESTION, onAnswer: { action: "setting", settingKey: DAILY_REPORT_KEY } }],
  });

  // 1. Rencontres.
  steps.push({
    key: "dating.falKey",
    label: "la clé fal.ai",
    team: "dating",
    short: "clé",
    done: falKey.set,
    why: "Elle sert à fabriquer les vidéos et les photos de l'équipe Rencontres. Colle la clé en réponse ; j'efface ton message.",
    asks: [
      {
        teamKey: "dating",
        kind: "SECRET",
        key: FAL_SECRET_KEY,
        question:
          "Crée un compte sur https://fal.ai, mets quelques dollars de crédit, crée une clé sur https://fal.ai/dashboard/keys, puis réponds à ce message avec la clé. Réponds « plus tard » pour passer.",
        onAnswer: { resume: false },
      },
    ],
  });
  if (personas.length === 0)
    steps.push({
      key: "dating.persona",
      label: "une persona Rencontres",
      team: "dating",
      short: "persona",
      done: false,
      why: "L'équipe Rencontres publie au nom d'un personnage : il en faut au moins un.",
      howTo: "Sur le site : Conversations → Personas → Nouvelle persona → remplis le prénom et le ton → coche Activée → Enregistrer.",
    });
  for (const persona of personas) {
    const sources = await p.mediaAsset.count({ where: { personaId: persona.id, kind: "SOURCE" } });
    const asks = personaAsks(persona, sources);
    steps.push({
      key: `persona.${persona.id}.media`,
      label: `les médias de ${persona.name}`,
      team: "dating",
      short: "médias",
      done: asks.length === 0,
      why: `Sans son fichier LoRA, ses photos et ses vidéos sources, je ne peux pas fabriquer les vidéos de ${persona.name}.`,
      asks,
    });
  }
  const datingBudgets = record(datingConfig?.monthlyBudgetCents);
  steps.push({
    key: "dating.videoBudget",
    label: "le plafond vidéo du mois",
    team: "dating",
    short: "plafond vidéo",
    done: typeof datingBudgets.video === "number" || (await closedRequest(deps, "agents.team.dating.videoBudget")),
    why: `Les vidéos IA coûtent : je ne dépasse jamais ce plafond. Réponds 1, 2, 3 ou un montant (${DEFAULT_VIDEO_BUDGET_EUROS} € si « plus tard »).`,
    asks: [
      {
        teamKey: "dating",
        kind: "CHOICE",
        key: "agents.team.dating.videoBudget",
        question: `Plafond des vidéos IA par mois pour l'équipe Rencontres : réponds 1, 2 ou 3, ou écris un montant (ex. 75). « plus tard » = ${DEFAULT_VIDEO_BUDGET_EUROS} €.`,
        options: BUDGET_OPTIONS,
        onAnswer: { action: "dating-video-budget", skipAnswer: `${DEFAULT_VIDEO_BUDGET_EUROS} €`, resume: false },
      },
    ],
  });
  steps.push({
    key: "dating.plan",
    label: "le plan des canaux Rencontres",
    team: "dating",
    short: "plan",
    done: datingPlans > 0,
    why: "C'est là que tu dis sur quels canaux l'équipe publie, et avec quelle persona.",
    howTo: "Sur le site : Agents → Équipe Rencontres → Plan par canal → coche « Activé » et choisis la persona → Enregistrer.",
  });

  // 2. Casino (seulement s'il existe un vrai canal casino).
  if (casinoChannels > 0) {
    const { computeCasinoStock } = await import("../casino/stock");
    const stock = await computeCasinoStock(p, { now: deps.now ? deps.now() : new Date() }).catch(() => []);
    const testIds = new Set(
      (await p.channel.findMany({ where: { vertical: "CASINO", isTest: true }, select: { id: true } })).map((c) => c.id),
    );
    const low = stock.filter((r) => r.state !== "ok" && !testIds.has(r.channelId));
    const first = low[0];
    steps.push({
      key: "casino.videos",
      label: first ? `les vidéos casino « ${first.theme} »` : "les vidéos casino",
      team: "casino",
      short: "vidéos",
      done: stock.length > 0 && low.length === 0,
      why: "L'équipe Casino ne publie que tes vidéos (jamais d'IA) : il en faut 3 par thème au moins.",
      asks: first
        ? [
            {
              teamKey: "casino",
              kind: "MEDIA",
              key: `media.casino.setup.${first.theme}`,
              question: `Envoie 3 à 5 vidéos ${first.theme} avec la légende #casino #${first.theme} (${low
                .filter((r) => r.theme === first.theme)
                .map((r) => r.channelTitle)
                .slice(0, 3)
                .join(", ")}). Réponds « plus tard » pour passer.`,
              expected: {
                count: 3,
                tags: ["casino", first.theme],
                channelIds: [...new Set(low.filter((r) => r.theme === first.theme).map((r) => r.channelId))],
              },
              onAnswer: { resume: false },
            },
          ]
        : undefined,
      howTo: first ? undefined : "Envoie-moi tes vidéos avec la légende #casino #<thème> (par exemple #casino #roulette).",
    });
    steps.push({
      key: "casino.plan",
      label: "le plan des canaux Casino",
      team: "casino",
      short: "plan",
      done: casinoPlans > 0,
      why: "C'est là que tu dis sur quels canaux casino l'équipe publie.",
      howTo: "Sur le site : Agents → Équipe Casino → Plan par canal → coche « Activé » pour chaque canal → Enregistrer.",
    });
  }

  // 3. Paris sportifs.
  steps.push({
    key: "sports.oddsKey",
    label: "la clé des cotes",
    team: "sports",
    short: "clé",
    done: oddsKey.set,
    why: "Elle donne les matchs et les cotes du jour (offre gratuite). Colle la clé en réponse ; j'efface ton message.",
    asks: [
      {
        teamKey: "sports",
        kind: "SECRET",
        key: ODDS_SECRET_KEY,
        question:
          "Équipe Paris sportifs : il me faut la clé de l'API des cotes SportsGameOdds. Crée un compte gratuit sur https://sportsgameodds.com (offre gratuite), copie la clé API et colle-la ici. Je la vérifie tout de suite et j'efface ton message.",
        onAnswer: { resume: false },
      },
    ],
  });
  const loginSet = (await secretSummary(p, "providers.bookmakers.sportaza.login")).set;
  steps.push({
    key: "sports.bookmaker",
    label: "le compte bookmaker",
    team: "sports",
    short: "bookmaker",
    done: bookmaker !== null,
    why: "Il sert seulement à faire la capture du pari (jamais de mise). J'efface tes messages aussitôt.",
    asks: [
      ...(loginSet
        ? []
        : [
            {
              teamKey: "sports" as const,
              kind: "SECRET" as const,
              key: "providers.bookmakers.sportaza.login",
              question:
                "Pour les captures d'écran des paris : envoie l'identifiant (e-mail ou nom d'utilisateur) du compte Sportaza. J'efface ton message aussitôt.",
              onAnswer: { resume: false },
            },
          ]),
      {
        teamKey: "sports",
        kind: "SECRET",
        key: "providers.bookmakers.sportaza.password",
        question: "Maintenant le mot de passe du compte Sportaza. J'efface ton message aussitôt et je teste la connexion (aucune mise, jamais).",
        onAnswer: { resume: false },
      },
    ],
  });
  const cats = await p.betCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, active: true, updatedById: true },
  });
  steps.push({
    key: "sports.categories",
    label: "les catégories de paris",
    team: "sports",
    short: "catégories",
    done:
      cats.some((c) => c.active) &&
      (cats.some((c) => c.updatedById !== null) || (await closedRequest(deps, SPORTS_CATEGORIES_REQUEST_KEY))),
    why: "Tu choisis les types de paris proposés (tirs cadrés, corners, buts…). Réponds par les numéros.",
    asks: cats.length
      ? [
          {
            teamKey: "sports",
            kind: "TEXT",
            key: SPORTS_CATEGORIES_REQUEST_KEY,
            question: `Quelles catégories de paris activer ? ${cats.map((c, i) => `${i + 1} ${c.name}`).join(", ")}. Réponds par les numéros (ex. « 1, 3 »), ou « plus tard ».`,
            onAnswer: { action: "sports-categories", categoryIds: cats.map((c) => c.id), resume: false },
          },
        ]
      : undefined,
    howTo: cats.length ? undefined : "Sur le site : Agents → Paris sportifs → Catégories → coche celles à activer → Enregistrer.",
  });

  // 4. Algorithme et Agent Ads.
  const algo = await p.agentTeamConfig.findUnique({ where: { teamKey: "algo" }, select: { autonomyLevel: true } });
  steps.push({
    key: "algo.level",
    label: "le niveau de l'équipe Algorithme",
    team: "algo",
    short: "niveau",
    done: (algo?.autonomyLevel ?? 0) > 0 || (await closedRequest(deps, "agents.team.algo.level")),
    why: "Tu décides si elle te propose tout ou applique seule les petits réglages. Réponds 1, 2 ou 3.",
    asks: [
      {
        teamKey: "algo",
        kind: "CHOICE",
        key: "agents.team.algo.level",
        question:
          "Niveau de l'équipe Algorithme : 1) tout me proposer 2) appliquer les petits réglages seuls (conseillé) 3) tout appliquer dans les bornes. Réponds 1, 2 ou 3 (« plus tard » = 2).",
        options: ALGO_LEVEL_OPTIONS,
        onAnswer: { action: "algo-level", skipAnswer: ALGO_LEVEL_OPTIONS[1], resume: false },
      },
    ],
  });
  const [thresholds, cprClosed, roasClosed] = await Promise.all([
    p.setting.findUnique({ where: { key: ADS_THRESHOLDS_KEY } }),
    closedRequest(deps, "agents.ads.targetCostPerRegistration"),
    closedRequest(deps, "agents.ads.minRoas"),
  ]);
  steps.push({
    key: "ads.thresholds",
    label: "les seuils des pubs",
    team: "ads",
    short: "seuils",
    done: (thresholds !== null && thresholds !== undefined) || (cprClosed && roasClosed),
    why: "Ils disent quand je te conseille d'arrêter ou d'augmenter une pub. « plus tard » garde des valeurs raisonnables.",
    howTo: "Sur le site : Agents → Agent Ads → Seuils par univers → Enregistrer les seuils.",
  });
  const [connections, costs] = await Promise.all([
    p.adAccountConnection.count({ where: { status: "ACTIVE" } }),
    p.adCost.count(),
  ]);
  steps.push({
    key: "ads.spend",
    label: "tes dépenses pub",
    team: "ads",
    short: "dépenses pub",
    done: connections > 0 || costs > 0,
    why: "Sans dépenses pub, l'Agent Ads n'a rien à analyser.",
    howTo:
      "Sur le site : Réglages → Connexions → Meta ou TikTok → suis le guide de la page (ou Campagnes → la campagne → Pubs → importer tes coûts).",
  });

  // 6. Passer une équipe pour de vrai (facultatif, à la fin).
  const real = await p.agentTeamConfig.count({ where: { simulation: false } });
  steps.push({
    key: "real",
    label: "passer une équipe pour de vrai",
    team: null,
    short: "en vrai",
    optional: true,
    done: real > 0,
    why: "Quand les essais sur le canal Test te plaisent.",
    howTo: "Écris-moi « passe le casino en vrai » (ou le dating, les paris) : je résume et tu confirmes par OUI.",
  });
  return steps;
}

/** Avancement « 3/14 » : étapes obligatoires faites / étapes obligatoires (pur). */
export function bossSetupProgress(steps: readonly BossGuideStep[]): { done: number; total: number; label: string } {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  return { done, total: required.length, label: `${done}/${required.length}` };
}

/** Première étape obligatoire manquante, ou null (pur). */
export function firstMissingBossStep(steps: readonly BossGuideStep[]): BossGuideStep | null {
  return steps.find((s) => !s.optional && !s.done) ?? null;
}

const SHORT_TEAM_LABELS: Record<TeamKey | "ads", string> = { ...TEAM_LABELS, ads: "Pubs" };

/** Les 3 lignes d'état (texte brut, l'appelant échappe) : simulation, niveaux, ce qui manque par équipe (pur). */
export function bossSetupStateLines(
  teams: ReadonlyArray<{ teamKey: string; simulation: boolean; autonomyLevel: number }>,
  steps: readonly BossGuideStep[],
  pausedAll = false,
): [string, string, string] {
  const byKey = new Map(teams.map((t) => [t.teamKey, t]));
  const rows = TEAM_KEYS.map((k) => ({ key: k, label: TEAM_LABELS[k], simulation: byKey.get(k)?.simulation ?? true, level: byKey.get(k)?.autonomyLevel ?? 0 }));
  const publishing = rows.filter((r) => r.key !== "algo");
  const real = publishing.filter((r) => !r.simulation).map((r) => r.label);
  const sim = publishing.filter((r) => r.simulation).map((r) => r.label);
  const pause = pausedAll ? "⏸ Pause générale. " : "";
  const line1 = real.length
    ? `${pause}En vrai : ${real.join(", ")}${sim.length ? ` · en simulation : ${sim.join(", ")}` : ""}.`
    : `${pause}Simulation partout : tout part sur le canal Test.`;
  const line2 = `Niveaux : ${rows.map((r) => `${r.label} ${r.level}`).join(" · ")}.`;
  const missing = new Map<string, string[]>();
  for (const s of steps) {
    if (s.done || s.optional) continue;
    const label = s.team ? SHORT_TEAM_LABELS[s.team] : "Général";
    const list = missing.get(label) ?? [];
    if (!list.includes(s.short)) list.push(s.short);
    missing.set(label, list);
  }
  const line3 = missing.size
    ? `Il manque : ${[...missing].map(([team, list]) => `${team} (${list.join(", ")})`).join(" · ")}.`
    : "Il ne manque rien.";
  return [line1, line2, line3];
}

/**
 * Réponse à « commencer » : état, avancement, première chose manquante et sa question (posée après la réponse). Une
 * question déjà ouverte de même clé n'est pas doublée : elle est rappelée dans la réponse.
 */
export async function bossStartReply(deps: BossGuideDeps): Promise<BossReply> {
  const [steps, teams, pausedAll] = await Promise.all([
    bossSetupSteps(deps),
    deps.prisma.agentTeamConfig.findMany({ select: { teamKey: true, simulation: true, autonomyLevel: true } }),
    isAgentsPausedAll(deps.prisma),
  ]);
  const lines = bossSetupStateLines(teams, steps, pausedAll).map(esc);
  const progress = bossSetupProgress(steps);
  const next = firstMissingBossStep(steps);
  if (!next) {
    const real = steps.find((s) => s.key === "real");
    const tail = real && !real.done ? `La suite : ${esc(real.howTo ?? "")}` : "Tu peux monter un niveau : écris « niveau casino 1 ».";
    return { reply: [`Tout est prêt 👍 (${progress.label})`, ...lines, tail].join("\n") };
  }
  // Une étape « passée » (« plus tard » depuis moins de 24 h) laisse la place à la suivante.
  const skipped = await recentlySkippedKeys(deps);
  const pick = steps.find((s) => !s.optional && !s.done && !(s.asks ?? []).some((a) => skipped.has(a.key))) ?? next;
  const head = [...lines, `Avancement : ${progress.label}`, `On commence par ${esc(pick.label)} ? ${esc(pick.why)}`];

  let asks = await asksOf(deps, pick);
  const out = [...head];
  if (!asks.length) {
    out.push(`👉 ${esc(pick.howTo ?? "Regarde la page Agents du site.")}`);
    // Étape à faire hors de Telegram : en attendant, la prochaine question qui se fait par une réponse.
    const index = steps.indexOf(pick);
    const later = steps.find(
      (s, i) => i > index && !s.optional && !s.done && (s.asks?.length || s.key === "ads.thresholds") && !(s.asks ?? []).some((a) => skipped.has(a.key)),
    );
    asks = later ? await asksOf(deps, later) : [];
    if (!asks.length) return { reply: out.join("\n") };
    out.push(`En attendant : ${esc(later!.label)}.`);
  }

  const first = asks[0]!;
  // Une question est déjà posée : la même (rappelée ici, jamais doublée) ou une autre (à finir d'abord).
  const current = await currentHumanRequest(deps);
  if (current && current.key === first.key) return { reply: [...out, "Je te l'ai déjà demandé, la voici :", formatQuestion(current)].join("\n") };
  if (current)
    return {
      reply: [...out, "D'abord, la question en cours (je pose la suivante juste après) :", formatQuestion(current)].join("\n"),
      followUp: () => queueAsks(deps, asks),
    };
  return { reply: [...out, "Je te pose la question juste en dessous 👇"].join("\n"), followUp: () => queueAsks(deps, asks) };
}

async function asksOf(deps: BossGuideDeps, step: BossGuideStep): Promise<AskHumanInput[]> {
  if (step.key === "ads.thresholds") return (await adsAsks(deps)) ?? [];
  return step.asks ?? [];
}

/** Clés des demandes passées (« plus tard ») depuis moins de 24 h. */
async function recentlySkippedKeys(deps: BossGuideDeps): Promise<Set<string>> {
  const now = deps.now ? deps.now() : new Date();
  const rows = await deps.prisma.humanRequest.findMany({
    where: { status: "SKIPPED", answeredAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
}

/** Range les questions de l'étape (idempotent par clé ouverte) ; la première part si aucune n'est en cours. */
async function queueAsks(deps: BossGuideDeps, asks: readonly AskHumanInput[]): Promise<void> {
  for (const a of asks) await askHuman(deps, a);
  await agentEvent(deps, "boss.guide.asked", { keys: asks.map((a) => a.key) });
}
