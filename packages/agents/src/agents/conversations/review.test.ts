import { describe, expect, it } from "vitest";
import { computeConversationProfiles, reviewConversations } from "../../algo/conversations-contract";
import { createFakeLlm } from "../../providers/fake";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsDeps } from "../../types";
import { suggestFollowUpHours } from "./follow-up-hours";

const now = new Date("2026-10-23T12:00:00Z");
const H = 3_600_000;
const enqueue = { orchestrator: async () => {}, step: async () => {} };

function seed(opts: { followUps?: boolean } = {}) {
  const conversation: Record<string, unknown>[] = [];
  const conversationMessage: Record<string, unknown>[] = [];
  const conversationEvent: Record<string, unknown>[] = [];
  const member: Record<string, unknown>[] = [];
  for (let i = 0; i < 34; i++) {
    const id = `c${i}`;
    const createdAt = new Date(now.getTime() - (i + 2) * 24 * H);
    member.push({ id: `m${i}`, firstName: "Gaspard", lastName: null, username: "gasp_75" });
    conversation.push({
      id,
      botId: "b1",
      memberId: `m${i}`,
      personaId: "p1",
      source: "tk",
      stage: "CHAT",
      status: "BOT",
      createdAt,
      convertedAt: null,
      lastInboundAt: createdAt,
      lastAssistantAt: createdAt,
      isMinor: i === 0,
      stoppedAt: i === 1 ? createdAt : null,
      closedReason: i === 1 ? "STOP" : null,
      offerSends: 0,
    });
    conversationMessage.push(
      { conversationId: id, direction: "OUT", author: "ASSISTANT", text: "Coucou, tu fais quoi ce soir ?", meta: {}, media: null, createdAt },
      {
        conversationId: id,
        direction: "IN",
        author: "MEMBER",
        text: "moi c'est Gaspard, appelle le 0612345678",
        meta: {},
        media: null,
        createdAt: new Date(createdAt.getTime() + 60_000),
      },
    );
    if (opts.followUps) {
      // 19 h Paris (17:00 UTC) : réponse ; 11 h Paris (09:00 UTC) : pas de réponse. 60 relances au total.
      for (const [h, replied] of [[17, true], [9, false]] as const) {
        // La relance de 11 h part le lendemain : la réponse de la veille ne compte pas pour elle.
        const day = new Date(Date.UTC(2026, 9, 20 - (i % 15) + (replied ? 0 : 1), h));
        conversationEvent.push({ conversationId: id, type: "follow_up_sent", fromStage: null, toStage: null, payload: {}, createdAt: day });
        if (replied)
          conversationMessage.push({ conversationId: id, direction: "IN", author: "MEMBER", text: "ok", meta: {}, media: null, createdAt: new Date(day.getTime() + H) });
      }
    }
  }
  return createFakePrisma({
    conversation,
    conversationMessage,
    conversationEvent,
    member,
    bot: [{ id: "b1", name: "Léa", username: "lea_bot", vertical: "DATING" }],
    persona: [
      {
        id: "p1",
        name: "Léa",
        styleExamples: null,
        minExchangesBeforeOffer: 4,
        followUpAfterHours: 24,
        followUpsMax: 2,
        suggestedFollowUpHours: null,
        identityKind: "GIRL",
        age: 23,
      },
    ],
    agentTeamConfig: [{ teamKey: "algo", settings: { algo: { minConversations: 30 } } }],
  });
}

describe("agent Conversations de bout en bout (base simulée)", () => {
  it("chiffres par profil sur 30 jours avec le seuil réglé", async () => {
    const prisma = seed();
    const profiles = await computeConversationProfiles({ prisma, enqueue, now: () => now });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ key: "b1:p1:tk", conversations: 29, replyRate: 1, enoughData: false });
    const all = await computeConversationProfiles({ prisma, enqueue, now: () => now }, { days: 40 });
    expect(all[0]).toMatchObject({ conversations: 34, enoughData: true, botLabel: "@lea_bot", personaName: "Léa" });
  });

  it("relecture : échantillon anonymisé sans mineur ni /stop, sortie validée, PERSONA autorisés seulement, coût compté", async () => {
    const prisma = seed();
    const llm = createFakeLlm({
      costCents: 3,
      responses: {
        conversations: JSON.stringify({
          hooks: ["Question sur la soirée", "x".repeat(90)],
          repellents: [],
          dropReasons: ["Pas de relance après la présentation"],
          proposals: [
            { field: "identityKind", value: "ASSISTANT", reason: "plus honnête" },
            { field: "age", value: 30, reason: "plus mûre" },
            { field: "minExchangesBeforeOffer", value: 6, reason: "Taux de réponse 100 %, aucun lien envoyé" },
          ],
        }),
      },
    });
    const deps = { prisma, enqueue, now: () => now, providers: { llm } } as AgentsDeps;
    const profiles = await computeConversationProfiles(deps, { days: 40 });
    const res = await reviewConversations(deps, profiles, { weekStart: "2026-10-19" });

    expect(llm.calls).toHaveLength(1);
    const user = llm.calls[0]!.user;
    expect(user).not.toMatch(/Gaspard|0612345678|gasp_75|Léa/);
    expect(user).toContain("[prénom]");
    // 29 conversations sur 30 jours − mineur − /stop = 27 (plafond 40).
    expect(user).toContain("Échantillon (27 conversations");

    const recs = prisma._model("recommendation").rows;
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ target: "PERSONA", targetId: "p1", field: "minExchangesBeforeOffer", before: 4, after: 6, status: "PROPOSED", size: "BIG", teamKey: "dating" });
    expect(res.recommendationIds).toEqual([recs[0]!.id]);
    expect(res.costCents).toBe(3);
    expect(prisma._model("agentUsage").rows[0]).toMatchObject({ teamKey: "algo", provider: "llm", cents: 3, calls: 1 });

    const review = JSON.stringify(res.review);
    expect(review).not.toMatch(/Gaspard|0612345678|Coucou, tu fais quoi/);
    expect(res.review.profiles[0]).toMatchObject({ hooks: ["Question sur la soirée"], sampleSize: 27 });
    expect(res.review.profiles[0]!.rejected).toEqual([
      "accroche : trop long",
      "proposition : champ interdit (identityKind)",
      "proposition : champ interdit (age)",
    ]);
  });

  it("réponse invalide de l'IA : rien n'est créé, coût compté quand même", async () => {
    const prisma = seed();
    const llm = createFakeLlm({ costCents: 2, responses: { conversations: "Voici mon analyse : …" } });
    const deps = { prisma, enqueue, now: () => now, providers: { llm } } as AgentsDeps;
    const res = await reviewConversations(deps, await computeConversationProfiles(deps, { days: 40 }), { weekStart: "2026-10-19" });
    expect(res.review.profiles[0]!.error).toMatch(/rejetée/);
    expect(res.recommendationIds).toEqual([]);
    expect(res.costCents).toBe(2);
  });

  it("sans clé d'IA : aucune relecture, résultat vide", async () => {
    const prisma = seed();
    const deps = { prisma, enqueue, now: () => now } as AgentsDeps;
    const res = await reviewConversations(deps, await computeConversationProfiles(deps, { days: 40 }), { weekStart: "2026-10-19" });
    expect(res).toMatchObject({ recommendationIds: [], costCents: 0, review: { profiles: [], model: null } });
    expect(res.review.skipped).toMatch(/Aucune clé/);
  });

  it("profil sans assez de données : jamais relu", async () => {
    const prisma = seed();
    const llm = createFakeLlm();
    const deps = { prisma, enqueue, now: () => now, providers: { llm } } as AgentsDeps;
    await reviewConversations(deps, await computeConversationProfiles(deps), { weekStart: "2026-10-19" });
    expect(llm.calls).toHaveLength(0);
  });

  it("heures de relance : proposition suggestedFollowUpHours sans IA", async () => {
    const prisma = seed({ followUps: true });
    const deps = { prisma, enqueue, now: () => now, providers: { llm: null } } as AgentsDeps;
    const res = await reviewConversations(deps, [], { weekStart: "2026-10-19" });
    expect(res.review.followUpHours).toMatchObject([{ personaId: "p1", hours: [19] }]);
    const rec = prisma._model("recommendation").rows.find((r) => r.field === "suggestedFollowUpHours");
    expect(rec).toMatchObject({ target: "PERSONA", after: [19], size: "BIG", status: "PROPOSED" });
  });
});

describe("heures de relance (pur)", () => {
  const at = (h: number, d = 20) => new Date(Date.UTC(2026, 9, d, h - 2));
  it("pas assez de relances, ou une seule heure : pas de proposition", () => {
    expect(suggestFollowUpHours([{ sentAt: at(19), replied: true }], 30)).toBeNull();
    const one = Array.from({ length: 40 }, () => ({ sentAt: at(19), replied: true }));
    expect(suggestFollowUpHours(one, 30)).toBeNull();
  });
  it("heures à 80 % de la meilleure, jamais la nuit", () => {
    const sends = [
      ...Array.from({ length: 10 }, (_, i) => ({ sentAt: at(19), replied: i < 6 })),
      ...Array.from({ length: 10 }, (_, i) => ({ sentAt: at(20), replied: i < 5 })),
      ...Array.from({ length: 10 }, (_, i) => ({ sentAt: at(11), replied: i < 1 })),
      ...Array.from({ length: 10 }, () => ({ sentAt: at(23), replied: true })),
    ];
    expect(suggestFollowUpHours(sends, 30)?.hours).toEqual([19, 20]);
  });
});
