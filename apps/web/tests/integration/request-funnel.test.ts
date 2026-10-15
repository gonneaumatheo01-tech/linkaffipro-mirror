import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type Prisma } from "@linkaffipro/db";
import { createTestBot, resetDb } from "./helpers";

/**
 * Phase 14 (décision E9), sur base réelle : parcours des demandes de l'onglet « Demandes » et de Statistiques →
 * Canaux. Cas du client (15 octobre) : Zone Interdite exige « Zone Roulette » et « Tir Cadré » ; trafic d'une pub
 * TikTok. Vrais blocages (`member.blocked`, refus « bot was blocked by the user ») et refus sans blocage (« bot can't
 * initiate conversation with a user », anciens refus sans erreur exacte) comptés à part ; accueil rapproché de la
 * demande (même bot, 10 minutes) ; canaux rejoints d'après nos données ; entrées directes exclues ; périodes de Paris.
 * Aucun appel à Telegram.
 */

// Tableau de provenance (DataTable) : le routeur de Next n'existe pas hors d'une requête.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const { channelsWithRequiredGates, funnelView, loadChannelRequestFunnels, loadStatsRequestFunnel } =
  await import("@/lib/channels/request-funnel");
const { RequestFunnel } = await import("@/components/channels/request-funnel");
const { resolvePeriod } = await import("@/lib/periods");

/** 15 octobre 2026, 12 h à Paris. */
const NOW = new Date("2026-10-15T10:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
const nb = (s: string) => s.replace(/ /g, " ");

describe("parcours des demandes (base réelle)", () => {
  const c = { zone: "", roulette: "", tir: "" };
  let bot = "";
  let otherBot = "";
  let pub1 = "";
  let pub2 = "";
  let ruleId = "";
  let n = 0;

  async function member(): Promise<string> {
    n++;
    return (
      await prisma.member.create({
        data: { telegramUserId: BigInt(7_100_000 + n), firstName: `Personne ${n}` },
      })
    ).id;
  }

  /** Demande pour Zone Interdite enregistrée comme le bot de la phase 11 (provenance, règle, canaux de l'accueil). */
  async function request(
    memberId: string,
    over: {
      at: Date;
      link?: string | null;
      channelId?: string;
      status?: Prisma.MembershipCreateInput["status"];
      extraSource?: Record<string, unknown>;
    } & Partial<Omit<Prisma.MembershipUncheckedCreateInput, "source">>,
  ) {
    const {
      at,
      link = pub1,
      channelId = c.zone,
      status = "PENDING_GATE",
      extraSource,
      ...rest
    } = over;
    return prisma.membership.create({
      data: {
        code: `f${n}-${Math.random().toString(36).slice(2, 8)}`,
        memberId,
        channelId,
        status,
        inviteLinkId: link,
        approvalRuleId: channelId === c.zone ? ruleId : null,
        requestedAt: at,
        source: {
          botId: bot,
          provenance: link
            ? { type: "AD", inviteLinkId: link, sourceChannelId: null, adPlatform: "TIKTOK" }
            : { type: "UNKNOWN", inviteLinkId: null, sourceChannelId: null, adPlatform: null },
          appliedRule: { id: ruleId, scope: "DEFAULT", label: null },
          rule: { id: ruleId, mode: "DELAY", delaySeconds: 300, gateMode: "REQUIRED" },
          gates: [
            { channelId: c.roulette, title: "Zone Roulette", url: "https://t.me/+r" },
            { channelId: c.tir, title: "Tir Cadré", url: "https://t.me/+t" },
          ],
          gateLinksMissing: [],
          ...extraSource,
        },
        ...rest,
      },
    });
  }

  async function welcome(
    memberId: string,
    at: Date,
    over: Partial<Prisma.OutboundMessageUncheckedCreateInput> = {},
  ) {
    await prisma.outboundMessage.create({
      data: {
        botId: bot,
        memberId,
        kind: "WELCOME",
        text: "Bienvenue",
        status: "SENT",
        queuedAt: at,
        sentAt: at,
        ...over,
      },
    });
  }

  async function event(
    memberId: string,
    type: string,
    at: Date,
    payload: Record<string, unknown> = {},
    botId = bot,
  ) {
    await prisma.event.create({
      data: { type, memberId, botId, occurredAt: at, payload: payload as Prisma.InputJsonValue },
    });
  }

  beforeEach(async () => {
    await resetDb();
    await prisma.campaign.deleteMany({ where: { name: "Test parcours des demandes" } });
    n = 0;
    bot = (await createTestBot(1401, "DATING")).id;
    otherBot = (await createTestBot(1402, "CASINO")).id;
    for (const [k, title, chat] of [
      ["zone", "Zone Interdite", -1001401],
      ["roulette", "Zone Roulette", -1001402],
      ["tir", "Tir Cadré", -1001403],
    ] as const)
      c[k] = (
        await prisma.channel.create({
          data: { telegramChatId: BigInt(chat), title, type: "CHANNEL", vertical: "DATING" },
        })
      ).id;
    ruleId = (
      await prisma.approvalRule.create({
        data: {
          channelId: c.zone,
          name: "Règle du canal",
          isDefault: true,
          scope: "DEFAULT",
          mode: "DELAY",
          delaySeconds: 300,
          gateMode: "REQUIRED",
          gateChannelIds: [c.roulette, c.tir],
        },
      })
    ).id;
    const link = (name: string, extra: Partial<Prisma.InviteLinkUncheckedCreateInput> = {}) =>
      prisma.inviteLink.create({
        data: {
          channelId: c.zone,
          botId: bot,
          telegramInviteLink: `https://t.me/+${name.replace(/\W/g, "")}${Math.random().toString(36).slice(2, 8)}`,
          name,
          kind: "AD_ENTRY",
          adPlatform: "TIKTOK",
          ...extra,
        },
      });
    pub1 = (await link("Dating test 1 semaine — Pub 1")).id;
    pub2 = (await link("Lien Pub 2", { adName: "Pub 2" })).id;
    // La pub 1 existe dans une campagne : son nom (« Pub 1 ») prime sur celui du lien.
    const campaign = await prisma.campaign.create({
      data: { name: "Test parcours des demandes", adPlatform: "TIKTOK" },
    });
    const adSet = await prisma.adSet.create({ data: { campaignId: campaign.id, name: "Groupe" } });
    await prisma.ad.create({ data: { adSetId: adSet.id, name: "Pub 1", inviteLinkId: pub1 } });
  });

  /** Le cas du 15 octobre, au complet. */
  async function seedScenario() {
    const t = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MIN);
    // m1 : accueil, puis bloque le bot 1 minute après (mise à jour Telegram « bot bloqué »).
    const m1 = await member();
    await request(m1, { at: t(120) });
    await welcome(m1, t(120));
    await event(m1, "member.blocked", t(119));
    // m2 : accueil, rappel refusé « bot was blocked by the user » (vrai blocage, phase 14).
    const m2 = await member();
    await request(m2, { at: t(110) });
    await welcome(m2, t(110));
    await event(m2, "dm.blocked", t(50), {
      kind: "GATE_REMINDER",
      telegramError: "403 Forbidden: bot was blocked by the user",
    });
    // m3 : accueil, rappel refusé « can't initiate » (jamais démarré : PAS un blocage), Zone Roulette rejointe.
    const m3 = await member();
    await request(m3, { at: t(100) });
    await welcome(m3, t(100));
    await event(m3, "dm.unreachable", t(40), {
      kind: "GATE_REMINDER",
      telegramError: "403 Forbidden: bot can't initiate conversation with a user",
    });
    await request(m3, { at: t(98), channelId: c.roulette, status: "APPROVED", link: null });
    // m4 : accueil, ancien refus « bloqué » sans erreur exacte (avant la phase 14) : compté comme refus, pas comme
    // blocage ; les deux canaux rejoints (une demande en attente dans Tir Cadré compte comme rejoint).
    const m4 = await member();
    await request(m4, { at: t(90) });
    await welcome(m4, t(90));
    await event(m4, "dm.blocked", t(30), { error: "Le destinataire a bloqué le bot." });
    await request(m4, { at: t(88), channelId: c.roulette, status: "PENDING_GATE", link: null });
    await request(m4, { at: t(87), channelId: c.tir, status: "REQUESTED", link: null });
    // m5 : pub 2, accueil refusé (non envoyé) ; canaux validés par le bot → acceptation programmée.
    const m5 = await member();
    await request(m5, {
      at: t(80),
      link: pub2,
      status: "SCHEDULED",
      gateSatisfiedAt: t(70),
      approveAt: t(65),
    });
    await welcome(m5, t(80), { status: "FAILED", sentAt: null });
    // m6 : pub 2, l'accueil et le blocage viennent d'un AUTRE bot (pas celui de la demande) ; acceptée puis partie.
    const m6 = await member();
    await request(m6, {
      at: t(75),
      link: pub2,
      status: "LEFT",
      gateSatisfiedAt: t(72),
      approvedAt: t(67),
      joinedAt: t(67),
      leftAt: t(20),
    });
    await welcome(m6, t(75), { botId: otherBot });
    await event(m6, "member.blocked", t(74), {}, otherBot);
    // m7 : entrée directe sans demande : hors du parcours des demandes.
    const m7 = await member();
    await request(m7, {
      at: t(60),
      status: "APPROVED",
      approvedAt: t(60),
      joinedAt: t(60),
      extraSource: { joinedDirectly: true, appliedRule: null },
    });
    // m8 : lien inconnu, accueil 20 minutes après la demande (trop tard pour être son accueil), hier.
    const m8 = await member();
    await request(m8, { at: new Date(NOW.getTime() - DAY), link: null });
    await welcome(m8, new Date(NOW.getTime() - DAY + 20 * MIN));
    // m9 : il y a 10 jours (période précédente des 7 derniers jours), acceptée.
    const m9 = await member();
    await request(m9, {
      at: new Date(NOW.getTime() - 10 * DAY),
      status: "APPROVED",
      approvedAt: new Date(NOW.getTime() - 10 * DAY + 10 * MIN),
    });
    await welcome(m9, new Date(NOW.getTime() - 10 * DAY));
    // m10 : il y a 40 jours : hors de toutes les périodes de la fiche.
    const m10 = await member();
    await request(m10, { at: new Date(NOW.getTime() - 40 * DAY) });
    return { m1, m2, m3, m4, m5, m6, m7, m8, m9, m10 };
  }

  it("onglet « Demandes » : aujourd'hui, 7 et 30 derniers jours ; vrais blocages et refus sans blocage séparés", async () => {
    await seedScenario();
    const funnels = await loadChannelRequestFunnels(c.zone, NOW);
    expect(funnels.map((f) => [f.key, f.label])).toEqual([
      ["today", "Aujourd'hui"],
      ["7d", "7 derniers jours"],
      ["30d", "30 derniers jours"],
    ]);
    const [today, week, month] = funnels.map((f) => f.data);
    // Aujourd'hui : m1 à m6 (m7 est une entrée directe ; m8 date d'hier).
    expect(today!.totals).toEqual({
      requests: 6,
      welcomed: 4,
      blocked: 2,
      unreachable: 2,
      withGates: 6,
      oneJoined: 4,
      allJoined: 3,
      accepted: 1,
      left: 1,
    });
    expect(week!.totals.requests).toBe(7);
    expect(week!.totals.welcomed).toBe(4);
    expect(month!.totals.requests).toBe(8);
    expect(month!.totals.accepted).toBe(2);
    // Par provenance : la pub 1 sous le nom de la pub, la pub 2 sous son nom de pub, puis « Autres liens ».
    expect(
      today!.groups.map((g) => [
        nb(g.label),
        g.counts.requests,
        g.counts.blocked,
        g.counts.allJoined,
      ]),
    ).toEqual([
      ["Pub TikTok « Pub 1 »", 4, 2, 1],
      ["Pub TikTok « Pub 2 »", 2, 0, 2],
    ]);
    expect(month!.groups.map((g) => nb(g.label))).toEqual([
      "Pub TikTok « Pub 1 »",
      "Pub TikTok « Pub 2 »",
      "Autres liens",
    ]);
  });

  it("vue et rendu : étapes, refus sans blocage dit à part, provenance cliquable", async () => {
    await seedScenario();
    const funnels = await loadChannelRequestFunnels(c.zone, NOW);
    const view = funnelView(funnels[0]!.data);
    expect(view.steps.map((s) => [s.label, s.valueText])).toEqual([
      ["Demandes", "6"],
      ["Accueil envoyé", "4"],
      ["Ont bloqué le bot", "2"],
      ["Au moins un canal rejoint", "4"],
      ["Tous les canaux rejoints", "3"],
      ["Acceptées", "1"],
      ["Parties du canal", "1"],
    ]);
    // Moins de 10 demandes : pas d'avertissement « bot bloqué ».
    expect(view.warning).toBeNull();
    expect(nb(view.unreachable!)).toMatch(
      /^2 personnes n'ont pas reçu un message du bot sans l'avoir bloqué/,
    );
    const html = nb(
      renderToStaticMarkup(
        createElement(RequestFunnel, {
          periods: funnels.map((f) => ({ key: f.key, label: f.label, view: funnelView(f.data) })),
          defaultKey: "today",
          welcomeHref: "/channels/x?tab=sequences",
        }),
      ),
    );
    expect(html).toContain('aria-label="Période du parcours"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Ont bloqué le bot");
    expect(html).toContain("Par provenance");
    expect(html).toContain("Pub TikTok « Pub 1 »");
    expect(html).toContain("jamais appuyé sur « Démarrer »");
  });

  it("au moins 10 demandes et plus de 25 % de vrais blocages : avertissement avec la pub la plus touchée", async () => {
    for (let i = 0; i < 12; i++) {
      const m = await member();
      const at = new Date(NOW.getTime() - (60 + i) * MIN);
      await request(m, { at, link: i < 8 ? pub1 : pub2 });
      await welcome(m, at);
      if (i < 4) await event(m, "member.blocked", new Date(at.getTime() + MIN));
    }
    const [today] = await loadChannelRequestFunnels(c.zone, NOW);
    // Canaux obligatoires (règle du canal) : le conseil de passer en « Proposés » est donné.
    expect(await channelsWithRequiredGates([c.zone])).toBe(true);
    const view = funnelView(today!.data, null, {
      requiredGates: await channelsWithRequiredGates([c.zone]),
    });
    expect(nb(view.warning!)).toBe(
      "50 % des personnes venues de Pub TikTok « Pub 1 » ont bloqué le bot (4 sur 8). Telegram peut limiter un bot signalé : adoucissez le message d'accueil ou passez les canaux en « Proposés ».",
    );
    // Le client passe déjà les canaux en « Proposés » (15 octobre) : seulement « adoucissez le message d'accueil ».
    await prisma.approvalRule.update({ where: { id: ruleId }, data: { gateMode: "SOFT" } });
    expect(await channelsWithRequiredGates([c.zone])).toBe(false);
    expect(nb(funnelView(today!.data, null, { requiredGates: false }).warning!)).toBe(
      "50 % des personnes venues de Pub TikTok « Pub 1 » ont bloqué le bot (4 sur 8). Telegram peut limiter un bot signalé : adoucissez le message d'accueil.",
    );
    // Une exception active avec des canaux obligatoires compte aussi ; désactivée, non.
    const exception = await prisma.approvalRule.create({
      data: {
        channelId: c.zone,
        name: "Pubs TikTok",
        isDefault: false,
        scope: "SOURCE_KIND",
        sourceKind: "AD_TIKTOK",
        gateMode: "REQUIRED",
        gateChannelIds: [c.tir],
      },
    });
    expect(await channelsWithRequiredGates([c.zone])).toBe(true);
    await prisma.approvalRule.update({ where: { id: exception.id }, data: { isActive: false } });
    expect(await channelsWithRequiredGates([c.zone])).toBe(false);
    // Le canal lui-même seul dans ses canaux à rejoindre : aucun canal obligatoire.
    await prisma.approvalRule.update({
      where: { id: ruleId },
      data: { gateMode: "REQUIRED", gateChannelIds: [c.zone] },
    });
    expect(await channelsWithRequiredGates([c.zone])).toBe(false);
    expect(await channelsWithRequiredGates([])).toBe(false);
    const html = renderToStaticMarkup(
      createElement(RequestFunnel, {
        periods: [{ key: "today", label: "Aujourd'hui", view }],
        welcomeHref: "/channels/x?tab=sequences",
      }),
    );
    expect(html).toContain("Modifier le message d&#x27;accueil");
    // Une seule période : pas de pastilles.
    expect(html).not.toContain("Période du parcours");
  });

  it("Statistiques → Canaux : canaux affichés seulement, période précédente avec la comparaison", async () => {
    const { m9 } = await seedScenario();
    // Une demande dans Tir Cadré (hors des canaux affichés si seul Zone Interdite l'est).
    const other = await member();
    await request(other, { at: new Date(NOW.getTime() - 2 * DAY), channelId: c.tir, link: null });
    const period = resolvePeriod({ range: "7d" }, NOW);
    const zoneOnly = await loadStatsRequestFunnel({
      channelIds: [c.zone],
      period,
      compare: true,
    });
    expect(zoneOnly.data.totals.requests).toBe(7);
    // Zone Interdite a des canaux obligatoires ; Tir Cadré n'a aucune règle.
    expect(zoneOnly.requiredGates).toBe(true);
    expect(
      (await loadStatsRequestFunnel({ channelIds: [c.tir], period, compare: false })).requiredGates,
    ).toBe(false);
    expect(zoneOnly.previous).toMatchObject({ requests: 1, welcomed: 1, accepted: 1 });
    expect(m9).toBeTruthy();
    const both = await loadStatsRequestFunnel({
      channelIds: [c.zone, c.tir],
      period,
      compare: false,
    });
    // Tir Cadré : m4 (en attente) et la nouvelle demande, plus m3 dans Zone Roulette exclue (canal non affiché).
    expect(both.data.totals.requests).toBe(9);
    expect(both.previous).toBeNull();
    const view = funnelView(zoneOnly.data, zoneOnly.previous);
    const first = view.steps[0]!;
    expect(first).toMatchObject({ valueText: "7", previousText: "1" });
    expect(first.variation).toMatchObject({ kind: "pct" });
    // Aucun canal affiché : aucune lecture, parcours vide.
    const none = await loadStatsRequestFunnel({ channelIds: [], period, compare: true });
    expect(none.data.totals.requests).toBe(0);
    expect(funnelView(none.data).empty).toBe(true);
  });
});
