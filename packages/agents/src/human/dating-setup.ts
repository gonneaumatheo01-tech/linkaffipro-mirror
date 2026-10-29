/**
 * Questions de mise en route de l'équipe Dating (phase 20, propriétaire : chantier B) : clé fal.ai, puis par persona
 * Dating active adresse du LoRA, mot déclencheur et photos de référence (les vidéos sources, le plafond vidéo et le
 * banc d'essai ont été retirés avec les vidéos IA le 29 octobre 2026). Mises dans la file `HumanRequest` une seule fois
 * (`Setting` `agents.datingSetupAsked`) : une question à la fois, la suivante part à la réponse. Seul ce qui manque est
 * demandé.
 *
 * Persona « Dating » : active, et d'identité fille (`identityKind` GIRL, comptes réels de la phase 18) ou rattachée à
 * l'univers Dating (campagne ou offre Link Affi `vertical` DATING, ou persona d'un canal de l'équipe Dating).
 */
import type { AgentsDeps } from "../types";
import { agentAudit, agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import { personaTagOf } from "../library/tags";
import { askHuman } from "./requests";
import { registerAnswerAction } from "./respond";
import { checkLoraUrl } from "./answer";
import { secretSummary } from "./secrets";

export const DATING_SETUP_SETTING = "agents.datingSetupAsked";
export const FAL_SECRET_KEY = "providers.fal.apiKey";
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
        question: `Envoie 1 à 3 photos de ${p.name} avec la légende #dating #reference #${tag} (la première sert de modèle). Réponds « plus tard » pour passer.`,
        expected: { count: 1, tags: ["dating", "reference", tag] },
        onAnswer: { resume: false },
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

/** Anciennes questions (plafond vidéo, banc d'essai) encore ouvertes : les vidéos IA ne sont plus produites. */
const VIDEO_REMOVED = "Les vidéos IA ne sont plus produites : rien à régler.";
registerAnswerAction("dating-video-budget", async () => VIDEO_REMOVED);
registerAnswerAction("dating-bench", async () => VIDEO_REMOVED);
