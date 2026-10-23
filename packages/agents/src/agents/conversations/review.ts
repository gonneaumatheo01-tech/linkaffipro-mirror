/**
 * Relecture hebdomadaire de l'agent Conversations :
 * 1. heures de relance par persona (logique programmée, sans IA) → proposition `suggestedFollowUpHours` ;
 * 2. pour chaque profil avec assez de données et une persona : échantillon anonymisé → modèle rapide de l'équipe
 *    Algorithme → sortie JSON stricte validée → au plus 3 propositions PERSONA. Sans clé d'IA réelle : aucune relecture
 *    (le faux modèle de repli n'est jamais utilisé ici, il ne dirait rien de vrai). Plafond `llm` de l'équipe vérifié
 *    avant chaque appel, coût compté dans `AgentUsage` (équipe algo).
 * Le résultat ne contient que des chiffres et des motifs courts validés : jamais un texte de conversation.
 */
import type { ConversationProfileStats } from "../../algo/contracts";
import type { EngineDeps } from "../../missions/context";
import { loadTeamSettings } from "../../missions/settings";
import { recordUsage } from "../../missions/usage";
import { checkBudgets } from "../../orchestrator/budgets";
import { loadLlmProvider } from "../../providers/llm";
import { TEAM_OF_VERTICAL, type AgentsDeps, type LlmProvider, type TeamKey } from "../../types";
import { profileWindow } from "./compute";
import { loadFollowUpSends, suggestFollowUpHours } from "./follow-up-hours";
import {
  draftFromAiProposal,
  savePersonaRecommendation,
  type PersonaCurrent,
  type PersonaRecommendationDraft,
} from "./recommendations";
import { parseReviewOutput } from "./review-output";
import { buildReviewUser, REVIEW_SYSTEM } from "./review-prompt";
import { loadProfileSample } from "./sample";
import { loadConversationsSettings, PROFILE_DAYS } from "./settings";

/** En dessous, l'échantillon ne dit rien (conversations exclues ou vides). */
export const MIN_SAMPLE_SIZE = 5;

export type ProfileReview = {
  key: string;
  personaId: string;
  sampleSize: number;
  hooks: string[];
  repellents: string[];
  dropReasons: string[];
  proposals: { field: string; recommendationId: string }[];
  /** Éléments rejetés par le contrôle (motif seulement). */
  rejected: string[];
  error?: string;
};

export type FollowUpHoursReview = {
  personaId: string;
  sent: number;
  overallRate: number;
  hours: number[];
  recommendationId: string;
};

export type ConversationReview = {
  weekStart: string;
  model: string | null;
  profiles: ProfileReview[];
  followUpHours: FollowUpHoursReview[];
  /** Raison d'une relecture IA non faite (pas de clé, plafond atteint). */
  skipped: string | null;
};

export type ReviewDeps = AgentsDeps & Pick<EngineDeps, "providers" | "llmFactory">;

const PERSONA_SELECT = {
  id: true,
  styleExamples: true,
  minExchangesBeforeOffer: true,
  followUpAfterHours: true,
  followUpsMax: true,
  suggestedFollowUpHours: true,
} as const;

async function teamOfBot(deps: AgentsDeps, botId: string | undefined): Promise<TeamKey> {
  if (!botId) return "dating";
  const bot = await deps.prisma.bot.findUnique({ where: { id: botId }, select: { vertical: true } });
  const v = bot?.vertical as keyof typeof TEAM_OF_VERTICAL | undefined;
  return (v && TEAM_OF_VERTICAL[v]) || "dating";
}

const sameHours = (a: unknown, b: readonly number[]) =>
  Array.isArray(a) && a.length === b.length && [...a].sort((x, y) => Number(x) - Number(y)).every((x, i) => x === b[i]);

async function reviewFollowUpHours(
  deps: AgentsDeps,
  window: { start: Date; end: Date },
  minTotal: number,
  weekStart: string,
): Promise<FollowUpHoursReview[]> {
  const out: FollowUpHoursReview[] = [];
  const byPersona = await loadFollowUpSends(deps.prisma, window);
  for (const [personaId, entry] of byPersona) {
    const s = suggestFollowUpHours(entry.sends, minTotal);
    if (!s) continue;
    const persona = await deps.prisma.persona.findUnique({ where: { id: personaId }, select: PERSONA_SELECT });
    if (!persona || sameHours(persona.suggestedFollowUpHours, s.hours)) continue;
    const draft: PersonaRecommendationDraft = {
      teamKey: await teamOfBot(deps, entry.botIds[0]),
      target: "PERSONA",
      targetId: personaId,
      field: "suggestedFollowUpHours",
      before: persona.suggestedFollowUpHours ?? null,
      after: s.hours,
      evidence: {
        agent: "conversations",
        periodDays: PROFILE_DAYS,
        followUpsSent: entry.sends.length,
        overallReplyRate: s.overall,
        byHour: s.rates.map((r) => ({ hour: r.hour, sent: r.sent, rate: r.rate })),
      },
      expectedGain: `Plus de réponses aux relances (moyenne actuelle ${Math.round(s.overall * 100)} %)`,
      size: "BIG",
      weekStart,
    };
    const recommendationId = await savePersonaRecommendation(deps.prisma, draft);
    out.push({ personaId, sent: entry.sends.length, overallRate: s.overall, hours: s.hours, recommendationId });
  }
  return out;
}

/** Fournisseur de la relecture : imposé (tests) ou réel si une clé est réglée ; jamais le faux de repli. */
async function reviewLlm(deps: ReviewDeps): Promise<LlmProvider | null> {
  if (deps.providers?.llm !== undefined) return deps.providers.llm;
  return loadLlmProvider(deps.prisma, deps.llmFactory);
}

export async function runConversationReview(
  deps: ReviewDeps,
  profiles: readonly ConversationProfileStats[],
  opts: { weekStart: string },
): Promise<{ review: ConversationReview; recommendationIds: string[]; costCents: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const window = profileWindow(now);
  const { minConversations } = await loadConversationsSettings(deps.prisma);
  const settings = await loadTeamSettings(deps.prisma, "algo");
  const review: ConversationReview = { weekStart: opts.weekStart, model: null, profiles: [], followUpHours: [], skipped: null };
  const recommendationIds: string[] = [];
  let costCents = 0;

  review.followUpHours = await reviewFollowUpHours(deps, window, minConversations, opts.weekStart);
  recommendationIds.push(...review.followUpHours.map((f) => f.recommendationId));

  const llm = await reviewLlm(deps);
  if (!llm) {
    review.skipped = "Aucune clé d'IA réglée : relecture des conversations non faite.";
    return { review, recommendationIds, costCents };
  }
  review.model = settings.models.fast;
  // Une seule proposition par champ et par persona dans la semaine : celle du profil le plus fourni (ordre reçu).
  const taken = new Set<string>();
  for (const profile of profiles) {
    if (!profile.enoughData || !profile.personaId) continue;
    const budget = await checkBudgets(deps, settings, ["llm"], now);
    if (budget) {
      review.skipped = budget.reason;
      break;
    }
    const persona = await deps.prisma.persona.findUnique({ where: { id: profile.personaId }, select: PERSONA_SELECT });
    if (!persona) continue;
    const sample = await loadProfileSample(
      deps.prisma,
      { botId: profile.botId, personaId: profile.personaId, source: profile.source },
      window,
      profile.personaName,
    );
    if (sample.length < MIN_SAMPLE_SIZE) continue;
    const entry: ProfileReview = {
      key: profile.key,
      personaId: profile.personaId,
      sampleSize: sample.length,
      hooks: [],
      repellents: [],
      dropReasons: [],
      proposals: [],
      rejected: [],
    };
    review.profiles.push(entry);
    let text: string;
    try {
      const res = await llm.complete({
        model: settings.models.fast,
        system: REVIEW_SYSTEM,
        user: buildReviewUser(
          profile,
          {
            minExchangesBeforeOffer: persona.minExchangesBeforeOffer,
            followUpAfterHours: persona.followUpAfterHours,
            followUpsMax: persona.followUpsMax,
            styleExamplesCount: (persona.styleExamples ?? "").split("\n").filter((l) => l.trim()).length,
          },
          sample,
        ),
        maxTokens: 1500,
      });
      costCents += res.costCents;
      await recordUsage(deps.prisma, "algo", "llm", res.costCents, now);
      text = res.text;
    } catch (err) {
      // Message d'erreur du fournisseur seulement (jamais le contenu envoyé).
      entry.error = `Appel à l'IA en échec : ${(err as Error).message}`.slice(0, 200);
      continue;
    }
    const parsed = parseReviewOutput(text, sample);
    if (!parsed.ok) {
      entry.error = `Réponse de l'IA rejetée : ${parsed.error}`;
      continue;
    }
    entry.hooks = parsed.output.hooks;
    entry.repellents = parsed.output.repellents;
    entry.dropReasons = parsed.output.dropReasons;
    entry.rejected = parsed.rejected;
    const teamKey = await teamOfBot(deps, profile.botId);
    for (const proposal of parsed.output.proposals) {
      const slot = `${profile.personaId}:${proposal.field}`;
      if (taken.has(slot)) continue;
      const draft = draftFromAiProposal(proposal, {
        persona: persona as PersonaCurrent,
        profile,
        teamKey,
        weekStart: opts.weekStart,
        sampleSize: sample.length,
      });
      if (!draft) continue;
      const id = await savePersonaRecommendation(deps.prisma, draft);
      taken.add(slot);
      entry.proposals.push({ field: proposal.field, recommendationId: id });
      recommendationIds.push(id);
    }
  }
  return { review, recommendationIds, costCents };
}
