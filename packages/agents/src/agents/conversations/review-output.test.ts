import { describe, expect, it } from "vitest";
import type { ConversationProfileStats } from "../../algo/contracts";
import { draftFromAiProposal, isPersonaRecommendationField, savePersonaRecommendation, type PersonaCurrent } from "./recommendations";
import { parseReviewOutput } from "./review-output";
import type { SampleConversation } from "./sample";
import { createFakePrisma } from "../../testing/fake-prisma";

const sample: SampleConversation[] = [
  {
    n: "c1",
    replied: true,
    linkSent: false,
    converted: false,
    stage: "CHAT",
    messages: [
      { who: "profil", text: "Tu fais quoi de beau ce soir ?" },
      { who: "personne", text: "je regarde un film tranquille chez moi" },
    ],
  },
];
const ok = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    hooks: ["Question ouverte sur la soirée"],
    repellents: ["Lien proposé trop tôt"],
    dropReasons: ["Silence après la 2e question"],
    proposals: [{ field: "minExchangesBeforeOffer", value: 6, reason: "Médiane de 3 messages avant le lien, 1 inscription" }],
    ...over,
  });

describe("sortie stricte de la relecture", () => {
  it("sortie valide acceptée", () => {
    const r = parseReviewOutput(ok(), sample);
    expect(r).toEqual({
      ok: true,
      rejected: [],
      output: {
        hooks: ["Question ouverte sur la soirée"],
        repellents: ["Lien proposé trop tôt"],
        dropReasons: ["Silence après la 2e question"],
        proposals: [{ field: "minExchangesBeforeOffer", value: 6, reason: "Médiane de 3 messages avant le lien, 1 inscription" }],
      },
    });
  });

  it("JSON invalide, texte autour, clé manquante ou en trop : tout est rejeté", () => {
    expect(parseReviewOutput("pas du json", sample).ok).toBe(false);
    expect(parseReviewOutput("```json\n" + ok() + "\n```", sample).ok).toBe(false);
    expect(parseReviewOutput(JSON.stringify({ hooks: [], repellents: [], dropReasons: [] }), sample).ok).toBe(false);
    expect(parseReviewOutput(ok({ extra: 1 }), sample).ok).toBe(false);
    expect(parseReviewOutput(ok({ hooks: "texte" }), sample).ok).toBe(false);
  });

  it("élément trop long, message entier ou donnée personnelle : élément rejeté", () => {
    const r = parseReviewOutput(
      ok({
        hooks: ["x".repeat(80), "je regarde un film tranquille chez moi", "Écrire sur t.me/canal", "Salue Julie", "Court et bon"],
      }),
      sample,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.output.hooks).toEqual(["Court et bon"]);
    expect(r.rejected).toEqual([
      "accroche : trop long",
      "accroche : message entier",
      "accroche : donnée personnelle",
      "accroche : donnée personnelle",
    ]);
  });

  it("champ interdit, valeur hors bornes, plus de 3 propositions : rejetés", () => {
    const r = parseReviewOutput(
      ok({
        proposals: [
          { field: "identityKind", value: "GIRL", reason: "plus naturel" },
          { field: "age", value: 19, reason: "plus jeune" },
          { field: "illusion", value: true, reason: "plus crédible" },
          { field: "followUpsMax", value: 5, reason: "plus de relances" },
          { field: "followUpsMax", value: 1, reason: "Taux de réponse aux relances faible" },
          { field: "followUpAfterHours", value: 12, reason: "Réponses rares après 24 h" },
          { field: "styleExamples", value: ["lui: t'es où ? / moi: au chaud, et toi ?"], reason: "Taux de réponse 34 %" },
          { field: "minExchangesBeforeOffer", value: 5, reason: "Lien trop tôt" },
        ],
      }),
      sample,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.output.proposals.map((p) => p.field)).toEqual(["followUpsMax", "followUpAfterHours", "styleExamples"]);
    expect(r.rejected).toEqual([
      "proposition : champ interdit (identityKind)",
      "proposition : champ interdit (age)",
      "proposition : champ interdit (illusion)",
      "proposition : valeur hors bornes (followUpsMax)",
      "proposition : plus de 3",
    ]);
  });
});

const profile: ConversationProfileStats = {
  key: "b1:p1:tk",
  botId: "b1",
  botLabel: "@lea_bot",
  kind: "BOT",
  personaId: "p1",
  personaName: "Léa",
  source: "tk",
  conversations: 40,
  replyRate: 0.34,
  medianMessagesBeforeLink: 3,
  dropStage: "CHAT",
  medianReplyDelaySec: 300,
  replyHours: [21],
  linksSent: 10,
  clicks: 4,
  registrations: 1,
  ftds: 0,
  aiCostEur: 1,
  costPerRegistrationEur: 1,
  enoughData: true,
};
const persona: PersonaCurrent = {
  id: "p1",
  styleExamples: "lui: salut / moi: coucou toi",
  minExchangesBeforeOffer: 4,
  followUpAfterHours: 24,
  followUpsMax: 2,
  suggestedFollowUpHours: null,
};

describe("recommandations PERSONA", () => {
  const ctx = { persona, profile, teamKey: "dating" as const, weekStart: "2026-10-19", sampleSize: 30 };

  it("exemples de style ajoutés au registre, preuve chiffrée, taille BIG", () => {
    const d = draftFromAiProposal({ field: "styleExamples", value: ["lui: salut / moi: coucou toi", "lui: ça va ? / moi: au top"], reason: "r" }, ctx)!;
    expect(d).toMatchObject({
      target: "PERSONA",
      targetId: "p1",
      field: "styleExamples",
      size: "BIG",
      before: "lui: salut / moi: coucou toi",
      after: "lui: salut / moi: coucou toi\nlui: ça va ? / moi: au top",
      evidence: { conversations: 40, replyRate: 0.34, sampleSize: 30, append: ["lui: ça va ? / moi: au top"] },
    });
    expect(draftFromAiProposal({ field: "minExchangesBeforeOffer", value: 4, reason: "r" }, ctx)).toBeNull();
    expect(draftFromAiProposal({ field: "minExchangesBeforeOffer", value: 6, reason: "r" }, ctx)).toMatchObject({ before: 4, after: 6 });
  });

  it("seuls 5 champs autorisés, jamais l'identité, l'âge, l'illusion ou /stop", () => {
    for (const f of ["styleExamples", "minExchangesBeforeOffer", "followUpAfterHours", "followUpsMax", "suggestedFollowUpHours"])
      expect(isPersonaRecommendationField(f)).toBe(true);
    for (const f of ["identityKind", "illusion", "age", "extraPrompt", "isActive", "name", "maxOfferSends"])
      expect(isPersonaRecommendationField(f)).toBe(false);
  });

  it("écrit en PROPOSED, met à jour au lieu de doubler, refuse un champ interdit", async () => {
    const prisma = createFakePrisma();
    const d = draftFromAiProposal({ field: "followUpsMax", value: 1, reason: "r" }, ctx)!;
    const id1 = await savePersonaRecommendation(prisma, d);
    const id2 = await savePersonaRecommendation(prisma, { ...d, after: 0 });
    expect(id2).toBe(id1);
    const rows = prisma._model("recommendation").rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "PROPOSED", target: "PERSONA", field: "followUpsMax", after: 0, size: "BIG" });
    await expect(savePersonaRecommendation(prisma, { ...d, field: "identityKind" as never })).rejects.toThrow(/non autorisé/);
  });
});
