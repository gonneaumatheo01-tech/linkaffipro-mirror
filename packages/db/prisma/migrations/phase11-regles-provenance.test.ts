import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de la phase 11 (règles d'adhésion selon la provenance, liens de partage) : elle doit exister,
// rester additive (ni suppression, ni renommage, ni changement de type, ni colonne obligatoire sans défaut) et ne
// réécrire qu'une seule donnée : la portée INVITE_LINK des anciennes règles d'un lien précis (même comportement).
// L'alignement exact schéma ↔ base se vérifie avec `prisma migrate diff --exit-code` (voir docs/DATA-MODEL.md).

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function phase11Sql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase11_regles_provenance"));
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

const SCOPE_UPDATE = `UPDATE "ApprovalRule" SET "scope" = 'INVITE_LINK' WHERE "inviteLinkId" IS NOT NULL`;

describe("migration phase 11 : règles selon la provenance", () => {
  const sql = phase11Sql();

  it("existe une seule fois", () => {
    expect(sql).not.toBeNull();
  });

  it("est additive : énumérations, valeur d'énumération, colonnes avec défaut ou facultatives, index", () => {
    for (const s of statements(sql ?? "")) {
      if (/^CREATE TYPE "\w+" AS ENUM \('\w+'(, '\w+')*\)$/.test(s)) continue;
      if (/^ALTER TYPE "\w+" ADD VALUE '\w+'$/.test(s)) continue;
      if (/^CREATE INDEX "\w+" ON "\w+"\("\w+"(, "\w+")*\)$/.test(s)) continue;
      if (s === SCOPE_UPDATE) continue;
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

  it("garde le comportement des règles existantes (DEFAULT, ou INVITE_LINK pour un lien précis)", () => {
    expect(sql).toMatch(/ADD COLUMN "scope" "ApprovalRuleScope" NOT NULL DEFAULT 'DEFAULT'/);
    expect(statements(sql ?? "")).toContain(SCOPE_UPDATE);
    expect(sql).toMatch(/ADD COLUMN "sendWelcome" BOOLEAN NOT NULL DEFAULT true/);
  });

  it("ajoute la portée, la provenance et l'ordre aux règles d'adhésion", () => {
    const rule = block("ApprovalRule");
    expect(rule).toMatch(/scope\s+ApprovalRuleScope\s+@default\(DEFAULT\)/);
    expect(rule).toMatch(/sourceChannelId\s+String\?/);
    expect(rule).toMatch(/sourceKind\s+ApprovalSourceKind\?/);
    expect(rule).toMatch(/label\s+String\?/);
    expect(rule).toMatch(/sortOrder\s+Int\s+@default\(0\)/);
    expect(rule).toMatch(/sendWelcome\s+Boolean\s+@default\(true\)/);
    expect(rule).toMatch(/inviteLinkId\s+String\?\s+@unique/);
    expect(rule).toMatch(/@@index\(\[channelId, scope, isActive\]\)/);
    for (const v of ["DEFAULT", "INVITE_LINK", "SOURCE_CHANNEL", "SOURCE_KIND"])
      expect(block("ApprovalRuleScope")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
    for (const v of ["GATE", "ANY_CHANNEL", "AD_ANY", "AD_TIKTOK", "AD_META", "SHARE"])
      expect(block("ApprovalSourceKind")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
  });

  it("ajoute les liens de partage", () => {
    expect(sql).toMatch(/ALTER TYPE "InviteLinkKind" ADD VALUE 'SHARE';/);
    expect(block("InviteLinkKind")).toMatch(/\n\s+SHARE\n/);
  });
});
