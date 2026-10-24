// Casino / Paris sportifs côté worker (phase 25) : persona du moteur (identité imposée, fiche d'informations), silence
// de l'assistante quand la conversation est à traiter, enregistrement du passage à un humain, alerte groupée 30 min.
import type { TurnResult } from "@linkaffipro/chat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setting: null as null | { value: unknown },
  rows: [] as unknown[],
  upserts: [] as unknown[],
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async () => h.setting),
      upsert: vi.fn(async (a: unknown) => {
        h.upserts.push(a);
        return a;
      }),
    },
    conversation: { findMany: vi.fn(async () => h.rows) },
  },
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/queue", () => ({ getRedis: () => ({}) }));
vi.mock("@linkaffipro/telegram", () => ({ notifyAdmin: vi.fn(async () => true) }));

import { planNeedsHumanDigest, runNeedsHumanDigest, type DigestDeps } from "./needs-human-digest";
import { planTurnPersistence, precheck, reconcileTurnPlan, toPersonaInput, type PersonaRow, type PrecheckInput } from "./rules";

const persona: PersonaRow = {
  name: "Jade",
  gender: "F",
  personality: "",
  tone: "",
  languages: ["fr"],
  interests: [],
  extraPrompt: null,
  model: null,
  temperature: null,
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  followUpAfterHours: 24,
  followUpsMax: 2,
  affiliateCampaignId: "off1",
  offerPitch: "Bonus",
  offerButtonText: "Découvrir l'app",
  offerMediaAssetId: null,
};
const extras = { offerUsable: true, channelTitle: null, botName: null };

describe("persona Casino / Paris pour le moteur", () => {
  it("GIRL enregistré par erreur : ASSISTANT ; fiche d'informations nettoyée", () => {
    const p = toPersonaInput(
      { ...persona, identityKind: "GIRL", illusion: true, universe: "casino", faq: [{ q: " Bonus ? ", a: "200 €" }, { q: "" }] },
      extras,
    );
    expect(p).toMatchObject({ identity: "ASSISTANT", universe: "casino", faq: [{ q: "Bonus ?", a: "200 €" }] });
  });

  it("Rencontres inchangé : GIRL gardé, univers dating, fiche vide", () => {
    expect(toPersonaInput({ ...persona, identityKind: "GIRL" }, extras)).toMatchObject({
      identity: "GIRL",
      universe: "dating",
      faq: [],
    });
  });
});

describe("conversation à traiter : silence de l'assistante", () => {
  const ok: PrecheckInput = {
    bot: { mode: "ASSISTANT", isActive: true },
    persona: { isActive: true },
    activation: "all",
    isTeamMember: false,
    conversation: { status: "BOT", stoppedAt: null, isMinor: false },
    blocked: false,
    assistantMessagesToday: 0,
    dailyLimit: 60,
    monthSpendEur: 0,
    monthlyCapEur: 30,
  };
  const at = new Date("2026-10-24T10:00:00Z");
  it("argent, réclamation, insulte : plus de réponse ni de relance jusqu'à la reprise", () => {
    for (const reason of ["money", "complaint", "insult", "minor"])
      expect(
        precheck({ ...ok, conversation: { ...ok.conversation, needsHumanAt: at, needsHumanReason: reason } }),
      ).toMatchObject({ ok: false, reason: "needs_human" });
  });
  it("question hors fiche : l'assistante continue ; reprise faite (null) : elle répond", () => {
    expect(precheck({ ...ok, conversation: { ...ok.conversation, needsHumanAt: at, needsHumanReason: "off_faq" } })).toEqual({ ok: true });
    expect(precheck({ ...ok, conversation: { ...ok.conversation, needsHumanAt: null, needsHumanReason: "money" } })).toEqual({ ok: true });
  });
});

describe("enregistrement du passage à un humain", () => {
  const now = new Date("2026-10-24T10:00:00Z");
  const before = { stage: "CHAT" as const, followUpCount: 0 };
  const result = (over: Partial<TurnResult> = {}): TurnResult => ({
    outcome: "replied",
    sent: [{ index: 0, text: "Je transmets", offerSubId: null, mediaAssetId: null, fixedKey: "handoff" }],
    newStage: "CHAT",
    stageChanges: [],
    style: {},
    facts: [],
    offerSent: null,
    events: [{ type: "needs_human", payload: { reason: "money", source: "code" } }],
    language: "fr",
    model: null,
    rejected: [],
    note: null,
    inboundUsed: [{ id: "in1", text: "x" }],
    deferredInbound: [],
    followUpCount: 0,
    nextFollowUpAt: null,
    neutralSent: false,
    closeReason: null,
    sendError: null,
    unsentOfferSubId: null,
    needsHuman: { reason: "money", source: "code" },
    ...over,
  });

  it("motif posé, ni relance ni nouvel essai, événement sans texte", () => {
    const plan = planTurnPersistence({ kind: "reply", before, result: result(), now });
    expect(plan.patch).toMatchObject({ needsHuman: "money", nextFollowUpAt: null, retryAt: null });
    expect(plan.events).toEqual([{ type: "needs_human", payload: { reason: "money", source: "code", kind: "reply" } }]);
  });

  it("reprise par l'équipe pendant le tour : rien à signaler", () => {
    const plan = planTurnPersistence({ kind: "reply", before, result: result(), now });
    const r = reconcileTurnPlan(plan, before, { status: "HUMAN", stoppedAt: null, stage: "CHAT", reset: false });
    expect(r.patch.needsHuman).toBeUndefined();
  });
});

describe("alerte groupée des conversations à traiter", () => {
  const now = new Date("2026-10-24T10:00:00Z");
  const row = (id: string, minutesAgo: number, reason: string) => ({
    id,
    needsHumanAt: new Date(now.getTime() - minutesAgo * 60_000),
    needsHumanReason: reason,
    personaName: "Jade <VIP>",
    universe: "casino",
  });

  it("une ligne par conversation, sans texte de conversation, lien vers la conversation", () => {
    const plan = planNeedsHumanDigest({
      now,
      state: { lastSentAt: null, watermark: null },
      rows: [row("c2", 1, "insult"), row("c1", 5, "money")],
      baseUrl: "https://app.linkaffipro.com/",
    });
    expect(plan?.count).toBe(2);
    expect(plan?.text.split("\n")).toEqual([
      "<b>Conversations à traiter</b> (2)",
      '• Jade &lt;VIP&gt; (Casino) : Demande d\'argent — <a href="https://app.linkaffipro.com/conversations/c1">ouvrir</a>',
      '• Jade &lt;VIP&gt; (Casino) : Insulte — <a href="https://app.linkaffipro.com/conversations/c2">ouvrir</a>',
      "Prends la main depuis la conversation pour répondre.",
    ]);
    expect(plan?.watermark).toEqual(row("c2", 1, "insult").needsHumanAt);
  });

  it("au plus toutes les 30 minutes ; déjà signalées jamais redites", () => {
    const rows = [row("c1", 5, "money")];
    expect(
      planNeedsHumanDigest({ now, state: { lastSentAt: new Date(now.getTime() - 29 * 60_000), watermark: null }, rows, baseUrl: "x" }),
    ).toBeNull();
    expect(
      planNeedsHumanDigest({ now, state: { lastSentAt: new Date(now.getTime() - 31 * 60_000), watermark: null }, rows, baseUrl: "x" }),
    ).not.toBeNull();
    expect(
      planNeedsHumanDigest({ now, state: { lastSentAt: null, watermark: rows[0]!.needsHumanAt }, rows, baseUrl: "x" }),
    ).toBeNull();
  });

  describe("passage complet", () => {
    let deps: DigestDeps & { sent: string[]; window: boolean };
    beforeEach(() => {
      h.setting = null;
      h.upserts = [];
      h.rows = [{ id: "c1", needsHumanAt: new Date(now.getTime() - 60_000), needsHumanReason: "complaint", persona: { name: "Jade", universe: "sports" } }];
      const d = {
        sent: [] as string[],
        window: false,
        notify: async (t: string) => {
          d.sent.push(t);
          return true;
        },
        acquireWindow: async () => {
          if (d.window) return false;
          d.window = true;
          return true;
        },
        releaseWindow: async () => {
          d.window = false;
        },
        baseUrl: "https://app.linkaffipro.com",
      };
      deps = d;
    });

    it("envoie une fois, mémorise le repère, puis se tait pendant 30 min", async () => {
      expect(await runNeedsHumanDigest(now, deps)).toBe(1);
      expect(deps.sent[0]).toContain("Paris sportifs");
      expect(deps.sent[0]).toContain("Réclamation");
      expect(h.upserts).toHaveLength(1);
      h.setting = { value: (h.upserts[0] as { create: { value: unknown } }).create.value };
      expect(await runNeedsHumanDigest(new Date(now.getTime() + 60_000), deps)).toBe(0);
      expect(deps.sent).toHaveLength(1);
    });

    it("envoi impossible : la fenêtre est rendue pour le passage suivant", async () => {
      deps.notify = async () => false;
      expect(await runNeedsHumanDigest(now, deps)).toBe(0);
      expect(deps.window).toBe(false);
      expect(h.upserts).toHaveLength(0);
    });
  });
});
