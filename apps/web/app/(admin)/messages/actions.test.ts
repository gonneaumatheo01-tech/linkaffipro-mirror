/**
 * Actions des messages de canal : un bouton refusé (Offre sans campagne, adresse invalide) bloque l'enregistrement
 * AVANT la création du moindre message (aucun message programmé fantôme publié sans ses boutons) ; un message n'est
 * programmé qu'une fois ses boutons enregistrés, et un échec en cours de route retire les messages déjà créés ;
 * rattacher un ancien bouton Offre à une campagne relance le recalcul des statistiques.
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
  requireAdmin: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/posts/queries", () => ({
  publishingBotFor: vi.fn(async () => ({ id: "bot1" })),
}));
vi.mock("@linkaffipro/queue", () => ({ enqueue: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: refresh }));

const db = vi.hoisted(() => ({
  prisma: {
    post: {
      create: vi.fn(),
      update: vi.fn(async (..._args: unknown[]) => ({})),
      updateMany: vi.fn(async (..._args: unknown[]) => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    channel: { findUnique: vi.fn(async () => ({ vertical: "CASINO" })) },
    campaign: { findUnique: vi.fn() },
    affiliateCampaign: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    trackingLink: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
  audit: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/db", () => db);

import { createPostAction, updatePostAction } from "./actions";

/** Date à venir au format du formulaire (heure de Paris, AAAA-MM-JJTHH:MM). */
function future(): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  return d.toISOString().slice(0, 16);
}

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

async function run(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return url;
    throw err;
  }
  throw new Error("aucune redirection");
}

function param(url: string, key: string): string {
  return new URLSearchParams(url.split("?")[1] ?? "").get(key) ?? "";
}

let postSeq = 0;
beforeEach(() => {
  vi.clearAllMocks();
  postSeq = 0;
  db.prisma.post.create.mockImplementation(async () => ({ id: `p${++postSeq}` }));
  db.prisma.campaign.findUnique.mockResolvedValue({
    id: "camp1",
    name: "Ma campagne",
    affiliateCampaignIds: ["aff1"],
  });
  db.prisma.affiliateCampaign.findUnique.mockResolvedValue({
    id: "aff1",
    isActive: true,
    trackingUrlTemplate: "https://linkaffi.me/go/x?sub_id={subid}",
  });
  db.prisma.trackingLink.findUnique.mockResolvedValue(null);
  let linkSeq = 0;
  db.prisma.trackingLink.create.mockImplementation(async (args: { data: object }) => ({
    ...args.data,
    id: `tl${++linkSeq}`,
    slug: `slug${linkSeq}xx`,
  }));
  db.prisma.trackingLink.update.mockImplementation(
    async (args: { where: { id: string }; data: object }) => ({
      ...args.data,
      id: args.where.id,
      slug: "oldslug1",
    }),
  );
});

const offerWithoutCampaign = [[{ text: "Jouer", type: "OFFER", affiliateCampaignId: "aff1" }]];
const offerWithCampaign = [
  [{ text: "Jouer", type: "OFFER", affiliateCampaignId: "aff1", campaignId: "camp1" }],
];

describe("création d'un message : boutons vérifiés avant tout enregistrement", () => {
  it("bouton Offre sans campagne (copie d'un ancien message) : refusé, aucun message créé", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(offerWithoutCampaign),
        }),
      ),
    );
    expect(url).toMatch(/^\/messages\/new\?/);
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
    expect(db.prisma.post.create).not.toHaveBeenCalled();
  });

  it("copie refusée : retour sur la copie du message d'origine, pas sur un formulaire vide", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "draft",
          duplicatedFromId: "p-old",
          buttons: JSON.stringify(offerWithoutCampaign),
        }),
      ),
    );
    expect(param(url, "from")).toBe("p-old");
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
  });

  it("adresse invalide : refusée avant la création du message", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify([[{ text: "Site", type: "URL", url: "ftp://x" }]]),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/https/);
    expect(db.prisma.post.create).not.toHaveBeenCalled();
  });

  it("version B refusée : aucun message A ni B créé", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(offerWithCampaign),
          abEnabled: "1",
          textB: "Salut",
          buttonsB: JSON.stringify(offerWithoutCampaign),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
    expect(db.prisma.post.create).not.toHaveBeenCalled();
  });

  it("message programmé : créé en brouillon, programmé seulement avec ses boutons", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(offerWithCampaign),
        }),
      ),
    );
    expect(param(url, "ok")).toMatch(/programmé/);
    const created = db.prisma.post.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe("DRAFT");
    const upd = (
      db.prisma.post.update.mock.calls as unknown as Array<[{ data: { buttons: unknown } }]>
    )[0]![0];
    expect(JSON.stringify(upd.data.buttons)).toContain("camp1");
    // Programmé après l'enregistrement des boutons.
    expect(db.prisma.post.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { status: "SCHEDULED" },
    });
    expect(db.prisma.post.updateMany.mock.invocationCallOrder[0]!).toBeGreaterThan(
      db.prisma.post.update.mock.invocationCallOrder[0]!,
    );
  });

  it("échec pendant l'enregistrement du second canal : les messages déjà créés sont retirés", async () => {
    db.prisma.trackingLink.create
      .mockImplementationOnce(async (args: { data: object }) => ({
        ...args.data,
        id: "tl1",
        slug: "slug1xxx",
      }))
      .mockRejectedValueOnce(new Error("base indisponible"));
    const url = await run(
      createPostAction(
        form({
          channelIds: ["ch1", "ch2"],
          text: "Bonjour",
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(offerWithCampaign),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/indisponible/);
    expect(db.prisma.post.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
    });
    expect(db.prisma.trackingLink.deleteMany).toHaveBeenCalledWith({
      where: { postId: { in: ["p1", "p2"] } },
    });
    // Aucun des deux n'a été programmé, rien n'est journalisé pour eux.
    expect(db.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });
});

describe("modification d'un message", () => {
  it("ancien bouton Offre rattaché à une campagne : recalcul complet des statistiques demandé", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue({
      id: "p9",
      status: "DRAFT",
      channelId: "ch1",
      isTemplate: false,
      templateName: null,
    });
    db.prisma.trackingLink.findUnique.mockResolvedValue({
      id: "tl-old",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: null,
    });
    await run(
      updatePostAction(
        form({
          postId: "p9",
          channelIds: "ch1",
          text: "Bonjour",
          intent: "draft",
          buttons: JSON.stringify([
            [
              {
                text: "Jouer",
                type: "OFFER",
                trackingLinkId: "tl-old",
                affiliateCampaignId: "aff1",
                campaignId: "camp1",
              },
            ],
          ]),
        }),
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("bouton inchangé : pas de recalcul", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue({
      id: "p9",
      status: "DRAFT",
      channelId: "ch1",
      isTemplate: false,
      templateName: null,
    });
    db.prisma.trackingLink.findUnique.mockResolvedValue({
      id: "tl-old",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: "camp1",
    });
    await run(
      updatePostAction(
        form({
          postId: "p9",
          channelIds: "ch1",
          text: "Bonjour",
          intent: "draft",
          buttons: JSON.stringify([
            [
              {
                text: "Jouer",
                type: "OFFER",
                trackingLinkId: "tl-old",
                affiliateCampaignId: "aff1",
                campaignId: "camp1",
              },
            ],
          ]),
        }),
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
