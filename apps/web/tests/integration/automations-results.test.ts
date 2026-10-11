/**
 * Relances automatiques, phase 10, sur base réelle :
 * - résultats d'une relance (`loadRuleResults`) : envoyés (messages remis rattachés à la relance, essais et échecs
 *   exclus), clics de ses boutons Offre par des membres qui l'avaient reçue pour de vrai (les clics d'un essai
 *   « Tester sur moi », même lien, ne comptent pas), inscriptions, premiers dépôts et gains (événements de commission
 *   des joueurs venus de ces clics, annulation retirée) ; rien d'une autre relance ;
 * - début des résultats par relance (`loadResultsTrackingStart`) : date de la migration de la phase 10 ;
 * - une carte enregistrée avec un bouton « Offre (campagne) » garde la campagne et l'offre (vérifiées en base), et
 *   une offre qui n'est pas dans la campagne est refusée sans rien écrire.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { loadResultsTrackingStart, loadRuleResults } from "@/lib/automations/queries";
import { createTestBot, resetDb } from "./helpers";

const session = vi.hoisted(() => ({
  user: { id: "", email: "relances@results.test.local", name: "Équipe relances", role: "ADMIN" },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const { saveCardAction } = await import("@/app/(admin)/members/automations/actions");

const PREFIX = "RR · ";
const ids: Record<string, string> = {};

async function clean() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  const mine = {
    OR: [{ name: { startsWith: PREFIX } }, ...(user ? [{ createdById: user.id }] : [])],
  };
  await prisma.automationRun.deleteMany({ where: { rule: mine } });
  await prisma.automationRule.deleteMany({ where: mine });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { user: { email: session.user.email } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("aucune redirection");
}

beforeAll(async () => {
  await resetDb();
  await clean();
  session.user.id = (
    await prisma.user.create({
      data: {
        email: session.user.email,
        name: session.user.name,
        passwordHash: "x",
        role: "ADMIN",
      },
    })
  ).id;
  const bot = await createTestBot(833, "CASINO");
  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino RR", source: "LINKAFFI", externalId: "cas-rr" },
  });
  const offer = (externalId: string) =>
    prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId,
        campaignKey: externalId.toUpperCase(),
        name: `Offre ${externalId}`,
        trackingUrlTemplate: `https://linkaffi.me/go/${externalId}?sub_id={subid}`,
      },
    });
  ids.offer = (await offer("rr1")).id;
  ids.otherOffer = (await offer("rr2")).id;
  ids.campaign = (
    await prisma.campaign.create({
      data: { name: `${PREFIX}Casino`, status: "ACTIVE", affiliateCampaignIds: [ids.offer] },
    })
  ).id;
  const rule = (name: string) =>
    prisma.automationRule.create({
      data: { name: `${PREFIX}${name}`, trigger: "OFFER_CLICKED", conditions: {}, actions: [] },
    });
  ids.rule = (await rule("Relance offre")).id;
  ids.other = (await rule("Autre")).id;
  ids.empty = (await rule("Vide")).id;

  const member = (n: number) =>
    prisma.member.create({ data: { telegramUserId: BigInt(8_330 + n), firstName: `M${n}` } });
  const m = await Promise.all([1, 2, 3, 4, 5].map(member));
  const out = (
    memberId: string,
    ruleId: string,
    kind: "AUTOMATION" | "TEST",
    status: "SENT" | "FAILED",
  ) =>
    prisma.outboundMessage.create({
      data: { botId: bot.id, memberId, kind, status, text: "x", automationRuleId: ruleId },
    });
  await out(m[0]!.id, ids.rule, "AUTOMATION", "SENT");
  await out(m[1]!.id, ids.rule, "AUTOMATION", "SENT");
  await out(m[2]!.id, ids.rule, "AUTOMATION", "SENT");
  await out(m[3]!.id, ids.rule, "AUTOMATION", "FAILED"); // échec : pas compté
  await out(m[4]!.id, ids.rule, "TEST", "SENT"); // essai : pas compté
  await out(m[4]!.id, ids.other, "AUTOMATION", "SENT"); // autre relance

  const link = (slug: string, ruleId: string, clicks: number, uniqueClicks: number) =>
    prisma.trackingLink.create({
      data: {
        slug,
        kind: "OFFER",
        destinationTemplate: "https://linkaffi.me/go/rr1?sub_id={subid}",
        label: "RR offre",
        automationRuleId: ruleId,
        campaignId: ids.campaign,
        affiliateCampaignId: ids.offer,
        clicks,
        uniqueClicks,
      },
    });
  // Compteurs du lien = toutes les lignes de clic, essais compris (5 clics, 4 personnes).
  const ruleLink = await link("rrlink0001", ids.rule, 5, 4);
  const otherLink = await link("rrlink0002", ids.other, 2, 2);
  const click = (linkId: string, memberId: string, subId: string, createdAt?: Date) =>
    prisma.click.create({ data: { trackingLinkId: linkId, memberId, subId, createdAt } });
  const c1 = await click(ruleLink.id, m[0]!.id, "RRSUB0000001");
  const c2 = await click(ruleLink.id, m[1]!.id, "RRSUB0000002");
  const c3 = await click(ruleLink.id, m[2]!.id, "RRSUB0000003");
  const c4 = await click(otherLink.id, m[4]!.id, "RRSUB0000004");
  // « Tester sur moi » : m[4] n'a reçu cette relance qu'en essai, son clic sur le même lien ne compte pas.
  const cTest = await click(ruleLink.id, m[4]!.id, "RRSUB0000005");
  // Clic de m[0] daté d'avant son premier message réel (pendant un essai) : ne compte pas.
  await click(ruleLink.id, m[0]!.id, "RRSUB0000006", new Date(Date.now() - 3_600_000));
  const at = new Date("2026-10-10T12:00:00Z");
  const player = (
    clickId: string,
    n: number,
    extra: { ftdAt?: Date; cpaStatus?: string; cpaAmount?: number } = {},
  ) =>
    prisma.player.create({
      data: {
        affiliateCampaignId: ids.offer!,
        externalPlayerId: `RR-${n}`,
        clickId,
        registeredAt: at,
        ftdAt: extra.ftdAt ?? null,
        cpaStatus: extra.cpaStatus ?? null,
        cpaAmount: extra.cpaAmount ?? null,
      },
    });
  // Premier dépôt + commission créditée (événement daté).
  const p1 = await player(c1.id, 1, { ftdAt: at, cpaStatus: "approved", cpaAmount: 50 });
  await prisma.playerEvent.create({
    data: { playerId: p1.id, type: "CPA", amount: 50, occurredAt: at, externalId: "cpa:rr-1" },
  });
  // Commission créditée (approuvée), sans premier dépôt.
  const p2 = await player(c2.id, 2, { cpaStatus: "approved", cpaAmount: 45 });
  await prisma.playerEvent.create({
    data: { playerId: p2.id, type: "CPA", amount: 45, occurredAt: at, externalId: "cpa:rr-2" },
  });
  // Premier dépôt, commission créditée puis annulée : rien.
  const p3 = await player(c3.id, 3, { ftdAt: at, cpaStatus: "reversed", cpaAmount: 40 });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: p3.id, type: "CPA", amount: 40, occurredAt: at, externalId: "cpa:rr-3" },
      {
        playerId: p3.id,
        type: "CPA_REVERSAL",
        amount: -40,
        occurredAt: at,
        externalId: "cpa_reversal:rr-3",
      },
    ],
  });
  // Joueur venu du clic d'essai : ne compte pas.
  const p5 = await player(cTest.id, 5, { ftdAt: at, cpaStatus: "approved", cpaAmount: 80 });
  await prisma.playerEvent.create({
    data: { playerId: p5.id, type: "CPA", amount: 80, occurredAt: at, externalId: "cpa:rr-5" },
  });
  // Joueur d'une autre relance.
  const p4 = await player(c4.id, 4, { ftdAt: at, cpaStatus: "approved", cpaAmount: 99 });
  await prisma.playerEvent.create({
    data: { playerId: p4.id, type: "CPA", amount: 99, occurredAt: at, externalId: "cpa:rr-4" },
  });
});

afterAll(clean);

describe("résultats d'une relance (base réelle)", () => {
  it("envoyés, clics, inscriptions, premiers dépôts et gains de la relance seulement", async () => {
    const r = await loadRuleResults([ids.rule!, ids.other!, ids.empty!]);
    expect(r[ids.rule!]).toEqual({
      sent: 3,
      clicks: 3,
      clickers: 3,
      registrations: 3,
      ftds: 2,
      commissions: 95,
      gains: 95,
    });
    expect(r[ids.other!]).toMatchObject({
      sent: 1,
      clicks: 1,
      registrations: 1,
      ftds: 1,
      gains: 99,
    });
    expect(r[ids.empty!]).toEqual({
      sent: 0,
      clicks: 0,
      clickers: 0,
      registrations: 0,
      ftds: 0,
      commissions: 0,
      gains: 0,
    });
    expect(await loadRuleResults([])).toEqual({});
  });

  it("début des résultats par relance : fin de la migration de la phase 10 (base migrée)", async () => {
    const start = await loadResultsTrackingStart();
    expect(start).toBeInstanceOf(Date);
    expect(start!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("carte enregistrée avec un bouton « Offre (campagne) » (base réelle)", () => {
  const form = (affiliateCampaignId: string) => {
    const fd = new FormData();
    fd.set("templateKey", "offer_no_signup");
    fd.set("delay", "24");
    fd.set("text", "Bonjour {prenom}, votre offre vous attend.");
    fd.set(
      "buttonsJson",
      JSON.stringify([
        {
          kind: "offer",
          text: "Voir l'offre",
          url: "",
          campaignId: ids.campaign,
          affiliateCampaignId,
        },
      ]),
    );
    return fd;
  };

  it("offre de la campagne : relance créée (désactivée) avec le bouton, campagne et offre gardées", async () => {
    const url = await redirectOf(saveCardAction(form(ids.offer!)));
    expect(url).toMatch(/^\/members\/automations\?ok=/);
    const rule = await prisma.automationRule.findFirstOrThrow({
      where: { createdById: session.user.id, templateKey: "offer_no_signup" },
    });
    expect(rule.isActive).toBe(false);
    const message = (
      rule.graph as { nodes: Array<{ id: string; action?: { buttons?: unknown } }> }
    ).nodes.find((n) => n.id === "message");
    expect(message?.action?.buttons).toEqual([
      [
        {
          text: "Voir l'offre",
          type: "OFFER",
          campaignId: ids.campaign,
          affiliateCampaignId: ids.offer,
        },
      ],
    ]);
  });

  it("offre qui n'est pas dans la campagne : refusée en français, rien n'est écrit", async () => {
    const before = await prisma.automationRule.count();
    const r = await saveCardAction(form(ids.otherOffer!));
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(
        /Bouton « Voir l'offre » : cette offre n'est plus dans la campagne/,
      ),
    });
    expect(await prisma.automationRule.count()).toBe(before);
  });
});
