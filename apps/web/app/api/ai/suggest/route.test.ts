import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient, AiMessageRequest } from "@linkaffipro/ai";

// Base, session, réglages et compteurs simulés : aucune base, aucun appel réseau.
const mocks = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  return {
    rows,
    audits,
    user: { id: "u1", role: "MANAGER" as const } as {
      id: string;
      role: "ADMIN" | "MANAGER";
    } | null,
    config: {
      apiKeyEncrypted: "enc",
      defaultModel: "claude-haiku-5-5",
      qualityModel: "claude-sonnet-5-5",
      monthlyCapEur: 20,
      perUserDailyLimit: 50,
      riskNotice: {
        casino: "Jouer comporte des risques : endettement, isolement, dépendance.",
        sports: "Jouer comporte des risques : endettement, isolement, dépendance.",
      },
      verifiedAt: null,
      lastError: null,
    },
    apiKey: "sk-ant-test" as string | null,
    spent: 0,
    today: 0,
  };
});

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    aiSuggestion: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `s${mocks.rows.length + 1}`, ...data };
        mocks.rows.push(row);
        return { id: row.id };
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => {
    mocks.audits.push(a);
  }),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@/lib/ai/api-user", () => ({ apiUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/ai/config", () => ({
  loadAiConfig: vi.fn(async () => mocks.config),
  loadAiApiKey: vi.fn(async () => mocks.apiKey),
  saveAiConfig: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/examples", () => ({ loadBestExamples: vi.fn(async () => []) }));
vi.mock("@/lib/ai/usage", () => ({
  monthCostEur: vi.fn(async () => mocks.spent),
  userDailyCount: vi.fn(async () => mocks.today),
}));

import { setAiClientFactory } from "@/lib/ai/client";
import { POST } from "./route";

const usage = { inputTokens: 1200, outputTokens: 400, cachedTokens: 0, cacheWriteTokens: 0 };
const good = JSON.stringify({
  versions: [
    { text: "Salut {prenom} ! Découvre l'offre du jour.", why: "Plus direct." },
    { text: "{prenom}, l'offre du jour est là.", why: "Plus court." },
    { text: "Envie d'essayer, {prenom} ?", why: "Question." },
  ],
});

function fakeClient(
  text = good,
  stopReason = "end_turn",
): AiClient & { calls: AiMessageRequest[] } {
  const calls: AiMessageRequest[] = [];
  return {
    calls,
    async createMessage(req) {
      calls.push(req);
      return { text, usage, stopReason };
    },
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/ai/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const body = {
  kind: "improve",
  text: "Salut {prenom}, l'offre du jour est ouverte.",
  context: { vertical: "DATING", surface: "post", language: "fr" },
};

let client: ReturnType<typeof fakeClient>;
let factoryCalls: string[];
beforeEach(() => {
  mocks.rows.length = 0;
  mocks.audits.length = 0;
  mocks.user = { id: "u1", role: "MANAGER" };
  mocks.apiKey = "sk-ant-test";
  mocks.spent = 0;
  mocks.today = 0;
  client = fakeClient();
  factoryCalls = [];
  setAiClientFactory((key) => {
    factoryCalls.push(key);
    return client;
  });
});
afterEach(() => setAiClientFactory(null));

describe("POST /api/ai/suggest", () => {
  it("401 sans session", async () => {
    mocks.user = null;
    expect((await post(body)).status).toBe(401);
    expect(factoryCalls).toEqual([]);
  });
  it("428 sans clé, sans aucun appel à l'IA", async () => {
    mocks.apiKey = null;
    const res = await post(body);
    expect(res.status).toBe(428);
    expect(((await res.json()) as { code: string }).code).toBe("no_key");
    expect(factoryCalls).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });
  it("402 quand le plafond mensuel est atteint", async () => {
    mocks.spent = 20;
    const res = await post(body);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe("cap");
    expect(client.calls).toHaveLength(0);
  });
  it("429 quand la limite par personne et par jour est atteinte", async () => {
    mocks.today = 50;
    const res = await post(body);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("limit");
    expect(client.calls).toHaveLength(0);
  });
  it("succès : 3 versions, une ligne AiSuggestion avec usage et coût, journal d'audit", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      id: string;
      versions: unknown[];
      model: string;
      costEur: number;
    };
    expect(data.versions).toHaveLength(3);
    expect(data.model).toBe("claude-haiku-5-5");
    expect(factoryCalls).toEqual(["sk-ant-test"]);
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0]).toMatchObject({
      id: data.id,
      userId: "u1",
      kind: "improve",
      model: "claude-haiku-5-5",
      inputTokens: 1200,
      outputTokens: 400,
      input: body.text,
    });
    expect(Number(mocks.rows[0]!.costEur)).toBeGreaterThan(0);
    expect(mocks.audits.map((a) => a.action)).toEqual(["ai.suggestion_created"]);
  });
  it("modèle « qualité supérieure » sur demande", async () => {
    const res = await post({ ...body, quality: true });
    expect(((await res.json()) as { model: string }).model).toBe("claude-sonnet-5-5");
    expect(client.calls[0]!.model).toBe("claude-sonnet-5-5");
  });
  it("réponse coupée : message lisible, coût compté dans le plafond (ligne sans version), un seul appel", async () => {
    client = fakeClient('{"versions": [{"text": "coupé', "max_tokens");
    const res = await post(body);
    expect(res.status).toBe(422);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe("too_long");
    expect(data.error).toMatch(/Court/);
    expect(client.calls).toHaveLength(1);
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0]).toMatchObject({ outputs: [], inputTokens: 1200, outputTokens: 400 });
    expect(mocks.audits.map((a) => a.action)).toEqual(["ai.suggestion_failed"]);
  });
  it("400 sur un corps invalide", async () => {
    expect((await post({ kind: "inconnu", text: "x" })).status).toBe(400);
  });
});
