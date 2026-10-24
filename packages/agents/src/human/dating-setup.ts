/**
 * Questions de mise en route de l'équipe Dating (phase 20, propriétaire : chantier B) : clé fal.ai, puis par persona
 * Dating active adresse du LoRA, mot déclencheur, photos de référence, vidéos sources, puis plafond vidéo, puis
 * confirmation du banc d'essai. Mises dans la file `HumanRequest` une seule fois (`Setting` `agents.datingSetupAsked`) :
 * une question à la fois, la suivante part à la réponse. Seul ce qui manque est demandé.
 *
 * Persona « Dating » : active, et d'identité fille (`identityKind` GIRL, comptes réels de la phase 18) ou rattachée à
 * l'univers Dating (campagne ou offre Link Affi `vertical` DATING, ou persona d'un canal de l'équipe Dating).
 */
import type { AgentsDeps } from "../types";
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { setTeamBudget } from "../admin/budget";
import { startBench } from "../orchestrator/bench";
import { personaTagOf } from "../library/tags";
import { askHuman } from "./requests";
import { registerAnswerAction } from "./respond";
import { checkLoraUrl, parseEuroAmount } from "./answer";
import { secretSummary } from "./secrets";

export const DATING_SETUP_SETTING = "agents.datingSetupAsked";
export const FAL_SECRET_KEY = "providers.fal.apiKey";
/** Plafond vidéo retenu quand le client répond « plus tard ». */
export const DEFAULT_VIDEO_BUDGET_EUROS = 100;
export const BUDGET_OPTIONS = ["50 €", "100 €", "200 €"];
/** Vidéos sources demandées par persona (5 à 10). */
export const SOURCE_VIDEOS_WANTED = 5;
export const BENCH_COUNT = 3;

/** Tarifs fal.ai constatés le 23 octobre (dollars par seconde facturée), banc d'essai en 580p puis 720p. */
const BENCH_USD_PER_SEC = { "580p": 0.06, "720p": 0.08 } as const;
/** Conversion prudente dollar → euro pour une estimation affichée (pas une facture). */
const USD_TO_EUR = 0.95;
/** Durée supposée d'une vidéo source sans durée connue. */
const DEFAULT_SOURCE_SECONDS = 10;

export type DatingPersona = { id: string; name: string };

type PersonaRow = {
  id: string;
  name: string;
  isActive: boolean;
  identityKind: string;
  campaignId: string | null;
  affiliateCampaignId: string | null;
  loraUrl: string | null;
  loraTrigger: string | null;
  referenceImageIds: unknown;
  createdAt: Date;
};

function idsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Personas actives de l'univers Dating (voir l'en-tête), les plus anciennes d'abord. */
export async function datingPersonas(deps: Pick<AgentsDeps, "prisma">): Promise<PersonaRow[]> {
  const personas = (await deps.prisma.persona.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  })) as unknown as PersonaRow[];
  if (personas.length === 0) return [];
  const campaignIds = personas.map((p) => p.campaignId).filter((x): x is string => !!x);
  const offerIds = personas.map((p) => p.affiliateCampaignId).filter((x): x is string => !!x);
  const [campaigns, offers, plans] = await Promise.all([
    campaignIds.length
      ? deps.prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, vertical: true } })
      : [],
    offerIds.length
      ? deps.prisma.affiliateCampaign.findMany({ where: { id: { in: offerIds } }, select: { id: true, vertical: true } })
      : [],
    deps.prisma.channelAgentPlan.findMany({ where: { teamKey: "dating" }, select: { personaId: true } }),
  ]);
  const datingCampaigns = new Set(campaigns.filter((c) => c.vertical === "DATING").map((c) => c.id));
  const datingOffers = new Set(offers.filter((o) => o.vertical === "DATING").map((o) => o.id));
  const planned = new Set(plans.map((p) => p.personaId).filter((x): x is string => !!x));
  return personas.filter(
    (p) =>
      p.identityKind === "GIRL" ||
      (p.campaignId !== null && datingCampaigns.has(p.campaignId)) ||
      (p.affiliateCampaignId !== null && datingOffers.has(p.affiliateCampaignId)) ||
      planned.has(p.id),
  );
}

/** Coût estimé du banc d'essai en centimes d'euro : chaque vidéo en 580p puis en 720p chez fal. */
export function estimateBenchCents(durationsSec: (number | null | undefined)[], count = BENCH_COUNT): number {
  let usd = 0;
  for (let i = 0; i < count; i++) {
    const d = durationsSec[i];
    const sec = typeof d === "number" && d > 0 ? d : DEFAULT_SOURCE_SECONDS;
    usd += sec * (BENCH_USD_PER_SEC["580p"] + BENCH_USD_PER_SEC["720p"]);
  }
  return Math.round(usd * USD_TO_EUR * 100);
}

/** « environ 4 € » : arrondi à l'euro, 1 € au moins. */
export function formatEstimate(cents: number): string {
  return `${Math.max(1, Math.round(cents / 100)).toLocaleString("fr-FR")} €`;
}

async function sourceDurations(deps: AgentsDeps, personaId: string): Promise<number[]> {
  const sources = await deps.prisma.mediaAsset.findMany({
    where: { personaId, kind: "SOURCE" },
    orderBy: { createdAt: "asc" },
    take: BENCH_COUNT,
    select: { duration: true },
  });
  return sources.map((s) => s.duration ?? DEFAULT_SOURCE_SECONDS);
}

/**
 * Range les questions de mise en route (une seule fois) ; la première part tout de suite si aucune autre n'est en
 * cours. Rend le nombre de questions mises en file (0 si déjà fait).
 */
export async function ensureDatingSetupQuestions(deps: AgentsDeps): Promise<{ queued: number }> {
  if ((await readSetting(deps, DATING_SETUP_SETTING)) !== undefined) return { queued: 0 };
  // Marqué AVANT les questions : deux appels simultanés ne posent pas deux fois la série (askHuman reste idempotent).
  await writeSetting(deps, DATING_SETUP_SETTING, { askedAt: nowOf(deps).toISOString(), queued: null });
  let queued = 0;
  const ask = async (input: Parameters<typeof askHuman>[1]) => {
    await askHuman(deps, { teamKey: "dating", ...input });
    queued++;
  };

  if (!(await secretSummary(deps.prisma, FAL_SECRET_KEY)).set)
    await ask({
      kind: "SECRET",
      key: FAL_SECRET_KEY,
      question:
        "Crée un compte sur https://fal.ai, mets quelques dollars de crédit, crée une clé sur https://fal.ai/dashboard/keys, puis réponds à ce message avec la clé. Réponds « plus tard » pour passer.",
      onAnswer: { resume: false },
    });

  const personas = await datingPersonas(deps);
  for (const p of personas) {
    const tag = personaTagOf(p.name);
    if (!p.loraUrl)
      await ask({
        kind: "TEXT",
        key: `persona.${p.id}.loraUrl`,
        question: `Réponds avec l'adresse du fichier LoRA de ${p.name} (elle commence par https:// et finit souvent par .safetensors), ou « plus tard ».`,
        onAnswer: { action: "persona-lora-url", personaId: p.id, resume: false },
      });
    if (!p.loraTrigger)
      await ask({
        kind: "TEXT",
        key: `persona.${p.id}.loraTrigger`,
        question: `Réponds avec le mot déclencheur du LoRA de ${p.name} (le mot qui fait apparaître ${p.name} sur les photos), ou « plus tard ».`,
        onAnswer: { action: "persona-lora-trigger", personaId: p.id, resume: false },
      });
    if (idsOf(p.referenceImageIds).length === 0)
      await ask({
        kind: "MEDIA",
        key: `persona.${p.id}.referenceImages`,
        question: `Envoie 1 à 3 photos de ${p.name} avec la légende #dating #reference #${tag} (la première sert de modèle pour les vidéos). Réponds « plus tard » pour passer.`,
        expected: { count: 1, tags: ["dating", "reference", tag] },
        onAnswer: { resume: false },
      });
    const sources = await deps.prisma.mediaAsset.count({ where: { personaId: p.id, kind: "SOURCE" } });
    if (sources < SOURCE_VIDEOS_WANTED)
      await ask({
        kind: "MEDIA",
        key: `persona.${p.id}.sourceVideos`,
        question: `Envoie 5 à 10 vidéos sources pour ${p.name} avec la légende #dating #source #${tag} (une personne bien visible, en entier). Réponds « plus tard » pour passer.`,
        expected: { count: SOURCE_VIDEOS_WANTED, tags: ["dating", "source", tag] },
        onAnswer: { resume: false },
      });
  }

  await ask({
    kind: "CHOICE",
    key: "agents.team.dating.videoBudget",
    question: `Plafond des vidéos IA par mois pour l'équipe Rencontres : réponds 1, 2 ou 3, ou écris un montant (ex. 75). « plus tard » = ${DEFAULT_VIDEO_BUDGET_EUROS} €.`,
    options: BUDGET_OPTIONS,
    onAnswer: { action: "dating-video-budget", skipAnswer: `${DEFAULT_VIDEO_BUDGET_EUROS} €`, resume: false },
  });

  for (const p of personas) {
    const estimate = formatEstimate(estimateBenchCents(await sourceDurations(deps, p.id)));
    const forName = personas.length > 1 ? ` pour ${p.name}` : "";
    await ask({
      kind: "CONFIRM",
      key: `persona.${p.id}.bench`,
      question: `Tout est là : je lance le banc d'essai${forName} (${BENCH_COUNT} vidéos, environ ${estimate}) ? Réponds oui ou non.`,
      onAnswer: { action: "dating-bench", personaId: p.id, resume: false },
    });
  }

  await writeSetting(deps, DATING_SETUP_SETTING, { askedAt: nowOf(deps).toISOString(), queued, personas: personas.length });
  await agentEvent(deps, "agents.dating.setup_queued", { queued, personas: personas.length });
  return { queued };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Suites des réponses (enregistrées au chargement du module).                                                       */
/* ---------------------------------------------------------------------------------------------------------------- */

async function personaName(deps: AgentsDeps, personaId: string): Promise<string | null> {
  const p = await deps.prisma.persona.findUnique({ where: { id: personaId }, select: { name: true } });
  return p?.name ?? null;
}

registerAnswerAction("persona-lora-url", async (deps, { value, actor, onAnswer }) => {
  const personaId = typeof onAnswer.personaId === "string" ? onAnswer.personaId : null;
  const name = personaId ? await personaName(deps, personaId) : null;
  if (!personaId || !name) return "Persona introuvable : rien n'est enregistré.";
  const lora = checkLoraUrl(value);
  if (!lora.ok) return lora.message;
  await deps.prisma.persona.update({ where: { id: personaId }, data: { loraUrl: lora.url } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.persona.lora_url",
    entityType: "Persona",
    entityId: personaId,
    metadata: { via: actor.via, doubtful: lora.doubtful },
  });
  return lora.doubtful
    ? `Adresse du LoRA de ${name} enregistrée ✅ Je ne reconnais pas cet hébergeur : vérifie que l'adresse mène bien au fichier .safetensors.`
    : `Adresse du LoRA de ${name} enregistrée ✅`;
});

registerAnswerAction("persona-lora-trigger", async (deps, { value, actor, onAnswer }) => {
  const personaId = typeof onAnswer.personaId === "string" ? onAnswer.personaId : null;
  const name = personaId ? await personaName(deps, personaId) : null;
  if (!personaId || !name) return "Persona introuvable : rien n'est enregistré.";
  const trigger = value.trim().replace(/^["«“'\s]+|["»”'\s]+$/g, "").slice(0, 60);
  if (!trigger) return "Mot déclencheur vide : rien n'est enregistré.";
  await deps.prisma.persona.update({ where: { id: personaId }, data: { loraTrigger: trigger } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.persona.lora_trigger",
    entityType: "Persona",
    entityId: personaId,
    metadata: { via: actor.via },
  });
  return `Mot déclencheur de ${name} : « ${trigger} » ✅`;
});

registerAnswerAction("dating-video-budget", async (deps, { value, actor }) => {
  const amount = parseEuroAmount(value);
  const euros = amount && amount.euros <= 100_000 ? amount.euros : DEFAULT_VIDEO_BUDGET_EUROS;
  await setTeamBudget(deps, "dating", "video", euros * 100, actor);
  return `Plafond vidéo de l'équipe Rencontres : ${euros.toLocaleString("fr-FR")} € par mois ✅`;
});

registerAnswerAction("dating-bench", async (deps, { value, actor, onAnswer }) => {
  const personaId = typeof onAnswer.personaId === "string" ? onAnswer.personaId : null;
  if (!personaId) return "Persona introuvable : banc d'essai non lancé.";
  if (value !== "oui")
    return "D'accord, pas de banc d'essai pour l'instant. Tu pourras le lancer depuis la fiche de l'équipe Rencontres.";
  try {
    const r = await startBench(deps, { personaId, count: BENCH_COUNT, byUserId: actor.userId ?? null });
    return r.message;
  } catch (err) {
    deps.logger?.error({ err: (err as Error).message, personaId }, "[agents] banc d'essai non lancé");
    return "Le banc d'essai n'a pas pu démarrer : réessaie depuis la fiche de l'équipe Rencontres.";
  }
});
