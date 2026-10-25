/**
 * Phase 33 : chaque texte fixe envoyé par Kevin depuis le paquet telegram (toutes variantes, rendues avec les valeurs
 * d'exemple) passe le contrôle de la voix (`voiceCheck`, charte `docs/KEVIN-VOIX.md`).
 */
import { describe, expect, it } from "vitest";
import { voiceCheck, voiceEntryTexts, type VoiceTable } from "@linkaffipro/agents";
import { BOSS_REPLY_VARIANTS } from "./reply";
import { AGENTS_ADMIN_VARIANTS, bossRedirectText, bossWelcomeText } from "../handlers/agents-admin";
import { BOSS_GROUP_VARIANTS } from "../handlers/boss-group";

const TABLES: Record<string, VoiceTable> = {
  BOSS_REPLY_VARIANTS,
  AGENTS_ADMIN_VARIANTS,
  BOSS_GROUP_VARIANTS,
};

describe("voix de Kevin : textes fixes du paquet telegram", () => {
  for (const [tableName, table] of Object.entries(TABLES)) {
    for (const [key, entry] of Object.entries(table)) {
      it(`${tableName}.${key} : chaque variante passe voiceCheck`, () => {
        const { texts, rules } = voiceEntryTexts(entry);
        expect(texts.length).toBeGreaterThanOrEqual(2);
        const failures = texts
          .map((text) => ({ text, problems: voiceCheck(text, rules).problems }))
          .filter((f) => f.problems.length > 0);
        expect(failures).toEqual([]);
        expect(new Set(texts.map((t) => t.trim())).size).toBe(texts.length);
      });
    }
  }

  it("les textes à paramètres gardent l'information (nom de Kevin, bot, commandes)", () => {
    for (let i = 0; i < 4; i++) {
      const w = bossWelcomeText("Kevin", 77);
      expect(w).toContain("moi c'est Kevin");
      expect(w).toContain("<b>commencer</b>");
      expect(w).toContain("<b>aide</b>");
      expect(bossRedirectText("kevin_boss_bot", "Kevin", 77)).toContain("@kevin_boss_bot (Kevin)");
    }
  });

  it("rotation : deux accueils de suite dans une conversation ne sont jamais identiques", () => {
    const a = bossWelcomeText("Kevin", 99);
    const b = bossWelcomeText("Kevin", 99);
    expect(a).not.toBe(b);
  });
});
