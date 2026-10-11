/**
 * Actions des envois groupés : un bouton refusé bloque la création AVANT tout enregistrement, et « Envoyer la
 * gagnante au reste » reprend les boutons de la gagnante tels quels (ancien bouton Offre sans campagne accepté,
 * offre retirée de la campagne remplacée comme le fait le bot) sans toucher aux liens d'origine.
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
vi.mock("@/lib/env", () => ({ env: { trackingBaseUrl: "https://go.example" } }));
vi.mock("@linkaffipro/queue", () => ({ enqueue: vi.fn(async () => ({})), enqueueDm: vi.fn() }));
vi.mock("@linkaffipro/telegram", () => ({ offerDeepLink: vi.fn(() => "https://t.me/x") }));
const usage = vi.hoisted(() => vi.fn(async (..._texts: unknown[]) => 1));
vi.mock("@/lib/custom-emoji/usage", () => ({ markCustomEmojisUsed: usage }));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/campaigns/refresh", () => ({ refreshCampaignStats: refresh }));
const ab = vi.hoisted(() => ({ cmp: null as unknown }));
vi.mock("@/lib/broadcasts/ab-queries", () => ({ loadAbComparison: vi.fn(async () => ab.cmp) }));
vi.mock("@/lib/broadcasts/ab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/broadcasts/ab")>()),
  pickWinner: vi.fn(() => ({ status: "winner", variant: "A", ctr: 0.2 })),
}));

const db = vi.hoisted(() => ({
  prisma: {
    broadcast: {
      create: vi.fn(),
      update: vi.fn(async () => ({})),
      findUniqueOrThrow: vi.fn(),
      delete: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    bot: { findUnique: vi.fn(async () => ({ id: "bot1", isActive: true })) },
    channel: { findFirst: vi.fn(async () => ({ id: "ch1" })) },
    post: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "container1", channelId: "ch1" })),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    campaign: { findUnique: vi.fn() },
    affiliateCampaign: { findUnique: vi.fn(), findMany: vi.fn() },
    trackingLink: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    member: { findUnique: vi.fn(async () => null) },
  },
  audit: vi.fn(async () => undefined),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/db", () => db);

import { enqueue, enqueueDm } from "@linkaffipro/queue";
import { requireUser } from "@/lib/session";
import { createAndTestAction, createBroadcastAction, sendWinnerToRestAction } from "./actions";

const offer = {
  id: "aff1",
  isActive: true,
  trackingUrlTemplate: "https://linkaffi.me/go/x?sub_id={subid}",
};

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
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

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.broadcast.create.mockResolvedValue({ id: "rest1" });
  db.prisma.affiliateCampaign.findUnique.mockImplementation(
    async (args: { where: { id: string } }) =>
      args.where.id === "aff1" ? offer : args.where.id === "aff2" ? { ...offer, id: "aff2" } : null,
  );
  db.prisma.affiliateCampaign.findMany.mockResolvedValue([offer, { ...offer, id: "aff2" }]);
  db.prisma.campaign.findUnique.mockResolvedValue(null);
  db.prisma.trackingLink.create.mockImplementation(async (args: { data: object }) => ({
    ...args.data,
    id: "tl-new",
    slug: "newslug1",
  }));
  ab.cmp = { rest: null, variants: [{ id: "bA", variant: "A" }] };
});

describe("création d'un envoi groupé", () => {
  it("bouton Offre sans campagne : refusé avant la création du moindre envoi", async () => {
    const url = await run(
      createBroadcastAction(
        form({
          name: "Promo",
          botId: "bot1",
          text: "Bonjour",
          intent: "now",
          buttons: JSON.stringify([
            [{ text: "Jouer", type: "OFFER", affiliateCampaignId: "aff1" }],
          ]),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
    expect(db.prisma.broadcast.create).not.toHaveBeenCalled();
    expect(db.prisma.post.create).not.toHaveBeenCalled();
  });
});

describe("envoyer la gagnante au reste", () => {
  it("test A/B d'avant la phase 8 (bouton Offre sans campagne) : l'envoi au reste part", async () => {
    db.prisma.broadcast.findUniqueOrThrow.mockResolvedValue({
      id: "bA",
      name: "Promo — A",
      botId: "bot1",
      segment: {},
      text: "Bonjour",
      mediaAssetId: null,
      buttons: [
        [
          {
            text: "Jouer",
            type: "OFFER",
            trackingLinkId: "tl-src",
            slug: "srcslug1",
            affiliateCampaignId: "aff1",
          },
        ],
      ],
    });
    db.prisma.trackingLink.findUnique.mockResolvedValue({
      id: "tl-src",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: null,
    });
    const url = await run(sendWinnerToRestAction(form({ groupId: "g1" })));
    expect(param(url, "ok")).toMatch(/envoyée au reste/);
    expect(db.prisma.broadcast.delete).not.toHaveBeenCalled();
    // Lien d'origine intact, nouveau lien pour le reste.
    expect(db.prisma.trackingLink.update).not.toHaveBeenCalled();
    expect(db.prisma.trackingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ affiliateCampaignId: "aff1", campaignId: null }),
      }),
    );
    expect(db.prisma.broadcast.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENDING" }) }),
    );
  });

  it("offre retirée de la campagne depuis : une autre offre de la campagne est prise", async () => {
    db.prisma.broadcast.findUniqueOrThrow.mockResolvedValue({
      id: "bA",
      name: "Promo — A",
      botId: "bot1",
      segment: {},
      text: "Bonjour",
      mediaAssetId: null,
      buttons: [
        [
          {
            text: "Jouer",
            type: "OFFER",
            trackingLinkId: "tl-src",
            slug: "srcslug1",
            affiliateCampaignId: "aff1",
            campaignId: "camp1",
          },
        ],
      ],
    });
    db.prisma.campaign.findUnique.mockResolvedValue({
      id: "camp1",
      name: "Ma campagne",
      affiliateCampaignIds: ["aff2"],
    });
    db.prisma.trackingLink.findUnique.mockResolvedValue({
      id: "tl-src",
      kind: "OFFER",
      affiliateCampaignId: "aff1",
      campaignId: "camp1",
    });
    const url = await run(sendWinnerToRestAction(form({ groupId: "g1" })));
    expect(param(url, "ok")).toMatch(/envoyée au reste/);
    expect(db.prisma.trackingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ affiliateCampaignId: "aff2", campaignId: "camp1" }),
      }),
    );
  });
});

describe("« Envoyer un test à moi » depuis l'assistant", () => {
  const fields = { name: "Promo", botId: "bot1", text: "Bonjour", scheduledAt: "" };
  const container = { id: "b1", botId: "bot1", text: "Bonjour", buttons: [], mediaAssetId: null };

  beforeEach(() => {
    db.prisma.broadcast.create.mockResolvedValue({ id: "b1" });
    db.prisma.broadcast.findUniqueOrThrow.mockResolvedValue({
      ...container,
      bot: { username: "casino_bot" },
    });
  });

  it("enregistre un brouillon puis envoie le test sur le Telegram de l'utilisateur, rien d'autre", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.c",
      name: "Admin",
      role: "MANAGER",
      telegramUserId: BigInt(42),
    });
    db.prisma.member.findUnique.mockResolvedValueOnce({
      id: "m1",
      botStates: [{ canDm: true }],
    } as never);
    // Même si le bouton venait d'un formulaire « Envoyer », l'intention est forcée à « brouillon ».
    const url = await run(createAndTestAction(form({ ...fields, intent: "now" })));
    expect(url.split("?")[0]).toBe("/members/broadcasts/b1");
    expect(param(url, "ok")).toBe(
      "Brouillon enregistré. Message de test envoyé sur votre Telegram (quelques secondes).",
    );
    expect(db.prisma.broadcast.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }),
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(enqueueDm).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "TEST", memberId: "m1", botId: "bot1" }),
    );
  });

  it("le test est personnalisé comme l'envoi réel : {prenom} et {bot} remplacés (valeurs échappées)", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.c",
      name: "Admin",
      role: "MANAGER",
      telegramUserId: BigInt(42),
    });
    db.prisma.broadcast.findUniqueOrThrow.mockResolvedValue({
      ...container,
      text: "Bonjour {prenom}, ici {bot}. {offre} reste tel quel.",
      bot: { username: "casino_bot", name: "Casino & Co" },
    });
    db.prisma.member.findUnique.mockResolvedValueOnce({
      id: "m1",
      firstName: "Tom <3",
      botStates: [{ canDm: true }],
    } as never);
    await run(createAndTestAction(form({ ...fields, intent: "draft" })));
    expect(enqueueDm).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "TEST",
        text: "Bonjour Tom &lt;3, ici Casino &amp; Co. {offre} reste tel quel.",
      }),
    );
  });

  it("membre sans prénom : {prenom} disparaît (comme pour les destinataires)", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({
      id: "u1",
      email: "a@b.c",
      name: "Admin",
      role: "MANAGER",
      telegramUserId: BigInt(42),
    });
    db.prisma.broadcast.findUniqueOrThrow.mockResolvedValue({
      ...container,
      text: "Bonjour {prenom} !",
      bot: { username: "casino_bot", name: "Casino" },
    });
    db.prisma.member.findUnique.mockResolvedValueOnce({
      id: "m1",
      firstName: null,
      botStates: [{ canDm: true }],
    } as never);
    await run(createAndTestAction(form({ ...fields, intent: "draft" })));
    expect(enqueueDm).toHaveBeenCalledWith(expect.objectContaining({ text: "Bonjour  !" }));
  });

  it("compte Telegram non lié : le brouillon reste, la raison s'affiche", async () => {
    const url = await run(createAndTestAction(form(fields)));
    expect(url.split("?")[0]).toBe("/members/broadcasts/b1");
    expect(param(url, "ok")).toBe("Brouillon enregistré.");
    expect(param(url, "error")).toMatch(
      /^Le test n'est pas parti\. Liez d'abord votre compte Telegram/,
    );
    expect(enqueueDm).not.toHaveBeenCalled();
  });

  it("« Envoyer » depuis l'assistant : inchangé (envoi lancé, aucun test)", async () => {
    const url = await run(createBroadcastAction(form({ ...fields, intent: "now" })));
    expect(param(url, "ok")).toBe("Envoi lancé.");
    expect(enqueue).toHaveBeenCalledWith(
      "scheduler",
      { type: "broadcast", broadcastId: "b1" },
      expect.objectContaining({ jobId: "broadcast-b1" }),
    );
    expect(enqueueDm).not.toHaveBeenCalled();
  });
});

describe("emojis animés dans un message à un groupe (phase 12)", () => {
  it("texte enregistré avec ses balises, emojis notés comme utilisés", async () => {
    usage.mockClear();
    db.prisma.broadcast.create.mockResolvedValue({ id: "b1" });
    const text = 'Bonus <tg-emoji emoji-id="5368324170671202286">🎁</tg-emoji> ce soir';
    const url = await run(
      createBroadcastAction(form({ name: "Promo", botId: "bot1", text, intent: "draft" })),
    );
    expect(param(url, "ok")).toBe("Brouillon enregistré.");
    expect(db.prisma.broadcast.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ text }) }),
    );
    expect(usage).toHaveBeenCalledWith([text]);
  });
});
