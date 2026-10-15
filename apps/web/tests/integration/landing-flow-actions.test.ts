/**
 * Phase 15, rubrique « Pages » côté écrans, sur la base réelle (Telegram simulé) :
 * - actions serveur de la rubrique : « Créer la page » (brouillon JSON du formulaire → page, sources et liens, retour
 *   sur la fiche), refus renvoyé au formulaire, « Réessayer », suppression réservée à l'administrateur ;
 * - « Qui peut entrer et quand » : exceptions « la page <nom> » et « n'importe quelle page d'atterrissage » enregistrées
 *   par la vraie action de la fiche canal (page du canal seulement, pas de doublon), relues par l'onglet, menus et
 *   simulateur, et retenues par le bot pour une demande venue de la page (même règle).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import {
  getOrCreateBot,
  prismaTelegramDeps,
  resolveRuleForProvenance,
} from "@linkaffipro/telegram";
import { createTestBot, resetDb, type TelegramCall } from "./helpers";

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "MANAGER";
    telegramUserId: bigint | null;
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  },
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
  updateTag: () => undefined,
  revalidateTag: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));

const pages = await import("@/app/(admin)/pages/actions");
const channelActions = await import("@/app/(admin)/channels/[id]/actions");
const { loadRulesTab } = await import("@/lib/channels/queries");
const { initialEntryState, entryFormFields } = await import("@/lib/channels/entry-rule");
const { provenanceMenu, conditionText } = await import("@/lib/channels/exceptions");
const { simulate, simulationChoices } = await import("@/lib/channels/rule-simulator");
const { loadChannelLandingPages } = await import("@/lib/landing/queries");
const { mainSource } = await import("@/lib/landing/form");

const CHAT = -1001_970_000_001n;
const OTHER_CHAT = -1001_970_000_002n;

/** URL d'une redirection d'action serveur (« NEXT_REDIRECT »). */
async function redirectUrl(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return url;
    throw err;
  }
  throw new Error("redirection attendue");
}

/** Paramètre d'une adresse de retour (« ok », « error »). */
function param(url: string, key: string): string | null {
  return new URLSearchParams(url.split("?")[1] ?? "").get(key);
}

function payload(data: unknown): FormData {
  const f = new FormData();
  f.append("payload", JSON.stringify(data));
  return f;
}

describe("rubrique Pages : actions et exceptions de règles (base réelle)", () => {
  const ids = { bot: "", channel: "", other: "", page: "", otherPage: "", admin: "", manager: "" };
  let calls: TelegramCall[] = [];
  let refuse = false;

  beforeAll(async () => {
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    const bot = await createTestBot(971, "SPORTS");
    ids.bot = bot.id;
    calls = [];
    let n = 0;
    (getOrCreateBot(bot, prismaTelegramDeps).api as Api).config.use(async (_p, method, raw) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      if (method === "createChatInviteLink") {
        if (refuse)
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: not enough rights to manage chat invite links",
          } as never;
        return {
          ok: true,
          result: {
            invite_link: `https://t.me/+act${++n}Zz971`,
            creator: { id: 971, is_bot: true, first_name: "Foot" },
            creates_join_request: true,
            is_primary: false,
            is_revoked: false,
            name: p.name,
          },
        } as never;
      }
      return { ok: true, result: true } as never;
    });
    for (const [key, chat, title] of [
      ["channel", CHAT, "Pronos Foot"],
      ["other", OTHER_CHAT, "Autre canal"],
    ] as const) {
      const ch = await prisma.channel.create({
        data: {
          telegramChatId: chat,
          title,
          vertical: "SPORTS",
          primaryBotId: bot.id,
          isTest: true,
          chatCheckedAt: new Date(),
        },
      });
      ids[key] = ch.id;
      await prisma.channelBotAdmin.create({
        data: {
          channelId: ch.id,
          botId: bot.id,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
      await prisma.approvalRule.create({
        data: {
          channelId: ch.id,
          name: "Règle par défaut",
          isDefault: true,
          mode: "DELAY",
          delaySeconds: 600,
          reminderAfterMinutes: [],
          maxReminders: 0,
        },
      });
    }
    const mk = (role: "ADMIN" | "MANAGER") =>
      prisma.user.create({
        data: { email: `${role}-${Date.now()}@pages.test`, passwordHash: "x", name: role, role },
      });
    ids.admin = (await mk("ADMIN")).id;
    ids.manager = (await mk("MANAGER")).id;
  });

  const asUser = (id: string, role: "ADMIN" | "MANAGER") => {
    session.user = { id, email: `${role}@x`, name: role, role, telegramUserId: null };
  };

  const draft = (channelId: string, over: Record<string, unknown> = {}) => ({
    pageId: null,
    channelId,
    headline: "Nos pronos du week-end",
    subtext: "",
    buttonText: "",
    footnote: "",
    language: "fr",
    tiktokPixel: "",
    metaPixel: "",
    cookieBanner: false,
    showPhoto: false,
    name: "Pronos",
    slug: "",
    slugTouched: false,
    isActive: true,
    sources: [mainSource(), { id: null, key: "meta1", adId: null, removed: false, main: false }],
    ...over,
  });

  it("« Créer la page » (responsable) : page, sources et liens créés, retour sur la fiche avec le message", async () => {
    asUser(ids.manager, "MANAGER");
    const url = await redirectUrl(() =>
      pages.saveLandingPageAction(null, payload(draft(ids.channel))),
    );
    const page = await prisma.landingPage.findFirstOrThrow({ where: { channelId: ids.channel } });
    ids.page = page.id;
    expect(url).toBe(
      `/pages/${page.id}?${new URLSearchParams({ ok: "Page créée. 2 liens Telegram créés." })}`,
    );
    expect(page).toMatchObject({ slug: "pronos", createdById: ids.manager });
    expect(await prisma.landingSource.count({ where: { landingPageId: page.id } })).toBe(2);
  });

  it("refus renvoyé au formulaire (pixel illisible) ; brouillon illisible", async () => {
    asUser(ids.manager, "MANAGER");
    const r = await pages.saveLandingPageAction(
      null,
      payload(draft(ids.other, { metaPixel: "pas un pixel", name: "Autre" })),
    );
    expect(r?.error).toMatch(/pixel Meta non reconnu/);
    expect(r?.errors?.metaPixel).toMatch(/pixel Meta non reconnu/);
    const bad = new FormData();
    bad.append("payload", "{pas du json");
    expect((await pages.saveLandingPageAction(null, bad))?.error).toMatch(/rechargez la page/);
  });

  it("« Réessayer » : Telegram refuse, le refus est gardé sur la source ; il accepte ensuite, le lien est créé", async () => {
    asUser(ids.manager, "MANAGER");
    refuse = true;
    const url = await redirectUrl(() =>
      pages.saveLandingPageAction(null, payload(draft(ids.other, { name: "Autre page" }))),
    );
    const page = await prisma.landingPage.findFirstOrThrow({ where: { channelId: ids.other } });
    ids.otherPage = page.id;
    expect(param(url, "ok")).toMatch(/^Page créée\. 2 liens en attente : Telegram refuse/);
    expect(
      await prisma.landingSource.count({
        where: { landingPageId: page.id, linkError: { not: null } },
      }),
    ).toBe(2);
    refuse = false;
    const f = new FormData();
    f.append("pageId", page.id);
    const retry = await redirectUrl(() => pages.retryLandingLinksAction(f));
    expect(param(retry, "ok")).toBe("2 liens Telegram créés.");
    expect(
      await prisma.landingSource.count({ where: { landingPageId: page.id, linkError: null } }),
    ).toBe(2);
  });

  it("exception « la page Pronos » : enregistrée par l'action de la fiche canal, relue par l'onglet et le bot", async () => {
    asUser(ids.manager, "MANAGER");
    const f = new FormData();
    f.append("channelId", ids.channel);
    f.append("provenance", `landing:${ids.page}`);
    for (const [k, v] of entryFormFields({ ...initialEntryState(null), choice: "now" }))
      f.append(k, v);
    const url = await redirectUrl(() => channelActions.saveExceptionAction(null, f));
    expect(param(url, "ok")).toContain(
      "Exception enregistrée pour les personnes venues de la page « Pronos »",
    );
    const rule = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: ids.channel, sourceKind: "LANDING_PAGE" },
    });
    expect(rule).toMatchObject({
      scope: "SOURCE_KIND",
      landingPageId: ids.page,
      label: "Venu de la page « Pronos »",
    });
    // Doublon refusé ; une page d'un autre canal refusée.
    expect((await channelActions.saveExceptionAction(null, f))?.error).toMatch(/existe déjà/);
    const g = new FormData();
    g.append("channelId", ids.channel);
    g.append("provenance", `landing:${ids.otherPage}`);
    for (const [k, v] of entryFormFields(initialEntryState(null))) g.append(k, v);
    expect((await channelActions.saveExceptionAction(null, g))?.error).toBe(
      "Cette page d'atterrissage n'existe plus : choisissez une autre provenance.",
    );

    // L'onglet relit l'exception avec sa page ; menu et simulateur la proposent.
    const tab = await loadRulesTab(ids.channel);
    const item = tab.exceptions.find((e) => e.id === rule.id)!;
    expect(item.landingPageId).toBe(ids.page);
    const landingPages = await loadChannelLandingPages(ids.channel, [ids.page]);
    expect(landingPages).toEqual([{ id: ids.page, name: "Pronos", isActive: true }]);
    const names = {
      titles: {},
      linkNames: {},
      landingPageNames: Object.fromEntries(landingPages.map((p) => [p.id, p.name])),
    };
    expect(conditionText(item, names)).toBe("de la page « Pronos »");
    const menu = provenanceMenu({
      channelId: ids.channel,
      channels: [],
      links: [],
      senders: [],
      landingPages,
      used: [`landing:${ids.page}`],
    });
    expect(menu.find((g2) => g2.label === "Une page d'atterrissage")?.options).toEqual([
      { key: "kind:LANDING_ANY", label: "de n'importe quelle page d'atterrissage" },
      { key: `landing:${ids.page}`, label: "de la page « Pronos »", used: true },
    ]);
    const choice = simulationChoices({
      channelId: ids.channel,
      channels: [],
      senders: [],
      shareLinks: [],
      landingPages,
    })
      .find((g2) => g2.label === "Une page d'atterrissage")!
      .choices.find((c) => c.key === `landing:${ids.page}`)!;
    const sim = simulate(
      [
        {
          id: "d",
          scope: "DEFAULT",
          isDefault: true,
          isActive: true,
          inviteLinkId: null,
          sourceChannelId: null,
          sourceKind: null,
          sortOrder: 0,
          label: null,
          rule: { ...tab.defaultRule! },
        },
        ...tab.exceptions,
      ],
      choice.provenance,
      { ...names, channelId: ids.channel, channelTitle: "Pronos Foot" },
    );
    expect(sim.ruleText).toBe("L'exception pour les personnes venues de la page « Pronos ».");
    expect(sim.whenText).toBe("Elle est acceptée tout de suite.");
    // Le bot retient la même règle pour une demande venue de la page.
    const botRule = resolveRuleForProvenance(
      await prisma.approvalRule.findMany({ where: { channelId: ids.channel, isActive: true } }),
      choice.provenance,
      ids.channel,
    );
    expect(botRule.id).toBe(rule.id);
  });

  it("exception « n'importe quelle page d'atterrissage » ; suppression d'une page réservée à l'administrateur", async () => {
    asUser(ids.manager, "MANAGER");
    const f = new FormData();
    f.append("channelId", ids.other);
    f.append("provenance", "kind:LANDING_ANY");
    for (const [k, v] of entryFormFields(initialEntryState(null))) f.append(k, v);
    await redirectUrl(() => channelActions.saveExceptionAction(null, f));
    expect(
      await prisma.approvalRule.findFirstOrThrow({
        where: { channelId: ids.other, sourceKind: "LANDING_ANY" },
      }),
    ).toMatchObject({ label: "Venu de n'importe quelle page d'atterrissage", landingPageId: null });

    const del = new FormData();
    del.append("pageId", ids.page);
    const refused = await redirectUrl(() => pages.deleteLandingPageAction(del));
    expect(param(refused, "error")).toMatch(/^Seul un administrateur peut supprimer une page\./);
    expect(await prisma.landingPage.count({ where: { id: ids.page } })).toBe(1);
    asUser(ids.admin, "ADMIN");
    const done = await redirectUrl(() => pages.deleteLandingPageAction(del));
    expect(done.startsWith("/pages?")).toBe(true);
    expect(param(done, "ok")).toBe("Page « Pronos » supprimée : ses liens ne fonctionnent plus.");
    expect(await prisma.landingPage.count({ where: { id: ids.page } })).toBe(0);
    // L'exception reste, affichée « page supprimée ».
    const rule = await prisma.approvalRule.findFirstOrThrow({
      where: { channelId: ids.channel, sourceKind: "LANDING_PAGE" },
    });
    const { conditionText: cond } = await import("@/lib/channels/exceptions");
    expect(
      cond({ ...rule, scope: "SOURCE_KIND" }, { titles: {}, linkNames: {}, landingPageNames: {} }),
    ).toBe("d'une page supprimée");
    expect(calls.filter((c) => c.method === "revokeChatInviteLink")).toHaveLength(2);
  });
});
