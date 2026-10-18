import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ASSISTANT_CONFIG,
  createFakeLlm,
  fakePersona,
  type FakeLlm,
  type PersonaInput,
} from "@linkaffipro/chat";

// Bouton « Tester » : base, session, réglages et dépense simulés ; faux client Venice injecté par la fabrique (aucun
// appel réseau) ; aucun accès à Telegram (la route n'en importe rien).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "MANAGER" } as { id: string; role: "ADMIN" | "MANAGER" } | null,
  persona: null as { input: PersonaInput; offerLinked: boolean } | null,
  config: {} as Record<string, unknown>,
  apiKey: "VENICE_cle_secrete" as string | null,
  spent: [0] as number[],
  recent: 0,
  usages: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  countWhere: [] as unknown[],
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    auditLog: {
      count: vi.fn(async (args: unknown) => {
        m.countWhere.push(args);
        return m.recent;
      }),
    },
    aiConversationUsage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        m.usages.push(data);
        return { id: `u${m.usages.length}` };
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
}));
vi.mock("@/lib/ai/api-user", () => ({ apiUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/assistant/config", () => ({
  loadAssistantConfig: vi.fn(async () => m.config),
  loadAssistantApiKey: vi.fn(async () => m.apiKey),
}));
vi.mock("@/lib/assistant/usage", () => ({
  // Dépense du mois : une valeur par lecture (la dernière se répète).
  monthCostEur: vi.fn(async () => (m.spent.length > 1 ? m.spent.shift()! : m.spent[0]!)),
}));
vi.mock("@/lib/personas/queries", () => ({
  loadPersonaTurnInput: vi.fn(async () => m.persona),
}));

import {
  TEST_SLOT_WINDOW_MS,
  memoryTestSlotStore,
  setTestSlotStore,
  type TestSlotStore,
} from "@/lib/personas/test-limit";
import { setVeniceClientFactory } from "@/lib/personas/venice-client";
import { POST } from "./route";

let llm: FakeLlm;
let keys: string[];
let slots: TestSlotStore;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/assistant/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const intro = { messages: ["Coucou ! Moi c'est Léa, l'assistante du canal 😉 Tu vas bien ?"] };

beforeEach(() => {
  m.user = { id: "u1", role: "MANAGER" };
  m.persona = { input: fakePersona({ name: "Léa" }), offerLinked: true };
  m.config = { ...DEFAULT_ASSISTANT_CONFIG, apiKeyEncrypted: "chiffrée", monthlyCapEur: 30 };
  m.apiKey = "VENICE_cle_secrete";
  m.spent = [0];
  m.recent = 0;
  m.usages.length = 0;
  m.audits.length = 0;
  m.countWhere.length = 0;
  llm = createFakeLlm([intro], { usage: { inputTokens: 900, outputTokens: 80 } });
  keys = [];
  setVeniceClientFactory((key) => {
    keys.push(key);
    return llm;
  });
  // Places d'essai : magasin en mémoire neuf (aucun Redis).
  slots = memoryTestSlotStore();
  setTestSlotStore(slots);
});
afterEach(() => {
  setVeniceClientFactory(null);
  setTestSlotStore(null);
});

describe("POST /api/assistant/test", () => {
  it("refuse sans session", async () => {
    m.user = null;
    expect((await post({ personaId: "p1", message: "salut" })).status).toBe(401);
    expect(llm.calls).toBe(0);
  });

  it("refuse une demande invalide (historique trop long, message vide, persona absente)", async () => {
    expect((await post("pas du json")).status).toBe(400);
    expect(
      (
        await post({
          personaId: "p1",
          message: "salut",
          history: Array.from({ length: 41 }, () => ({ from: "person", text: "x" })),
        })
      ).status,
    ).toBe(400);
    expect((await post({ personaId: "p1", message: "   " })).status).toBe(400);
    m.persona = null;
    expect((await post({ personaId: "p1", message: "salut" })).status).toBe(404);
    expect(llm.calls).toBe(0);
  });

  it("sans clé Venice : refus clair, aucun appel", async () => {
    m.apiKey = null;
    const res = await post({ personaId: "p1", message: "salut" });
    expect(res.status).toBe(428);
    expect((await res.json()).error).toBe(
      "Collez d'abord la clé Venice dans Réglages → IA de conversation (administrateurs).",
    );
    expect(llm.calls).toBe(0);
  });

  it("plafond mensuel atteint : refus avant tout appel", async () => {
    m.spent = [30];
    const res = await post({ personaId: "p1", message: "salut" });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("cap");
    expect(llm.calls).toBe(0);
  });

  it("limite de 30 messages d'essai par heure et par personne (comptés dans le journal)", async () => {
    m.recent = 30;
    const res = await post({ personaId: "p1", message: "salut" });
    expect(res.status).toBe(429);
    expect(llm.calls).toBe(0);
    expect(m.countWhere[0]).toMatchObject({
      where: { userId: "u1", action: "persona.tested" },
    });
  });

  it("demandes simultanées : la place est réservée avant l'appel, jamais plus de 30 essais par heure", async () => {
    // 29 essais dans l'heure (journal et places), puis 10 demandes parties en même temps.
    m.recent = 29;
    for (let i = 0; i < 29; i++) await slots.reserve("u1", Date.now(), 30, TEST_SLOT_WINDOW_MS);
    llm = createFakeLlm(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return intro;
    });
    const res = await Promise.all(
      Array.from({ length: 10 }, () => post({ personaId: "p1", message: "salut" })),
    );
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 429)).toHaveLength(9);
    expect(llm.calls).toBe(1);
    expect(m.usages).toHaveLength(1);
  });

  it("place réservée pour chaque essai : la 31e demande de l'heure est refusée même si le journal est en retard", async () => {
    m.recent = 0;
    for (let i = 0; i < 30; i++) await slots.reserve("u1", Date.now(), 30, TEST_SLOT_WINDOW_MS);
    const res = await post({ personaId: "p1", message: "salut" });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("limit");
    expect(llm.calls).toBe(0);
    // Une autre personne de l'équipe garde ses propres places.
    m.user = { id: "u2", role: "ADMIN" };
    expect((await post({ personaId: "p1", message: "salut" })).status).toBe(200);
  });

  it("aucune place prise quand l'essai est refusé avant l'IA (clé absente, plafond atteint)", async () => {
    m.apiKey = null;
    await post({ personaId: "p1", message: "salut" });
    m.apiKey = "VENICE_cle_secrete";
    m.spent = [30];
    await post({ personaId: "p1", message: "salut" });
    m.spent = [0];
    for (let i = 0; i < 29; i++) await slots.reserve("u1", Date.now(), 30, TEST_SLOT_WINDOW_MS);
    expect((await post({ personaId: "p1", message: "salut" })).status).toBe(200);
  });

  it("conversation d'essai fermée (moins de 18 ans) : « Recommencer »", async () => {
    const res = await post({
      personaId: "p1",
      message: "salut",
      state: { stage: "CLOSED", closed: true },
    });
    expect(res.status).toBe(409);
    expect(llm.calls).toBe(0);
  });

  it("répond avec la vraie clé et le vrai moteur ; coût enregistré en TEST, sans conversation ; journal sans texte", async () => {
    const res = await post({ personaId: "p1", message: "salut, tu fais quoi ?" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(keys).toEqual(["VENICE_cle_secrete"]);
    expect(llm.calls).toBe(1);
    expect(body.outcome).toBe("replied");
    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].text).toContain("l'assistante du canal");
    expect(body.state).toMatchObject({ stage: "WELCOME", assistantTurns: 1, closed: false });
    expect(m.usages).toHaveLength(1);
    expect(m.usages[0]).toMatchObject({
      personaId: "p1",
      conversationId: null,
      purpose: "TEST",
      inputTokens: 900,
      outputTokens: 80,
      ok: true,
    });
    expect(Number(m.usages[0]!.costEur)).toBeGreaterThan(0);
    expect(m.audits).toHaveLength(1);
    expect(m.audits[0]).toMatchObject({
      userId: "u1",
      action: "persona.tested",
      entityType: "Persona",
      entityId: "p1",
    });
    const logged = JSON.stringify(m.audits[0]);
    expect(logged).not.toContain("salut");
    expect(logged).not.toContain("Coucou");
    expect(logged).not.toContain("VENICE_cle_secrete");
  });

  it("le message et l'historique envoyés à l'IA : ceux renvoyés par la page", async () => {
    llm = createFakeLlm([{ messages: ["Haha, et toi alors ?"] }]);
    const res = await post({
      personaId: "p1",
      message: "je regarde une série",
      history: [
        { from: "person", text: "salut" },
        { from: "assistant", text: "Moi c'est Léa, l'assistante du canal 😉" },
      ],
      state: { stage: "WELCOME", assistantTurns: 1 },
    });
    expect(res.status).toBe(200);
    const sent = llm.requests[0]!.messages;
    expect(sent[0]!.role).toBe("system");
    expect(sent.slice(1).map((x) => [x.role, x.content])).toEqual([
      ["user", "salut"],
      ["assistant", "Moi c'est Léa, l'assistante du canal 😉"],
      ["user", "je regarde une série"],
    ]);
    expect((await res.json()).state.stage).toBe("CHAT");
  });

  it("plafond atteint entre deux appels : vérifié avant CHAQUE appel à l'IA", async () => {
    // 1re lecture (avant le tour) : 0 € ; ensuite : plafond atteint.
    m.spent = [0, 30];
    const res = await post({ personaId: "p1", message: "salut" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("skipped_cap");
    expect(llm.calls).toBe(0);
    expect(body.notice.text).toMatch(/Plafond mensuel atteint/);
  });
});
