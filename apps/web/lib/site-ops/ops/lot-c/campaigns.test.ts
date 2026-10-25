/**
 * Phase 34, lot C — cœurs des campagnes, liens, imports et du recalcul : mêmes erreurs que le site, droits (ADMIN
 * pour les suppressions), essai à blanc sans aucune écriture ni mise en file, résolution par nom (Kevin), journal
 * avec la provenance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor } from "@linkaffipro/agents";

const db = vi.hoisted(() => {
  const writes: string[] = [];
  const data: Record<string, Record<string, (args: unknown) => unknown>> = {};
  const WRITE = /^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, m: string) => async (args: unknown) => {
          if (WRITE.test(m)) writes.push(`${name}.${m}`);
          const fn = data[name]?.[m];
          if (fn) return fn(args);
          if (WRITE.test(m)) return { id: `${name}-new`, count: 0 };
          return m === "findMany" ? [] : m === "count" ? 0 : null;
        },
      },
    );
  const base: Record<string, unknown> = {
    $transaction: async (x: unknown) => {
      writes.push("$transaction");
      return Array.isArray(x) ? Promise.all(x) : (x as (p: unknown) => unknown)(prisma);
    },
  };
  const prisma: Record<string, unknown> = new Proxy(base, {
    get: (t, k: string) => (k in t ? t[k] : model(k)),
  });
  class KnownError extends Error {
    code = "";
  }
  return {
    prisma,
    writes,
    data,
    audit: vi.fn(async (..._a: unknown[]) => undefined),
    recordEvent: vi.fn(async () => undefined),
    toJsonValue: (v: unknown) => v,
    Prisma: { DbNull: "DbNull", PrismaClientKnownRequestError: KnownError },
  };
});
vi.mock("@linkaffipro/db", () => db);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const queue = vi.hoisted(() => ({ enqueue: vi.fn(async (..._a: unknown[]) => ({})), enqueueDm: vi.fn() }));
vi.mock("@linkaffipro/queue", () => queue);
vi.mock("@/lib/env", () => ({ env: { trackingBaseUrl: "https://go.example" } }));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: refresh, invalidateCampaignCaches: vi.fn() }));
const entry = vi.hoisted(() =>
  vi.fn(async (..._a: unknown[]) => ({ trackingLink: { slug: "abc12345", label: "Celsius — Pub 1" } })),
);
vi.mock("@/lib/campaigns/entry-links", () => ({ createCampaignEntryLink: entry }));
const merge = vi.hoisted(() => ({
  mergeImportedCampaign: vi.fn(async (..._a: unknown[]) => ({ adSets: 1, costs: 1, platformName: "TT" })),
  findImportedShellByName: vi.fn(async (..._a: unknown[]) => null),
}));
vi.mock("@/lib/campaigns/merge", () => merge);
const links = vi.hoisted(() => {
  class LinkError extends Error {}
  return {
    LinkError,
    createEntryLink: vi.fn(async (..._a: unknown[]) => ({ trackingLink: { slug: "zz998877" } })),
    createGenericLink: vi.fn(async (..._a: unknown[]) => ({ slug: "gen11111", label: "Promo" })),
  };
});
vi.mock("@/lib/links/create", () => links);
vi.mock("@/lib/campaigns/queries", () => ({
  campaignTree: vi.fn(async () => []),
  apiFedCampaignIds: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/lib/dashboard/cache", () => ({ invalidateDashboards: vi.fn() }));
vi.mock("@/lib/affiliates/tutorial", () => ({ dismissTutorial: vi.fn(async () => undefined) }));

import {
  addAd,
  addAdSet,
  addEntryLink,
  addManualCost,
  addOffer,
  attachImportedCampaign,
  attachLinkToAd,
  CAMPAIGN_FORM_ERROR,
  createCampaignWizard,
  deleteAd,
  deleteAdSet,
  deleteCampaign,
  dismissAffiliatesTutorial,
  removeOffer,
  updateCampaign,
  updateCampaignChannels,
} from "./campaigns";
import { createEntryLinks, createGeneric, toggleLink } from "./links";
import { confirmImport, previewImport } from "./imports";
import { recomputeStats } from "./dashboard";

const KEVIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "TELEGRAM", telegramUserId: "42" };
const MANAGER: SiteOpActor = { ...KEVIN, role: "MANAGER" };
const WEB: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB", telegramUserId: null };

const CAMPAIGNS = [
  { id: "c1", name: "Celsius FR" },
  { id: "c2", name: "Casino Octobre" },
];
const CHANNELS = [
  { id: "ch1", title: "🚩𝒁𝒐𝒏𝒆 𝑰𝒏𝒕𝒆𝒓𝒅𝒊𝒕𝒆", username: "zone_interdite" },
  { id: "ch2", title: "Casino VIP", username: null },
];

function err(r: { ok: boolean; error?: string }): string {
  if (r.ok) throw new Error("réussite inattendue");
  return r.error!;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.writes.length = 0;
  for (const k of Object.keys(db.data)) delete db.data[k];
  db.data.campaign = {
    findMany: () => CAMPAIGNS,
    findUnique: () => ({
      id: "c1",
      name: "Celsius FR",
      adPlatform: "TIKTOK",
      vertical: "CASINO",
      status: "ACTIVE",
      budgetDaily: 30,
      notes: null,
      startAt: null,
      endAt: null,
      connectionId: null,
      externalCampaignId: null,
      channelIds: ["ch1"],
      affiliateCampaignIds: [],
      adSets: [{ _count: { ads: 2 } }],
      _count: { adSets: 1, inviteLinks: 2, trackingLinks: 2 },
    }),
  };
  db.data.channel = {
    findMany: (a) =>
      (a as { where?: { isActive?: boolean } })?.where?.isActive
        ? CHANNELS.map((c) => ({ id: c.id, title: c.title }))
        : CHANNELS,
    findUnique: () => ({ language: "fr", title: CHANNELS[0]!.title }),
  };
});

describe("modifier une campagne", () => {
  it("même erreur que le site (nom vide) ; rien d'écrit", async () => {
    const r = await updateCampaign(
      { campaignId: "c1", name: "", adPlatform: "", vertical: "", status: "ACTIVE", budgetDaily: "", notes: "", startAt: "", endAt: "", connectionId: "" },
      WEB,
    );
    expect(err(r)).toBe(CAMPAIGN_FORM_ERROR);
    expect(db.writes).toEqual([]);
  });

  it("Kevin : « mets Celsius en pause » → seul le statut change, journal avec via TELEGRAM", async () => {
    const r = await updateCampaign({ campaign: "celsius", status: "PAUSED" }, KEVIN);
    expect(r.ok).toBe(true);
    expect(db.writes).toContain("campaign.update");
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "campaign.updated",
        entityId: "c1",
        metadata: expect.objectContaining({ name: "Celsius FR", status: "PAUSED", via: "TELEGRAM" }),
      }),
    );
  });

  it("essai à blanc : aperçu, aucune écriture, aucun recalcul", async () => {
    const r = await updateCampaign({ campaign: "Celsius FR", budgetDaily: "50" }, KEVIN, { dryRun: true });
    expect(r.ok && r.preview?.summary).toMatch(/50 € par jour/);
    expect(db.writes).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("nom ambigu : refus avec la liste ; nom inconnu : introuvable", async () => {
    db.data.campaign!.findMany = () => [
      { id: "c1", name: "Celsius FR" },
      { id: "c3", name: "Celsius BE" },
    ];
    const r = await updateCampaign({ campaign: "Celsius", status: "PAUSED" }, KEVIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("invalid");
    expect(err(r)).toMatch(/« Celsius FR ».*« Celsius BE »/);
    const r2 = await updateCampaign({ campaign: "Betify", status: "PAUSED" }, KEVIN);
    expect(!r2.ok && r2.code).toBe("not_found");
  });
});

describe("groupes, pubs et liens de pub", () => {
  it("groupe sans nom : même message que le site ; essai à blanc sans écriture", async () => {
    expect(err(await addAdSet({ campaignId: "c1", name: "" }, WEB))).toBe("Donnez un nom au groupe.");
    const r = await addAdSet({ campaign: "Celsius", name: "Femmes 25-34" }, KEVIN, { dryRun: true });
    expect(r.ok).toBe(true);
    expect(db.writes).toEqual([]);
  });

  it("pub sans nom : même message que le site", async () => {
    expect(err(await addAd({ campaignId: "c1", adSetId: "s1", name: "" }, WEB))).toBe(
      "Donnez un nom à la pub précise.",
    );
  });

  it("Kevin ne détache jamais un lien par oubli ; essai à blanc du détachement sans écriture", async () => {
    db.data.ad = { findMany: () => [{ id: "a1", name: "Vidéo plage", adSet: { name: "Groupe 1" } }] };
    expect(err(await attachLinkToAd({ campaign: "Celsius", ad: "Vidéo plage" }, KEVIN))).toMatch(/Indiquez le lien/);
    const r = await attachLinkToAd({ campaign: "Celsius", ad: "plage", detach: true }, KEVIN, { dryRun: true });
    expect(r.ok && r.preview?.summary).toMatch(/détaché/);
    expect(db.writes).toEqual([]);
  });
});

describe("dépense saisie à la main (« ajoute 150 € de dépense TikTok hier »)", () => {
  it("saisie incomplète : même message que le site", async () => {
    expect(err(await addManualCost({ campaignId: "c1", level: "campaign:c1", date: "hier", spend: "1", impressions: "", clicks: "" }, WEB))).toBe(
      "Saisie incomplète : vérifiez le jour et la dépense.",
    );
  });

  it("jour déjà couvert par l'API : refusé comme sur le site", async () => {
    db.data.adCost = { findFirst: () => ({ id: "api" }) };
    expect(err(await addManualCost({ campaign: "Celsius", date: "2026-10-24", spend: 150 }, KEVIN))).toMatch(/l'API a priorité/);
    expect(db.writes).toEqual([]);
  });

  it("essai à blanc puis vrai : niveau campagne par défaut, journal via TELEGRAM", async () => {
    const dry = await addManualCost({ campaign: "Celsius", date: "2026-10-24", spend: 150 }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/150 € le 2026-10-24/);
    expect(db.writes).toEqual([]);
    const r = await addManualCost({ campaign: "Celsius", date: "2026-10-24", spend: 150 }, KEVIN);
    expect(r.ok && r.message).toBe("Dépense du 2026-10-24 enregistrée.");
    expect(db.writes).toContain("adCost.upsert");
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "adcost.manual",
        metadata: { level: "campaign:c1", date: "2026-10-24", spend: 150, via: "TELEGRAM" },
      }),
    );
  });
});

describe("liens d'entrée d'une campagne et liens de suivi", () => {
  it("lien d'entrée sans canal : même message que le site ; Kevin trouve le canal par son nom stylisé", async () => {
    expect(err(await addEntryLink({ campaignId: "c1", channelId: "" }, WEB))).toBe(
      "Choisissez le canal que ce lien doit ouvrir.",
    );
    const dry = await addEntryLink({ campaign: "Celsius", channel: "zone interdite" }, KEVIN, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(entry).not.toHaveBeenCalled();
    const r = await addEntryLink({ campaign: "Celsius", channel: "zone interdite", platform: "TIKTOK" }, KEVIN);
    expect(entry).toHaveBeenCalledWith(expect.objectContaining({ channelId: "ch1", platform: "TIKTOK", via: "TELEGRAM" }));
    expect(r.ok && r.message).toContain("https://go.example/abc12345");
  });

  it("« donne-moi un lien de suivi pour TikTok sur Zone Interdite » : aperçu sans création, puis l'adresse", async () => {
    const dry = await createEntryLinks({ channel: "Zone Interdite", platform: "tiktok" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/TikTok vers/);
    expect(links.createEntryLink).not.toHaveBeenCalled();
    const r = await createEntryLinks({ channel: "Zone Interdite", platform: "tiktok" }, KEVIN);
    expect(links.createEntryLink).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "ch1", platform: "TIKTOK", language: "fr", userId: "u1", via: "TELEGRAM" }),
    );
    expect(r.ok && r.message).toContain("https://go.example/zz998877");
  });

  it("formulaire incomplet et lien générique invalide : mêmes messages que le site", async () => {
    expect(err(await createEntryLinks({ channelId: "ch1", names: "", platform: "TIKTOK", language: "fr" }, WEB))).toMatch(
      /^Vérifiez le formulaire : le canal, au moins un nom/,
    );
    expect(err(await createGeneric({ label: "Promo", url: "pas une adresse" }, WEB))).toBe(
      "Indiquez un nom et une adresse complète commençant par https://.",
    );
  });

  it("activer un lien déjà actif : rien à faire ; essai à blanc de la désactivation sans écriture", async () => {
    db.data.trackingLink = {
      findMany: () => [{ id: "t1", label: "TikTok 26/10", slug: "abc" }],
      findUnique: () => ({ id: "t1", label: "TikTok 26/10", isActive: true, inviteLinkId: "i1" }),
    };
    const same = await toggleLink({ link: "TikTok 26/10", active: true }, KEVIN);
    expect(same.ok && same.message).toMatch(/déjà actif/);
    const dry = await toggleLink({ link: "TikTok 26/10", active: false }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/désactivé/);
    expect(db.writes).toEqual([]);
  });
});

describe("canaux et offres", () => {
  it("Kevin : « ajoute Casino VIP à Celsius » garde les canaux actuels", async () => {
    db.data.channel!.findMany = (a) =>
      (a as { where?: { isActive?: boolean } })?.where?.isActive ? [{ id: "ch1" }, { id: "ch2" }] : CHANNELS;
    const r = await updateCampaignChannels({ campaign: "Celsius", channels: ["Casino VIP"], mode: "add" }, KEVIN);
    expect(r.ok).toBe(true);
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { channelIds: ["ch1", "ch2"], via: "TELEGRAM" } }),
    );
  });

  it("offre : mêmes messages que le site ; par son nom pour Kevin ; essai à blanc sans écriture", async () => {
    expect(err(await addOffer({ campaignId: "c1" }, WEB))).toBe(
      "Choisissez une offre dans la liste ou collez un lien d'offre.",
    );
    expect(err(await addOffer({ campaignId: "c1", reference: "https://x" }, WEB))).toBe(
      "Collez un lien de la forme https://linkaffi.me/go/<clé> ou la clé seule.",
    );
    db.data.affiliateCampaign = {
      findMany: () => [{ id: "aff1", name: "Celsius Casino", campaignKey: "47eb8mwc", externalId: "x1" }],
      findFirst: () => ({ id: "aff1", name: "Celsius Casino" }),
    };
    const dry = await addOffer({ campaign: "Celsius FR", offer: "celsius casino" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/Celsius Casino/);
    expect(db.writes).toEqual([]);
    const rm = await removeOffer({ campaign: "Celsius FR", offer: "47eb8mwc" }, KEVIN, { dryRun: true });
    expect(rm.ok).toBe(true);
    expect(db.writes).toEqual([]);
  });

  it("campagne pub importée non choisie : même message que le site", async () => {
    expect(err(await attachImportedCampaign({ campaignId: "c1", importedCampaignId: "" }, WEB))).toBe(
      "Choisissez la campagne pub importée à rattacher.",
    );
  });
});

describe("suppressions : ADMIN seulement, essai à blanc avec ce qui disparaît", () => {
  it("un responsable ne supprime ni campagne, ni groupe, ni pub", async () => {
    for (const r of [
      await deleteCampaign({ campaign: "Celsius" }, MANAGER),
      await deleteAdSet({ campaign: "Celsius", adSet: "Groupe 1" }, MANAGER),
      await deleteAd({ campaign: "Celsius", ad: "Pub 1" }, MANAGER),
    ]) {
      expect(err(r)).toBe("Suppression réservée aux administrateurs.");
      expect(!r.ok && r.code).toBe("forbidden");
    }
    expect(db.writes).toEqual([]);
  });

  it("essai à blanc : impact décrit, rien supprimé ; pub d'une autre campagne introuvable", async () => {
    const r = await deleteCampaign({ campaign: "Celsius" }, KEVIN, { dryRun: true });
    expect(r.ok && r.preview?.impact).toMatch(/membres, clics et joueurs conservés/);
    expect(db.writes).toEqual([]);
    expect(err(await deleteAd({ campaignId: "c1", adId: "a-autre" }, WEB))).toBe("Pub introuvable.");
  });
});

describe("assistant « Nouvelle campagne » (« crée une campagne pour Celsius en France avec un CPA de 120 »)", () => {
  beforeEach(() => {
    db.data.affiliateCampaign = {
      findMany: (a) =>
        (a as { where?: { id?: unknown } })?.where?.id
          ? [{ id: "aff1", name: "Celsius" }]
          : [{ id: "aff1", name: "Celsius", campaignKey: "cel", externalId: "x1" }],
    };
  });

  it("même erreur que le site (nom manquant), à la bonne étape", async () => {
    const r = await createCampaignWizard({ payload: JSON.stringify({ name: "" }) }, WEB);
    expect(err(r)).toBe("Le nom de la campagne est obligatoire.");
    expect(r.back?.params?.step).toBe("general");
  });

  it("essai à blanc : offre trouvée par son nom, pays et CPA dans les notes, rien de créé", async () => {
    const r = await createCampaignWizard(
      { name: "Celsius FR", offers: ["celsius"], country: "France", cpa: 120 },
      KEVIN,
      { dryRun: true },
    );
    expect(r.ok && r.preview?.summary).toMatch(/Offre\(s\) : « Celsius »/);
    expect(r.ok && r.preview?.summary).toMatch(/Pays : France · CPA : 120 €/);
    expect(db.writes).toEqual([]);
  });

  it("vrai : campagne créée avec les notes, journal via TELEGRAM", async () => {
    db.data.campaign!.create = () => ({ id: "new1" });
    const r = await createCampaignWizard({ name: "Celsius FR", offers: ["celsius"], country: "France", cpa: 120 }, KEVIN);
    expect(r.ok).toBe(true);
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "campaign.created",
        metadata: expect.objectContaining({ viaWizard: true, via: "TELEGRAM" }),
      }),
    );
  });

  it("mini-tutoriel : sans compte du site, refus clair", async () => {
    const r = await dismissAffiliatesTutorial({}, { ...KEVIN, userId: null });
    expect(!r.ok && r.code).toBe("unavailable");
  });
});

describe("import des dépenses par fichier CSV (document envoyé à Kevin)", () => {
  const CSV = "Date,Campaign name,Amount spent\n2026-10-20,Celsius FR,12.5\n2026-10-21,Celsius FR,7\n";

  it("aperçu : mêmes lignes que le site, fichier vide refusé avec le même message", async () => {
    const r = await previewImport({ file: { fileName: "tt.csv", text: CSV }, platform: "OTHER" }, KEVIN);
    expect(r.ok).toBe(true);
    const p = (r.ok ? r.data?.preview : null) as { totalRows: number; filename: string } | null;
    expect(p?.totalRows).toBe(2);
    expect(p?.filename).toBe("tt.csv");
    expect(err(await previewImport({ file: { text: "" } }, KEVIN))).toBe("Choisissez d'abord un fichier CSV.");
  });

  it("import en essai à blanc : aperçu, aucune écriture ; vrai : lot d'import journalisé", async () => {
    const dry = await confirmImport({ file: { fileName: "tt.csv", text: CSV }, platform: "OTHER" }, KEVIN, { dryRun: true });
    expect(dry.ok && dry.preview?.summary).toMatch(/2 ligne\(s\) importable\(s\)/);
    expect(db.writes).toEqual([]);
    const r = await confirmImport({ file: { fileName: "tt.csv", text: CSV }, platform: "OTHER" }, KEVIN);
    expect(r.ok && r.message).toMatch(/^Import de tt.csv terminé/);
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "import.costs", metadata: expect.objectContaining({ via: "TELEGRAM" }) }),
    );
  });
});

describe("recalcul des statistiques", () => {
  it("ADMIN seulement ; essai à blanc sans mise en file", async () => {
    expect(!(await recomputeStats({}, MANAGER)).ok).toBe(true);
    const dry = await recomputeStats({}, KEVIN, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(queue.enqueue).not.toHaveBeenCalled();
    await recomputeStats({}, KEVIN);
    expect(queue.enqueue).toHaveBeenCalledWith("stats", { type: "daily", full: true }, expect.anything());
  });
});
