/**
 * Phase 31 — l'IA de lecture des canaux vient de Réglages → IA quand le worker n'en fournit pas (comme le dossier et
 * les réponses de Kevin). Sans clé : erreur claire `no_ai`, jamais d'appel.
 */
import { describe, expect, it } from "vitest";
import { callEnrichLlm, EnrichAiError, type EnrichDeps } from "./ai";

function depsWith(aiConfig: unknown, extra: Partial<EnrichDeps> = {}): EnrichDeps {
  const settings = new Map<string, unknown>(aiConfig === undefined ? [] : [["ai.config", aiConfig]]);
  return {
    prisma: {
      setting: { findUnique: async ({ where }: { where: { key: string } }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null) },
      agentUsage: { findMany: async () => [], upsert: async () => ({}) },
    },
    providers: { llm: { fake: true, complete: async () => ({ text: "faux", costCents: 0 }) } },
    ...extra,
  } as unknown as EnrichDeps;
}

describe("IA de lecture des canaux", () => {
  it("sans clé dans Réglages → IA ni IA fournie : no_ai, le faux fournisseur n'est jamais pris", async () => {
    const err = await callEnrichLlm(depsWith(undefined), { model: "m", system: "s", messages: [] } as never, "la lecture du canal").catch((e) => e);
    expect(err).toBeInstanceOf(EnrichAiError);
    expect((err as EnrichAiError).code).toBe("no_ai");
  });

  it("clé illisible : no_ai", async () => {
    const err = await callEnrichLlm(depsWith({ apiKeyEncrypted: "pas-chiffre" }), { model: "m", system: "s", messages: [] } as never, "la lecture").catch((e) => e);
    expect((err as EnrichAiError).code).toBe("no_ai");
  });

  it("IA fournie par le worker : utilisée et comptée", async () => {
    const calls: unknown[] = [];
    const deps = depsWith(undefined, { prospectionLlm: { complete: async (r: unknown) => (calls.push(r), { text: "ok", costCents: 2 }) } as never });
    expect(await callEnrichLlm(deps, { model: "m", system: "s", messages: [] } as never, "la lecture")).toBe("ok");
    expect(calls).toHaveLength(1);
  });
});
