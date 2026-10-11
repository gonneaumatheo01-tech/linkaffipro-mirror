/**
 * Reprise des gains (packages/db/prisma/phase10-gains.ts, `pnpm db:phase10:gains`) sur base réelle : les joueurs déjà
 * importés reçoivent leurs champs CPA et leurs événements de commission depuis leur ligne Link Affi gardée (`raw`),
 * avec la même règle que la synchro (montants convertis avec la table de taux gardée par la synchro) ; relançable sans
 * doublon ; un joueur sans commission n'est pas touché ; seules les commissions de NOS joueurs vont au journal ; un
 * nouveau crédit après une annulation garde l'ancien couple.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CURRENCY_RATES_SETTING_KEY } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import {
  GAINS_SUMMARY_ACTION,
  backfillCommissions,
  cpaStateFromRaw,
} from "../../../../packages/db/prisma/phase10-gains";
import { resetDb } from "./helpers";

const db = prisma as unknown as PrismaClient;

const approvedRaw = {
  id: "la-ok",
  cpa_status: "approved",
  cpa_affiliate_amount: 70,
  cpa_credited_at: "2026-10-02T14:27:34.268902+00:00",
};
const reversedRaw = {
  id: "la-rev",
  cpa_status: "reversed",
  cpa_affiliate_amount: "70",
  cpa_credited_at: null,
  qualified_at: "2026-10-04T12:01:03Z",
  cpa_reversed_at: "2026-10-06T06:17:01.773859+00:00",
};

const usdRaw = {
  id: "la-usd",
  cpa_status: "approved",
  cpa_affiliate_amount: 100,
  currency: "USD",
  cpa_credited_at: "2026-10-03T10:00:00Z",
};
/** Joueur d'un autre affilié (offre non rattachée à nos campagnes, aucun clic à nous). */
const otherRaw = {
  id: "la-other",
  cpa_status: "approved",
  cpa_affiliate_amount: 500,
  cpa_credited_at: "2026-10-03T12:00:00Z",
};

describe("reprise phase 10 : commissions CPA des joueurs déjà importés", () => {
  const ids: Record<string, string> = {};
  let campaignId = "";

  beforeAll(async () => {
    await resetDb();
    await prisma.auditLog.deleteMany({ where: { action: GAINS_SUMMARY_ACTION } });
    // Table de taux gardée par la synchro (unités de devise pour 1 EUR).
    await prisma.setting.upsert({
      where: { key: CURRENCY_RATES_SETTING_KEY },
      create: { key: CURRENCY_RATES_SETTING_KEY, value: { EUR: 1, USD: 1.25 } },
      update: { value: { EUR: 1, USD: 1.25 } },
    });
    const program = await prisma.affiliateProgram.create({
      data: { name: "Casino P10", externalId: "prog-p10" },
    });
    const off = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "OFF-P10",
        name: "Offre",
        trackingUrlTemplate: "https://linkaffi.me/go/X?sub_id={subid}",
      },
    });
    const other = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "OFF-OTHER",
        name: "Offre d'un autre affilié",
        trackingUrlTemplate: "https://linkaffi.me/go/Y?sub_id={subid}",
      },
    });
    // Notre campagne rattache l'offre OFF-P10 : ses joueurs sont les nôtres.
    campaignId = (
      await prisma.campaign.create({
        data: { name: "Campagne P10", vertical: "CASINO", affiliateCampaignIds: [off.id] },
      })
    ).id;
    const mk = async (
      key: string,
      raw: Record<string, unknown> | null,
      offerId: string = off.id,
    ) => {
      const p = await prisma.player.create({
        data: {
          affiliateCampaignId: offerId,
          externalPlayerId: key,
          raw: (raw ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      ids[key] = p.id;
    };
    await mk("ok", approvedRaw);
    await mk("rev", reversedRaw);
    await mk("none", { id: "la-none", cpa_status: "none", cpa_affiliate_amount: 50 });
    await mk("noraw", null);
    await mk("usd", usdRaw);
    await mk("other", otherRaw, other.id);
    // Un événement d'une autre origine (inscription) : jamais retiré par la reprise.
    await prisma.playerEvent.create({
      data: {
        playerId: ids.ok!,
        type: "REGISTRATION",
        occurredAt: new Date("2026-10-01T10:00:00Z"),
        externalId: "registration:ok",
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: GAINS_SUMMARY_ACTION } });
    await prisma.setting.deleteMany({ where: { key: CURRENCY_RATES_SETTING_KEY } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await resetDb();
  });

  it("lit l'état CPA d'une ligne brute (texte ou nombre, dates ISO, replis)", () => {
    expect(cpaStateFromRaw(reversedRaw)).toEqual({
      laPlayerId: "la-rev",
      status: "reversed",
      amount: 70,
      creditedAt: null,
      reversedAt: new Date("2026-10-06T06:17:01.773Z"),
      qualifiedAt: new Date("2026-10-04T12:01:03Z"),
      disqualifiedAt: null,
      observedAt: null,
    });
    // Même conversion que la synchro : 100 $ à 1,25 $ pour 1 € = 80 €.
    expect(cpaStateFromRaw(usdRaw, { EUR: 1, USD: 1.25 })!.amount).toBe(80);
    expect(cpaStateFromRaw(null)).toBeNull();
    expect(cpaStateFromRaw({ cpa_status: "approved" })).toBeNull();
  });

  it("écrit les champs CPA et les événements datés, puis ne refait rien au second passage", async () => {
    const r1 = await backfillCommissions(db);
    expect(r1).toMatchObject({
      players: 6,
      withCommission: 4,
      playersUpdated: 5,
      eventsWritten: 5,
      eventsRemoved: 0,
      firstDay: "2026-10-02",
    });
    // Montant converti avec la table de taux gardée par la synchro.
    const usd = await prisma.player.findUniqueOrThrow({
      where: { id: ids.usd! },
      include: { events: true },
    });
    expect(Number(usd.cpaAmount)).toBe(80);
    expect(usd.events.map((e) => Number(e.amount))).toEqual([80]);
    // Joueur d'un autre affilié : sa commission est gardée (filtrée à la lecture), sans entrée de journal.
    const other = await prisma.player.findUniqueOrThrow({
      where: { id: ids.other! },
      include: { events: true },
    });
    expect(other.events.map((e) => [e.type, Number(e.amount)])).toEqual([["CPA", 500]]);

    const rev = await prisma.player.findUniqueOrThrow({
      where: { id: ids.rev! },
      include: { events: { orderBy: { occurredAt: "asc" } } },
    });
    expect(rev.cpaStatus).toBe("reversed");
    expect(Number(rev.cpaAmount)).toBe(70);
    // Repli sur la qualification pour la date de crédit.
    expect(rev.cpaCreditedAt?.toISOString()).toBe("2026-10-04T12:01:03.000Z");
    expect(rev.events.map((e) => [e.type, Number(e.amount), e.externalId])).toEqual([
      ["CPA", 70, "cpa:la-rev"],
      ["CPA_REVERSAL", -70, "cpa_reversal:la-rev"],
    ]);
    // Statut « none » : champs recopiés, aucun événement.
    const none = await prisma.player.findUniqueOrThrow({
      where: { id: ids.none! },
      include: { events: true },
    });
    expect(none).toMatchObject({ cpaStatus: "none", cpaCreditedAt: null });
    expect(none.events).toEqual([]);
    // Journal : une ligne par commission ou annulation, à sa date réelle ; un résumé dans le journal des actions.
    const logged = await prisma.event.findMany({
      where: { type: { startsWith: "player.cpa_" } },
      orderBy: { occurredAt: "asc" },
    });
    expect(logged.map((e) => [e.type, e.occurredAt.toISOString()])).toEqual([
      ["player.cpa_credited", "2026-10-02T14:27:34.268Z"],
      ["player.cpa_credited", "2026-10-03T10:00:00.000Z"],
      ["player.cpa_credited", "2026-10-04T12:01:03.000Z"],
      ["player.cpa_reversed", "2026-10-06T06:17:01.773Z"],
    ]);
    expect(await prisma.auditLog.count({ where: { action: GAINS_SUMMARY_ACTION } })).toBe(1);

    const r2 = await backfillCommissions(db);
    expect(r2).toMatchObject({
      playersUpdated: 0,
      eventsWritten: 0,
      eventsRemoved: 0,
      firstDay: null,
    });
    expect(
      await prisma.playerEvent.count({ where: { type: { in: ["CPA", "CPA_REVERSAL"] } } }),
    ).toBe(5);
    expect(await prisma.event.count({ where: { type: { startsWith: "player.cpa_" } } })).toBe(4);
    expect(await prisma.playerEvent.count({ where: { externalId: "registration:ok" } })).toBe(1);
  });

  it("Link Affi crédite de nouveau après l'annulation : +70 / −70 gardés, +70 le jour du changement", async () => {
    await prisma.player.update({
      where: { id: ids.rev! },
      data: {
        raw: {
          ...reversedRaw,
          cpa_status: "approved",
          cpa_reversed_at: null,
          updated_at: "2026-10-09T08:00:00Z",
        },
      },
    });
    const r = await backfillCommissions(db);
    expect(r).toMatchObject({ eventsWritten: 1, eventsRemoved: 0, firstDay: "2026-10-09" });
    const events = await prisma.playerEvent.findMany({
      where: { playerId: ids.rev! },
      orderBy: { occurredAt: "asc" },
    });
    expect(
      events.map((e) => [e.type, Number(e.amount), e.occurredAt.toISOString(), e.externalId]),
    ).toEqual([
      ["CPA", 70, "2026-10-04T12:01:03.000Z", "cpa:la-rev:1"],
      ["CPA_REVERSAL", -70, "2026-10-06T06:17:01.773Z", "cpa_reversal:la-rev:1"],
      ["CPA", 70, "2026-10-09T08:00:00.000Z", "cpa:la-rev"],
    ]);
    // Relancée : rien de plus.
    expect(await backfillCommissions(db)).toMatchObject({ eventsWritten: 0, playersUpdated: 0 });
  });
});
