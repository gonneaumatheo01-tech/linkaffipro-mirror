/**
 * Phase 12, messages de canal avec emojis animés, sur base réelle (aucun appel à Telegram) :
 * - emojis animés sans bouton → publié par le compte connecté (`publisher` ACCOUNT), programmé si le compte peut
 *   publier dans le canal, sans boutons ;
 * - emojis animés ET boutons sans choix → refusé, rien d'enregistré ; « Garder les boutons » → publié par le bot avec les
 *   emojis normaux ; « Garder les emojis animés » → compte, boutons retirés ;
 * - modèle avec emojis animés et boutons → gardé tel quel ; un message créé depuis ce modèle exige le choix ;
 * - prérequis manquants (aucun compte, canal non autorisé) → programmation refusée, message gardé en brouillon ;
 * - groupe ou supergroupe → publié par le bot, emojis animés et boutons gardés, sans compte connecté ;
 * - « Contenu protégé » jamais enregistré pour un message publié par le compte (Telegram le réserve aux bots) ;
 * - offre ajoutée comme lien dans le texte → lien traqué rattaché au message, copié pour un second canal ;
 * - emojis notés comme utilisés (« Récents de l'équipe ») ; « Vérifier » enfile le relevé du compte.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { capturedJobs, createBotAndChannel, resetDb } from "./helpers";

const session = vi.hoisted(() => ({
  user: {
    id: "",
    email: "emojis@custom-emoji-posts.test.local",
    name: "Équipe emojis",
    role: "MANAGER",
    telegramUserId: null as bigint | null,
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => ({ ...session.user, role: "ADMIN" }),
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const actions = await import("@/app/(admin)/messages/actions");
const { env } = await import("@/lib/env");
const { emojiFallbackSentence, emojiFallbackWhere } =
  await import("@/lib/custom-emoji/dm-fallback");

const E1 = "5368324170671202286";
const E2 = "5377498341074542641";
const EMOJI_TEXT = `Jackpot <tg-emoji emoji-id="${E1}">🎰</tg-emoji> ce soir <tg-emoji emoji-id="${E2}">🔥</tg-emoji>`;
const URL_BUTTONS = [[{ text: "Site", type: "URL", url: "https://site.test" }]];
const TRACKED_BUTTONS = [[{ text: "Suivi", type: "BUTTON", url: "https://site.test/suivi" }]];
const STATUS_KEY = "mtproto.publishStatus";
const ids: Record<string, string> = {};

/** Date à venir au format du formulaire (heure de Paris, AAAA-MM-JJTHH:MM). */
function future(days = 3): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);
}

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

/** Lance une action serveur et renvoie l'adresse de redirection. */
async function redirectOf(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("aucune redirection");
}

function param(url: string, key: string): string {
  return new URLSearchParams(url.split("?")[1] ?? "").get(key) ?? "";
}

/** Relevé du compte connecté : il peut publier dans les canaux donnés (et pas dans les autres). */
async function setStatus(value: Record<string, unknown> | null) {
  if (value === null) {
    await prisma.setting.deleteMany({ where: { key: STATUS_KEY } });
    return;
  }
  await prisma.setting.upsert({
    where: { key: STATUS_KEY },
    create: { key: STATUS_KEY, value: value as never },
    update: { value: value as never },
  });
}
function ready(channelIds: string[], extra: Record<string, unknown> = {}) {
  const at = new Date().toISOString();
  return {
    checkedAt: at,
    connected: true,
    premium: true,
    user: { id: "4242", firstName: "Matt", username: "matt" },
    error: null,
    channels: Object.fromEntries(channelIds.map((id) => [id, { canPost: true, checkedAt: at }])),
    ...extra,
  };
}

/** Messages créés par l'équipe de test (du plus ancien au plus récent). */
function myPosts() {
  return prisma.post.findMany({
    where: { createdById: session.user.id },
    orderBy: { createdAt: "asc" },
    include: { trackingLinks: true },
  });
}

const BROADCAST_NAME = "Envoi emojis normaux (test)";

/** Envoi à un groupe du test (non vidé par resetDb : retiré avant, sinon son bot ne pourrait pas l'être). */
async function dropBroadcasts() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await prisma.outboundMessage.deleteMany({ where: { broadcast: { name: BROADCAST_NAME } } });
  await prisma.broadcast.deleteMany({ where: { name: BROADCAST_NAME } });
}

async function cleanExtras() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await dropBroadcasts();
  await prisma.trackingLink.deleteMany({ where: { createdBy: { email: session.user.email } } });
  await prisma.post.deleteMany({ where: { createdBy: { email: session.user.email } } });
  await prisma.auditLog.deleteMany({ where: { user: { email: session.user.email } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
  await prisma.customEmoji.deleteMany({ where: { customEmojiId: { in: [E1, E2] } } });
  await prisma.campaign.deleteMany({ where: { name: "Campagne emojis (test)" } });
  await prisma.setting.deleteMany({ where: { key: STATUS_KEY } });
}

beforeAll(async () => {
  await dropBroadcasts();
  await resetDb();
  await cleanExtras();
  const u = await prisma.user.create({
    data: {
      email: session.user.email,
      name: session.user.name,
      passwordHash: "x",
      role: "MANAGER",
    },
  });
  session.user.id = u.id;
  const { bot, channel } = await createBotAndChannel({ title: "Casino VIP" });
  ids.bot = bot.id;
  ids.channel = channel.id;
  const second = await prisma.channel.create({
    data: {
      telegramChatId: -1009876543210n,
      title: "Casino Test 2",
      type: "CHANNEL",
      language: "fr",
      primaryBotId: bot.id,
      isTest: true,
    },
  });
  await prisma.channelBotAdmin.create({
    data: { channelId: second.id, botId: bot.id, rights: { status: "administrator" } },
  });
  ids.channel2 = second.id;
  // Supergroupe (`Channel.type` GROUP) : le bot y publie lui-même les emojis animés.
  const group = await prisma.channel.create({
    data: {
      telegramChatId: -1005555555555n,
      title: "Groupe Casino",
      type: "GROUP",
      language: "fr",
      primaryBotId: bot.id,
      isTest: true,
    },
  });
  await prisma.channelBotAdmin.create({
    data: { channelId: group.id, botId: bot.id, rights: { status: "administrator" } },
  });
  ids.group = group.id;
  const program = await prisma.affiliateProgram.create({ data: { name: "Programme emojis" } });
  const offer = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "emoji-offer",
      name: "Offre emojis",
      trackingUrlTemplate: "https://linkaffi.me/go/emoji42?sub_id={subid}",
    },
  });
  ids.offer = offer.id;
  ids.campaign = (
    await prisma.campaign.create({
      data: { name: "Campagne emojis (test)", affiliateCampaignIds: [offer.id] },
    })
  ).id;
  await prisma.customEmoji.createMany({
    data: [
      { customEmojiId: E1, fallback: "🎰", source: "FORWARD" },
      { customEmojiId: E2, fallback: "🔥", source: "PACK" },
    ],
  });
});

beforeEach(async () => {
  await prisma.trackingLink.deleteMany({ where: { createdById: session.user.id } });
  await prisma.post.deleteMany({ where: { createdById: session.user.id } });
  await setStatus(ready([ids.channel!, ids.channel2!]));
  (globalThis.__jobs ??= []).length = 0;
});

afterAll(cleanExtras);

describe("qui publie un message de canal avec des emojis animés", () => {
  it("sans bouton : programmé, publié par le compte connecté, balises gardées, emojis notés comme utilisés", async () => {
    const before = await prisma.customEmoji.findUniqueOrThrow({ where: { customEmojiId: E1 } });
    const url = await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );
    expect(param(url, "ok")).toMatch(/programmé/);
    const [post] = await myPosts();
    expect(post).toMatchObject({
      status: "SCHEDULED",
      publisher: "ACCOUNT",
      text: EMOJI_TEXT,
      buttons: [],
    });
    const after = await prisma.customEmoji.findUniqueOrThrow({ where: { customEmojiId: E1 } });
    expect(after.useCount).toBe(before.useCount + 1);
    expect(after.lastUsedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirst({
      where: { userId: session.user.id, entityId: post!.id, action: "post.scheduled" },
    });
    expect(log?.metadata).toMatchObject({ publisher: "ACCOUNT" });
  });

  it("emojis animés ET boutons sans choix : refusé, aucun message", async () => {
    const url = await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(URL_BUTTONS),
        }),
      ),
    );
    expect(param(url, "error")).toMatch(/emojis animés et des boutons/);
    expect(await myPosts()).toHaveLength(0);
  });

  it("« Garder les boutons (emojis normaux) » : publié par le bot, emojis remplacés, lien traqué du bouton créé", async () => {
    await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(TRACKED_BUTTONS),
          emojiButtonsChoice: "buttons",
        }),
      ),
    );
    const [post] = await myPosts();
    expect(post).toMatchObject({
      status: "SCHEDULED",
      publisher: "BOT",
      text: "Jackpot 🎰 ce soir 🔥",
    });
    expect(post!.trackingLinks).toHaveLength(1);
    expect(post!.trackingLinks[0]).toMatchObject({ kind: "BUTTON", label: "Suivi" });
  });

  it("« Garder les emojis animés (sans boutons) » : publié par le compte, boutons retirés, aucun lien créé", async () => {
    await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "draft",
          buttons: JSON.stringify(TRACKED_BUTTONS),
          emojiButtonsChoice: "emojis",
        }),
      ),
    );
    const [post] = await myPosts();
    expect(post).toMatchObject({ status: "DRAFT", publisher: "ACCOUNT", buttons: [] });
    expect(post!.trackingLinks).toHaveLength(0);
  });
});

describe("groupe ou supergroupe : le bot publie lui-même les emojis animés", () => {
  it("emojis animés ET boutons, sans choix ni compte connecté : programmé, publié par le bot, tout gardé", async () => {
    await setStatus(null);
    const url = await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.group!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          buttons: JSON.stringify(TRACKED_BUTTONS),
          protectContent: "on",
        }),
      ),
    );
    expect(param(url, "ok")).toMatch(/programmé/);
    const [post] = await myPosts();
    expect(post).toMatchObject({
      channelId: ids.group,
      status: "SCHEDULED",
      publisher: "BOT",
      text: EMOJI_TEXT,
      protectContent: true,
    });
    expect(post!.trackingLinks).toHaveLength(1);
    expect(post!.buttons).toMatchObject([[{ text: "Suivi", type: "BUTTON" }]]);
  });

  it("canal et groupe cochés : compte dans le canal (contenu protégé non enregistré), bot dans le groupe", async () => {
    // Le relevé du compte ne connaît que le canal : le groupe n'en a pas besoin.
    await setStatus(ready([ids.channel!]));
    const url = await redirectOf(
      actions.createPostAction(
        form({
          channelIds: [ids.channel!, ids.group!],
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
          protectContent: "on",
        }),
      ),
    );
    expect(param(url, "ok")).toMatch(/2 message\(s\) programmé/);
    const posts = await myPosts();
    const byChannel = Object.fromEntries(posts.map((p) => [p.channelId, p]));
    expect(byChannel[ids.channel!]).toMatchObject({
      status: "SCHEDULED",
      publisher: "ACCOUNT",
      protectContent: false,
    });
    expect(byChannel[ids.group!]).toMatchObject({
      status: "SCHEDULED",
      publisher: "BOT",
      text: EMOJI_TEXT,
      protectContent: true,
    });
  });
});

describe("messages privés partis avec les emojis normaux (fiche d'un envoi à un groupe)", () => {
  it("compte seulement les messages partis de cet envoi qui portent la note du service d'arrière-plan", async () => {
    const broadcast = await prisma.broadcast.create({
      data: { name: BROADCAST_NAME, botId: ids.bot!, text: EMOJI_TEXT, status: "SENT" },
    });
    const other = await prisma.broadcast.create({
      data: { name: BROADCAST_NAME, botId: ids.bot!, text: EMOJI_TEXT, status: "SENT" },
    });
    const members = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        prisma.member.create({ data: { telegramUserId: BigInt(77_000_000 + n) } }),
      ),
    );
    const msg = (
      i: number,
      status: "SENT" | "FAILED",
      error: string | null,
      broadcastId = broadcast.id,
    ) => ({
      botId: ids.bot!,
      memberId: members[i]!.id,
      kind: "BROADCAST" as const,
      broadcastId,
      text: EMOJI_TEXT,
      status,
      error,
    });
    await prisma.outboundMessage.createMany({
      data: [
        msg(0, "SENT", "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés."),
        msg(1, "SENT", "Telegram a affiché les emojis normaux à la place des emojis animés."),
        msg(2, "SENT", null),
        msg(3, "FAILED", "Bad Request: emojis normaux"),
        msg(
          4,
          "SENT",
          "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés.",
          other.id,
        ),
      ],
    });
    const count = await prisma.outboundMessage.count({ where: emojiFallbackWhere(broadcast.id) });
    expect(count).toBe(2);
    expect(emojiFallbackSentence(count)).toMatch(/^2 messages sont partis avec les emojis normaux/);
    await dropBroadcasts();
    await prisma.member.deleteMany({ where: { id: { in: members.map((m) => m.id) } } });
  });
});

describe("modèle avec des emojis animés", () => {
  it("gardé tel quel (emojis et boutons) ; le message créé depuis le modèle exige le choix", async () => {
    await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "template",
          templateName: "Jackpot animé",
          buttons: JSON.stringify(URL_BUTTONS),
        }),
      ),
    );
    const [tpl] = await myPosts();
    expect(tpl).toMatchObject({
      isTemplate: true,
      publisher: "BOT",
      text: EMOJI_TEXT,
      buttons: URL_BUTTONS,
    });
    const url = await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: tpl!.text,
          intent: "draft",
          buttons: JSON.stringify(URL_BUTTONS),
          duplicatedFromId: tpl!.id,
        }),
      ),
    );
    // Refus : retour sur le modèle (contenu rechargé), rien de plus en base.
    expect(param(url, "from")).toBe(tpl!.id);
    expect(param(url, "error")).toMatch(/emojis animés et des boutons/);
    expect(await myPosts()).toHaveLength(1);
  });
});

describe("prérequis du compte Telegram connecté", () => {
  it("aucun compte connecté : pas programmé, gardé en brouillon, retour au message avec la raison", async () => {
    await setStatus(null);
    const url = await redirectOf(
      actions.createPostAction(
        form({
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );
    const [post] = await myPosts();
    expect(url).toMatch(new RegExp(`^/messages/${post!.id}/edit\\?`));
    expect(param(url, "error")).toMatch(/^Enregistré en brouillon, pas programmé/);
    expect(param(url, "error")).toContain("Réglages → Connexions → Telegram");
    expect(post).toMatchObject({ status: "DRAFT", publisher: "ACCOUNT", text: EMOJI_TEXT });
    expect(post!.scheduledAt).not.toBeNull();
  });

  it("modification : canal où le compte n'a pas le droit de publier → brouillon, raison qui nomme le canal", async () => {
    await setStatus(
      ready([ids.channel2!], {
        channels: {
          [ids.channel!]: { canPost: false, checkedAt: new Date().toISOString(), error: null },
        },
      }),
    );
    const draft = await prisma.post.create({
      data: {
        code: "EMOJIED1",
        channelId: ids.channel!,
        botId: ids.bot!,
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() + 86_400_000),
        text: "Sans emoji",
        createdById: session.user.id,
      },
    });
    const url = await redirectOf(
      actions.updatePostAction(
        form({
          postId: draft.id,
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );
    expect(url).toMatch(new RegExp(`^/messages/${draft.id}/edit\\?`));
    expect(param(url, "error")).toMatch(/ne peut pas encore publier dans «\sCasino VIP\s»/);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: "DRAFT",
      publisher: "ACCOUNT",
      text: EMOJI_TEXT,
    });
  });

  it("compte prêt : la même modification est programmée", async () => {
    const draft = await prisma.post.create({
      data: {
        code: "EMOJIED2",
        channelId: ids.channel!,
        botId: ids.bot!,
        status: "DRAFT",
        text: "Sans emoji",
        createdById: session.user.id,
      },
    });
    const url = await redirectOf(
      actions.updatePostAction(
        form({
          postId: draft.id,
          channelIds: ids.channel!,
          text: EMOJI_TEXT,
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );
    expect(param(url, "ok")).toBe("Message programmé.");
    expect(await prisma.post.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: "SCHEDULED",
      publisher: "ACCOUNT",
    });
  });

  it("« Vérifier » : relevé du compte enfilé pour ces canaux", async () => {
    const r = await actions.checkAccountPublishAction([ids.channel!, "inconnu"]);
    expect(r.ok).toBe(true);
    const jobs = capturedJobs("custom-emoji");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ type: "account-status", channelIds: [ids.channel!] });
    expect(await actions.accountPublishStatusAction()).toMatchObject({ connected: true });
  });
});

describe("offre ajoutée comme lien dans le texte", () => {
  it("lien traqué de l'offre de la campagne, rattaché au message, copié pour le second canal, clics comptés à part", async () => {
    const created = await actions.createTextOfferLinkAction({
      campaignId: ids.campaign,
      affiliateCampaignId: ids.offer,
      label: "👉 Profiter de l'offre",
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.url.startsWith(`${env.trackingBaseUrl}/`)).toBe(true);
    const slug = created.url.split("/").pop()!;
    const link = await prisma.trackingLink.findUniqueOrThrow({ where: { slug } });
    expect(link).toMatchObject({
      kind: "BUTTON",
      campaignId: ids.campaign,
      affiliateCampaignId: ids.offer,
      destinationTemplate: "https://linkaffi.me/go/emoji42",
      postId: null,
    });

    const text = `${EMOJI_TEXT}\n\n${created.html}`;
    await redirectOf(
      actions.createPostAction(
        form({
          channelIds: [ids.channel!, ids.channel2!],
          text,
          intent: "schedule",
          scheduledAt: future(),
        }),
      ),
    );
    const posts = await myPosts();
    expect(posts).toHaveLength(2);
    expect(posts.every((p) => p.publisher === "ACCOUNT" && p.status === "SCHEDULED")).toBe(true);
    const p1 = posts.find((p) => p.channelId === ids.channel);
    const p2 = posts.find((p) => p.channelId === ids.channel2);
    // Premier canal : le lien créé est rattaché ; second canal : sa propre copie, adresse remplacée dans son texte.
    expect(p1!.trackingLinks.map((l) => l.id)).toEqual([link.id]);
    expect(p1!.trackingLinks[0]).toMatchObject({ channelId: ids.channel });
    expect(p1!.text).toContain(`${env.trackingBaseUrl}/${slug}`);
    expect(p2!.trackingLinks).toHaveLength(1);
    const copy = p2!.trackingLinks[0]!;
    expect(copy).toMatchObject({
      kind: "BUTTON",
      channelId: ids.channel2,
      campaignId: ids.campaign,
      affiliateCampaignId: ids.offer,
    });
    expect(copy.slug).not.toBe(slug);
    expect(p2!.text).toContain(`${env.trackingBaseUrl}/${copy.slug}`);
    expect(p2!.text).not.toContain(`/${slug}"`);
  });

  it("offre qui n'est pas dans la campagne : refus clair, aucun lien", async () => {
    const r = await actions.createTextOfferLinkAction({
      campaignId: ids.campaign,
      affiliateCampaignId: "inconnue",
      label: "Jouer",
    });
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/n'est plus dans la campagne/),
    });
    expect(await prisma.trackingLink.count({ where: { createdById: session.user.id } })).toBe(0);
  });
});
