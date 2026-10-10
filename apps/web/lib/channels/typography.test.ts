import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guillemets français des écrans Canaux : l'espace à l'intérieur des guillemets est insécable (U+00A0), sinon le
 * navigateur peut couper la ligne juste après le guillemet ouvrant ou juste avant le guillemet fermant (le guillemet se
 * retrouve seul en bout ou en début de ligne). Écrire `« … »`.
 */

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const ROOTS = ["app/(admin)/channels", "components/channels", "lib/channels"];
/** Guillemet ouvrant suivi d'une espace ordinaire, ou espace ordinaire avant un guillemet fermant. */
const BREAKABLE = /\u00ab | \u00bb/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("guillemets français (écrans Canaux)", () => {
  it("aucune espace ordinaire à l'intérieur des guillemets", () => {
    const bad: string[] = [];
    for (const root of ROOTS)
      for (const file of sources(join(WEB, root))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (BREAKABLE.test(line)) bad.push(`${relative(WEB, file)}:${i + 1}`);
          });
      }
    expect(bad).toEqual([]);
  });

  it("le contrôle repère une espace ordinaire et accepte l'espace insécable", () => {
    expect(BREAKABLE.test("message \u00ab Accepté \u00bb")).toBe(true);
    expect(BREAKABLE.test("message \u00ab\u00a0Accepté\u00a0\u00bb")).toBe(false);
  });
});
