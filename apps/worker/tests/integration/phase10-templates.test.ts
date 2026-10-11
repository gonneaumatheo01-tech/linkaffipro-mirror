/**
 * Reprise phase 10 des modèles fournis (packages/db/prisma/phase10-templates.ts) sur base réelle : seuls les modèles
 * restés tels que la bibliothèque les a insérés sont réécrits (texte sans repère + bouton Offre), jamais un modèle
 * modifié par l'équipe (texte, bouton, nom, média, ou enregistré depuis le site) ; journal des actions ; second passage
 * sans effet ; `seed:templates` recrée un absent dans la nouvelle version.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@linkaffipro/db";
import {
  PHASE10_SUMMARY_ACTION,
  PHASE9_TEMPLATE_TEXTS,
  rewriteTemplates,
  TEMPLATE_REWRITTEN_ACTION,
} from "../../../../packages/db/prisma/phase10-templates";
import {
  buildTemplateRows,
  seedTemplates,
  type TemplateDb,
} from "../../../../packages/db/prisma/seed-templates";
import { createBotAndChannel, resetDb } from "./helpers";

const db = prisma as unknown as PrismaClient;
const rows = buildTemplateRows();
const quiet = () => undefined;
const EDITED = "modele:casino:bonus:1";
const WITH_BUTTON = "modele:sports:rappel:2";
const MISSING = "modele:dating:teasing:2";
const TEAM_TEXT = "Notre propre version, écrite par l'équipe.";
const TEAM_BUTTONS = [[{ text: "Site", type: "URL", url: "https://example.org" }]];
// Texte d'origine gardé, mais l'équipe a touché à autre chose.
const RENAMED = "modele:casino:teasing:1";
const TEAM_NAME = "Notre teasing du lundi";
const WITH_MEDIA = "modele:sports:bonus:1";
const SAVED_FROM_SITE = "modele:dating:rappel:1";
const TEAM_EMAIL = "modeles@phase10.test.local";
const KEPT = [EDITED, WITH_BUTTON, RENAMED, WITH_MEDIA, SAVED_FROM_SITE];

async function cleanAudit() {
  await prisma.auditLog.deleteMany({
    where: { action: { in: [TEMPLATE_REWRITTEN_ACTION, PHASE10_SUMMARY_ACTION] } },
  });
}

async function cleanUser() {
  await prisma.post.deleteMany({ where: { updatedBy: { email: TEAM_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: TEAM_EMAIL } });
}

describe("reprise phase 10 des modèles fournis (base réelle)", () => {
  beforeAll(async () => {
    await resetDb();
    await cleanAudit();
    await cleanUser();
    const { bot, channel } = await createBotAndChannel();
    // État de la production avant la phase 10 : les 63 modèles d'origine, sans bouton (un absent).
    for (const r of rows) {
      if (r.code === MISSING) continue;
      await prisma.post.create({
        data: {
          code: r.code,
          templateName: r.templateName,
          vertical: r.vertical,
          channelId: channel.id,
          botId: bot.id,
          status: "DRAFT",
          isTemplate: true,
          language: "fr",
          text: PHASE9_TEMPLATE_TEXTS[r.code]!,
          buttons: [],
        },
      });
    }
    // Modifiés par l'équipe : un texte réécrit, un bouton ajouté (texte d'origine gardé).
    await prisma.post.update({ where: { code: EDITED }, data: { text: TEAM_TEXT } });
    await prisma.post.update({ where: { code: WITH_BUTTON }, data: { buttons: TEAM_BUTTONS } });
    // Texte d'origine, mais renommé ; avec une image ; enregistré depuis le site (« Modifier »).
    await prisma.post.update({ where: { code: RENAMED }, data: { templateName: TEAM_NAME } });
    await prisma.post.update({ where: { code: WITH_MEDIA }, data: { mediaAssetIds: ["media-1"] } });
    const user = await prisma.user.create({
      data: { email: TEAM_EMAIL, name: "Équipe", passwordHash: "x", role: "MANAGER" },
    });
    await prisma.post.update({
      where: { code: SAVED_FROM_SITE },
      data: { updatedById: user.id, language: "en" },
    });
  });

  afterAll(async () => {
    await cleanAudit();
    await cleanUser();
  });

  it("premier passage : réécrit les modèles d'origine, garde ceux de l'équipe, journalise chaque modèle", async () => {
    const r = await rewriteTemplates(db, quiet);
    const changed = rows
      .filter((x) => x.text !== PHASE9_TEMPLATE_TEXTS[x.code] || x.buttons.length > 0)
      .map((x) => x.code);
    expect([...r.keptByTeam].sort()).toEqual([...KEPT].sort());
    expect(r.missing).toEqual([MISSING]);
    expect([...r.updated].sort()).toEqual(
      changed.filter((c) => ![...KEPT, MISSING].includes(c)).sort(),
    );
    expect(r.updated.length + r.upToDate.length + r.keptByTeam.length + r.missing.length).toBe(63);

    const posts = await prisma.post.findMany({ where: { code: { startsWith: "modele:" } } });
    const byCode = new Map(posts.map((p) => [p.code, p]));
    for (const row of rows) {
      const p = byCode.get(row.code);
      if (row.code === MISSING) {
        expect(p).toBeUndefined();
        continue;
      }
      if (row.code === EDITED) {
        expect(p!.text).toBe(TEAM_TEXT);
        expect(p!.buttons).toEqual([]);
        continue;
      }
      if (row.code === WITH_BUTTON) {
        expect(p!.text).toBe(PHASE9_TEMPLATE_TEXTS[row.code]);
        expect(p!.buttons).toEqual(TEAM_BUTTONS);
        continue;
      }
      if ([RENAMED, WITH_MEDIA, SAVED_FROM_SITE].includes(row.code)) {
        expect(p!.text, row.code).toBe(PHASE9_TEMPLATE_TEXTS[row.code]);
        expect(p!.buttons, row.code).toEqual([]);
        continue;
      }
      expect(p!.text, row.code).toBe(row.text);
      expect(p!.buttons, row.code).toEqual(row.buttons);
      expect(p!.text, row.code).not.toMatch(/\{(prenom|offre|canal)\}/);
    }
    // Bouton Offre sans campagne, au format des boutons de message.
    expect(byCode.get("modele:casino:bonus:2")!.buttons).toEqual([
      [{ text: expect.any(String), type: "OFFER" }],
    ]);

    const perPost = await prisma.auditLog.findMany({
      where: { action: TEMPLATE_REWRITTEN_ACTION },
    });
    expect(perPost).toHaveLength(r.updated.length);
    expect(new Set(perPost.map((a) => a.entityId))).toEqual(
      new Set(r.updated.map((c) => byCode.get(c)!.id)),
    );
    expect(perPost.every((a) => a.entityType === "Post" && a.userId === null)).toBe(true);
    const summary = await prisma.auditLog.findMany({ where: { action: PHASE10_SUMMARY_ACTION } });
    expect(summary).toHaveLength(1);
    expect(summary[0]!.metadata).toMatchObject({ keptByTeam: r.keptByTeam, missing: [MISSING] });
  });

  it("second passage : aucune écriture, aucun nouveau journal par modèle", async () => {
    const before = await prisma.post.findMany({
      where: { code: { startsWith: "modele:" } },
      select: { code: true, updatedAt: true },
    });
    const rewrittenBefore = await prisma.auditLog.count({
      where: { action: TEMPLATE_REWRITTEN_ACTION },
    });
    const r = await rewriteTemplates(db, quiet);
    expect(r.updated).toEqual([]);
    expect([...r.keptByTeam].sort()).toEqual([...KEPT].sort());
    const after = await prisma.post.findMany({
      where: { code: { startsWith: "modele:" } },
      select: { code: true, updatedAt: true },
    });
    expect(after.map((p) => [p.code, p.updatedAt.getTime()]).sort()).toEqual(
      before.map((p) => [p.code, p.updatedAt.getTime()]).sort(),
    );
    expect(await prisma.auditLog.count({ where: { action: TEMPLATE_REWRITTEN_ACTION } })).toBe(
      rewrittenBefore,
    );
    expect(await prisma.auditLog.count({ where: { action: PHASE10_SUMMARY_ACTION } })).toBe(2);
  });

  it("seed:templates recrée le modèle absent dans sa nouvelle version, sans toucher aux autres", async () => {
    const r = await seedTemplates(prisma as unknown as TemplateDb, quiet);
    expect(r).toEqual({ created: 1, skipped: 62 });
    const row = rows.find((x) => x.code === MISSING)!;
    const p = await prisma.post.findUniqueOrThrow({ where: { code: MISSING } });
    expect(p.text).toBe(row.text);
    expect(p.buttons).toEqual(row.buttons);
    expect((await prisma.post.findUniqueOrThrow({ where: { code: EDITED } })).text).toBe(TEAM_TEXT);
  });
});
