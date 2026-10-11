import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE,
  DEFAULT_EMAIL,
  DEFAULT_PASSWORD,
  OptionError,
  normalizeRoute,
  parseA11yOptions,
  parseCaptureOptions,
  parsePagesText,
  parseWidths,
  resolvePagesValue,
} from "./options";

describe("options de pnpm captures", () => {
  it("valeurs par défaut : serveur local 3103, compte de vérification, 1440 et 390 px, docs/captures", () => {
    const o = parseCaptureOptions([], {});
    expect(o).toMatchObject({
      base: DEFAULT_BASE,
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      pages: null,
      out: "docs/captures",
      widths: [1440, 390],
      keepPng: false,
      prune: false,
      help: false,
    });
    expect(DEFAULT_BASE).toBe("http://localhost:3103");
  });

  it("lit --option valeur et --option=valeur, et ignore le « -- » ajouté par pnpm", () => {
    const o = parseCaptureOptions(
      [
        "--",
        "--base",
        "http://127.0.0.1:3200/",
        "--pages=/,/campaigns",
        "--widths",
        "1280",
        "--out=tmp/x",
      ],
      {},
    );
    expect(o.base).toBe("http://127.0.0.1:3200");
    expect(o.pages).toBe("/,/campaigns");
    expect(o.widths).toEqual([1280]);
    expect(o.out).toBe("tmp/x");
  });

  it("--password-file lit le mot de passe dans un fichier (rien sur la ligne de commande)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lap-pw-"));
    const f = join(dir, "pw");
    writeFileSync(f, "secret-du-fichier\n", { mode: 0o600 });
    expect(
      parseCaptureOptions(["--base", "https://app.linkaffipro.com", "--password-file", f], {})
        .password,
    ).toBe("secret-du-fichier");
    rmSync(dir, { recursive: true, force: true });
  });

  it("variables CAPTURE_EMAIL / CAPTURE_PASSWORD, puis DEMO_PASSWORD ; les options gagnent", () => {
    expect(
      parseCaptureOptions([], { CAPTURE_EMAIL: "a@b.c", CAPTURE_PASSWORD: "x" }),
    ).toMatchObject({ email: "a@b.c", password: "x" });
    expect(parseCaptureOptions([], { DEMO_PASSWORD: "demo2" }).password).toBe("demo2");
    expect(
      parseCaptureOptions(["--email", "z@z.z", "--password", "p"], { CAPTURE_EMAIL: "a@b.c" }),
    ).toMatchObject({ email: "z@z.z", password: "p" });
  });

  it("refuse le mot de passe de démonstration sur un site qui n'est pas local", () => {
    expect(() => parseCaptureOptions(["--base", "https://app.linkaffipro.com"], {})).toThrow(
      OptionError,
    );
    expect(
      parseCaptureOptions(["--base", "https://app.linkaffipro.com"], { CAPTURE_PASSWORD: "s" })
        .password,
    ).toBe("s");
  });

  it("options booléennes et --help", () => {
    const o = parseCaptureOptions(["--keep-png", "--prune", "-h"], {});
    expect(o).toMatchObject({ keepPng: true, prune: true, help: true });
  });

  it("erreurs claires : option inconnue, valeur manquante, adresse invalide, délai invalide", () => {
    expect(() => parseCaptureOptions(["--nope"], {})).toThrow(/Option inconnue : --nope/);
    expect(() => parseCaptureOptions(["--pages"], {})).toThrow(/--pages attend une valeur/);
    expect(() => parseCaptureOptions(["--base", "localhost:3103"], {})).toThrow(/--base/);
    expect(() => parseCaptureOptions(["--timeout", "0"], {})).toThrow(/--timeout/);
    expect(parseCaptureOptions(["--timeout", "30"], {}).timeoutMs).toBe(30_000);
  });
});

describe("navigateur (--browser)", () => {
  it("Chromium par défaut ; firefox et webkit au choix (option ou CAPTURE_BROWSER)", () => {
    expect(parseCaptureOptions([], {}).browser).toBe("chromium");
    expect(parseA11yOptions([], {}).browser).toBe("chromium");
    expect(parseCaptureOptions(["--browser", "firefox"], {}).browser).toBe("firefox");
    expect(parseCaptureOptions(["--browser=WebKit"], {}).browser).toBe("webkit");
    expect(parseA11yOptions([], { CAPTURE_BROWSER: "firefox" }).browser).toBe("firefox");
    expect(
      parseCaptureOptions(["--browser", "chromium"], { CAPTURE_BROWSER: "firefox" }).browser,
    ).toBe("chromium");
  });

  it("refuse un navigateur inconnu", () => {
    expect(() => parseCaptureOptions(["--browser", "safari"], {})).toThrow(OptionError);
    expect(() => parseCaptureOptions(["--browser", "safari"], {})).toThrow(
      /chromium, firefox, webkit/,
    );
  });
});

describe("largeurs", () => {
  it("liste séparée par des virgules, sans doublon", () => {
    expect(parseWidths("1440, 390,1440")).toEqual([1440, 390]);
  });
  it("refuse une largeur hors limites ou illisible", () => {
    expect(() => parseWidths("100")).toThrow(OptionError);
    expect(() => parseWidths("abc")).toThrow(OptionError);
    expect(() => parseWidths("")).toThrow(OptionError);
  });
});

describe("liste de pages", () => {
  it("normalise : barre initiale, sans barre finale, origine retirée, :id → [id]", () => {
    expect(normalizeRoute("campaigns/")).toBe("/campaigns");
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("http://localhost:3103/members?x=1")).toBe("/members?x=1");
    expect(normalizeRoute("/campaigns/:id")).toBe("/campaigns/[id]");
    expect(normalizeRoute("  /messages/ab/:groupId/ ")).toBe("/messages/ab/[groupId]");
    expect(normalizeRoute("http://localhost:3103")).toBe("/");
  });

  it("texte : virgules et lignes, commentaires # ignorés, sans doublon", () => {
    expect(parsePagesText("/, /campaigns\n# fiche\n/campaigns/[id]\n\n/campaigns")).toEqual([
      "/",
      "/campaigns",
      "/campaigns/[id]",
    ]);
  });

  it("valeur : liste si elle commence par / (ou contient une virgule), sinon fichier", () => {
    const fs = {
      exists: (p: string) => p === "pages.txt",
      read: () => "/members\n/channels",
    };
    expect(resolvePagesValue("/,/campaigns,/members", fs)).toEqual(["/", "/campaigns", "/members"]);
    expect(resolvePagesValue("pages.txt", fs)).toEqual(["/members", "/channels"]);
    expect(() => resolvePagesValue("absent.txt", fs)).toThrow(/introuvable/);
    expect(() => resolvePagesValue("pages.txt", { ...fs, read: () => "# rien" })).toThrow(
      /aucune page/,
    );
  });
});

describe("options de pnpm a11y", () => {
  it("valeurs par défaut : 1440 px, wcag2a + wcag2aa, échec sur « critical », rapport dans docs/captures", () => {
    const o = parseA11yOptions([], {});
    expect(o).toMatchObject({
      base: DEFAULT_BASE,
      width: 1440,
      tags: ["wcag2a", "wcag2aa"],
      failOn: "critical",
      report: "docs/captures/a11y-report.json",
      pages: null,
    });
  });
  it("--fail-on serious, --tags, --width, --report", () => {
    const o = parseA11yOptions(
      ["--fail-on", "serious", "--tags", "wcag2a,wcag21aa", "--width=1280", "--report", "r.json"],
      {},
    );
    expect(o).toMatchObject({
      failOn: "serious",
      tags: ["wcag2a", "wcag21aa"],
      width: 1280,
      report: "r.json",
    });
  });
  it("refuse un niveau inconnu", () => {
    expect(() => parseA11yOptions(["--fail-on", "grave"], {})).toThrow(/--fail-on/);
  });
});
