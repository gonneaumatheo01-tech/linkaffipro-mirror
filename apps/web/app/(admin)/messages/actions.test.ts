/**
 * Actions des messages de canal : un bouton refusé (Offre sans campagne, adresse invalide) bloque l'enregistrement
 * AVANT la création du moindre message (aucun message programmé fantôme publié sans ses boutons) ; un message n'est
 * programmé qu'une fois ses boutons enregistrés, et un échec en cours de route retire les messages déjà créés ;
 * rattacher un ancien bouton Offre à une campagne relance le recalcul des statistiques.
 * Emojis animés (phase 12) : publié par le compte connecté sans boutons, choix imposé avec des boutons, emojis normaux
 * si l'équipe garde les boutons, modèle gardé tel quel, programmation refusée (brouillon gardé) si le compte ne peut pas
 * publier, offre en lien dans le texte rattachée au message, « Vérifier » enfilé, emojis notés comme utilisés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const queue = vi.hoisted(() => ({ enqueue: vi.fn(async (..._args: unknown[]) => ({})) }));
vi.mock("@linkaffipro/queue", () => queue);
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
    channel: {
      findUnique: vi.fn(async () => ({ vertical: "CASINO" })),
      findMany: vi.fn(async (..._args: unknown[]) => [{ id: "ch1", title: "Casino VIP" }]),
    },
    setting: { findUnique: vi.fn(async (..._args: unknown[]): Promise<unknown> => null) },
    customEmoji: { updateMany: vi.fn(async (..._args: unknown[]) => ({ count: 1 })) },
    campaign: { findUnique: vi.fn() },
    affiliateCampaign: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    trackingLink: {
      findUnique: vi.fn(),
      findMany: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async (..._args: unknown[]) => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
  audit: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/db", () => db);

import {
  checkAccountPublishAction,
  createPostAction,
  createTextOfferLinkAction,
  updatePostAction,
} from "./actions";
import { publishingBotFor } from "@/lib/posts/queries";

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
  db.prisma.setting.findUnique.mockResolvedValue(null);
  db.prisma.trackingLink.findMany.mockResolvedValue([]);
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

describe("modification : jamais publié par un bot devenu assistant de conversation (phase 17)", () => {
  const cancelled = {
    id: "p7",
    status: "CANCELLED",
    channelId: "ch1",
    botId: "assistant",
    isTemplate: false,
    templateName: null,
  };
  const reschedule = () =>
    run(
      updatePostAction(
        form({
          postId: "p7",
          channelIds: "ch1",
          text: "Bonjour",
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );

  it("même canal : le bot actuel n'est gardé que s'il peut encore publier, sinon un bot normal le remplace", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(cancelled);
    vi.mocked(publishingBotFor).mockResolvedValueOnce({ id: "normal", username: "normal_bot" });
    const url = await reschedule();
    expect(publishingBotFor).toHaveBeenCalledWith("ch1", { keep: "assistant" });
    expect(param(url, "ok")).toBe("Message programmé.");
    expect(db.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ botId: "normal", status: "SCHEDULED" }),
      }),
    );
  });

  it("autre canal : choisi sans garder l'ancien bot", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(cancelled);
    await run(
      updatePostAction(form({ postId: "p7", channelIds: "ch2", text: "Bonjour", intent: "draft" })),
    );
    expect(publishingBotFor).toHaveBeenCalledWith("ch2", {});
  });

  it("aucun bot normal pour publier : programmation refusée, gardé en brouillon avec la raison", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(cancelled);
    vi.mocked(publishingBotFor).mockResolvedValueOnce(null);
    const url = await reschedule();
    expect(url).toMatch(/^\/messages\/p7\/edit\?/);
    expect(param(url, "error")).toMatch(/Aucun de nos bots ne peut publier dans ce canal/);
    const data = (db.prisma.post.update.mock.calls[0]![0] as { data: Record<string, unknown> })
      .data;
    expect(data).toMatchObject({ status: "DRAFT", publisher: "BOT", text: "Bonjour" });
    expect(data.botId).toBeUndefined();
  });

  it("aucun bot normal, simple brouillon : enregistré sans erreur (rien ne part)", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(cancelled);
    vi.mocked(publishingBotFor).mockResolvedValueOnce(null);
    const url = await run(
      updatePostAction(form({ postId: "p7", channelIds: "ch1", text: "Bonjour", intent: "draft" })),
    );
    expect(param(url, "ok")).toBe("Message enregistré.");
    expect(db.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }),
    );
  });
});

describe("modèles : bouton Offre dont la campagne se choisit à l'utilisation", () => {
  const offerToChoose = [[{ text: "🎁 J'en profite", type: "OFFER" }]];
  const template = {
    id: "tpl1",
    status: "DRAFT",
    channelId: "ch1",
    isTemplate: true,
    templateName: "Casino · Bonus · Tours gratuits",
  };

  it("modifier un modèle fourni (bouton Offre sans campagne) : accepté, bouton gardé tel quel, aucun lien", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(template);
    const url = await run(
      updatePostAction(
        form({
          postId: "tpl1",
          channelIds: "ch1",
          text: "Des <b>tours gratuits</b> cette semaine.",
          intent: "template",
          templateName: "Casino · Bonus · Tours gratuits",
          buttons: JSON.stringify(offerToChoose),
        }),
      ),
    );
    expect(url).toMatch(/^\/messages\/tpl1\?/);
    expect(param(url, "error")).toBe("");
    const upd = (
      db.prisma.post.update.mock.calls as unknown as Array<
        [{ where: { id: string }; data: { text: string; buttons: unknown } }]
      >
    )[0]![0];
    expect(upd.where.id).toBe("tpl1");
    expect(upd.data.text).toBe("Des <b>tours gratuits</b> cette semaine.");
    expect(upd.data.buttons).toEqual([[{ text: "🎁 J'en profite", type: "OFFER" }]]);
    expect(db.prisma.trackingLink.create).not.toHaveBeenCalled();
    expect(db.prisma.trackingLink.update).not.toHaveBeenCalled();
  });

  it("modèle avec une campagne à plusieurs offres, offre pas encore choisie : la campagne est gardée", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(template);
    await run(
      updatePostAction(
        form({
          postId: "tpl1",
          channelIds: "ch1",
          text: "Bonjour",
          intent: "template",
          buttons: JSON.stringify([[{ text: "Jouer", type: "OFFER", campaignId: "camp1" }]]),
        }),
      ),
    );
    const upd = (
      db.prisma.post.update.mock.calls as unknown as Array<[{ data: { buttons: unknown } }]>
    )[0]![0];
    expect(upd.data.buttons).toEqual([[{ text: "Jouer", type: "OFFER", campaignId: "camp1" }]]);
  });

  it("« Enregistrer comme modèle » avec un bouton Offre sans campagne : modèle créé", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "template",
          templateName: "Notre modèle",
          buttons: JSON.stringify(offerToChoose),
        }),
      ),
    );
    expect(param(url, "ok")).toBe("Modèle enregistré.");
    const created = db.prisma.post.create.mock.calls[0]![0] as {
      data: { isTemplate: boolean; templateName: string };
    };
    expect(created.data).toMatchObject({ isTemplate: true, templateName: "Notre modèle" });
    const upd = (
      db.prisma.post.update.mock.calls as unknown as Array<[{ data: { buttons: unknown } }]>
    )[0]![0];
    expect(upd.data.buttons).toEqual([[{ text: "🎁 J'en profite", type: "OFFER" }]]);
    expect(db.prisma.trackingLink.create).not.toHaveBeenCalled();
  });

  it("modèle avec campagne et offre choisies : vérifié et relié comme un message", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(template);
    await run(
      updatePostAction(
        form({
          postId: "tpl1",
          channelIds: "ch1",
          text: "Bonjour",
          intent: "template",
          buttons: JSON.stringify(offerWithCampaign),
        }),
      ),
    );
    expect(db.prisma.trackingLink.create).toHaveBeenCalledTimes(1);
    const upd = (
      db.prisma.post.update.mock.calls as unknown as Array<[{ data: { buttons: unknown } }]>
    )[0]![0];
    expect(JSON.stringify(upd.data.buttons)).toContain("camp1");
  });

  it("message ordinaire (brouillon) avec le même bouton sans campagne : toujours refusé", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue({
      ...template,
      id: "p9",
      isTemplate: false,
      templateName: null,
    });
    const url = await run(
      updatePostAction(
        form({
          postId: "p9",
          channelIds: "ch1",
          text: "Bonjour",
          intent: "draft",
          buttons: JSON.stringify(offerToChoose),
        }),
      ),
    );
    expect(url).toMatch(/^\/messages\/p9\/edit\?/);
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
    expect(db.prisma.post.update).not.toHaveBeenCalled();
  });

  it("nouveau message depuis un modèle, campagne oubliée : toujours refusé", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: "Bonjour",
          intent: "draft",
          duplicatedFromId: "tpl1",
          buttons: JSON.stringify(offerToChoose),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/choisissez une campagne/);
    expect(db.prisma.post.create).not.toHaveBeenCalled();
  });
});

const EMOJI = '<tg-emoji emoji-id="5368324170671202286">🎰</tg-emoji>';
const EMOJI_TEXT = `Jackpot ${EMOJI} ce soir`;
const URL_BUTTONS = [[{ text: "Site", type: "URL", url: "https://site.test" }]];
/** Relevé du compte connecté : il peut publier dans ch1. */
const READY = {
  checkedAt: new Date().toISOString(),
  connected: true,
  premium: true,
  user: { id: "42", firstName: "Matt", username: "matt" },
  error: null,
  channels: { ch1: { canPost: true, checkedAt: new Date().toISOString() } },
};

/** Données du dernier `post.create` (le message créé). */
function createdData(i = 0): Record<string, unknown> {
  return (db.prisma.post.create.mock.calls[i] as unknown as [{ data: Record<string, unknown> }])[0]
    .data;
}

describe("emojis animés : qui publie le message de canal", () => {
  it("emojis animés sans bouton : publié par le compte connecté, programmé si le compte peut publier", async () => {
    db.prisma.setting.findUnique.mockResolvedValue({ value: READY });
    const url = await run(
      createPostAction(
        form({ channelIds: "ch1", text: EMOJI_TEXT, intent: "schedule", scheduledAt: future() }),
      ),
    );
    expect(param(url, "ok")).toMatch(/programmé/);
    expect(createdData()).toMatchObject({ publisher: "ACCOUNT", text: EMOJI_TEXT, buttons: [] });
    expect(db.prisma.post.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { status: "SCHEDULED" },
    });
    // « Récents de l'équipe » : l'emoji est noté comme utilisé.
    expect(db.prisma.customEmoji.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customEmojiId: { in: ["5368324170671202286"] } } }),
    );
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "post.scheduled",
        metadata: expect.objectContaining({ publisher: "ACCOUNT" }),
      }),
    );
  });

  it("emojis animés ET boutons sans choix : refusé, aucun message créé", async () => {
    const url = await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "draft",
          buttons: JSON.stringify(URL_BUTTONS),
        }),
      ),
    );
    expect(url).toMatch(/^\/messages\/new\?/);
    expect(param(url, "error")).toMatch(/emojis animés et des boutons/);
    expect(db.prisma.post.create).not.toHaveBeenCalled();
  });

  it("« Garder les boutons (emojis normaux) » : publié par le bot, emojis remplacés, boutons gardés", async () => {
    await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "draft",
          buttons: JSON.stringify(URL_BUTTONS),
          emojiButtonsChoice: "buttons",
        }),
      ),
    );
    expect(createdData()).toMatchObject({ publisher: "BOT", text: "Jackpot 🎰 ce soir" });
    expect(db.prisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { buttons: [[{ text: "Site", type: "URL", url: "https://site.test" }]] },
    });
    // Aucun emoji animé enregistré : rien à noter.
    expect(db.prisma.customEmoji.updateMany).not.toHaveBeenCalled();
  });

  it("« Garder les emojis animés (sans boutons) » : publié par le compte, boutons retirés sans être vérifiés", async () => {
    await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "draft",
          // Un bouton Offre sans campagne serait refusé : il n'est plus vérifié puisqu'il est retiré.
          buttons: JSON.stringify(offerWithoutCampaign),
          emojiButtonsChoice: "emojis",
        }),
      ),
    );
    expect(createdData()).toMatchObject({ publisher: "ACCOUNT", text: EMOJI_TEXT });
    expect(db.prisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { buttons: [] },
    });
    expect(db.prisma.trackingLink.create).not.toHaveBeenCalled();
  });

  it("modèle avec emojis animés et boutons : gardé tel quel, sans choix", async () => {
    await run(
      createPostAction(
        form({
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "template",
          templateName: "Jackpot",
          buttons: JSON.stringify(URL_BUTTONS),
        }),
      ),
    );
    expect(createdData()).toMatchObject({
      publisher: "BOT",
      text: EMOJI_TEXT,
      isTemplate: true,
    });
    expect(db.prisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { buttons: [[{ text: "Site", type: "URL", url: "https://site.test" }]] },
    });
  });

  it("programmer alors que le compte ne peut pas publier : gardé en brouillon, retour au message avec la raison", async () => {
    // Aucun relevé : aucun compte connecté.
    const url = await run(
      createPostAction(
        form({ channelIds: "ch1", text: EMOJI_TEXT, intent: "schedule", scheduledAt: future() }),
      ),
    );
    expect(url).toMatch(/^\/messages\/p1\/edit\?/);
    expect(param(url, "error")).toMatch(/^Enregistré en brouillon, pas programmé/);
    expect(param(url, "error")).toContain("Réglages → Connexions → Telegram");
    expect(db.prisma.post.updateMany).not.toHaveBeenCalled();
    expect(db.prisma.post.deleteMany).not.toHaveBeenCalled();
    expect(db.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "post.drafted" }));
  });

  it("canal pas autorisé pour le compte : la raison nomme le canal", async () => {
    db.prisma.setting.findUnique.mockResolvedValue({
      value: { ...READY, channels: { ch1: { canPost: false, checkedAt: READY.checkedAt } } },
    });
    const url = await run(
      createPostAction(
        form({ channelIds: "ch1", text: EMOJI_TEXT, intent: "schedule", scheduledAt: future() }),
      ),
    );
    expect(param(url, "error")).toMatch(/ne peut pas encore publier dans «\sCasino VIP\s»/);
  });

  it("brouillon : jamais bloqué par le compte connecté", async () => {
    const url = await run(
      createPostAction(form({ channelIds: "ch1", text: EMOJI_TEXT, intent: "draft" })),
    );
    expect(param(url, "ok")).toMatch(/brouillon/);
    expect(db.prisma.setting.findUnique).not.toHaveBeenCalled();
  });
});

describe("emojis animés : modification d'un message", () => {
  const existing = {
    id: "p5",
    status: "SCHEDULED",
    isTemplate: false,
    templateName: null,
    channelId: "ch1",
  };

  it("emojis ajoutés à un message à boutons : choix exigé, rien d'enregistré", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(existing);
    const url = await run(
      updatePostAction(
        form({
          postId: "p5",
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(URL_BUTTONS),
        }),
      ),
    );
    expect(url).toMatch(/^\/messages\/p5\/edit\?/);
    expect(param(url, "error")).toMatch(/emojis animés et des boutons/);
    expect(db.prisma.post.update).not.toHaveBeenCalled();
  });

  it("programmé, compte sans Premium : enregistré en brouillon avec le texte, raison affichée", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(existing);
    db.prisma.setting.findUnique.mockResolvedValue({ value: { ...READY, premium: false } });
    const url = await run(
      updatePostAction(
        form({
          postId: "p5",
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );
    expect(url).toMatch(/^\/messages\/p5\/edit\?/);
    expect(param(url, "error")).toMatch(/Premium/);
    expect(db.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT", publisher: "ACCOUNT", text: EMOJI_TEXT }),
      }),
    );
  });

  it("emojis retirés : de nouveau publié par le bot", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue(existing);
    await run(
      updatePostAction(
        form({ postId: "p5", channelIds: "ch1", text: "Plus d'emoji", intent: "draft" }),
      ),
    );
    expect(db.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publisher: "BOT", status: "DRAFT" }),
      }),
    );
  });
});

describe("offre ajoutée comme lien dans le texte", () => {
  it("création : campagne et offre vérifiées, lien traqué BUTTON sans identifiant par membre", async () => {
    const r = await createTextOfferLinkAction({
      campaignId: "camp1",
      affiliateCampaignId: "aff1",
      label: "Jouer <vite>",
    });
    expect(r).toEqual({
      ok: true,
      url: "https://go.goolink.eu/slug1xx",
      html: '<a href="https://go.goolink.eu/slug1xx">Jouer &lt;vite&gt;</a>',
    });
    expect(db.prisma.trackingLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "BUTTON",
        destinationTemplate: "https://linkaffi.me/go/x",
        label: "Jouer <vite> (lien dans le texte)",
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
        createdById: "u1",
      }),
      select: { id: true, slug: true },
    });
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tracking_link.text_offer_created" }),
    );
  });

  it("refus : campagne manquante, texte vide, offre qui n'est plus dans la campagne", async () => {
    expect(await createTextOfferLinkAction({ label: "Jouer" })).toEqual({
      ok: false,
      error: "Choisissez la campagne de l'offre.",
    });
    expect(
      await createTextOfferLinkAction({
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
        label: " ",
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/texte du lien/) });
    db.prisma.campaign.findUnique.mockResolvedValue({
      id: "camp1",
      name: "Ma campagne",
      affiliateCampaignIds: ["autre"],
    });
    expect(
      await createTextOfferLinkAction({
        campaignId: "camp1",
        affiliateCampaignId: "aff1",
        label: "Jouer",
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/n'est plus dans la campagne/) });
    expect(db.prisma.trackingLink.create).not.toHaveBeenCalled();
  });

  it("enregistrement : le lien libre du texte est rattaché au message et à son canal", async () => {
    db.prisma.trackingLink.findMany.mockResolvedValue([
      { id: "tl-text", slug: "Txt12345", postId: null, channelId: null },
    ]);
    const text = `${EMOJI_TEXT}\n\n<a href="https://go.goolink.eu/Txt12345">Jouer</a>`;
    await run(createPostAction(form({ channelIds: "ch1", text, intent: "draft" })));
    expect(db.prisma.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { id: "tl-text", postId: null },
      data: { postId: "p1", channelId: "ch1", isActive: true },
    });
  });

  it("deux canaux : le second message reçoit sa propre copie du lien", async () => {
    db.prisma.trackingLink.findMany
      .mockResolvedValueOnce([{ id: "tl-text", slug: "Txt12345", postId: null, channelId: null }])
      .mockResolvedValueOnce([
        {
          id: "tl-text",
          slug: "Txt12345",
          postId: "p1",
          channelId: "ch1",
          destinationTemplate: "https://linkaffi.me/go/x",
          label: "Jouer (lien dans le texte)",
          campaignId: "camp1",
          affiliateCampaignId: "aff1",
        },
      ]);
    const text = `Salut <a href="https://go.goolink.eu/Txt12345">Jouer</a>`;
    await run(createPostAction(form({ channelIds: ["ch1", "ch2"], text, intent: "draft" })));
    expect(db.prisma.trackingLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "BUTTON", postId: "p2", channelId: "ch2" }),
      select: { id: true, slug: true },
    });
    expect(db.prisma.post.update).toHaveBeenCalledWith({
      where: { id: "p2" },
      data: { buttons: [], text: 'Salut <a href="https://go.goolink.eu/slug1xx">Jouer</a>' },
    });
  });
});

describe("« Vérifier » le compte Telegram connecté", () => {
  it("enfile le relevé des canaux du message et le journalise", async () => {
    db.prisma.channel.findMany.mockResolvedValue([{ id: "ch1", title: "Casino VIP" }]);
    const r = await checkAccountPublishAction(["ch1", "ch1", "inconnu"]);
    expect(r).toMatchObject({ ok: true });
    expect(queue.enqueue).toHaveBeenCalledWith(
      "custom-emoji",
      { type: "account-status", channelIds: ["ch1"] },
      expect.objectContaining({ jobId: expect.stringMatching(/^custom-emoji:account-status:/) }),
    );
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "post.account_check_requested" }),
    );
  });

  it("service d'arrière-plan muet : message clair", async () => {
    queue.enqueue.mockRejectedValueOnce(new Error("redis"));
    expect(await checkAccountPublishAction(["ch1"])).toEqual({
      ok: false,
      error: "Le service d'arrière-plan ne répond pas : réessayez dans une minute.",
    });
  });
});

describe("emojis animés dans un groupe ou un supergroupe : le bot publie lui-même", () => {
  /** Types des canaux (`Channel.type`) renvoyés par la base simulée. */
  function chatTypes(types: Record<string, "CHANNEL" | "GROUP">) {
    const titles: Record<string, string> = { ch1: "Casino VIP", g1: "Groupe Casino" };
    db.prisma.channel.findMany.mockImplementation(async (...args: unknown[]) => {
      const where = (args[0] as { where?: { id?: { in?: string[] } } } | undefined)?.where;
      return (where?.id?.in ?? Object.keys(types)).map((id) => ({
        id,
        title: titles[id] ?? id,
        type: types[id] ?? "CHANNEL",
      }));
    });
  }
  afterEach(() => {
    db.prisma.channel.findMany.mockImplementation(async () => [{ id: "ch1", title: "Casino VIP" }]);
  });

  it("groupe : emojis animés ET boutons sans choix → publié par le bot, tout gardé, programmé sans compte connecté", async () => {
    chatTypes({ g1: "GROUP" });
    const url = await run(
      createPostAction(
        form({
          channelIds: "g1",
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(URL_BUTTONS),
          protectContent: "on",
        }),
      ),
    );
    expect(param(url, "ok")).toMatch(/programmé/);
    expect(createdData()).toMatchObject({
      channelId: "g1",
      publisher: "BOT",
      text: EMOJI_TEXT,
      protectContent: true,
    });
    expect(db.prisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { buttons: URL_BUTTONS },
    });
    expect(db.prisma.post.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { status: "SCHEDULED" },
    });
    // Le compte connecté n'est pas concerné : son état n'est même pas lu.
    expect(db.prisma.setting.findUnique).not.toHaveBeenCalled();
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ publisher: "BOT" }) }),
    );
  });

  it("canal et groupe cochés : compte dans le canal (seul vérifié), bot dans le groupe ; contenu protégé seulement pour le bot", async () => {
    chatTypes({ ch1: "CHANNEL", g1: "GROUP" });
    // Le relevé ne connaît que ch1 : le groupe n'a pas à y figurer.
    db.prisma.setting.findUnique.mockResolvedValue({ value: READY });
    const url = await run(
      createPostAction(
        form({
          channelIds: ["ch1", "g1"],
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          protectContent: "on",
        }),
      ),
    );
    expect(param(url, "ok")).toMatch(/2 message\(s\) programmé/);
    expect(createdData(0)).toMatchObject({
      channelId: "ch1",
      publisher: "ACCOUNT",
      text: EMOJI_TEXT,
      // Telegram réserve la protection d'un message aux bots : rien d'enregistré qui ne serait pas appliqué.
      protectContent: false,
    });
    expect(createdData(1)).toMatchObject({
      channelId: "g1",
      publisher: "BOT",
      text: EMOJI_TEXT,
      protectContent: true,
    });
  });

  it("modification d'un message de groupe : emojis animés et boutons gardés, publié par le bot", async () => {
    chatTypes({ g1: "GROUP" });
    db.prisma.post.findUniqueOrThrow.mockResolvedValue({
      id: "p7",
      status: "DRAFT",
      isTemplate: false,
      templateName: null,
      channelId: "g1",
    });
    const url = await run(
      updatePostAction(
        form({
          postId: "p7",
          channelIds: "g1",
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(URL_BUTTONS),
        }),
      ),
    );
    expect(param(url, "ok")).toBe("Message programmé.");
    expect(db.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SCHEDULED",
          publisher: "BOT",
          text: EMOJI_TEXT,
          buttons: URL_BUTTONS,
        }),
      }),
    );
  });

  it("message publié par le compte : « Contenu protégé » jamais enregistré (modification)", async () => {
    db.prisma.post.findUniqueOrThrow.mockResolvedValue({
      id: "p8",
      status: "DRAFT",
      isTemplate: false,
      templateName: null,
      channelId: "ch1",
    });
    await run(
      updatePostAction(
        form({
          postId: "p8",
          channelIds: "ch1",
          text: EMOJI_TEXT,
          intent: "draft",
          protectContent: "on",
        }),
      ),
    );
    expect(db.prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publisher: "ACCOUNT", protectContent: false }),
      }),
    );
  });
});
