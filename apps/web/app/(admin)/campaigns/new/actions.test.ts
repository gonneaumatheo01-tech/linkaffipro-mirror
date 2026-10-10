/**
 * Assistant « Nouvelle campagne » (action serveur) : un double envoi ne crée pas deux campagnes (jeton), les liens
 * d'entrée vont vers le canal d'entrée choisi (pas le premier coché), une campagne sans pub se crée sans lien, et la
 * campagne pub importée choisie est reprise.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace", url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER" })),
}));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: refresh }));
const entry = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/campaigns/entry-links", () => ({ createCampaignEntryLink: entry }));
const merge = vi.hoisted(() => vi.fn(async () => ({ adSets: 1, costs: 3, platformName: "TT" })));
const byName = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null as unknown));
vi.mock("@/lib/campaigns/merge", () => ({
  mergeImportedCampaign: merge,
  findImportedShellByName: byName,
}));

const KnownError = vi.hoisted(
  () =>
    class KnownError extends Error {
      code: string;
      constructor(code: string) {
        super(code);
        this.code = code;
      }
    },
);
const settings = vi.hoisted(() => new Map<string, unknown>());
const db = vi.hoisted(() => ({
  prisma: {
    affiliateCampaign: { findMany: vi.fn() },
    channel: { findMany: vi.fn() },
    adAccountConnection: { findFirst: vi.fn() },
    campaign: { findUnique: vi.fn(), create: vi.fn() },
    setting: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  audit: vi.fn(async () => undefined),
  Prisma: { PrismaClientKnownRequestError: KnownError },
}));
vi.mock("@linkaffipro/db", () => db);

import { createCampaignWizardAction } from "./actions";

const REQ = "6f1c1f9e-2a7b-4c1d-9a51-0f0d2a4b8c3e";
function submit(payload: Record<string, unknown>): Promise<string> {
  const fd = new FormData();
  fd.set("payload", JSON.stringify(payload));
  return createCampaignWizardAction(fd).then(
    () => {
      throw new Error("aucune redirection");
    },
    (err: { url?: string }) => {
      if (!err.url) throw err;
      return err.url;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  db.prisma.affiliateCampaign.findMany.mockResolvedValue([{ id: "aff1", name: "Offre" }]);
  db.prisma.channel.findMany.mockResolvedValue([
    { id: "chA", title: "A" },
    { id: "chB", title: "B" },
  ]);
  db.prisma.adAccountConnection.findFirst.mockResolvedValue({ id: "conn1" });
  db.prisma.campaign.create.mockResolvedValue({ id: "new1" });
  db.prisma.setting.create.mockImplementation(
    async ({ data }: { data: { key: string; value: unknown } }) => {
      if (settings.has(data.key)) throw new KnownError("P2002");
      settings.set(data.key, data.value);
      return data;
    },
  );
  db.prisma.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
  );
  db.prisma.setting.update.mockImplementation(
    async ({ where, data }: { where: { key: string }; data: { value: unknown } }) => {
      settings.set(where.key, data.value);
      return {};
    },
  );
});

const base = {
  name: "TT-casinoX-FR-2026-10",
  affiliateCampaignIds: ["aff1"],
  channelIds: ["chA", "chB"],
  entryChannelId: "chB",
  adPlatform: "TIKTOK",
  adCount: 2,
  requestId: REQ,
};

describe("assistant Nouvelle campagne", () => {
  it("liens d'entrée vers le canal d'entrée choisi, pas le premier coché", async () => {
    const url = await submit(base);
    expect(url).toMatch(/^\/campaigns\/new1\?/);
    expect(entry).toHaveBeenCalledTimes(2);
    for (const call of entry.mock.calls as unknown as Array<[{ channelId: string }]>)
      expect(call[0].channelId).toBe("chB");
    expect(refresh).toHaveBeenCalled();
  });

  it("double envoi : une seule campagne, le second renvoie vers la première", async () => {
    await submit(base);
    const second = await submit(base);
    expect(db.prisma.campaign.create).toHaveBeenCalledTimes(1);
    expect(second).toMatch(/^\/campaigns\/new1\?/);
    expect(new URLSearchParams(second.split("?")[1]).get("ok")).toMatch(/déjà été créée/);
  });

  it("campagne sans pub : créée sans lien ni canal d'entrée", async () => {
    const url = await submit({ ...base, adPlatform: "", adCount: 0, entryChannelId: "" });
    expect(url).toMatch(/^\/campaigns\/new1\?/);
    expect(entry).not.toHaveBeenCalled();
  });

  it("canal d'entrée hors des canaux cochés : retour à l'étape 4", async () => {
    const url = await submit({ ...base, entryChannelId: "chZ" });
    expect(url).toMatch(/^\/campaigns\/new\?/);
    expect(new URLSearchParams(url.split("?")[1]).get("step")).toBe("ads");
    expect(db.prisma.campaign.create).not.toHaveBeenCalled();
  });

  it("campagne pub importée du compte choisi : reprise dans la nouvelle campagne", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({
      connectionId: "conn1",
      externalCampaignId: "ext-1",
      adExternalIds: { source: "sync", platformName: "TT" },
      affiliateCampaignIds: [],
      channelIds: [],
    });
    await submit({ ...base, connectionId: "conn1", importedCampaignId: "shell1" });
    expect(merge).toHaveBeenCalledWith({ targetId: "new1", shellId: "shell1", userId: "u1" });
    expect(byName).not.toHaveBeenCalled();
  });

  it("« aucune » choisie mais la campagne pub du même nom est déjà importée : elle est reprise (rapprochement par le nom)", async () => {
    byName.mockResolvedValueOnce({ id: "shell-same", name: "tt-casinox-fr-2026-10" });
    const url = await submit({ ...base, connectionId: "conn1" });
    expect(byName).toHaveBeenCalledWith("conn1", "TT-casinoX-FR-2026-10");
    expect(merge).toHaveBeenCalledWith({
      targetId: "new1",
      shellId: "shell-same",
      userId: "u1",
      matchedByName: true,
    });
    expect(new URLSearchParams(url.split("?")[1]).get("ok")).toMatch(/même nom/);
  });

  it("sans compte connecté : aucun rapprochement par le nom", async () => {
    await submit(base);
    expect(byName).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  });
});
