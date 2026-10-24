import { beforeEach, describe, expect, it, vi } from "vitest";

// Enregistrement des personas : base simulée, profil Telegram simulé (aucun appel réseau).
const m = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  offer: { id: "aff1", isActive: true } as { id: string; isActive: boolean } | null,
  campaign: { id: "c1" } as { id: string } | null,
  media: { id: "m1", mimeType: "image/png" } as { id: string; mimeType: string } | null,
  bots: [] as Array<{ id: string; username: string }>,
  deleteTarget: null as {
    id: string;
    name: string;
    bots: Array<{ username: string }>;
  } | null,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  linkMoves: [] as Array<Record<string, unknown>>,
  profile: vi.fn(),
  refreshStats: vi.fn(async () => {}),
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    persona: {
      findUnique: vi.fn(async (args: { select?: Record<string, unknown> }) =>
        args.select && "bots" in args.select ? m.deleteTarget : m.existing,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        m.created.push(data);
        return { id: "new1" };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        m.updated.push(data);
        return {};
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        m.deleted.push(where.id);
        return {};
      }),
    },
    affiliateCampaign: { findUnique: vi.fn(async () => m.offer) },
    campaign: { findUnique: vi.fn(async () => m.campaign) },
    mediaAsset: { findUnique: vi.fn(async () => m.media) },
    bot: { findMany: vi.fn(async () => m.bots) },
    trackingLink: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        m.linkMoves.push(args);
        return { count: 1 };
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
}));
vi.mock("@linkaffipro/telegram", () => ({
  mentionsAssistant: (t: string | null | undefined) => /assist[ae]nt|asistent/i.test(t ?? ""),
  setAssistantProfile: m.profile,
}));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: m.refreshStats }));

import { emptyPersonaForm, type PersonaFormState } from "./form";
import { changedFields, deletePersona, saveMessage, savePersona } from "./save";

const admin = { id: "a1", role: "ADMIN" as const };
const manager = { id: "u2", role: "MANAGER" as const };

function draft(over: Partial<PersonaFormState> = {}): PersonaFormState {
  return {
    ...emptyPersonaForm(),
    name: "Léa",
    personality: "Pétillante",
    botDescription: "Moi c'est Léa, l'assistante du canal : une IA.",
    botShortDescription: "Léa, l'assistante du canal",
    ...over,
  };
}

const saved = {
  id: "p1",
  name: "Léa",
  gender: "F",
  identityKind: "ASSISTANT",
  age: null,
  styleExamples: null,
  personality: "Pétillante",
  tone: "",
  languages: ["fr"],
  interests: [],
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  followUpAfterHours: 24,
  followUpsMax: 2,
  affiliateCampaignId: null,
  campaignId: null,
  offerPitch: "",
  offerButtonText: "Découvrir l'app",
  offerMediaAssetId: null,
  botDescription: "Moi c'est Léa, l'assistante du canal : une IA.",
  botShortDescription: "Léa, l'assistante du canal",
  model: null,
  temperature: null,
  extraPrompt: null,
  universe: "dating",
  faq: [] as Array<{ q: string; a: string }>,
  isActive: false,
};

beforeEach(() => {
  m.existing = null;
  m.offer = { id: "aff1", isActive: true };
  m.campaign = { id: "c1" };
  m.media = { id: "m1", mimeType: "image/png" };
  m.bots = [];
  m.deleteTarget = null;
  m.created.length = 0;
  m.updated.length = 0;
  m.deleted.length = 0;
  m.audits.length = 0;
  m.linkMoves.length = 0;
  m.refreshStats.mockClear();
  m.profile.mockReset();
  m.profile.mockResolvedValue({
    mode: "ASSISTANT",
    applied: true,
    languages: ["fr"],
    warnings: [],
  });
});

describe("créer une persona", () => {
  it("un responsable peut créer ; désactivée par défaut ; journal « persona.created », pas d'activation", async () => {
    const r = await savePersona(draft(), manager);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe("new1");
    expect(r.created).toBe(true);
    expect(m.created[0]).toMatchObject({ name: "Léa", isActive: false, createdById: "u2" });
    expect(m.audits.map((a) => a.action)).toEqual(["persona.created"]);
    expect(r.message).toMatch(/créée\. Elle est désactivée/);
  });

  it("créée activée : « persona.created » puis « persona.activated »", async () => {
    const r = await savePersona(draft({ isActive: true }), admin);
    expect(r.ok).toBe(true);
    expect(m.audits.map((a) => a.action)).toEqual(["persona.created", "persona.activated"]);
  });

  it("références vérifiées : offre, campagne, visuel (image seulement)", async () => {
    m.offer = null;
    m.campaign = null;
    m.media = { id: "m1", mimeType: "video/mp4" };
    const r = await savePersona(
      draft({ affiliateCampaignId: "aff9", campaignId: "c9", offerMediaAssetId: "m1" }),
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors?.affiliateCampaignId).toBeTruthy();
    expect(r.errors?.campaignId).toBeTruthy();
    expect(r.errors?.offerMediaAssetId).toMatch(/image/);
    expect(m.created).toHaveLength(0);
  });

  it("offre inactive refusée pour une nouvelle liaison", async () => {
    m.offer = { id: "aff1", isActive: false };
    const r = await savePersona(draft({ affiliateCampaignId: "aff1" }), admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors?.affiliateCampaignId).toMatch(/plus active/);
  });

  it("activation refusée : offre liée sans fiche de l'offre (rien n'est écrit)", async () => {
    const r = await savePersona(draft({ affiliateCampaignId: "aff1", isActive: true }), admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors?.isActive).toMatch(/Activation impossible/);
    expect(m.created).toHaveLength(0);
    expect(m.audits).toHaveLength(0);
  });

  it("description du bot qui ne dit pas « assistante » : refusée", async () => {
    const r = await savePersona(draft({ botDescription: "Moi c'est Léa 😘" }), admin);
    expect(r.ok).toBe(false);
  });

  it("description du bot qui dit « assistante » mais le nie : refusée, rien n'est écrit ni posé dans Telegram", async () => {
    const r = await savePersona(
      draft({
        botDescription:
          "Léa, 24 ans. Je ne suis pas une assistante ni un bot, juste une vraie personne.",
        botShortDescription: "Moi c'est Léa, pas une assistante : une vraie fille de Paris 😉",
        isActive: true,
      }),
      admin,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors?.botDescription).toMatch(/^Refusé/);
    expect(r.errors?.botShortDescription).toMatch(/^Refusé/);
    expect(m.created).toHaveLength(0);
    expect(m.profile).not.toHaveBeenCalled();
  });

  it("création : aucun lien à déplacer, aucun recalcul des statistiques", async () => {
    const r = await savePersona(draft({ campaignId: "c1" }), admin);
    expect(r.ok).toBe(true);
    expect(m.linkMoves).toHaveLength(0);
    expect(m.refreshStats).not.toHaveBeenCalled();
  });
});

describe("modifier une persona", () => {
  it("journal des champs modifiés (sans les textes), activation, profil Telegram des bots assistants", async () => {
    m.existing = { ...saved };
    m.bots = [{ id: "b1", username: "lea_bot" }];
    const r = await savePersona(
      draft({
        id: "p1",
        tone: "complice",
        affiliateCampaignId: "aff1",
        offerPitch: "Gratuite à l'inscription.",
        isActive: true,
      }),
      manager,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(false);
    expect(m.updated).toHaveLength(1);
    const actions = m.audits.map((a) => a.action);
    expect(actions).toEqual(["persona.updated", "persona.activated"]);
    const meta = m.audits[0]!.metadata as { fields: string[] };
    expect(meta.fields).toEqual(["tone", "affiliateCampaignId", "offerPitch", "isActive"]);
    expect(JSON.stringify(m.audits)).not.toContain("Gratuite");
    expect(m.profile).toHaveBeenCalledWith("b1");
    expect(r.message).toMatch(/Description de @lea_bot mise à jour/);
    expect(r.problem).toBeNull();
  });

  it("Telegram injoignable : enregistrement fait, problème rapporté", async () => {
    m.existing = { ...saved };
    m.bots = [{ id: "b1", username: "lea_bot" }];
    m.profile.mockRejectedValue(new Error("Network request failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await savePersona(draft({ id: "p1", tone: "léger" }), admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(m.updated).toHaveLength(1);
    // Phrase simple à l'écran ; le texte technique (anglais) va seulement dans le journal du serveur.
    expect(r.problem).toContain("@lea_bot");
    expect(r.problem).toContain("Telegram ne répond pas pour l'instant");
    expect(r.problem).not.toContain("Network request failed");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("une fille : illusion forcée à true et âge enregistré", async () => {
    m.existing = null;
    const r = await savePersona(
      draft({
        identityKind: "GIRL",
        age: "23",
        botDescription: "",
        botShortDescription: "",
      }),
      admin,
    );
    expect(r.ok).toBe(true);
    expect(m.created[0]).toMatchObject({ identityKind: "GIRL", age: 23, illusion: true });
  });

  it("désactivation journalisée ; aucun changement : pas de « persona.updated »", async () => {
    m.existing = { ...saved, isActive: true };
    const off = await savePersona(draft({ id: "p1", isActive: false }), admin);
    expect(off.ok).toBe(true);
    expect(m.audits.map((a) => a.action)).toEqual(["persona.updated", "persona.deactivated"]);
    m.audits.length = 0;
    m.existing = { ...saved };
    const same = await savePersona(draft({ id: "p1" }), admin);
    expect(same.ok).toBe(true);
    expect(m.audits).toHaveLength(0);
  });

  it("campagne changée : le lien de l'offre actuelle passe tout de suite dans la nouvelle campagne, recalcul complet demandé", async () => {
    m.existing = {
      ...saved,
      affiliateCampaignId: "aff1",
      offerPitch: "Gratuite.",
      campaignId: "c1",
    };
    const r = await savePersona(
      draft({ id: "p1", affiliateCampaignId: "aff1", offerPitch: "Gratuite.", campaignId: "c2" }),
      admin,
    );
    expect(r.ok).toBe(true);
    expect(m.linkMoves).toEqual([
      {
        where: { personaId: "p1", kind: "OFFER", affiliateCampaignId: "aff1" },
        data: { campaignId: "c2" },
      },
    ]);
    expect(m.refreshStats).toHaveBeenCalledTimes(1);
    // Campagne retirée : le lien n'a plus de campagne.
    m.linkMoves.length = 0;
    m.existing = {
      ...saved,
      affiliateCampaignId: "aff1",
      offerPitch: "Gratuite.",
      campaignId: "c2",
    };
    await savePersona(
      draft({ id: "p1", affiliateCampaignId: "aff1", offerPitch: "Gratuite." }),
      admin,
    );
    expect(m.linkMoves[0]).toMatchObject({ data: { campaignId: null } });
    expect(m.refreshStats).toHaveBeenCalledTimes(2);
  });

  it("offre changée : recalcul complet demandé ; ni offre ni campagne changées : rien", async () => {
    m.existing = { ...saved, affiliateCampaignId: "aff1", offerPitch: "Gratuite." };
    await savePersona(
      draft({ id: "p1", affiliateCampaignId: "aff2", offerPitch: "Gratuite." }),
      admin,
    );
    expect(m.refreshStats).toHaveBeenCalledTimes(1);
    expect(m.linkMoves[0]).toMatchObject({ where: { affiliateCampaignId: "aff2" } });
    m.refreshStats.mockClear();
    m.linkMoves.length = 0;
    m.existing = { ...saved };
    await savePersona(draft({ id: "p1", tone: "léger" }), admin);
    expect(m.refreshStats).not.toHaveBeenCalled();
    expect(m.linkMoves).toHaveLength(0);
  });

  it("recalcul impossible (file indisponible) : l'enregistrement est fait quand même", async () => {
    m.existing = { ...saved, campaignId: "c1" };
    m.refreshStats.mockRejectedValueOnce(new Error("Redis indisponible"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await savePersona(draft({ id: "p1", campaignId: "c2" }), admin);
    spy.mockRestore();
    expect(r.ok).toBe(true);
    expect(m.updated).toHaveLength(1);
  });

  it("persona supprimée entre-temps : refus clair", async () => {
    m.existing = null;
    const r = await savePersona(draft({ id: "p404" }), admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/n'existe plus/);
  });

  it("champs modifiés : comparaison par valeur (listes comprises)", () => {
    const after = {
      ...saved,
      gender: "F",
      languages: ["fr"],
      tone: "léger",
    } as unknown as Parameters<typeof changedFields>[1];
    expect(changedFields({ ...saved, languages: ["fr"] }, after)).toEqual(["tone"]);
  });
});

describe("supprimer une persona", () => {
  it("réservé aux administrateurs", async () => {
    m.deleteTarget = { id: "p1", name: "Léa", bots: [] };
    const r = await deletePersona("p1", manager);
    expect(r.ok).toBe(false);
    expect(m.deleted).toHaveLength(0);
  });

  it("refusé tant qu'un bot l'utilise, avec la marche à suivre", async () => {
    m.deleteTarget = { id: "p1", name: "Léa", bots: [{ username: "lea_bot" }] };
    const r = await deletePersona("p1", admin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/@lea_bot l'utilise.*Réglages → Bots/);
    expect(m.deleted).toHaveLength(0);
  });

  it("administrateur, aucun bot : supprimée, journal « persona.deleted »", async () => {
    m.deleteTarget = { id: "p1", name: "Léa", bots: [] };
    const r = await deletePersona("p1", admin);
    expect(r.ok).toBe(true);
    expect(m.deleted).toEqual(["p1"]);
    expect(m.audits[0]).toMatchObject({ action: "persona.deleted", entityId: "p1" });
  });
});

describe("phrases de retour", () => {
  it("création, activation, désactivation", () => {
    expect(saveMessage({ created: true, name: "Léa", isActive: true, wasActive: false })).toBe(
      "Persona « Léa » créée. Elle est activée.",
    );
    expect(saveMessage({ created: false, name: "Léa", isActive: false, wasActive: true })).toMatch(
      /désactivée/,
    );
    expect(saveMessage({ created: false, name: "", isActive: false, wasActive: false })).toBe(
      "Modifications enregistrées.",
    );
  });
});

describe("univers et fiche d'informations (phase 25)", () => {
  const faq = [{ q: "Dépôt minimum ?", a: "10 €" }];

  it("administrateur : fiche enregistrée, journal sans les textes ; assistante → illusion false", async () => {
    m.existing = { ...saved };
    const r = await savePersona(draft({ id: "p1", universe: "casino", faq }), admin);
    expect(r.ok).toBe(true);
    expect(m.updated[0]).toMatchObject({ universe: "casino", faq, illusion: false });
    const faqAudit = m.audits.find((a) => a.action === "persona.faq_updated");
    expect(faqAudit?.metadata).toEqual({ universe: "casino", before: 0, after: 1 });
    expect(JSON.stringify(m.audits)).not.toContain("10 €");
    expect(m.audits.find((a) => a.action === "persona.updated")?.metadata).toMatchObject({
      fields: ["universe"],
      universe: "casino",
      faqEntries: 1,
    });
  });

  it("responsable : fiche modifiée refusée (inchangée) ; fiche identique acceptée", async () => {
    m.existing = { ...saved, faq };
    const refused = await savePersona(draft({ id: "p1", faq: [] }), manager);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors?.faq).toMatch(/administrateur/);
    expect(m.updated).toHaveLength(0);
    const ok = await savePersona(draft({ id: "p1", faq, tone: "léger" }), manager);
    expect(ok.ok).toBe(true);
    expect(m.updated[0]).toMatchObject({ faq });
    expect(m.audits.map((a) => a.action)).not.toContain("persona.faq_updated");
  });

  it("responsable qui crée : fiche vide seulement ; Casino « une fille » refusée", async () => {
    expect((await savePersona(draft({ faq }), manager)).ok).toBe(false);
    expect(m.created).toHaveLength(0);
    const girl = await savePersona(
      draft({
        universe: "sports",
        identityKind: "GIRL",
        age: "23",
        botDescription: "",
        botShortDescription: "",
      }),
      admin,
    );
    expect(girl.ok).toBe(false);
    expect(m.created).toHaveLength(0);
  });
});
