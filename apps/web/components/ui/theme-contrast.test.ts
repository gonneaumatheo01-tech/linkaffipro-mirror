/**
 * Contrastes du thème (WCAG 2.1 AA), calculés depuis les vraies valeurs de `app/globals.css` :
 * texte ≥ 4,5:1 ; bordures de champ, courbes et anneau de focus ≥ 3:1 (critère 1.4.11).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fieldBorderClass } from "./native-select";

const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root);
  if (!m) throw new Error(`Jeton --${name} introuvable dans globals.css`);
  return m[1]!;
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** Couleur à `alpha` posée sur un fond opaque (ce que fait le navigateur pour `border-x/75`). */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as Rgb;

function ratio(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(typeof a === "string" ? rgb(a) : a);
  const lb = luminance(typeof b === "string" ? rgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("contrastes du thème", () => {
  it("texte : 4,5:1 au moins sur son fond", () => {
    const pairs: Array<[string, string]> = [
      ["foreground", "background"],
      ["foreground", "card"],
      ["muted-foreground", "background"],
      ["muted-foreground", "card"],
      ["muted-foreground", "muted"],
      ["brand-ink", "background"],
      ["brand-ink", "card"],
      ["brand-foreground", "brand"],
      ["success", "success-soft"],
      ["warning", "warning-soft"],
      ["danger", "danger-soft"],
      ["info", "info-soft"],
      ["universe-casino-ink", "card"],
      ["universe-sports-ink", "card"],
      ["universe-dating-ink", "card"],
      ["night-foreground", "night"],
      ["night-muted", "night"],
    ];
    const failing = pairs
      .map(([fg, bg]) => ({ pair: `${fg} / ${bg}`, r: ratio(token(fg), token(bg)) }))
      .filter((p) => p.r < 4.5);
    expect(failing).toEqual([]);
  });

  it("bordure des champs : 3:1 au moins sur blanc, sur le fond des pages et sur le gris des zones", () => {
    const m = /^border-([a-z-]+)\/(\d+)$/.exec(fieldBorderClass);
    expect(m).not.toBeNull();
    const color = rgb(token(m![1]!));
    const alpha = Number(m![2]) / 100;
    for (const bg of ["card", "background", "muted"]) {
      const b = rgb(token(bg));
      expect(ratio(over(color, alpha, b), b), `bordure sur ${bg}`).toBeGreaterThanOrEqual(3);
    }
    // L'ancienne bordure (--input) ne suffisait pas : 1,42:1.
    expect(ratio(token("input"), token("card"))).toBeLessThan(3);
  });

  it("les champs utilisent cette bordure (Input, Textarea, SelectTrigger, Checkbox)", () => {
    for (const f of ["input.tsx", "textarea.tsx", "select.tsx", "checkbox.tsx"]) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).toContain(`border ${fieldBorderClass}`);
    }
  });

  it("courbes et focus : 3:1 au moins", () => {
    // Ligne des mini-courbes (StatCard) : brand-ink, pas l'orange de marque (2:1).
    expect(ratio(token("brand-ink"), token("card"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("brand"), token("card"))).toBeLessThan(3);
    expect(readFileSync(join(__dirname, "..", "admin", "stat-card.tsx"), "utf8")).toMatch(
      /overflow-visible text-brand-ink/,
    );
    // Anneau de focus.
    expect(ratio(token("ring"), token("background"))).toBeGreaterThanOrEqual(3);
  });
});
