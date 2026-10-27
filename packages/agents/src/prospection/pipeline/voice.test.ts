/**
 * Phase 31, chantier C — voix de Kevin : chaque variante des tables `*_VARIANTS` de l'Évaluateur et du Pipeline, les
 * cartes du Top du jour, les fiches et le rapport passent `voiceCheck` ; guillemets français avec espace insécable.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts, type VoiceTable } from "../../boss/voice";
import { DOSSIER_LEGAL_LINE, DOSSIER_VARIANTS } from "../score/dossier";
import { createProspectKit } from "../score/prospect-test-kit";
import { PROSPECT_CALLBACK_VARIANTS } from "./callbacks";
import { renderProspectCard, sampleProspect } from "./cards";
import { DAILY_TOP_VARIANTS } from "./daily-top";
import { REMINDERS_VARIANTS } from "./reminders";
import { formatProspectDetail, formatProspectLine } from "./stats";
import { WEEKLY_REPORT_VARIANTS, buildWeeklyReport } from "./weekly-report";

beforeEach(() => resetVoiceRotation());

const TABLES: Record<string, VoiceTable> = { DOSSIER_VARIANTS, PROSPECT_CALLBACK_VARIANTS, DAILY_TOP_VARIANTS, REMINDERS_VARIANTS, WEEKLY_REPORT_VARIANTS };
const NOW = new Date("2026-10-26T08:00:00Z");

const problems = (t: string, opts?: Parameters<typeof voiceCheck>[1]) => voiceCheck(t, opts).problems.map((p) => `${p.code} (${p.detail})`);

describe("voix de Kevin", () => {
  it("toutes les variantes passent voiceCheck", () => {
    const failures: string[] = [];
    let n = 0;
    for (const [name, table] of Object.entries(TABLES))
      for (const [key, entry] of Object.entries(table)) {
        const { texts, rules } = voiceEntryTexts(entry);
        expect(texts.length, `${name}.${key}`).toBeGreaterThan(0);
        for (const t of texts) {
          n++;
          const p = problems(t, rules);
          if (p.length) failures.push(`${name}.${key} : ${p.join(", ")} «\u00a0${t}\u00a0»`);
        }
      }
    expect(failures, failures.join("\n")).toEqual([]);
    expect(n).toBeGreaterThan(40);
    expect(problems(DOSSIER_LEGAL_LINE)).toEqual([]);
  });

  it("cartes du Top du jour (avec et sans alertes), lignes et fiches", () => {
    const offer = { id: "o", brand: "Winamax", vertical: "SPORTS" as const, countries: ["FR"], dealTypes: { cpa: 100, hybrid: { cpa: 50, revshare: 15 } }, isActive: true };
    const contacts = [
      { type: "TELEGRAM_USERNAME", value: "@admin_pub", label: "pub", source: "description", confidence: "HIGH" as const },
      { type: "WEBSITE", value: "https://pronos.fr", label: null, source: "description", confidence: "MEDIUM" as const },
    ];
    const samples = [
      sampleProspect(),
      sampleProspect({ fakeFlags: ["SUSPECT_FAKE_SUBS"], regulatoryFlag: "FR", riskFlags: ["PROMOTES_OUR_BRAND"], tier: "B", competitiveState: "OURS", brands: [] }),
      sampleProspect({ medianViews: null, kind: "GROUP", username: null, title: "Casino Italia", countries: ["IT"], vertical: "CASINO", monetization: null, contactConfidence: "NONE", bestContact: null }),
    ];
    for (const p of samples) {
      for (const t of [renderProspectCard(p, contacts, offer, NOW), renderProspectCard(p, [], null, NOW), formatProspectLine(p)]) expect(problems(t), t).toEqual([]);
      const detail = formatProspectDetail({ ...p, dossier: "Canal foot FR." }, { contacts, offerBrand: "Winamax", offerDeal: offer.dealTypes, now: NOW });
      expect(problems(detail, { allowLong: true, allowList: true }), detail).toEqual([]);
    }
    expect(renderProspectCard(samples[0]!, contacts, offer, NOW)).toContain("2,1k vues/post (12\u00a0% des 17k abonnés)");
  });

  it("rapport de la semaine", async () => {
    const k = createProspectKit(NOW);
    await k.prospect({ enrichedAt: NOW, countries: ["IT"] });
    await k.prospect({ status: "SIGNED", contactedAt: new Date("2026-10-10T08:00:00Z"), respondedAt: new Date("2026-10-12T08:00:00Z"), signedAt: new Date("2026-10-15T08:00:00Z") });
    const text = await buildWeeklyReport(k.deps, NOW);
    expect(problems(text, { allowLong: true, allowList: true }), text).toEqual([]);
  });

  it("guillemets français : espace insécable à l'intérieur de «\u00a0»", () => {
    const dirs = [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../score/", import.meta.url))];
    const bad: string[] = [];
    for (const dir of dirs)
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts")))
        readFileSync(join(dir, f), "utf8")
          .split("\n")
          .forEach((l, i) => {
            const t = l.trim();
            if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return;
            if (/\u00ab |\u00ab$| \u00bb|^\u00bb/.test(l.trim())) bad.push(`${f}:${i + 1}`);
          });
    expect(bad).toEqual([]);
  });
});
