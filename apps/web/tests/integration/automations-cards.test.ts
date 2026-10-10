/**
 * Relances automatiques (phase 9) sur base réelle :
 * - compteur des cartes « envoyé à N personnes cette semaine, M ont cliqué » (`loadRuleCounters`) : membres distincts
 *   ayant reçu un message de la relance sur 7 jours, essais exclus, clics d'offre (identifiant de suivi, hors robots)
 *   après le message ;
 * - les relances enregistrées par les cartes (`buildCardRule`) sont relues en base et rangées sous leur carte, la règle
 *   linéaire de la démo reste « sur mesure » ou sous sa carte selon sa forme ;
 * - choix des formulaires (`loadEditorOptions`) : canaux actifs avec leur univers, langues des membres regroupées
 *   (« fr-FR » compté avec « fr », membres anonymisés exclus).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { buildCardRule, defaultCardSettings, groupRulesByCard } from "@/lib/automations/cards";
import { loadEditorOptions, loadRuleCounters } from "@/lib/automations/queries";
import { resetDb } from "./helpers";

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const at = (h: number) => hoursAgo(h).toISOString();
const PREFIX = "RU · ";
const ids: Record<string, string> = {};

async function clean() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await prisma.automationRule.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await resetDb();
  await clean();
  const member = (
    n: number,
    firstName: string,
    extra: { languageCode?: string; anonymizedAt?: Date } = {},
  ) => prisma.member.create({ data: { telegramUserId: BigInt(8_310 + n), firstName, ...extra } });
  ids.ana = (await member(1, "Ana", { languageCode: "fr" })).id;
  ids.ben = (await member(2, "Ben", { languageCode: "fr-FR" })).id;
  ids.cid = (await member(3, "Cid", { languageCode: "es" })).id;
  ids.dora = (await member(4, "Dora", { languageCode: "de", anonymizedAt: hoursAgo(1) })).id;
  await prisma.channel.create({
    data: { telegramChatId: -100_831_001n, title: "RU Casino", vertical: "CASINO" },
  });
  await prisma.channel.create({
    data: { telegramChatId: -100_831_002n, title: "RU Sans univers" },
  });
  await prisma.channel.create({
    data: { telegramChatId: -100_831_003n, title: "RU Fermé", isActive: false },
  });
  ids.rule = (
    await prisma.automationRule.create({
      data: {
        name: `${PREFIX}Relance clic`,
        trigger: "OFFER_CLICKED",
        conditions: {},
        actions: [],
        graph: buildCardRule("offer_no_signup", defaultCardSettings("offer_no_signup"))
          .graph as object,
        templateKey: "offer_no_signup",
      },
    })
  ).id;
  ids.other = (
    await prisma.automationRule.create({
      data: { name: `${PREFIX}Autre`, trigger: "JOINED", conditions: {}, actions: [] },
    })
  ).id;
  const sent = (h: number) => [
    { step: 0, nodeId: "wait", type: "wait", at: at(h + 24), ok: true },
    { step: 1, nodeId: "check", type: "condition", at: at(h), ok: true, branch: "no" },
    { step: 2, nodeId: "message", type: "send_message", at: at(h), ok: true },
  ];
  const run = (
    ruleId: string,
    memberId: string,
    log: unknown[],
    extra: { context?: object; createdAt?: Date } = {},
  ) =>
    prisma.automationRun.create({
      data: {
        ruleId,
        memberId,
        status: "DONE",
        log: log as object,
        context: extra.context ?? {},
        createdAt: extra.createdAt ?? hoursAgo(30),
      },
    });
  await run(ids.rule, ids.ana!, sent(10)); // reçu il y a 10 h, a cliqué après
  await run(ids.rule, ids.ben!, sent(20)); // reçu, clic avant le message seulement
  await run(ids.rule, ids.cid!, sent(5), { context: { test: true } }); // essai : ignoré
  await run(ids.rule, ids.dora!, sent(24 * 9)); // hors de la fenêtre (mis à jour aujourd'hui)
  await run(ids.rule, ids.dora!, [{ step: 0, nodeId: "wait", type: "wait", at: at(1), ok: true }], {
    createdAt: hoursAgo(1),
  }); // en attente
  await run(ids.other!, ids.ben!, [{ step: 0, type: "send_message", at: at(2), ok: false }]); // échec : rien remis

  const link = await prisma.trackingLink.create({
    data: { slug: "ru-test-offer", destinationTemplate: "https://x.y/{subid}", label: "RU offre" },
  });
  const click = (
    memberId: string,
    h: number,
    extra: { isBot?: boolean; subId?: string | null } = {},
  ) =>
    prisma.click.create({
      data: {
        trackingLinkId: link.id,
        memberId,
        createdAt: hoursAgo(h),
        isBot: extra.isBot ?? false,
        subId: extra.subId === undefined ? `ru-${memberId}-${h}` : extra.subId,
      },
    });
  await click(ids.ana!, 3); // après le message : compte
  await click(ids.ben!, 22); // avant le message : ne compte pas
  await click(ids.ben!, 1, { isBot: true }); // robot : ne compte pas
  await click(ids.ben!, 2, { subId: null }); // sans identifiant de suivi : pas une offre
  await click(ids.cid!, 1); // essai : ignoré
});

afterAll(async () => {
  await clean();
  await prisma.channel.deleteMany({ where: { title: { startsWith: "RU " } } });
  await prisma.trackingLink.deleteMany({ where: { slug: "ru-test-offer" } });
  await resetDb();
});

describe("relances automatiques (base réelle)", () => {
  it("compteur de la semaine : envoyés et cliqués, selon la définition documentée", async () => {
    const counters = await loadRuleCounters([ids.rule!, ids.other!], now);
    expect(counters[ids.rule!]).toEqual({ sent: 2, clicked: 1 });
    expect(counters[ids.other!]).toBeUndefined();
    expect(await loadRuleCounters([], now)).toEqual({});
  });

  it("une relance enregistrée par une carte est relue et rangée sous sa carte", async () => {
    const rules = await prisma.automationRule.findMany({ where: { name: { startsWith: PREFIX } } });
    const { cards, custom } = groupRulesByCard(rules);
    expect(cards.find((c) => c.key === "offer_no_signup")?.rule?.id).toBe(ids.rule);
    expect(custom.map((r) => r.id)).toEqual([ids.other]);
  });

  it("choix des formulaires : univers des canaux actifs et langues des membres", async () => {
    const o = await loadEditorOptions();
    const ru = o.channels.filter((c) => c.title.startsWith("RU "));
    expect(ru).toEqual([
      { id: expect.any(String), title: "RU Casino", vertical: "CASINO" },
      { id: expect.any(String), title: "RU Sans univers", vertical: null },
    ]);
    expect(o.languages).toEqual([
      { code: "fr", count: 2 },
      { code: "es", count: 1 },
    ]);
  });
});
