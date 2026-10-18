import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Garde de la migration de la phase 17 (assistant de conversation, contrat docs/ASSISTANT-CONVERSATION.md § 1) : elle
// doit exister et rester additive (ni suppression, ni renommage, ni changement de type, ni colonne obligatoire sans
// défaut sur une table existante, ni écriture de données). Les tests d'intégration suppriment `member` et `bot` : toutes
// les nouvelles clés étrangères passent à null ou suppriment en cascade les lignes propres à l'assistant ; supprimer une
// persona, une conversation ou un clic ne supprime jamais un bot, un lien traqué, un clic ou un message privé.

const MIGRATIONS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(MIGRATIONS, "..", "schema.prisma"), "utf8");

function phase17Sql(): string | null {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_phase17_assistant_conversation"));
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

const NEW_TABLES = [
  "Persona",
  "Conversation",
  "ConversationMessage",
  "ConversationEvent",
  "AssistantOfferLink",
  "AiConversationUsage",
];

describe("migration phase 17 : assistant de conversation", () => {
  const sql = phase17Sql();

  it("existe une seule fois, après la migration de la phase 16", () => {
    expect(sql).not.toBeNull();
    const dirs = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
    const p16 = dirs.findIndex((d) => d.endsWith("_phase16_sortie_des_applis"));
    const p17 = dirs.findIndex((d) => d.endsWith("_phase17_assistant_conversation"));
    expect(p17).toBeGreaterThan(p16);
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
          if (/NOT NULL/.test(col)) expect(col, `colonne obligatoire sans défaut : ${col}`).toMatch(/DEFAULT /);
        }
        continue;
      }
      throw new Error(`Instruction non additive : ${s}`);
    }
    expect([...created].sort()).toEqual([...NEW_TABLES].sort());
  });

  it("ajoute les énumérations (noms anglais) et le message privé ASSISTANT", () => {
    expect(sql).toMatch(/CREATE TYPE "BotMode" AS ENUM \('STANDARD', 'ASSISTANT'\)/);
    expect(sql).toMatch(
      /CREATE TYPE "ConversationStage" AS ENUM \('WELCOME', 'CHAT', 'PROPOSAL', 'LINK_SENT', 'FOLLOW_UP', 'CONVERTED', 'CLOSED'\)/,
    );
    expect(sql).toMatch(/CREATE TYPE "ConversationStatus" AS ENUM \('BOT', 'HUMAN', 'PAUSED', 'CLOSED'\)/);
    expect(sql).toMatch(/CREATE TYPE "ConversationDirection" AS ENUM \('IN', 'OUT'\)/);
    expect(sql).toMatch(/CREATE TYPE "ConversationAuthor" AS ENUM \('MEMBER', 'ASSISTANT', 'TEAM', 'SYSTEM'\)/);
    expect(sql).toMatch(/ALTER TYPE "OutboundKind" ADD VALUE 'ASSISTANT';/);
    expect(block("OutboundKind")).toMatch(/\n\s+ASSISTANT\n/);
  });

  it("bot : mode normal par défaut, persona liée facultative", () => {
    expect(sql).toMatch(/ADD COLUMN\s+"mode" "BotMode" NOT NULL DEFAULT 'STANDARD'/);
    expect(block("Bot")).toMatch(/mode\s+BotMode\s+@default\(STANDARD\)/);
    expect(block("Bot")).toMatch(/personaId\s+String\?/);
    expect(block("Bot")).toContain("@@index([mode])");
  });

  it("persona : désactivée par défaut, règles du parcours aux valeurs du contrat", () => {
    const p = block("Persona");
    expect(p).toMatch(/isActive\s+Boolean\s+@default\(false\)/);
    expect(p).toMatch(/gender\s+String\s+@default\("F"\)/);
    expect(p).toMatch(/languages\s+String\[\]\s+@default\(\["fr"\]\)/);
    expect(p).toMatch(/minExchangesBeforeOffer\s+Int\s+@default\(4\)/);
    expect(p).toMatch(/requireInterest\s+Boolean\s+@default\(true\)/);
    expect(p).toMatch(/maxOfferSends\s+Int\s+@default\(2\)/);
    expect(p).toMatch(/followUpAfterHours\s+Int\s+@default\(24\)/);
    expect(p).toMatch(/followUpsMax\s+Int\s+@default\(2\)/);
    expect(p).toMatch(/offerPitch\s+String\s+@default\(""\)/);
    expect(p).toMatch(/model\s+String\?/);
    expect(p).toMatch(/temperature\s+Float\?/);
    // Aucune option pour cacher qu'il s'agit d'un assistant, aucune photo de profil (« selfie »).
    expect(p).not.toMatch(/\n\s+(hideAssistant|isHuman|pretendHuman|selfie\w*|photo\w*)\s/i);
  });

  it("conversation : une par bot et par membre, anti-doublon des messages, tours ordonnés", () => {
    const c = block("Conversation");
    expect(c).toMatch(/stage\s+ConversationStage\s+@default\(WELCOME\)/);
    expect(c).toMatch(/status\s+ConversationStatus\s+@default\(BOT\)/);
    expect(c).toMatch(/isMinor\s+Boolean\s+@default\(false\)/);
    expect(c).toMatch(/styleProfile\s+Json\s+@default\("\{\}"\)/);
    expect(c).toMatch(/facts\s+Json\s+@default\("\[\]"\)/);
    for (const f of ["stoppedAt", "closedAt", "nextFollowUpAt", "retryAt", "convertedAt", "lastInboundAt"])
      expect(c).toMatch(new RegExp(`${f}\\s+DateTime\\?`));
    for (const idx of [
      "@@unique([botId, memberId])",
      "@@index([status, nextFollowUpAt])",
      "@@index([status, retryAt])",
      "@@index([personaId, createdAt])",
      "@@index([source])",
      "@@index([lastInboundAt])",
      "@@index([memberId])",
    ])
      expect(c).toContain(idx);
    const m = block("ConversationMessage");
    expect(m).toContain("@@unique([conversationId, direction, telegramMessageId])");
    expect(m).toContain("@@unique([turnId, partIndex])");
    expect(m).toMatch(/outboundMessageId\s+String\?\s+@unique/);
    expect(m).toMatch(/telegramMessageId\s+BigInt\?/);
    // Événements du parcours : aucun texte de conversation.
    expect(block("ConversationEvent")).not.toMatch(/\n\s+text\s/);
    expect(block("AssistantOfferLink")).toMatch(/subId\s+String\s+@unique/);
    expect(block("AssistantOfferLink")).toMatch(/clickId\s+String\?\s+@unique/);
    expect(block("AiConversationUsage")).toMatch(/costEur\s+Decimal\s+@db\.Decimal\(10, 4\)/);
  });

  it("supprimer un membre ou un bot emporte ses conversations ; rien d'existant n'est supprimé en cascade", () => {
    const fks = foreignKeys(sql ?? "");
    const rule = (table: string, column: string) => fks.find((f) => f.table === table && f.column === column);
    expect(rule("Bot", "personaId")).toMatchObject({ target: "Persona", onDelete: "SET NULL" });
    expect(rule("TrackingLink", "personaId")).toMatchObject({ target: "Persona", onDelete: "SET NULL" });
    expect(rule("Click", "conversationId")).toMatchObject({ target: "Conversation", onDelete: "SET NULL" });
    expect(rule("Persona", "affiliateCampaignId")).toMatchObject({ target: "AffiliateCampaign", onDelete: "SET NULL" });
    expect(rule("Persona", "campaignId")).toMatchObject({ target: "Campaign", onDelete: "SET NULL" });
    expect(rule("Persona", "offerMediaAssetId")).toMatchObject({ target: "MediaAsset", onDelete: "SET NULL" });
    expect(rule("Persona", "createdById")).toMatchObject({ target: "User", onDelete: "SET NULL" });
    expect(rule("Conversation", "botId")).toMatchObject({ target: "Bot", onDelete: "CASCADE" });
    expect(rule("Conversation", "memberId")).toMatchObject({ target: "Member", onDelete: "CASCADE" });
    expect(rule("Conversation", "personaId")).toMatchObject({ target: "Persona", onDelete: "SET NULL" });
    expect(rule("Conversation", "takenOverById")).toMatchObject({ target: "User", onDelete: "SET NULL" });
    expect(rule("ConversationMessage", "conversationId")).toMatchObject({ target: "Conversation", onDelete: "CASCADE" });
    expect(rule("ConversationMessage", "teamUserId")).toMatchObject({ target: "User", onDelete: "SET NULL" });
    expect(rule("ConversationMessage", "outboundMessageId")).toMatchObject({
      target: "OutboundMessage",
      onDelete: "SET NULL",
    });
    expect(rule("ConversationEvent", "conversationId")).toMatchObject({ target: "Conversation", onDelete: "CASCADE" });
    expect(rule("AssistantOfferLink", "conversationId")).toMatchObject({ target: "Conversation", onDelete: "SET NULL" });
    expect(rule("AssistantOfferLink", "personaId")).toMatchObject({ target: "Persona", onDelete: "SET NULL" });
    expect(rule("AssistantOfferLink", "botId")).toMatchObject({ target: "Bot", onDelete: "CASCADE" });
    expect(rule("AssistantOfferLink", "memberId")).toMatchObject({ target: "Member", onDelete: "SET NULL" });
    expect(rule("AssistantOfferLink", "trackingLinkId")).toMatchObject({ target: "TrackingLink", onDelete: "CASCADE" });
    expect(rule("AssistantOfferLink", "clickId")).toMatchObject({ target: "Click", onDelete: "SET NULL" });
    expect(rule("AiConversationUsage", "personaId")).toMatchObject({ target: "Persona", onDelete: "SET NULL" });
    expect(rule("AiConversationUsage", "conversationId")).toMatchObject({
      target: "Conversation",
      onDelete: "SET NULL",
    });
    expect(fks).toHaveLength(23);
    // Le schéma dit la même chose que le SQL.
    expect(block("Bot")).toMatch(
      /persona\s+Persona\?\s+@relation\(fields: \[personaId\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(block("Conversation")).toMatch(
      /member\s+Member\s+@relation\(fields: \[memberId\], references: \[id\], onDelete: Cascade\)/,
    );
    expect(block("Conversation")).toMatch(/bot\s+Bot\s+@relation\(fields: \[botId\], references: \[id\], onDelete: Cascade\)/);
    expect(block("Click")).toMatch(
      /conversation\s+Conversation\?\s+@relation\(fields: \[conversationId\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(block("Click")).toContain("@@index([conversationId])");
    expect(block("TrackingLink")).toMatch(
      /persona\s+Persona\?\s+@relation\(fields: \[personaId\], references: \[id\], onDelete: SetNull\)/,
    );
  });
});
