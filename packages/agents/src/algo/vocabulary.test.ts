/** « Dating » est du jargon (le site dit « Rencontres ») : aucun texte affiché par les agents ne dit « équipe Dating ». */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEAM_LABELS } from "../types";

const ROOT = join(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "fixtures" ? [] : files(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("vocabulaire des agents", () => {
  it("l'équipe des rencontres s'appelle « Rencontres »", () => {
    expect(TEAM_LABELS.dating).toBe("Rencontres");
  });
  it("aucune chaîne de packages/agents/src ne contient « équipe Dating »", () => {
    const hits: string[] = [];
    for (const f of files(ROOT))
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
          if (/équipe Dating/i.test(code.replace(/\/\/.*$/, ""))) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
        });
    expect(hits).toEqual([]);
  });
});
