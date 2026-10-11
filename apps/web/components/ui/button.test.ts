import { describe, expect, it } from "vitest";
import { badgeVariants } from "./badge";
import { buttonVariants } from "./button";

const classes = (s: string) => s.split(/\s+/).filter(Boolean);
/** Classes de couleur de bordure (sans variante d'état : `aria-invalid:border-danger` n'est pas concernée). */
const borderColors = (s: string) =>
  classes(s).filter((c) => /^border-(transparent|input|border|danger|brand)/.test(c));

describe("buttonVariants (liens qui ressemblent à un bouton)", () => {
  it("garde la bordure de la variante outline (plus de border-transparent à côté)", () => {
    const outline = buttonVariants({ variant: "outline" });
    expect(borderColors(outline)).toEqual(["border-input"]);
    expect(outline).toContain("bg-surface");
  });

  it("ne garde qu'une couleur de bordure, une hauteur et un fond par variante", () => {
    const variants = [
      "default",
      "outline",
      "secondary",
      "ghost",
      "destructive",
      "danger",
      "link",
    ] as const;
    for (const variant of variants) {
      const c = buttonVariants({ variant });
      expect(borderColors(c).length, variant).toBeLessThanOrEqual(1);
      expect(classes(c).filter((x) => /^bg-(?!clip)/.test(x)).length, variant).toBeLessThanOrEqual(
        1,
      );
    }
    expect(borderColors(buttonVariants({ variant: "destructive" }))).toEqual(["border-danger/25"]);
    const sm = buttonVariants({ size: "sm" });
    expect(classes(sm).filter((x) => /^h-\d/.test(x))).toEqual(["h-8"]);
    expect(classes(sm).filter((x) => /^rounded-/.test(x))).toEqual(["rounded-md"]);
  });

  it("garde la taille de texte du thème (cn configuré) et les classes ajoutées", () => {
    const xs = buttonVariants({ size: "xs" });
    expect(classes(xs)).toContain("text-note");
    expect(classes(xs)).not.toContain("text-body");
    const withClass = buttonVariants({ variant: "outline", className: "max-md:h-10 w-full" });
    expect(classes(withClass)).toEqual(expect.arrayContaining(["max-md:h-10", "w-full"]));
  });

  it("a un contour de focus clavier visible même si on ajoute outline-none (Tailwind 4)", () => {
    const c = buttonVariants({ variant: "ghost", className: "outline-none" });
    expect(classes(c)).toEqual(
      expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-solid"]),
    );
  });
});

describe("badgeVariants", () => {
  it("garde la bordure de la variante outline", () => {
    expect(borderColors(badgeVariants({ variant: "outline" }))).toEqual(["border-border"]);
    expect(borderColors(badgeVariants({ variant: "default" }))).toEqual(["border-brand/30"]);
  });
});
