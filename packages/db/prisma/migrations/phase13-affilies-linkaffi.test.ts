import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de la phase 13 (campagnes Telegram des affiliés Link Affi) : elle doit exister et rester
// additive (ni suppression, ni renommage, ni changement de type, ni colonne obligatoire sans défaut, ni écriture de
// données). Le seul index unique sur une table existante porte sur une colonne nouvelle (vide en production).

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function phase13Sql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase13_affilies_linkaffi"));
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


describe("migration phase 13 : affiliés Link Affi", () => {
  const sql = phase13Sql();

  it("existe une seule fois", () => {
    expect(sql).not.toBeNull();
  });

  it("est additive (le seul index unique sur une table existante porte sur une colonne nouvelle)", () => {
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
        if (!created.has(unique))
          expect(s, `index unique sur une table existante : ${s}`).toBe(
            'CREATE UNIQUE INDEX "InviteLink_linkaffiCampaignKey_channelId_key" ON "InviteLink"("linkaffiCampaignKey", "channelId")',
          );
        continue;
      }
      if (/^ALTER TABLE "\w+" ADD CONSTRAINT "\w+" FOREIGN KEY \("\w+"\) REFERENCES "\w+"\("\w+"\) ON DELETE SET NULL ON UPDATE CASCADE$/.test(s))
        continue;
      const add = s.match(/^ALTER TABLE "\w+" (ADD COLUMN .*)$/)?.[1];
      if (add) {
        for (const col of add.split(/,\s*(?=ADD COLUMN)/)) {
          expect(col, `colonne non additive : ${col}`).toMatch(/^ADD COLUMN "\w+" /);
          if (/NOT NULL/.test(col)) expect(col, `colonne obligatoire sans défaut : ${col}`).toMatch(/DEFAULT /);
        }
        continue;
      }
      throw new Error(`Instruction non additive : ${s}`);
    }
  });

  it("ajoute le lien d'affilié, l'attribution des membres et le paramètre tg des clics", () => {
    expect(sql).toMatch(/ALTER TYPE "InviteLinkKind" ADD VALUE 'LINKAFFI';/);
    for (const f of ["linkaffiCampaignKey", "linkaffiCampaignName", "linkaffiAffiliateId", "linkaffiAffiliateName"])
      expect(block("InviteLink")).toMatch(new RegExp(`${f}\\s+String\\?`));
    expect(block("InviteLink")).toMatch(/attributionDays\s+Int\?/);
    expect(block("InviteLink")).toMatch(/@@unique\(\[linkaffiCampaignKey, channelId\]\)/);
    for (const f of ["linkaffiCampaignKey", "linkaffiAffiliateId", "affiliateInviteLinkId"])
      expect(block("Member")).toMatch(new RegExp(`${f}\\s+String\\?`));
    expect(block("Member")).toMatch(/affiliateAttributedAt\s+DateTime\?/);
    expect(block("Click")).toMatch(/linkaffiTelegramCampaignKey\s+String\?/);
    for (const v of ["LINKAFFI_ANY", "LINKAFFI_AFFILIATE"]) expect(sql).toMatch(new RegExp(`ADD VALUE '${v}'`));
  });

  it("crée la file des événements (eventId unique) et la clé d'intégration (clé hachée, secret chiffré)", () => {
    expect(block("LinkaffiEvent")).toMatch(/eventId\s+String\s+@unique/);
    expect(block("LinkaffiEvent")).toMatch(/status\s+LinkaffiEventStatus\s+@default\(PENDING\)/);
    expect(block("IntegrationKey")).toMatch(/apiKeyHash\s+String\?\s+@unique/);
    expect(block("IntegrationKey")).toMatch(/webhookSecretEncrypted\s+String\?/);
    expect(block("IntegrationKey")).not.toMatch(/apiKey\s+String/);
  });
});
