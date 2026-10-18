import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de Réglages → IA de conversation : administrateur requis, journal sans la clé, activation journalisée,
// « Vérifier » sans aucun appel réseau réel (Venice simulé).
const m = vi.hoisted(() => {
  const config = {
    apiKeyEncrypted: null as string | null,
    activation: "off" as "off" | "team" | "all",
    defaultModel: "venice-uncensored-role-play",
    fallbackModel: "venice-uncensored-1-2",
    temperature: 0.85,
    maxTokens: 400,
    monthlyCapEur: 30,
    perConversationDailyLimit: 60,
    models: [] as unknown[],
    modelsFetchedAt: null as string | null,
    verifiedAt: null as string | null,
    lastError: null as string | null,
  };
  return {
    config,
    saved: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "ADMIN" })),
    verify: vi.fn(),
    list: vi.fn(),
  };
});

class Redirect extends Error {
  digest: string;
  constructor(readonly url: string) {
    super("NEXT_REDIRECT");
    this.digest = `NEXT_REDIRECT;${url}`;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@linkaffipro/db", () => ({
  audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
}));
vi.mock("@/lib/session", () => ({ requireAdmin: m.requireAdmin }));
vi.mock("@/lib/assistant/config", () => ({
  loadAssistantConfig: vi.fn(async () => ({ ...m.config })),
  loadAssistantApiKey: vi.fn(async () =>
    m.config.apiKeyEncrypted ? "VENICE_cle_en_clair_secrete" : null,
  ),
  saveAssistantConfig: vi.fn(async (patch: Record<string, unknown>) => {
    m.saved.push(patch);
    const { apiKey, ...rest } = patch;
    // Comme la vraie couche réglages : une nouvelle clé remet la vérification à zéro.
    Object.assign(
      m.config,
      rest,
      apiKey ? { apiKeyEncrypted: "chiffrée", verifiedAt: null, lastError: null } : {},
    );
    return { ...m.config };
  }),
}));
vi.mock("@linkaffipro/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linkaffipro/chat")>()),
  verifyVeniceKey: m.verify,
  listVeniceModels: m.list,
}));

import {
  removeAssistantKeyAction,
  saveAssistantSettingsAction,
  verifyAssistantKeyAction,
} from "./actions";

async function redirected(p: Promise<unknown>): Promise<URLSearchParams> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) {
      expect(err.url.startsWith("/settings/assistant?")).toBe(true);
      return new URLSearchParams(err.url.split("?")[1]);
    }
    throw err;
  }
  throw new Error("aucune redirection");
}

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values: Record<string, string> = {
    apiKey: "",
    activation: "off",
    defaultModel: "venice-uncensored-role-play",
    fallbackModel: "venice-uncensored-1-2",
    temperature: "0.85",
    maxTokens: "400",
    monthlyCapEur: "30",
    perConversationDailyLimit: "60",
    ...over,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const model = {
  id: "venice-uncensored-role-play",
  name: "Venice Role Play",
  inputUsdPerM: 0.5,
  outputUsdPerM: 2,
  maxCompletionTokens: 4096,
  contextLength: 32768,
  supportsResponseSchema: true,
  supportsReasoning: false,
  uncensored: true,
  offline: false,
  deprecated: false,
};

beforeEach(() => {
  Object.assign(m.config, {
    apiKeyEncrypted: null,
    activation: "off",
    models: [],
    modelsFetchedAt: null,
    verifiedAt: null,
    lastError: null,
  });
  m.saved.length = 0;
  m.audits.length = 0;
  m.verify.mockReset();
  m.list.mockReset();
  m.requireAdmin.mockClear();
});

describe("enregistrer les réglages", () => {
  it("nouvelle clé : chiffrée par la couche réglages, jamais dans le journal ; activation journalisée", async () => {
    const sp = await redirected(
      saveAssistantSettingsAction(
        form({ apiKey: "VENICE_cle_toute_neuve_123456", activation: "team" }),
      ),
    );
    expect(m.requireAdmin).toHaveBeenCalled();
    expect(sp.get("ok")).toMatch(/clé mise à jour/);
    expect(m.saved[0]).toMatchObject({
      apiKey: "VENICE_cle_toute_neuve_123456",
      activation: "team",
    });
    expect(m.audits.map((a) => a.action)).toEqual([
      "assistant.settings_saved",
      "assistant.activation_changed",
    ]);
    expect(m.audits[1]!.metadata).toEqual({ from: "off", to: "team" });
    expect(JSON.stringify(m.audits)).not.toContain("VENICE_cle_toute_neuve");
    expect(m.audits[0]!.metadata).toMatchObject({ keyChanged: true });
  });

  it("activer sans clé : refusé, rien n'est enregistré", async () => {
    const sp = await redirected(saveAssistantSettingsAction(form({ activation: "all" })));
    expect(sp.get("error")).toMatch(/Collez d'abord la clé Venice/);
    expect(m.saved).toEqual([]);
    expect(m.audits).toEqual([]);
  });

  it("valeur hors bornes : message clair, rien n'est enregistré", async () => {
    const sp = await redirected(saveAssistantSettingsAction(form({ temperature: "3" })));
    expect(sp.get("error")).toBe("Créativité des réponses : au plus 2.");
    expect(m.saved).toEqual([]);
  });

  it("même activation : un seul événement de journal", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.config.activation = "team";
    await redirected(
      saveAssistantSettingsAction(form({ activation: "team", monthlyCapEur: "50" })),
    );
    expect(m.audits.map((a) => a.action)).toEqual(["assistant.settings_saved"]);
    expect(m.audits[0]!.metadata).toMatchObject({ keyChanged: false, monthlyCapEur: 50 });
  });

  it("administrateur requis", async () => {
    m.requireAdmin.mockRejectedValueOnce(new Error("Action réservée aux administrateurs"));
    await expect(saveAssistantSettingsAction(form())).rejects.toThrow(/administrateurs/);
    expect(m.saved).toEqual([]);
  });
});

describe("Vérifier", () => {
  it("sans clé : message, aucun appel à Venice", async () => {
    const sp = await redirected(verifyAssistantKeyAction(form()));
    expect(sp.get("error")).toMatch(/Collez d'abord la clé Venice/);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.list).not.toHaveBeenCalled();
  });

  it("clé acceptée : date de vérification, modèles proposables gardés, solde affiché", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.verify.mockResolvedValue({ ok: true, balanceUsd: 12.3 });
    m.list.mockResolvedValue([model, { ...model, id: "retire", deprecated: true }]);
    const sp = await redirected(verifyAssistantKeyAction(form()));
    expect(m.verify).toHaveBeenCalledWith("VENICE_cle_en_clair_secrete");
    expect(sp.get("ok")).toMatch(/^Clé vérifiée : Venice l'accepte \(solde : 12,30\s\$/);
    expect(sp.get("ok")).toMatch(/1 modèle proposé\./);
    // Le modèle de repli n'est plus proposé : l'administrateur est prévenu.
    expect(sp.get("ok")).toMatch(/modèle de repli «\svenice-uncensored-1-2\s» n'est plus proposé/);
    const patch = m.saved[0]!;
    expect(patch.lastError).toBeNull();
    expect(typeof patch.verifiedAt).toBe("string");
    expect((patch.models as Array<{ id: string }>).map((x) => x.id)).toEqual([
      "venice-uncensored-role-play",
    ]);
    expect(m.audits[0]).toMatchObject({
      action: "assistant.key_verified",
      metadata: { ok: true, models: 1 },
    });
    expect(JSON.stringify(m.audits)).not.toContain("cle_en_clair");
  });

  it("clé refusée, liste des modèles injoignable : erreur gardée, ancienne liste conservée", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.verify.mockResolvedValue({
      ok: false,
      code: "auth",
      error: "Clé refusée par Venice : vérifiez-la.",
    });
    m.list.mockRejectedValue(new Error("réseau"));
    const sp = await redirected(verifyAssistantKeyAction(form()));
    expect(sp.get("error")).toMatch(/^Vérification refusée\. Clé refusée par Venice/);
    expect(sp.get("error")).toMatch(/liste des modèles n'a pas pu être relue/);
    expect(m.saved[0]).toEqual({ lastError: "Clé refusée par Venice : vérifiez-la." });
  });
});

describe("Vérifier une clé tout juste collée", () => {
  it("ancienne clé enregistrée, nouvelle collée : la nouvelle est enregistrée puis vérifiée (jamais l'ancienne)", async () => {
    m.config.apiKeyEncrypted = "ancienne-chiffrée";
    m.config.verifiedAt = "2026-10-01T10:00:00.000Z";
    m.verify.mockResolvedValue({ ok: true, balanceUsd: 5 });
    m.list.mockResolvedValue([model]);
    const sp = await redirected(
      verifyAssistantKeyAction(form({ apiKey: "  VENICE_nouvelle_cle_987654  " })),
    );
    expect(m.verify).toHaveBeenCalledTimes(1);
    expect(m.verify).toHaveBeenCalledWith("VENICE_nouvelle_cle_987654");
    expect(m.saved[0]).toEqual({ apiKey: "VENICE_nouvelle_cle_987654" });
    expect(m.config.apiKeyEncrypted).toBe("chiffrée");
    expect(typeof m.config.verifiedAt).toBe("string");
    expect(m.config.verifiedAt).not.toBe("2026-10-01T10:00:00.000Z");
    expect(sp.get("ok")).toMatch(/^Clé vérifiée/);
    expect(m.audits.map((a) => a.action)).toEqual([
      "assistant.settings_saved",
      "assistant.key_verified",
    ]);
    expect(m.audits[0]!.metadata).toEqual({ keyChanged: true, via: "verify" });
    expect(m.audits[1]!.metadata).toMatchObject({ ok: true, keyChanged: true });
    expect(JSON.stringify(m.audits)).not.toContain("nouvelle_cle");
  });

  it("aucune clé enregistrée : la clé collée suffit (pas besoin d'« Enregistrer » avant)", async () => {
    m.verify.mockResolvedValue({ ok: true });
    m.list.mockResolvedValue([model]);
    const sp = await redirected(
      verifyAssistantKeyAction(form({ apiKey: "VENICE_premiere_cle_123456" })),
    );
    expect(m.verify).toHaveBeenCalledWith("VENICE_premiere_cle_123456");
    expect(sp.get("ok")).toMatch(/^Clé vérifiée/);
  });

  it("clé collée mal formée : message clair, rien n'est enregistré ni envoyé à Venice", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    const sp = await redirected(verifyAssistantKeyAction(form({ apiKey: "deux mots" })));
    expect(sp.get("error")).toMatch(/sans espace/);
    expect(m.saved).toEqual([]);
    expect(m.verify).not.toHaveBeenCalled();
  });
});

describe("Vérifier : échec passager", () => {
  it("Venice en panne : ni refus ni date effacée enregistrés, message « réessayez »", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.config.verifiedAt = "2026-10-01T10:00:00.000Z";
    m.verify.mockResolvedValue({
      ok: false,
      code: "server",
      error: "Venice ne répond pas pour l'instant : réessayez dans quelques minutes.",
    });
    m.list.mockResolvedValue([model]);
    const sp = await redirected(verifyAssistantKeyAction(form()));
    expect(sp.get("error")).toMatch(
      /^Vérification impossible pour l'instant \(la clé n'est pas en cause\)/,
    );
    expect(sp.get("error")).not.toMatch(/refus/);
    // Seule la liste des modèles est enregistrée : l'état de la clé reste tel quel.
    expect(m.saved).toHaveLength(1);
    expect(m.saved[0]).not.toHaveProperty("lastError");
    expect(m.saved[0]).not.toHaveProperty("verifiedAt");
    expect(m.config.lastError).toBeNull();
    expect(m.config.verifiedAt).toBe("2026-10-01T10:00:00.000Z");
    expect(m.audits[0]).toMatchObject({
      action: "assistant.key_verified",
      metadata: { ok: false, transient: true },
    });
  });

  it("délai dépassé et liste injoignable : rien n'est enregistré du tout", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.verify.mockResolvedValue({
      ok: false,
      code: "timeout",
      error: "Venice injoignable : réessayez dans quelques minutes.",
    });
    m.list.mockRejectedValue(new Error("délai"));
    const sp = await redirected(verifyAssistantKeyAction(form()));
    expect(sp.get("error")).toMatch(/^Vérification impossible pour l'instant/);
    expect(m.saved).toEqual([]);
  });

  it("vrai refus (solde vide) : enregistré comme refus", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.verify.mockResolvedValue({ ok: false, code: "balance", error: "Solde Venice vide." });
    m.list.mockResolvedValue(null);
    const sp = await redirected(verifyAssistantKeyAction(form()));
    expect(sp.get("error")).toMatch(/^Vérification refusée\. Solde Venice vide/);
    expect(m.saved[0]).toEqual({ lastError: "Solde Venice vide." });
  });
});

describe("Retirer la clé", () => {
  it("désactive l'assistant et le journalise", async () => {
    m.config.apiKeyEncrypted = "chiffrée";
    m.config.activation = "all";
    const sp = await redirected(removeAssistantKeyAction());
    expect(sp.get("ok")).toMatch(/désactivé/);
    expect(m.saved[0]).toEqual({
      apiKeyEncrypted: null,
      verifiedAt: null,
      lastError: null,
      activation: "off",
    });
    expect(m.audits.map((a) => a.action)).toEqual([
      "assistant.key_removed",
      "assistant.activation_changed",
    ]);
  });
});
