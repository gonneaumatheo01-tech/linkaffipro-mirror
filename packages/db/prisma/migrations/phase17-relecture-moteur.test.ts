import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de relecture du moteur de la phase 17 : additive (ni suppression, ni renommage, ni changement
// de type, ni colonne obligatoire), index du balayage des tours bloqués, source copiée sur les coûts de l'IA.

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function sql(): string {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase17_relecture_moteur"));
  expect(dirs).toHaveLength(1);
  return readFileSync(join(MIGRATIONS, dirs[0]!, "migration.sql"), "utf8").replace(/--.*$/gm, "");
}

function block(name: string): string {
  return SCHEMA.match(new RegExp(`\\nmodel ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("migration phase 17 (relecture du moteur)", () => {
  it("additive seulement", () => {
    const s = sql();
    expect(s).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN|SET NOT NULL/i);
    // Colonnes ajoutées facultatives (jamais NOT NULL sur une table existante).
    for (const st of s.split(";").filter((x) => /ADD COLUMN/i.test(x)))
      expect(st).not.toMatch(/NOT NULL/i);
    expect(s).toMatch(/ALTER TABLE "ConversationMessage" ADD COLUMN\s+"claimedAt" TIMESTAMP\(3\)/);
    expect(s).toMatch(/ALTER TABLE "AiConversationUsage" ADD COLUMN\s+"source" TEXT/);
    expect(s).toMatch(
      /CREATE INDEX "ConversationMessage_claimedAt_idx" ON "ConversationMessage"\("claimedAt"\)/,
    );
  });

  it("schéma Prisma aligné", () => {
    expect(block("ConversationMessage")).toMatch(/claimedAt\s+DateTime\?/);
    expect(block("ConversationMessage")).toContain("@@index([claimedAt])");
    expect(block("AiConversationUsage")).toMatch(/source\s+String\?/);
  });
});
