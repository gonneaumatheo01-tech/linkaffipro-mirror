import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de la phase 15 (pages d'atterrissage Telegram, rubrique « Pages ») : elle doit exister et
// rester additive (ni suppression, ni renommage, ni changement de type, ni colonne obligatoire sans défaut sur une table
// existante, ni écriture de données). Supprimer une page ne supprime jamais un lien d'invitation, une demande ou une pub :
// les clés étrangères posées sur des tables existantes (ou vers elles) passent à null ; seules les lignes propres à la
// page (sources, visites et clics) partent avec elle, et une page part avec son canal.

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function phase15Sql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase15_pages_atterrissage"));
  if (dirs.length !== 1) return null;
  return readFileSync(join(MIGRATIONS, dirs[0]!, "migration.sql"), "utf8");
}

/** Instructions SQL sans commentaires, espaces normalisés. */
function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Bloc d'un modèle ou d'une énumération Prisma (`model X { … }`). */
function block(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\n(model|enum) ${name} \\{[\\s\\S]*?\\n\\}`));
  return m?.[0] ?? "";
}

/** Clés étrangères de la migration : table, colonne, table visée, comportement à la suppression. */
function foreignKeys(sql: string): Array<{ table: string; column: string; target: string; onDelete: string }> {
  const out: Array<{ table: string; column: string; target: string; onDelete: string }> = [];
  for (const s of statements(sql)) {
    const m =
      /^ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("(\w+)"\) REFERENCES "(\w+)"\("id"\) ON DELETE (SET NULL|CASCADE) ON UPDATE CASCADE$/.exec(
        s,
      );
    if (m) out.push({ table: m[1]!, column: m[2]!, target: m[3]!, onDelete: m[4]! });
  }
  return out;
}

const NEW_TABLES = ["LandingPage", "LandingSource", "LandingEvent"];

describe("migration phase 15 : pages d'atterrissage", () => {
  const sql = phase15Sql();

  it("existe une seule fois", () => {
    expect(sql).not.toBeNull();
  });

  it("est additive (index uniques et suppressions en cascade seulement sur les nouvelles tables)", () => {
    const created = new Set<string>();
    for (const s of statements(sql ?? "")) {
      const table = s.match(/^CREATE TABLE "(\w+)"/)?.[1];
      if (table) {
        created.add(table);
        continue;
      }
      if (/^CREATE TYPE "\w+" AS ENUM \('\w+'(, '\w+')*\)$/.test(s)) continue;
      if (/^ALTER TYPE "\w+" ADD VALUE '\w+'$/.test(s)) continue;
      if (/^CREATE INDEX "\w+" ON "\w+"\("\w+"(, "\w+")*\)$/.test(s)) continue;
      const unique = s.match(/^CREATE UNIQUE INDEX "\w+" ON "(\w+)"/)?.[1];
      if (unique) {
        expect(created.has(unique), `index unique sur une table existante : ${s}`).toBe(true);
        continue;
      }
      const fk = s.match(
        /^ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("\w+"\) REFERENCES "\w+"\("\w+"\) ON DELETE (SET NULL|CASCADE) ON UPDATE CASCADE$/,
      );
      if (fk) {
        if (fk[2] === "CASCADE")
          expect(created.has(fk[1]!), `suppression en cascade sur une table existante : ${s}`).toBe(true);
        continue;
      }
      const add = s.match(/^ALTER TABLE "\w+" (ADD COLUMN .*)$/)?.[1];
      if (add) {
        for (const col of add.split(/,\s*(?=ADD COLUMN)/)) {
          expect(col, `colonne non additive : ${col}`).toMatch(/^ADD COLUMN "\w+" /);
          if (/NOT NULL/.test(col))
            expect(col, `colonne obligatoire sans défaut : ${col}`).toMatch(/DEFAULT /);
        }
        continue;
      }
      throw new Error(`Instruction non additive : ${s}`);
    }
    expect([...created].sort()).toEqual([...NEW_TABLES].sort());
  });

  it("ajoute le lien LANDING (page + source), les exceptions par page et la photo du canal", () => {
    expect(sql).toMatch(/ALTER TYPE "InviteLinkKind" ADD VALUE 'LANDING';/);
    for (const v of ["LANDING_ANY", "LANDING_PAGE"])
      expect(sql).toMatch(new RegExp(`ALTER TYPE "ApprovalSourceKind" ADD VALUE '${v}'`));
    expect(sql).toMatch(/CREATE TYPE "LandingEventType" AS ENUM \('VIEW', 'CLICK', 'OPENED'\)/);
    for (const v of ["LANDING"]) expect(block("InviteLinkKind")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
    for (const v of ["LANDING_ANY", "LANDING_PAGE"])
      expect(block("ApprovalSourceKind")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
    for (const v of ["VIEW", "CLICK", "OPENED"])
      expect(block("LandingEventType")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
    expect(block("InviteLink")).toMatch(/landingPageId\s+String\?/);
    expect(block("InviteLink")).toMatch(/landingSource\s+String\?/);
    expect(block("InviteLink")).toMatch(/@@index\(\[landingPageId, landingSource\]\)/);
    // Exception « la page <nom> » : identifiant de page sans clé étrangère (« page supprimée » affiché).
    expect(block("ApprovalRule")).toMatch(/landingPageId\s+String\?/);
    expect(block("ApprovalRule")).not.toMatch(/landingPage\s+LandingPage/);
    expect(sql).not.toMatch(/"ApprovalRule" ADD CONSTRAINT/);
    expect(block("Channel")).toMatch(/photoSmall\s+Bytes\?/);
    expect(block("Channel")).toMatch(/photoFileUniqueId\s+String\?/);
    expect(block("Channel")).toMatch(/chatCheckedAt\s+DateTime\?/);
  });

  it("crée la page (adresse unique), ses sources (une par clé, un lien chacune) et ses visites sans adresse IP", () => {
    expect(block("LandingPage")).toMatch(/slug\s+String\s+@unique/);
    expect(block("LandingPage")).toMatch(/language\s+String\s+@default\("fr"\)/);
    expect(block("LandingPage")).toMatch(/showPhoto\s+Boolean\s+@default\(false\)/);
    expect(block("LandingPage")).toMatch(/cookieBanner\s+Boolean\s+@default\(false\)/);
    expect(block("LandingPage")).toMatch(/version\s+Int\s+@default\(1\)/);
    for (const f of ["subtext", "buttonText", "footnote", "tiktokPixelId", "metaPixelId"])
      expect(block("LandingPage")).toMatch(new RegExp(`${f}\\s+String\\?`));
    // Le titre du canal n'est jamais saisi : aucune colonne de titre sur la page.
    expect(block("LandingPage")).not.toMatch(/\n\s+(title|channelTitle)\s/);
    expect(block("LandingSource")).toMatch(/inviteLinkId\s+String\?\s+@unique/);
    expect(block("LandingSource")).toMatch(/@@unique\(\[landingPageId, key\]\)/);
    expect(block("LandingSource")).toMatch(/adId\s+String\?/);
    expect(block("LandingSource")).toMatch(/linkError\s+String\?/);
    expect(block("LandingEvent")).toMatch(/type\s+LandingEventType/);
    expect(block("LandingEvent")).toMatch(/sourceKey\s+String\s+@default\(""\)/);
    expect(block("LandingEvent")).toMatch(/isBot\s+Boolean\s+@default\(false\)/);
    expect(block("LandingEvent")).toMatch(/ipHash\s+String\?/);
    expect(block("LandingEvent")).not.toMatch(/\n\s+(ip|ipAddress|address)\s/);
    for (const idx of [
      "@@index([landingPageId, createdAt])",
      "@@index([landingPageId, type, createdAt])",
      "@@index([visitId])",
      "@@index([createdAt])",
    ])
      expect(block("LandingEvent")).toContain(idx);
  });

  it("supprimer une page garde les liens d'invitation, les pubs et les utilisateurs ; ses sources et visites partent avec elle", () => {
    const fks = foreignKeys(sql ?? "");
    const rule = (table: string, column: string) =>
      fks.find((f) => f.table === table && f.column === column);
    expect(rule("InviteLink", "landingPageId")).toMatchObject({ target: "LandingPage", onDelete: "SET NULL" });
    expect(rule("LandingSource", "inviteLinkId")).toMatchObject({ target: "InviteLink", onDelete: "SET NULL" });
    expect(rule("LandingSource", "adId")).toMatchObject({ target: "Ad", onDelete: "SET NULL" });
    expect(rule("LandingPage", "createdById")).toMatchObject({ target: "User", onDelete: "SET NULL" });
    expect(rule("LandingPage", "channelId")).toMatchObject({ target: "Channel", onDelete: "CASCADE" });
    expect(rule("LandingSource", "landingPageId")).toMatchObject({ target: "LandingPage", onDelete: "CASCADE" });
    expect(rule("LandingEvent", "landingPageId")).toMatchObject({ target: "LandingPage", onDelete: "CASCADE" });
    expect(fks).toHaveLength(7);
    // Le schéma dit la même chose que le SQL.
    expect(block("InviteLink")).toMatch(/landingPage\s+LandingPage\?\s+@relation\(fields: \[landingPageId\], references: \[id\], onDelete: SetNull\)/);
    expect(block("LandingSource")).toMatch(/inviteLink\s+InviteLink\?\s+@relation\("LandingSourceLink", fields: \[inviteLinkId\], references: \[id\], onDelete: SetNull\)/);
    expect(block("LandingSource")).toMatch(/ad\s+Ad\?\s+@relation\(fields: \[adId\], references: \[id\], onDelete: SetNull\)/);
    expect(block("LandingSource")).toMatch(/landingPage\s+LandingPage\s+@relation\(fields: \[landingPageId\], references: \[id\], onDelete: Cascade\)/);
    expect(block("LandingEvent")).toMatch(/landingPage\s+LandingPage\s+@relation\(fields: \[landingPageId\], references: \[id\], onDelete: Cascade\)/);
    expect(block("LandingPage")).toMatch(/channel\s+Channel\s+@relation\(fields: \[channelId\], references: \[id\], onDelete: Cascade\)/);
  });
});

// Correction D9 (même phase) : pub figée sur le lien d'une page et reprise des liens chacune à son tour. Additive : deux
// colonnes facultatives, un index, une clé étrangère SET NULL (supprimer une pub ne supprime jamais un lien), et une
// seule écriture de données, la reprise de la pub du lien ACTUEL d'une source (jamais d'un ancien lien).
function fixSql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase15_pub_figee_liens"));
  if (dirs.length !== 1) return null;
  return readFileSync(join(MIGRATIONS, dirs[0]!, "migration.sql"), "utf8");
}

describe("migration phase 15 (correction) : pub figée sur le lien d'une page", () => {
  const sql = fixSql();

  it("existe une seule fois, après la migration des pages", () => {
    expect(sql).not.toBeNull();
    const dirs = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
    const pages = dirs.findIndex((d) => d.endsWith("_phase15_pages_atterrissage"));
    const fix = dirs.findIndex((d) => d.endsWith("_phase15_pub_figee_liens"));
    expect(fix).toBeGreaterThan(pages);
  });

  it("est additive ; la seule écriture reprend la pub du lien actuel des sources reliées", () => {
    const s = statements(sql ?? "");
    expect(s).toEqual([
      'ALTER TABLE "InviteLink" ADD COLUMN "landingAdId" TEXT',
      'ALTER TABLE "LandingSource" ADD COLUMN "linkTriedAt" TIMESTAMP(3)',
      'CREATE INDEX "InviteLink_landingAdId_idx" ON "InviteLink"("landingAdId")',
      'ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_landingAdId_fkey" FOREIGN KEY ("landingAdId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      'UPDATE "InviteLink" AS l SET "landingAdId" = s."adId" FROM "LandingSource" AS s WHERE s."inviteLinkId" = l."id" AND l."kind" = \'LANDING\' AND s."adId" IS NOT NULL AND l."landingAdId" IS NULL',
    ]);
  });

  it("le schéma dit la même chose que le SQL", () => {
    expect(block("InviteLink")).toMatch(
      /landingAd\s+Ad\?\s+@relation\("LandingAdLinks", fields: \[landingAdId\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(block("InviteLink")).toContain("@@index([landingAdId])");
    expect(block("Ad")).toMatch(/landingLinks\s+InviteLink\[\]\s+@relation\("LandingAdLinks"\)/);
    expect(block("LandingSource")).toMatch(/linkTriedAt\s+DateTime\?/);
  });
});
