/**
 * Phase 13 (vues internes, D7 / D8) sur base réelle : page « Affiliés Link Affi » (chiffres par campagne et par
 * affilié, clics lus dans le relevé de la synchro, premiers dépôts, filtres canal et affilié, export CSV), filtre
 * « Affilié » de Membres et de la vue d'ensemble des Statistiques, correction de l'affilié d'un membre par un ADMIN
 * (refusée à un MANAGER, journalisée), exceptions de règle « un affilié précis » et « une campagne d'affilié »,
 * membres d'affiliés par canal (avertissement des messages). Aucun appel à Link Affi ni à Telegram.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { createBotAndChannel, resetDb } from "./helpers";

const session = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "MANAGER";
    telegramUserId: bigint | null;
  },
}));
vi.mock("@/lib/session", () => {
  class ForbiddenError extends Error {}
  const requireUser = async () => {
    if (!session.user)
      throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/login", digest: "NEXT_REDIRECT" });
    return session.user;
  };
  return {
    ForbiddenError,
    requireUser,
    requireAdmin: async () => {
      const u = await requireUser();
      if (u.role !== "ADMIN") throw new ForbiddenError("Action réservée aux administrateurs");
      return u;
    },
    requireAdminPage: requireUser,
  };
});
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url, digest: "NEXT_REDIRECT" });
  },
}));

const { loadAffiliatesPage, affiliateMembersByChannel } = await import("@/lib/affiliates/queries");
const { listMembers, parseMemberFilters, loadMemberFilterOptions } =
  await import("@/lib/members/query");
const { loadDashboardUncached } = await import("@/lib/dashboard/queries");
const memberActions = await import("@/app/(admin)/members/[id]/actions");
const channelActions = await import("@/app/(admin)/channels/[id]/actions");
const { loadRulesTab } = await import("@/lib/channels/queries");
const { initialEntryState, chooseEntry, entryFormFields } =
  await import("@/lib/channels/entry-rule");
const { GET: exportAffiliates } = await import("@/app/(admin)/campaigns/affiliates/export/route");
const { resolvePeriod } = await import("@/lib/periods");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);
const ids = {
  channelA: "",
  channelB: "",
  paulA: "",
  paulB: "",
  sarahA: "",
  offerLink: "",
  admin: "",
  manager: "",
  nora: "",
  leo: "",
  ana: "",
  outsider: "",
};

async function redirected(fn: () => Promise<unknown>): Promise<URLSearchParams> {
  try {
    await fn();
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (!url) throw err;
    return new URLSearchParams(url.split("?")[1] ?? "");
  }
  throw new Error("redirection attendue");
}

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeAll(async () => {
  await resetDb();
  await prisma.linkaffiEvent.deleteMany();
  await prisma.setting.deleteMany({ where: { key: "linkaffi.telegramCampaigns" } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "member.affiliate_" } } });
  const { bot, channel } = await createBotAndChannel({
    chatId: -100_913_101n,
    title: "Casino VIP",
  });
  ids.channelA = channel.id;
  const b = await prisma.channel.create({
    data: {
      telegramChatId: -100_913_102n,
      title: "Pronos Foot",
      type: "CHANNEL",
      language: "fr",
      primaryBotId: bot.id,
    },
  });
  ids.channelB = b.id;
  const link = (
    id: string,
    key: string,
    name: string,
    channelId: string,
    affiliateId: string,
    affiliateName: string,
    attributionDays: number | null = null,
  ) =>
    prisma.inviteLink.create({
      data: {
        id,
        channelId,
        botId: bot.id,
        telegramInviteLink: `https://t.me/+${id}`,
        name,
        kind: "LINKAFFI",
        linkaffiCampaignKey: key,
        linkaffiCampaignName: name,
        linkaffiAffiliateId: affiliateId,
        linkaffiAffiliateName: affiliateName,
        attributionDays,
        createdAt: ago(40 * DAY),
      },
    });
  ids.paulA = (await link("lkpaula", "kpaula", "Paul VIP", ids.channelA, "aff-paul", "Paul")).id;
  ids.paulB = (await link("lkpaulb", "kpaulb", "Paul Foot", ids.channelB, "aff-paul", "Paul")).id;
  ids.sarahA = (
    await link("lksarah", "ksarah", "Sarah VIP", ids.channelA, "aff-sarah", "Sarah", 30)
  ).id;

  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino Royal", externalId: "p13-prog" },
  });
  const offer = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "p13-offer",
      name: "Casino Royal — Bienvenue",
      trackingUrlTemplate: "https://linkaffi.me/go/OFFER1?sub_id={subid}",
    },
  });
  ids.offerLink = (
    await prisma.trackingLink.create({
      data: {
        slug: "p13offer",
        kind: "OFFER",
        destinationTemplate: offer.trackingUrlTemplate,
        label: "Offre",
        channelId: ids.channelA,
        affiliateCampaignId: offer.id,
      },
    })
  ).id;

  let tg = 913_100;
  const member = async (
    name: string,
    key: string | null,
    affiliateId: string | null,
    linkId: string | null,
  ) =>
    (
      await prisma.member.create({
        data: {
          telegramUserId: BigInt(tg++),
          firstName: name,
          linkaffiCampaignKey: key,
          linkaffiAffiliateId: affiliateId,
          affiliateAttributedAt: key ? ago(10 * DAY) : null,
          affiliateInviteLinkId: linkId,
        },
      })
    ).id;
  ids.nora = await member("Nora", "kpaula", "aff-paul", ids.paulA);
  ids.leo = await member("Léo", "kpaula", "aff-paul", ids.paulA);
  ids.ana = await member("Ana", "ksarah", "aff-sarah", ids.sarahA);
  ids.outsider = await member("Hors", null, null, null);
  let code = 0;
  const ms = (
    memberId: string,
    channelId: string,
    inviteLinkId: string | null,
    status: "APPROVED" | "LEFT" | "REQUESTED",
    requestedAt: Date,
    leftAt: Date | null = null,
  ) =>
    prisma.membership.create({
      data: {
        code: `p13-${code++}`,
        memberId,
        channelId,
        inviteLinkId,
        status,
        requestedAt,
        approvedAt: status === "REQUESTED" ? null : new Date(requestedAt.getTime() + 60_000),
        joinedAt: status === "REQUESTED" ? null : new Date(requestedAt.getTime() + 90_000),
        leftAt,
      },
    });
  await ms(ids.nora, ids.channelA, ids.paulA, "APPROVED", ago(5 * DAY));
  await ms(ids.leo, ids.channelA, ids.paulA, "LEFT", ago(6 * DAY), ago(2 * DAY));
  // Léo dans l'autre canal (pas celui de sa campagne) : ne compte pas pour Paul.
  await ms(ids.leo, ids.channelB, null, "APPROVED", ago(3 * DAY));
  await ms(ids.ana, ids.channelA, ids.sarahA, "REQUESTED", ago(1 * DAY));
  await ms(ids.outsider, ids.channelA, null, "APPROVED", ago(4 * DAY));

  const click = (memberId: string, key: string | null, at: Date, subId: string) =>
    prisma.click.create({
      data: {
        trackingLinkId: ids.offerLink,
        subId,
        memberId,
        botId: bot.id,
        linkaffiTelegramCampaignKey: key,
        destination: `https://linkaffi.me/go/OFFER1?sub_id=${subId}${key ? `&tg=${key}` : ""}`,
        createdAt: at,
      },
    });
  const c1 = await click(ids.nora, "kpaula", ago(4 * DAY), "p13sub000001");
  await click(ids.nora, "kpaula", ago(3 * DAY), "p13sub000002");
  await click(ids.ana, "ksarah", ago(20 * HOUR), "p13sub000003");
  await click(ids.outsider, null, ago(2 * DAY), "p13sub000004");
  const player = await prisma.player.create({
    data: {
      affiliateCampaignId: offer.id,
      externalPlayerId: "p13-player-1",
      subId: c1.subId,
      clickId: c1.id,
      memberId: ids.nora,
      registeredAt: ago(4 * DAY - HOUR),
      ftdAt: ago(3 * DAY),
      ftdAmount: 50,
      depositCount: 2,
      depositTotal: 80,
    },
  });
  for (const [type, amount, at] of [
    ["REGISTRATION", null, ago(4 * DAY - HOUR)],
    ["FTD", 50, ago(3 * DAY)],
    ["DEPOSIT", 30, ago(2 * DAY)],
    ["NGR", 42.5, ago(2 * DAY)],
    ["CPA", 40, ago(2 * DAY)],
  ] as const)
    await prisma.playerEvent.create({
      data: { playerId: player.id, type, amount, occurredAt: at, externalId: `p13-${type}` },
    });
  await prisma.setting.create({
    data: {
      key: "linkaffi.telegramCampaigns",
      value: {
        syncedAt: new Date().toISOString(),
        available: true,
        campaigns: { kpaula: { clicks: 120 }, ksarah: { clicks: "15" } },
        divergences: [],
      },
    },
  });
  const stamp = Date.now();
  ids.admin = (
    await prisma.user.create({
      data: { email: `p13-a-${stamp}@test.local`, passwordHash: "x", name: "Admin", role: "ADMIN" },
    })
  ).id;
  ids.manager = (
    await prisma.user.create({
      data: {
        email: `p13-m-${stamp}@test.local`,
        passwordHash: "x",
        name: "Resp",
        role: "MANAGER",
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "linkaffi.telegramCampaigns" } });
  await prisma.$disconnect();
});

const asAdmin = () => {
  session.user = {
    id: ids.admin,
    email: "a@x",
    name: "Admin",
    role: "ADMIN",
    telegramUserId: null,
  };
};
const asManager = () => {
  session.user = {
    id: ids.manager,
    email: "m@x",
    name: "Resp",
    role: "MANAGER",
    telegramUserId: null,
  };
};

describe("page « Affiliés Link Affi »", () => {
  it("chiffres par campagne puis par affilié, sur 30 jours", async () => {
    const data = await loadAffiliatesPage({ period: resolvePeriod({ range: "30d" }) });
    expect(data.affiliates.map((a) => a.name)).toEqual(["Paul", "Sarah"]);
    const paul = data.affiliates[0]!;
    const vip = paul.campaigns.find((c) => c.ref.inviteLinkId === ids.paulA)!;
    expect(vip.figures).toMatchObject({
      clicks: 120,
      requests: 2,
      approved: 2,
      present: 1,
      left: 1,
      offerClicks: 2,
      registrations: 1,
      ftds: 1,
      deposits: 2,
      depositAmount: 80,
      revenue: 42.5,
    });
    expect(vip.ftdList).toEqual([
      expect.objectContaining({ memberId: ids.nora, memberName: "Nora", amount: 50 }),
    ]);
    // La campagne de Paul sur l'autre canal existe, sans chiffre (Léo n'y est pas venu par elle).
    const foot = paul.campaigns.find((c) => c.ref.inviteLinkId === ids.paulB)!;
    expect(foot.figures).toMatchObject({ requests: 0, present: 0, clicks: null });
    expect(data.affiliates[1]!.figures).toMatchObject({
      clicks: 15,
      requests: 1,
      present: 0,
      offerClicks: 1,
      ftds: 0,
    });
    expect(data.totals).toMatchObject({ ftds: 1, offerClicks: 3, revenue: 42.5, clicks: 135 });
    expect(data.clicks.available).toBe(true);
    expect(data.options.map((o) => o.id)).toEqual(["aff-paul", "aff-sarah"]);
    expect(data.channels.map((c) => c.title)).toEqual(["Casino VIP", "Pronos Foot"]);
  });

  it("période : une journée sans activité ; filtres canal et affilié", async () => {
    const today = await loadAffiliatesPage({ period: resolvePeriod({ range: "today" }) });
    expect(today.totals).toMatchObject({ requests: 0, ftds: 0, revenue: 0 });
    // « Présents » : en ce moment, quelle que soit la période.
    expect(today.totals.present).toBe(1);
    const foot = await loadAffiliatesPage({
      period: resolvePeriod({ range: "30d" }),
      channelId: ids.channelB,
    });
    expect(foot.affiliates.flatMap((a) => a.campaigns.map((c) => c.ref.inviteLinkId))).toEqual([
      ids.paulB,
    ]);
    const sarah = await loadAffiliatesPage({
      period: resolvePeriod({ range: "30d" }),
      affiliateId: "aff-sarah",
    });
    expect(sarah.affiliates.map((a) => a.name)).toEqual(["Sarah"]);
  });

  it("export CSV : campagnes et premiers dépôts (ADMIN et MANAGER)", async () => {
    asManager();
    const res = await exportAffiliates(
      new Request("http://localhost/campaigns/affiliates/export?range=30d"),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.split("\r\n")[0]).toContain("Premiers dépôts (FTD);Dépôts (nombre)");
    expect(res.headers.get("Content-Disposition")).toMatch(/affilies-link-affi-/);
    expect(text).toContain("Paul;aff-paul;Paul VIP;kpaula;Casino VIP;oui;à vie;");
    expect(text).toMatch(/\r\nTotal;/);
    const ftds = await (
      await exportAffiliates(
        new Request("http://localhost/campaigns/affiliates/export?range=30d&kind=ftds"),
      )
    ).text();
    expect(ftds).toContain("Paul;Paul VIP;Casino VIP;Nora;");
  });
});

describe("filtres « Affilié » de Membres et des Statistiques", () => {
  it("Membres : les membres amenés par l'affilié ; choix proposés", async () => {
    const { rows, total } = await listMembers(parseMemberFilters({ affiliateId: "aff-paul" }));
    expect(total).toBe(2);
    expect(rows.map((r) => r.displayName).sort()).toEqual(["Léo", "Nora"]);
    const options = await loadMemberFilterOptions();
    expect(options.affiliates.map((a) => a.name)).toEqual(["Paul", "Sarah"]);
  });

  it("vue d'ensemble : demandes du canal de ses campagnes, clics d'offre portant sa clé, ses joueurs ; ni pub ni dépense", async () => {
    const d = await loadDashboardUncached({
      period: resolvePeriod({ range: "30d" }),
      vertical: "",
      channelId: "",
      affiliateId: "aff-paul",
    });
    const total = (k: string) => d.metrics.find((m) => m.key === k)?.series.total;
    expect(total("requests")).toBe(2);
    expect(total("offerClicks")).toBe(2);
    expect(total("ftds")).toBe(1);
    expect(total("ngr")).toBe(42.5);
    expect(total("entryClicks")).toBe(0);
    expect(total("commissions")).toBe(40);
    expect(d.metrics.some((m) => m.key === "spend" || m.key === "gains")).toBe(false);
    expect(d.metrics.find((m) => m.key === "commissions")?.note).toMatch(/affilié/);
    const unknown = await loadDashboardUncached({
      period: resolvePeriod({ range: "30d" }),
      vertical: "",
      channelId: "",
      affiliateId: "aff-inconnu",
    });
    expect(unknown.metrics.find((m) => m.key === "requests")?.series.total).toBe(0);
    expect(unknown.metrics.find((m) => m.key === "ftds")?.series.total).toBe(0);
  });

  it("membres d'affiliés présents par canal (avertissement des messages publiés sans boutons)", async () => {
    // Nora (Paul) dans « Casino VIP » ; Léo (Paul) aussi présent dans « Pronos Foot » : ses clics d'offre y portent la
    // clé de sa campagne. Ana (demande en attente) et le membre sans affilié ne comptent pas.
    expect(await affiliateMembersByChannel()).toEqual({ [ids.channelA]: 1, [ids.channelB]: 1 });
    expect(await affiliateMembersByChannel([ids.channelA])).toEqual({ [ids.channelA]: 1 });
  });
});

describe("fiche membre : corriger l'affilié (ADMIN seulement, motif, journal)", () => {
  it("un MANAGER est refusé sans rien changer", async () => {
    asManager();
    const q = await redirected(() =>
      memberActions.changeMemberAffiliateAction(
        form({ memberId: ids.leo, inviteLinkId: ids.sarahA, reason: "Essai du responsable" }),
      ),
    );
    expect(q.get("error")).toBe("Réservé aux administrateurs.");
    expect((await prisma.member.findUnique({ where: { id: ids.leo } }))?.linkaffiCampaignKey).toBe(
      "kpaula",
    );
  });

  it("motif obligatoire", async () => {
    asAdmin();
    const q = await redirected(() =>
      memberActions.changeMemberAffiliateAction(
        form({ memberId: ids.leo, inviteLinkId: ids.sarahA, reason: " " }),
      ),
    );
    expect(q.get("error")).toMatch(/motif/);
  });

  it("changer d'affilié : clé, affilié, lien, durée de la campagne ; événement et journal", async () => {
    asAdmin();
    const q = await redirected(() =>
      memberActions.changeMemberAffiliateAction(
        form({ memberId: ids.leo, inviteLinkId: ids.sarahA, reason: "Erreur de lien signalée" }),
      ),
    );
    expect(q.get("ok")).toBe("Membre rattaché à Sarah (campagne Sarah VIP, canal Casino VIP).");
    const m = await prisma.member.findUnique({ where: { id: ids.leo } });
    expect(m).toMatchObject({
      linkaffiCampaignKey: "ksarah",
      linkaffiAffiliateId: "aff-sarah",
      affiliateInviteLinkId: ids.sarahA,
    });
    expect(m!.affiliateAttributionEndsAt!.getTime() - m!.affiliateAttributedAt!.getTime()).toBe(
      30 * DAY,
    );
    const log = await prisma.auditLog.findFirst({
      where: { action: "member.affiliate_changed", entityId: ids.leo },
    });
    expect(log).toMatchObject({ userId: ids.admin, entityType: "Member" });
    expect(log!.metadata).toMatchObject({
      reason: "Erreur de lien signalée",
      from: { campaignKey: "kpaula", affiliateId: "aff-paul" },
      to: { campaignKey: "ksarah", affiliateId: "aff-sarah" },
    });
    expect(
      await prisma.event.count({ where: { type: "member.affiliate_changed", memberId: ids.leo } }),
    ).toBe(1);
    // Même campagne : refusé.
    const again = await redirected(() =>
      memberActions.changeMemberAffiliateAction(
        form({ memberId: ids.leo, inviteLinkId: ids.sarahA, reason: "Encore une fois" }),
      ),
    );
    expect(again.get("error")).toBe("Ce membre est déjà rattaché à cette campagne.");
    // Un lien qui n'est pas une campagne d'affilié : refusé.
    const wrong = await redirected(() =>
      memberActions.changeMemberAffiliateAction(
        form({ memberId: ids.leo, inviteLinkId: "inexistant", reason: "Mauvais choix" }),
      ),
    );
    expect(wrong.get("error")).toBe("Choisissez une campagne d'affilié dans la liste.");
  });

  it("retirer l'affilié : plus aucun champ ; journal ; un membre sans affilié est refusé", async () => {
    asAdmin();
    const q = await redirected(() =>
      memberActions.removeMemberAffiliateAction(
        form({ memberId: ids.leo, reason: "Déjà présent avant la campagne" }),
      ),
    );
    expect(q.get("ok")).toMatch(/^Affilié retiré/);
    const m = await prisma.member.findUnique({ where: { id: ids.leo } });
    expect(m).toMatchObject({
      linkaffiCampaignKey: null,
      linkaffiAffiliateId: null,
      affiliateAttributedAt: null,
      affiliateAttributionEndsAt: null,
      affiliateInviteLinkId: null,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: "member.affiliate_removed", entityId: ids.leo },
      }),
    ).toBe(1);
    const none = await redirected(() =>
      memberActions.removeMemberAffiliateAction(
        form({ memberId: ids.outsider, reason: "Rien à retirer" }),
      ),
    );
    expect(none.get("error")).toBe("Ce membre n'est rattaché à aucun affilié.");
  });
});

describe("exceptions de règle : un affilié précis, une campagne d'affilié", () => {
  const state = () => chooseEntry(initialEntryState(null), "now");
  const save = async (provenance: string) => {
    asAdmin();
    const f = new FormData();
    f.append("channelId", ids.channelA);
    f.append("provenance", provenance);
    for (const [k, v] of entryFormFields(state())) f.append(k, v);
    try {
      const r = await channelActions.saveExceptionAction(null, f);
      return { error: r?.error };
    } catch (err) {
      return { url: (err as { url?: string }).url ?? "" };
    }
  };

  it("« de l'affilié « Paul » » : enregistrée avec l'affilié, libellé en français", async () => {
    const r = await save("affiliate:aff-paul");
    expect(r.error).toBeUndefined();
    const rule = await prisma.approvalRule.findFirst({
      where: { channelId: ids.channelA, sourceKind: "LINKAFFI_AFFILIATE" },
    });
    expect(rule).toMatchObject({ scope: "SOURCE_KIND", linkaffiAffiliateId: "aff-paul" });
    expect(rule!.label).toBe("Venu de l'affilié « Paul »");
    // Pas deux exceptions pour le même affilié.
    expect((await save("affiliate:aff-paul")).error).toMatch(/existe déjà/);
    // Affilié inconnu : refusé.
    expect((await save("affiliate:aff-inconnu")).error).toMatch(/plus connu/);
  });

  it("« de la campagne « Sarah VIP » de l'affilié « Sarah » » : exception du lien ; onglet relu", async () => {
    const r = await save(`link:${ids.sarahA}`);
    expect(r.error).toBeUndefined();
    const rule = await prisma.approvalRule.findFirst({
      where: { channelId: ids.channelA, inviteLinkId: ids.sarahA },
    });
    expect(rule).toMatchObject({ scope: "INVITE_LINK", linkaffiAffiliateId: null });
    expect(rule!.label).toBe("Venu de la campagne « Sarah VIP » de l'affilié « Sarah »");
    // Une campagne d'un autre canal : refusée.
    expect((await save(`link:${ids.paulB}`)).error).toMatch(/n'existe plus/);
    const tab = await loadRulesTab(ids.channelA);
    expect(tab.affiliates.map((a) => a.id)).toEqual(["aff-paul", "aff-sarah"]);
    expect(tab.affiliateLinks.map((l) => [l.id, l.campaignName, l.affiliateName])).toEqual([
      [ids.paulA, "Paul VIP", "Paul"],
      [ids.sarahA, "Sarah VIP", "Sarah"],
    ]);
    expect(
      tab.exceptions.find((e) => e.sourceKind === "LINKAFFI_AFFILIATE")?.linkaffiAffiliateId,
    ).toBe("aff-paul");
  });
});

describe("fiche membre → Supprimer : plus aucune donnée personnelle dans les événements Link Affi", () => {
  it("les événements en attente sont supprimés, les autres perdent prénom, pseudo, langue et identifiant Telegram", async () => {
    asAdmin();
    const { buildLinkaffiEvent } = await import("@linkaffipro/core");
    const { toJsonValue } = await import("@linkaffipro/db");
    const TG_ID = 777_000_123_456n;
    const member = await prisma.member.create({
      data: {
        telegramUserId: TG_ID,
        firstName: "Camille",
        lastName: "Durand",
        username: "camille_privee",
        languageCode: "fr",
        linkaffiCampaignKey: "kpaula",
        linkaffiAffiliateId: "aff-paul",
        affiliateAttributedAt: new Date(),
        affiliateInviteLinkId: ids.paulA,
      },
    });
    const other = await prisma.member.create({
      data: { telegramUserId: 777_000_999_999n, firstName: "Autre", username: "autre_membre" },
    });
    const event = async (
      memberId: string,
      tgId: bigint,
      sourceId: string,
      type: "join_requested" | "joined" | "left",
      status: "PENDING" | "SENT" | "FAILED",
      who: { username: string; firstName: string },
    ) => {
      const body = buildLinkaffiEvent({
        type,
        sourceId,
        occurredAt: new Date(),
        campaignKey: "kpaula",
        channel: { id: ids.channelA, title: "Casino VIP" },
        member: {
          telegramUserId: tgId,
          username: who.username,
          firstName: who.firstName,
          languageCode: "fr",
        },
      });
      await prisma.linkaffiEvent.create({
        data: {
          eventId: body.eventId,
          type,
          occurredAt: new Date(),
          campaignKey: "kpaula",
          memberId,
          channelId: ids.channelA,
          body: toJsonValue(body),
          status,
          sentAt: status === "SENT" ? new Date() : null,
        },
      });
      return body.eventId;
    };
    const camille = { username: "camille_privee", firstName: "Camille" };
    const sent = await event(member.id, TG_ID, "anon-1", "join_requested", "SENT", camille);
    const failed = await event(member.id, TG_ID, "anon-2", "joined", "FAILED", camille);
    const pending = await event(member.id, TG_ID, "anon-3", "left", "PENDING", camille);
    const untouched = await event(other.id, 777_000_999_999n, "anon-4", "joined", "PENDING", {
      username: "autre_membre",
      firstName: "Autre",
    });

    const q = await redirected(() =>
      memberActions.anonymizeMemberAction(form({ memberId: member.id, confirm: "SUPPRIMER" })),
    );
    expect(q.get("ok")).toMatch(/^Membre supprimé/);

    // En attente : supprimé (rien ne part plus vers Link Affi pour ce membre).
    expect(await prisma.linkaffiEvent.findUnique({ where: { eventId: pending } })).toBeNull();
    const rows = await prisma.linkaffiEvent.findMany({ where: { memberId: member.id } });
    expect(rows.map((r) => r.eventId).sort()).toEqual([failed, sent].sort());
    const text = JSON.stringify(rows.map((r) => r.body));
    for (const secret of [TG_ID.toString(), "camille_privee", "Camille"])
      expect(text).not.toContain(secret);
    for (const r of rows) {
      const body = r.body as { member: unknown; type: string; campaignKey: string };
      expect(body.member).toEqual({
        telegramUserId: "0",
        username: null,
        firstName: null,
        languageCode: null,
      });
      // Le reste du corps (type, campagne) est gardé : les chiffres de l'affilié restent justes.
      expect(body.campaignKey).toBe("kpaula");
      expect(body.type).toBe(r.type);
    }
    // Un autre membre : intact.
    const kept = await prisma.linkaffiEvent.findUniqueOrThrow({ where: { eventId: untouched } });
    expect(JSON.stringify(kept.body)).toContain("autre_membre");
    expect(kept.status).toBe("PENDING");
    await prisma.linkaffiEvent.deleteMany({ where: { memberId: { in: [member.id, other.id] } } });
  });
});
