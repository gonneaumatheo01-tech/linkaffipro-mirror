/**
 * Propositions de réglages de persona de l'agent Conversations → `Recommendation` PROPOSED, cible PERSONA, taille BIG
 * (jamais appliquées seules au niveau 1). Seuls 5 champs sont permis ; tout autre champ (identité, illusion, âge,
 * règles adultes, /stop…) est refusé ici, avant toute écriture. Une proposition encore en attente sur le même champ de
 * la même persona est mise à jour plutôt que doublée.
 */
import { Prisma } from "@linkaffipro/db";
import type { ConversationProfileStats } from "../../algo/contracts";
import type { AgentsPrisma, TeamKey } from "../../types";
import type { AiProposal } from "./review-output";
import { STYLE_EXAMPLES_MAX_LENGTH } from "./review-output";

export const PERSONA_RECOMMENDATION_FIELDS = [
  "styleExamples",
  "minExchangesBeforeOffer",
  "followUpAfterHours",
  "followUpsMax",
  "suggestedFollowUpHours",
] as const;
export type PersonaRecommendationField = (typeof PERSONA_RECOMMENDATION_FIELDS)[number];

export function isPersonaRecommendationField(f: unknown): f is PersonaRecommendationField {
  return typeof f === "string" && (PERSONA_RECOMMENDATION_FIELDS as readonly string[]).includes(f);
}

export type PersonaRecommendationDraft = {
  teamKey: TeamKey;
  target: "PERSONA";
  targetId: string;
  field: PersonaRecommendationField;
  before: unknown;
  after: unknown;
  evidence: Record<string, unknown>;
  expectedGain: string;
  size: "BIG";
  weekStart: string;
};

export type PersonaCurrent = {
  id: string;
  styleExamples: string | null;
  minExchangesBeforeOffer: number;
  followUpAfterHours: number;
  followUpsMax: number;
  suggestedFollowUpHours: unknown;
};

const pct = (r: number | null) => (r === null ? "inconnu" : `${Math.round(r * 100)} %`);

/** Preuve chiffrée d'une proposition (chiffres du profil, jamais de texte de conversation). */
export function profileEvidence(p: ConversationProfileStats, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent: "conversations",
    periodDays: 30,
    profileKey: p.key,
    profile: { bot: p.botLabel, persona: p.personaName, source: p.source },
    conversations: p.conversations,
    replyRate: p.replyRate,
    medianMessagesBeforeLink: p.medianMessagesBeforeLink,
    dropStage: p.dropStage,
    linksSent: p.linksSent,
    clicks: p.clicks,
    registrations: p.registrations,
    ftds: p.ftds,
    ...extra,
  };
}

/**
 * Proposition de l'IA (déjà validée) → brouillon, ou null si elle ne change rien ou dépasse une borne. Exemples de
 * style : AJOUTÉS au registre actuel (`evidence.append` garde les lignes ajoutées, pour un nouvel ajout au moment
 * d'appliquer si le registre a changé entre-temps).
 */
export function draftFromAiProposal(
  proposal: AiProposal,
  ctx: { persona: PersonaCurrent; profile: ConversationProfileStats; teamKey: TeamKey; weekStart: string; sampleSize: number },
): PersonaRecommendationDraft | null {
  const { persona, profile } = ctx;
  const evidence = profileEvidence(profile, { sampleSize: ctx.sampleSize, reason: proposal.reason });
  const base = { teamKey: ctx.teamKey, target: "PERSONA" as const, targetId: persona.id, size: "BIG" as const, weekStart: ctx.weekStart };
  if (proposal.field === "styleExamples") {
    const before = persona.styleExamples ?? "";
    const existing = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
    const added = proposal.value.filter((l) => !existing.has(l));
    if (!added.length) return null;
    const after = [before.trimEnd(), ...added].filter(Boolean).join("\n");
    if (after.length > STYLE_EXAMPLES_MAX_LENGTH) return null;
    return {
      ...base,
      field: "styleExamples",
      before: persona.styleExamples,
      after,
      evidence: { ...evidence, append: added },
      expectedGain: `Plus de réponses (taux actuel ${pct(profile.replyRate)})`,
    };
  }
  const before = persona[proposal.field];
  if (before === proposal.value) return null;
  const gain =
    proposal.field === "minExchangesBeforeOffer"
      ? `Lien au bon moment (médiane actuelle ${profile.medianMessagesBeforeLink ?? "inconnue"} messages)`
      : "Plus de réponses aux relances";
  return { ...base, field: proposal.field, before, after: proposal.value, evidence, expectedGain: gain };
}

/** Écrit (ou met à jour) la proposition ; refuse tout champ non autorisé. Rend l'identifiant. */
export async function savePersonaRecommendation(prisma: AgentsPrisma, d: PersonaRecommendationDraft): Promise<string> {
  if (d.target !== "PERSONA" || !isPersonaRecommendationField(d.field)) throw new Error(`Champ de persona non autorisé : ${String(d.field)}`);
  const data = {
    teamKey: d.teamKey,
    // Json facultatif : « rien » s'écrit DbNull pour Prisma.
    before: d.before === null || d.before === undefined ? Prisma.DbNull : (d.before as Prisma.InputJsonValue),
    after: d.after as Prisma.InputJsonValue,
    evidence: d.evidence as Prisma.InputJsonValue,
    expectedGain: d.expectedGain,
    size: d.size,
    weekStart: d.weekStart,
  };
  const pending = await prisma.recommendation.findFirst({
    where: { target: "PERSONA", targetId: d.targetId, field: d.field, status: "PROPOSED" },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    await prisma.recommendation.update({ where: { id: pending.id }, data });
    return pending.id;
  }
  const row = await prisma.recommendation.create({
    data: { ...data, target: "PERSONA", targetId: d.targetId, field: d.field, status: "PROPOSED" },
  });
  return row.id;
}
