import { describe, expect, it } from "vitest";
import type { VeniceModelInfo } from "@linkaffipro/chat";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import {
  ACTIVATION_LABELS,
  ACTIVATION_OPTIONS,
  activationView,
  assistantCapUsage,
  assistantKeyView,
  modelOptions,
  modelPriceLabel,
  modelsFetchedLabel,
} from "./assistant-view";
import { parseAssistantForm } from "./assistant-form";

const base = { hasKey: true, keyHint: "VENI…WXYZ", verifiedAt: null, lastError: null };

function model(id: string, over: Partial<VeniceModelInfo> = {}): VeniceModelInfo {
  return {
    id,
    name: id,
    inputUsdPerM: 1,
    outputUsdPerM: 2,
    maxCompletionTokens: 4096,
    contextLength: 32768,
    supportsResponseSchema: true,
    supportsReasoning: false,
    uncensored: false,
    offline: false,
    deprecated: false,
    ...over,
  };
}

describe("Réglages → IA de conversation : état de la clé", () => {
  it("sans clé : personne ne reçoit de réponse, pastille grise", () => {
    const v = assistantKeyView({ ...base, hasKey: false, keyHint: null });
    expect(v.status).toBe("missing");
    expect(v.tone).toBe("muted");
    expect(v.sentence).toMatch(/ne peut répondre à personne/);
  });

  it("clé enregistrée : à vérifier (gratuit), avec l'indice, jamais la clé", () => {
    const v = assistantKeyView(base);
    expect(v.status).toBe("unverified");
    expect(v.sentence).toContain("VENI…WXYZ");
    expect(v.sentence).toContain("«\u00a0Vérifier\u00a0»");
    expect(v.sentence).toMatch(/ne coûte rien/);
  });

  it("vérifiée : date ; un refus récent l'emporte", () => {
    expect(assistantKeyView({ ...base, verifiedAt: "2026-10-18T10:00:00.000Z" })).toMatchObject({
      status: "verified",
      tone: "success",
    });
    const refused = assistantKeyView({
      ...base,
      verifiedAt: "2026-10-01T10:00:00.000Z",
      lastError: "Solde Venice vide : ajoutez des crédits.",
    });
    expect(refused.status).toBe("refused");
    expect(refused.alert).toBe("destructive");
    expect(refused.sentence).toMatch(/^Solde Venice vide/);
  });
});

describe("activation", () => {
  it("trois choix, désactivé en premier", () => {
    expect(ACTIVATION_OPTIONS).toEqual([
      { value: "off", label: "Désactivé" },
      { value: "team", label: "Seulement l'équipe (essai)" },
      { value: "all", label: "Tout le monde" },
    ]);
    expect(Object.keys(ACTIVATION_LABELS)).toEqual(["off", "team", "all"]);
  });

  it("pastille et phrase selon le choix", () => {
    expect(activationView("off")).toMatchObject({ pill: "Désactivé", tone: "muted" });
    expect(activationView("team").sentence).toMatch(/comptes Telegram de l'équipe/);
    expect(activationView("all")).toMatchObject({ tone: "success" });
    expect(activationView("all").sentence).toMatch(/d'elles-mêmes/);
  });
});

describe("listes de modèles", () => {
  const models = [
    model("cher", { name: "Gros modèle", inputUsdPerM: 3, outputUsdPerM: 12 }),
    model("venice-uncensored-role-play", {
      name: "Venice Role Play",
      inputUsdPerM: 0.5,
      outputUsdPerM: 2,
    }),
    model("retire", { deprecated: true }),
    model("sans-prix", { inputUsdPerM: null, outputUsdPerM: null }),
  ];

  it("modèles proposables avec leurs prix, du moins cher au plus cher", () => {
    const opts = modelOptions(models, "venice-uncensored-role-play");
    expect(opts.map((o) => o.value)).toEqual(["venice-uncensored-role-play", "cher", "sans-prix"]);
    expect(opts[0]!.label).toMatch(
      /^Venice Role Play \(venice-uncensored-role-play\) — lu 0,50\s\$ · écrit 2,00\s\$ par million de jetons$/,
    );
    expect(opts[2]!.label).toBe("sans-prix — prix inconnu");
  });

  it("la valeur actuelle est gardée même absente de la liste (modèle retiré, liste vide)", () => {
    const opts = modelOptions(models, "retire");
    expect(opts[0]).toEqual({
      value: "retire",
      label: "retire — modèle actuel, absent de la liste",
      missing: true,
    });
    expect(modelOptions([], "venice-uncensored-1-2")).toEqual([
      {
        value: "venice-uncensored-1-2",
        label: "venice-uncensored-1-2 — modèle actuel, absent de la liste",
        missing: true,
      },
    ]);
  });

  it("prix inconnu ; date de la dernière lecture", () => {
    expect(modelPriceLabel({ inputUsdPerM: null, outputUsdPerM: 1 })).toBe("prix inconnu");
    expect(modelsFetchedLabel(null)).toMatch(/«\sVérifier\s»/);
    expect(modelsFetchedLabel("2026-10-18T10:00:00.000Z")).toMatch(
      /^Liste des modèles relue le 18\/10\/2026/,
    );
  });
});

describe("plafond mensuel", () => {
  it("part utilisée et nuance de la barre", () => {
    expect(assistantCapUsage(3, 30)).toMatchObject({ pct: 10, tone: "brand" });
    expect(assistantCapUsage(24, 30)).toMatchObject({ pct: 80, tone: "warning" });
    expect(assistantCapUsage(40, 30)).toMatchObject({ pct: 100, tone: "danger" });
    expect(assistantCapUsage(40, 30).sentence).toMatch(/ne répond plus jusqu'au mois prochain/);
  });

  it("plafond à 0 € : aucun appel (contrairement à l'assistant d'écriture)", () => {
    const c = assistantCapUsage(0, 0);
    expect(c.tone).toBe("danger");
    expect(c.sentence).toMatch(/aucun appel/);
  });
});

describe("formulaire", () => {
  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    const values: Record<string, string> = {
      apiKey: "",
      activation: "team",
      defaultModel: "venice-uncensored-role-play",
      fallbackModel: "venice-uncensored-1-2",
      temperature: "0,85",
      maxTokens: "400",
      monthlyCapEur: "30",
      perConversationDailyLimit: "60",
      ...over,
    };
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return parseAssistantForm(fd);
  };

  it("valeurs du contrat ; virgule décimale ; clé vide = inchangée", () => {
    const r = form();
    expect(r).toEqual({
      ok: true,
      data: {
        activation: "team",
        defaultModel: "venice-uncensored-role-play",
        fallbackModel: "venice-uncensored-1-2",
        temperature: 0.85,
        maxTokens: 400,
        monthlyCapEur: 30,
        perConversationDailyLimit: 60,
      },
    });
    const withKey = form({ apiKey: "  VENICE_abcdefghijklmnopqrstuvwxyz  " });
    expect(withKey.ok && withKey.data.apiKey).toBe("VENICE_abcdefghijklmnopqrstuvwxyz");
  });

  it("bornes et messages en français simple", () => {
    const err = (over: Record<string, string>) => {
      const r = form(over);
      return r.ok ? null : r.error;
    };
    expect(err({ temperature: "2,5" })).toBe("Créativité des réponses : au plus 2.");
    expect(err({ maxTokens: "10" })).toBe("Longueur maximale des réponses : au moins 64.");
    expect(err({ maxTokens: "400.5" })).toBe(
      "Longueur maximale des réponses : saisissez un nombre entier.",
    );
    expect(err({ monthlyCapEur: "-1" })).toBe("Plafond mensuel : au moins 0.");
    expect(err({ perConversationDailyLimit: "" })).toBe(
      "Réponses par jour et par conversation : saisissez un nombre.",
    );
    expect(err({ activation: "on" })).toBe("Choisissez à qui l'assistant répond.");
    expect(err({ defaultModel: "un modèle" })).toBe("Modèle par défaut : nom de modèle invalide.");
    expect(err({ apiKey: "cle avec des espaces dedans" })).toBe(
      "Collez la clé Venice entièrement, sans espace.",
    );
    expect(form({ monthlyCapEur: "0" }).ok).toBe(true);
  });

  it("aucun mot technique dans les libellés", () => {
    const texts = [
      ...Object.values(ACTIVATION_LABELS),
      activationView("team").sentence,
      assistantKeyView(base).sentence,
      assistantCapUsage(1, 30).sentence,
    ];
    for (const t of texts) expect(jargonIn(t), t).toEqual([]);
  });
});
