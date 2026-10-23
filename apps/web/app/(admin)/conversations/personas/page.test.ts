import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_ASSISTANT_CONFIG, fakePersona } from "@linkaffipro/chat";
import {
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../../settings/categories/page-checks";

// Écrans Personas rendus côté serveur avec des données simulées : liste, nouvelle persona, fiche (formulaire,
// « Tester », aperçu des consignes, suppression réservée aux administrateurs).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  list: [] as unknown[],
  persona: null as Record<string, unknown> | null,
  config: {} as Record<string, unknown>,
  spent: 0,
  media: null as Record<string, unknown> | null,
  algoRecs: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/conversations/personas",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/assistant/config", () => ({ loadAssistantConfig: vi.fn(async () => m.config) }));
vi.mock("@/lib/assistant/usage", () => ({ monthCostEur: vi.fn(async () => m.spent) }));
vi.mock("./actions", () => ({ savePersonaAction: vi.fn(), deletePersonaAction: vi.fn() }));
vi.mock("./[id]/media-actions", () => ({ savePersonaMediaAction: vi.fn() }));
vi.mock("@/lib/agents/algo/queries", () => ({ loadPersonaRecommendations: vi.fn(async () => m.algoRecs) }));
vi.mock("@/app/(admin)/agents/[equipe]/algo-actions", () => ({ recommendationAction: vi.fn() }));
vi.mock("@/lib/personas/media-save", () => ({ loadPersonaMedia: vi.fn(async () => m.media) }));
vi.mock("@/lib/personas/queries", () => ({
  loadPersonaList: vi.fn(async () => m.list),
  loadPersona: vi.fn(async () => m.persona),
  loadPersonaFormChoices: vi.fn(async () => ({
    offers: [
      {
        id: "aff1",
        name: "Love App",
        programName: "Love Corp",
        vertical: "DATING",
        isActive: true,
      },
    ],
    campaigns: [{ id: "c1", name: "Rencontres été", affiliateCampaignIds: ["aff1"] }],
    images: [],
    models: [],
    defaultModel: "venice-uncensored-role-play",
    templates: {
      fr: {
        F: {
          long: "Moi c'est {name}, l'assistante du canal : une IA.",
          short: "{name}, l'assistante du canal",
        },
        M: {
          long: "Moi c'est {name}, l'assistant du canal : une IA.",
          short: "{name}, l'assistant du canal",
        },
      },
    },
  })),
  loadPersonaTurnInput: vi.fn(async () =>
    m.persona ? { input: fakePersona({ name: String(m.persona.name) }), offerLinked: true } : null,
  ),
}));

import PersonasPage from "./page";
import NewPersonaPage from "./new/page";
import PersonaPage from "./[id]/page";

const persona = {
  id: "p1",
  name: "Léa",
  gender: "F",
  personality: "Pétillante",
  tone: "complice",
  languages: ["fr", "en"],
  interests: ["voyages"],
  extraPrompt: null,
  model: null,
  temperature: null,
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  followUpAfterHours: 24,
  followUpsMax: 2,
  affiliateCampaignId: "aff1",
  campaignId: "c1",
  offerPitch: "Gratuite à l'inscription.",
  offerButtonText: "Découvrir l'app",
  offerMediaAssetId: null,
  botDescription: null,
  botShortDescription: null,
  isActive: true,
  createdAt: new Date("2026-10-18T10:00:00Z"),
  updatedAt: new Date("2026-10-18T11:00:00Z"),
  affiliateCampaign: { id: "aff1", name: "Love App", isActive: true, trackingUrlTemplate: "x" },
  campaign: { id: "c1", name: "Rencontres été" },
  offerMediaAsset: null,
  bots: [] as Array<{ id: string; name: string; username: string; mode: string }>,
  conversations: 3,
};

async function renderList(): Promise<string> {
  return renderToStaticMarkup(await PersonasPage({ searchParams: Promise.resolve({}) } as never));
}

async function renderFiche(): Promise<string> {
  return renderToStaticMarkup(
    await PersonaPage({
      params: Promise.resolve({ id: "p1" }),
      searchParams: Promise.resolve({}),
    } as never),
  );
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.list = [];
  m.persona = { ...persona, bots: [] };
  m.config = { ...DEFAULT_ASSISTANT_CONFIG, apiKeyEncrypted: "chiffrée" };
  m.spent = 0;
  m.media = {
    referenceImageIds: ["r1", "r2"],
    references: [
      { id: "r1", filename: "face.jpg", mimeType: "image/jpeg" },
      { id: "r2", filename: "pied.jpg", mimeType: "image/jpeg" },
    ],
    loraUrl: "https://v3.fal.media/files/lea.safetensors",
    loraTrigger: "lea_tok",
    loraScale: 0.8,
    mediaNotes: "Tenues décontractées",
  };
});

describe("liste des personas", () => {
  it("vide : un seul bouton orange (« Nouvelle persona » dans l'état vide)", async () => {
    const html = await renderList();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    expect(visibleText(html)).toContain("Aucune persona pour l'instant");
    expect(html).toContain('href="/conversations/personas/new"');
  });

  it("5 colonnes : prénom, état, offre liée, bots, conversations ; sans jargon", async () => {
    m.list = [
      {
        id: "p1",
        name: "Léa",
        gender: "F",
        isActive: true,
        offer: { name: "Love App", isActive: true },
        bots: [{ username: "lea_bot", mode: "ASSISTANT" }],
        conversations: 12,
      },
      {
        id: "p2",
        name: "Hugo",
        gender: "M",
        isActive: false,
        offer: null,
        bots: [],
        conversations: 0,
      },
    ];
    const html = await renderList();
    const text = visibleText(html);
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    for (const t of ["Prénom", "État", "Offre liée", "Bots", "Conversations"])
      expect(text).toContain(t);
    expect(text).toContain("l'assistante du canal");
    expect(text).toContain("l'assistant du canal");
    expect(text).toContain("Active");
    expect(text).toContain("Inactive");
    expect(text).toContain("@lea_bot");
    expect(html).toContain('href="/conversations/personas/p1"');
    expect(jargonIn(text)).toEqual([]);
  });
});

describe("nouvelle persona", () => {
  it("formulaire en sections, descriptions du bot vides sans prénom, un seul bouton orange", async () => {
    const html = renderToStaticMarkup(await NewPersonaPage());
    const text = visibleText(html);
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    for (const t of [
      "Identité",
      "Parcours",
      "Offre",
      "Profil du bot",
      "Mise en service",
      "Créer la persona",
      "Ce que l'assistante peut dire de l'app",
      "Rien d'autre ne sera dit : pas de chiffres, pas de promesses.",
      "jamais une photo présentée comme celle de l'assistante",
    ])
      expect(text).toContain(t);
    // Sans prénom, rien n'est pré-rempli (jamais « Léa » d'exemple) : le texte est proposé dès qu'un prénom est tapé.
    expect(html).not.toContain("l&#x27;assistante du canal : une IA.");
    expect(text).toContain("Proposée dès que vous tapez un prénom.");
    expect(text).not.toMatch(/dating/i);
    expect(jargonIn(text)).toEqual([]);
  });
});

describe("fiche d'une persona", () => {
  it("formulaire, « Tester », aperçu des consignes ; un seul bouton orange ; sans jargon", async () => {
    const html = await renderFiche();
    const text = visibleText(html);
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    expect(text).toContain("Enregistrer");
    expect(text).toContain("Tester");
    expect(text).toContain("Recommencer");
    expect(text).toContain("Ce que l'assistante reçoit comme consignes");
    // Nom complet de l'offre choisie écrit sous la liste (une liste fermée ne passe jamais à la ligne).
    expect(text).toContain("Offre choisie : Love App · Love Corp.");
    expect(html).toMatch(/<pre[^>]*>[\s\S]*Léa/);
    expect(html).toContain('id="tester"');
    // Le texte des consignes (destiné à l'IA) est hors du contrôle du vocabulaire : retiré avant de chercher le jargon.
    expect(jargonIn(visibleText(html.replace(/<pre[\s\S]*?<\/pre>/g, "")))).toEqual([]);
  });

  it("médias du personnage : images dans l'ordre, fichier du personnage expliqué au survol, sans « LoRA » en surface", async () => {
    const html = await renderFiche();
    const text = visibleText(html);
    expect(primaryButtonCount(html)).toBe(1);
    for (const t of [
      "Médias du personnage",
      "Images de référence (2 sur 3)",
      "1re : sert aux vidéos",
      "Adresse du fichier du personnage",
      "Mot déclencheur",
      "Force du personnage",
      "Tenue et ambiance",
      "Enregistrer les médias",
    ])
      expect(text, t).toContain(t);
    expect(html).toContain('id="medias"');
    expect(html).toContain('value="r1,r2"');
    expect(html).toContain('src="/api/agents/media/r1"');
    expect(html).toContain('value="0,8"');
    expect(text).not.toMatch(/\bLoRA\b/);
    expect(html).toContain("LoRA"); // au survol (lecteurs d'écran)
  });

  it("propositions de l'équipe Algorithme : encart avec Appliquer et Refuser (administrateurs seulement)", async () => {
    expect(visibleText(await renderFiche())).not.toContain("Propositions de l'équipe Algorithme");
    m.algoRecs = [
      {
        id: "r1",
        teamKey: "dating",
        target: "PERSONA",
        targetId: "p1",
        field: "messagesBeforeLink",
        before: 4,
        after: 6,
        evidence: { summary: "Les conversations qui attendent 6 échanges s'inscrivent deux fois plus.", conversations: 42 },
        expectedGain: "+30 % d'inscriptions",
        size: "BIG",
        status: "PROPOSED",
        appliedAt: null,
        appliedBy: null,
        undoneAt: null,
        rejectedAt: null,
        weekStart: "2026-10-19",
        createdAt: new Date("2026-10-19T06:00:00Z"),
        targetLabel: "Léa",
      },
    ];
    const html = await renderFiche();
    const text = visibleText(html);
    for (const t of ["Propositions de l'équipe Algorithme", "Échanges avant le lien", "Gain attendu : +30 % d'inscriptions", "42 conversations", "Appliquer", "Refuser"])
      expect(text, t).toContain(t);
    expect(html).toContain('id="propositions-algorithme"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(jargonIn(visibleText(html.replace(/<pre[\s\S]*?<\/pre>/g, "")))).toEqual([]);
    m.user = { id: "u2", role: "MANAGER" };
    const manager = visibleText(await renderFiche());
    expect(manager).toContain("Réservé aux administrateurs");
    expect(manager).not.toMatch(/\bAppliquer\b/);
  });

  it("administrateur : « Supprimer la persona » ; responsable : pas de suppression", async () => {
    expect(visibleText(await renderFiche())).toContain("Supprimer la persona");
    m.user = { id: "u2", role: "MANAGER" };
    expect(visibleText(await renderFiche())).not.toContain("Supprimer la persona");
  });

  it("utilisée par un bot : suppression impossible, marche à suivre affichée", async () => {
    m.persona = {
      ...persona,
      bots: [{ id: "b1", name: "Léa", username: "lea_bot", mode: "ASSISTANT" }],
    };
    const html = await renderFiche();
    const text = visibleText(html);
    expect(text).toContain("Impossible tant qu'un bot l'utilise");
    expect(text).toContain("@lea_bot");
    expect(html).not.toContain(">Supprimer la persona</button>");
  });

  it("sans clé Venice : « Tester » explique quoi faire, sans champ de saisie", async () => {
    m.config = { ...DEFAULT_ASSISTANT_CONFIG, apiKeyEncrypted: null };
    m.user = { id: "u2", role: "MANAGER" };
    const html = await renderFiche();
    expect(visibleText(html)).toContain(
      "Un administrateur doit d'abord coller la clé Venice dans Réglages → IA de conversation",
    );
    expect(html).not.toContain('id="tester-message"');
  });

  it("persona introuvable : page 404", async () => {
    m.persona = null;
    await expect(renderFiche()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
