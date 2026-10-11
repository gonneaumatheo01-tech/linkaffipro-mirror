import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de la phase 10 (gains et relances attribuables) : elle doit exister, rester additive
// (aucune perte : ni suppression, ni renommage, ni changement de type, ni colonne obligatoire sans défaut, ni écriture
// de données) et contenir les champs dont dépendent la synchro Link Affi, les statistiques et les relances.
// L'alignement exact schéma ↔ base se vérifie avec `prisma migrate diff --exit-code` (voir docs/DATA-MODEL.md).

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function phase10Sql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase10_gains_relances"));
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

/** Bloc d'un modèle Prisma (`model X { … }`). */
function modelBlock(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\n(model|enum) ${name} \\{[\\s\\S]*?\\n\\}`));
  return m?.[0] ?? "";
}

describe("migration phase 10 : gains et relances attribuables", () => {
  const sql = phase10Sql();

  it("existe une seule fois", () => {
    expect(sql).not.toBeNull();
  });

  it("est additive : seulement des ajouts (valeurs d'énumération, colonnes, tables, index, clés étrangères)", () => {
    const created = new Set<string>();
    for (const s of statements(sql ?? "")) {
      const table = s.match(/^CREATE TABLE "(\w+)"/)?.[1];
      if (table) {
        created.add(table);
        continue;
      }
      if (/^ALTER TYPE "\w+" ADD VALUE '\w+'$/.test(s)) continue;
      if (/^CREATE INDEX "\w+" ON "\w+"\("\w+"(, "\w+")*\)$/.test(s)) continue;
      const unique = s.match(/^CREATE UNIQUE INDEX "\w+" ON "(\w+)"/)?.[1];
      if (unique) {
        // Un index unique sur une table existante pourrait échouer sur les données de production.
        expect(created.has(unique), `index unique sur une table existante : ${s}`).toBe(true);
        continue;
      }
      if (/^ALTER TABLE "\w+" ADD CONSTRAINT "\w+" FOREIGN KEY \("\w+"\) REFERENCES "\w+"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE$/.test(s))
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

  it("ajoute les commissions CPA aux joueurs et les événements datés CPA / CPA_REVERSAL", () => {
    expect(sql).toMatch(/ALTER TYPE "PlayerEventType" ADD VALUE 'CPA';/);
    expect(sql).toMatch(/ALTER TYPE "PlayerEventType" ADD VALUE 'CPA_REVERSAL';/);
    const player = modelBlock("Player");
    for (const f of [/cpaStatus\s+String\?/, /cpaAmount\s+Decimal\?\s+@db\.Decimal\(14, 2\)/, /cpaCreditedAt\s+DateTime\?/, /cpaReversedAt\s+DateTime\?/])
      expect(player).toMatch(f);
    expect(sql).toMatch(/"cpaAmount" DECIMAL\(14,2\)/);
  });

  it("crée l'agrégat Link Affi par ligne (identifiant Link Affi unique, offre facultative)", () => {
    const stat = modelBlock("AffiliateDailyStat");
    expect(stat).toMatch(/externalId\s+String\s+@unique/);
    expect(stat).toMatch(/date\s+DateTime\s+@db\.Date/);
    expect(stat).toMatch(/affiliateCampaignId\s+String\?/);
    for (const f of ["revenue", "cpaRevenue", "revshareRevenue"]) expect(stat).toMatch(new RegExp(`${f}\\s+Decimal\\s+@default\\(0\\)`));
    expect(stat).toMatch(/@@index\(\[affiliateCampaignId, date\]\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "AffiliateDailyStat_externalId_key"/);
  });

  it("ajoute les commissions aux statistiques journalières (défaut 0)", () => {
    const daily = modelBlock("DailyStat");
    for (const f of ["commissions", "cpaCommissions", "revshareCommissions"])
      expect(daily).toMatch(new RegExp(`${f}\\s+Decimal\\s+@default\\(0\\) @db\\.Decimal\\(14, 2\\)`));
  });

  it("rattache les liens traqués et les messages privés à leur relance", () => {
    expect(modelBlock("TrackingLink")).toMatch(/automationRuleId\s+String\?/);
    expect(modelBlock("TrackingLink")).toMatch(/@@index\(\[automationRuleId\]\)/);
    expect(modelBlock("OutboundMessage")).toMatch(/automationRuleId\s+String\?/);
    expect(sql).toMatch(/CREATE INDEX "TrackingLink_automationRuleId_idx"/);
    expect(sql).toMatch(/CREATE INDEX "OutboundMessage_automationRuleId_status_idx"/);
  });
});
