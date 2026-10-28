/**
 * Phase 32, chantier B — voix de Kevin : chaque variante des tables du Valorisateur et de la boucle Link Affi passe
 * `voiceCheck` ; guillemets français avec espace insécable dans `value/` et `learn/`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation, voiceCheck, voiceEntryTexts, type VoiceTable } from "../../boss/voice";
import { VALUE_VARIANTS, formatValueAssumptions } from "../value/format";
import { estimateValue, DEFAULT_VALUE_SETTINGS } from "../value/estimate";
import { CALIBRATION_VARIANTS, LINK_VARIANTS, PERFORMANCE_VARIANTS, REPORT_VARIANTS } from "./texts";

beforeEach(() => resetVoiceRotation());

const TABLES: Record<string, VoiceTable> = { VALUE_VARIANTS, LINK_VARIANTS, CALIBRATION_VARIANTS, REPORT_VARIANTS, PERFORMANCE_VARIANTS };
const problems = (t: string, opts?: Parameters<typeof voiceCheck>[1]) => voiceCheck(t, opts).problems.map((p) => `${p.code} (${p.detail})`);

describe("voix de Kevin (Valorisateur, boucle Link Affi)", () => {
  it("toutes les variantes passent voiceCheck", () => {
    const failures: string[] = [];
    for (const [name, table] of Object.entries(TABLES))
      for (const [key, entry] of Object.entries(table)) {
        const { texts, rules } = voiceEntryTexts(entry);
        expect(texts.length, `${name}.${key}`).toBeGreaterThan(0);
        for (const t of texts) {
          const p = problems(t, rules);
          if (p.length) failures.push(`${name}.${key} : ${p.join(", ")} «\u00a0${t}\u00a0»`);
          if (/rapportera/i.test(t)) failures.push(`${name}.${key} : « rapportera »`);
        }
      }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("singulier : « 1 réglage », jamais « 1 réglages »", () => {
    expect(REPORT_VARIANTS.proposals({ n: 1 }).join(" ")).not.toMatch(/\b1 réglages\b/);
    expect(REPORT_VARIANTS.proposals({ n: 2 }).join(" ")).toMatch(/\b2 réglages\b/);
  });

  it("hypothèses lisibles", () => {
    const r = estimateValue(
      { postsPerDay: 2, medianViews: 2000, promoShareObserved: null, authenticity: "SUSPECT_GENERIC", fakeFlags: ["SUSPECT_FAKE_SUBS"], postsRead: 40, geoConfidence: 0.9, deal: { kind: "hybrid", cpa: 50, revsharePct: 15 }, offerId: null },
      DEFAULT_VALUE_SETTINGS,
      null,
      new Date(),
    );
    if (!r.ok) throw new Error("attendu");
    const t = formatValueAssumptions(r.estimate);
    expect(problems(t, { allowLong: true })).toEqual([]);
    expect(t).toMatch(/revenu mensuel par joueur/);
  });

  it("guillemets français : espace insécable à l'intérieur de «\u00a0»", () => {
    const dirs = [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../value/", import.meta.url))];
    const bad: string[] = [];
    for (const dir of dirs)
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts")))
        readFileSync(join(dir, f), "utf8")
          .split("\n")
          .forEach((l, i) => {
            const t = l.trim();
            if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return;
            if (/« |«$| »|^»/.test(t)) bad.push(`${f}:${i + 1}`);
          });
    expect(bad).toEqual([]);
  });
});
