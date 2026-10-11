import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de la phase 12 (emojis animés) : elle doit exister et rester additive (ni suppression, ni
// renommage, ni changement de type, ni colonne obligatoire sans défaut, ni écriture de données) : les messages
// existants restent publiés par le bot (publisher = BOT).
// L'alignement exact schéma ↔ base se vérifie avec `prisma migrate diff --exit-code` (voir docs/DATA-MODEL.md).

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function phase12Sql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase12_emojis_animes"));
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


describe("migration phase 12 : emojis animés", () => {
  const sql = phase12Sql();

  it("existe une seule fois", () => {
    expect(sql).not.toBeNull();
  });

  it("est additive : énumérations, colonne avec défaut, table, index, clé étrangère SET NULL", () => {
    const created = new Set<string>();
    for (const s of statements(sql ?? "")) {
      const table = s.match(/^CREATE TABLE "(\w+)"/)?.[1];
      if (table) {
        created.add(table);
        continue;
      }
      if (/^CREATE TYPE "\w+" AS ENUM \('\w+'(, '\w+')*\)$/.test(s)) continue;
      if (/^CREATE INDEX "\w+" ON "\w+"\("\w+"(, "\w+")*\)$/.test(s)) continue;
      const unique = s.match(/^CREATE UNIQUE INDEX "\w+" ON "(\w+)"/)?.[1];
      if (unique) {
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

  it("les messages existants restent publiés par le bot", () => {
    expect(sql).toMatch(/ADD COLUMN\s+"publisher" "PostPublisher" NOT NULL DEFAULT 'BOT'/);
    expect(block("Post")).toMatch(/publisher\s+PostPublisher\s+@default\(BOT\)/);
    for (const v of ["BOT", "ACCOUNT"]) expect(block("PostPublisher")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
  });

  it("crée la bibliothèque d'emojis animés (identifiant Telegram unique, aperçu, source)", () => {
    const e = block("CustomEmoji");
    expect(e).toMatch(/customEmojiId\s+String\s+@unique/);
    expect(e).toMatch(/fallback\s+String\n/);
    expect(e).toMatch(/previewBytes\s+Bytes\?/);
    expect(e).toMatch(/source\s+CustomEmojiSource/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "CustomEmoji_customEmojiId_key"/);
    for (const v of ["FORWARD", "PACK", "ACCOUNT"]) expect(block("CustomEmojiSource")).toMatch(new RegExp(`\\n\\s+${v}\\n`));
  });
});
