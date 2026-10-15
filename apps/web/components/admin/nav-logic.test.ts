import { describe, expect, it } from "vitest";
import { LEGACY_PREFIXES, legacyRedirect } from "@/lib/legacy-routes";
import {
  MOBILE_PRIMARY_HREFS,
  NAV,
  activeHref,
  initials,
  isActiveHref,
  mobileNav,
  navSections,
  navTourId,
  visibleNav,
  type NavItem,
} from "./nav-logic";

const item = (href: string, extra: Partial<NavItem> = {}): NavItem => ({
  key: href.replace(/[^a-z]/g, "") || "home",
  href,
  label: href,
  icon: "Settings",
  section: "main",
  ...extra,
});

describe("NAV (liste du menu)", () => {
  it("chaque entrée a une adresse unique, une clé unique, un libellé et une section", () => {
    const hrefs = NAV.map((i) => i.href);
    const keys = NAV.map((i) => i.key);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of NAV) {
      expect(i.label.trim()).not.toBe("");
      expect(i.key).toMatch(/^[a-z]+$/);
      expect(["main", "bottom"]).toContain(i.section);
    }
  });

  it("entrées principales dans l'ordre de docs/REFONTE-UX.md, « Pages » juste après Campagnes (phase 15)", () => {
    const main = NAV.filter((i) => i.section === "main");
    expect(main.map((i) => [i.href, i.label])).toEqual([
      ["/", "Accueil"],
      ["/campaigns", "Campagnes"],
      ["/pages", "Pages"],
      ["/channels", "Canaux"],
      ["/messages", "Messages"],
      ["/members", "Membres"],
      ["/stats", "Statistiques"],
    ]);
  });

  it("en bas : Réglages (barre de menu) ; Guide et Mon compte seulement dans « Plus » du téléphone", () => {
    const bottom = NAV.filter((i) => i.section === "bottom");
    expect(bottom.map((i) => i.href)).toEqual(["/settings", "/help", "/account"]);
    expect(bottom.filter((i) => !i.mobileOnly).map((i) => i.href)).toEqual(["/settings"]);
    expect(NAV.find((i) => i.href === "/help")?.label).toBe("Guide d'utilisation");
    expect(NAV.find((i) => i.href === "/account")?.label).toBe("Mon compte");
  });

  it("Réglages est visible pour tous les rôles", () => {
    expect(NAV.some((i) => i.adminOnly)).toBe(false);
    expect(navSections(NAV, false).bottom.map((i) => i.href)).toEqual(["/settings"]);
  });

  it("les entrées du bas suivent toutes les entrées principales", () => {
    const firstBottom = NAV.findIndex((i) => i.section === "bottom");
    expect(NAV.slice(firstBottom).every((i) => i.section === "bottom")).toBe(true);
  });

  it("aucune ancienne adresse dans le menu", () => {
    for (const [old] of LEGACY_PREFIXES)
      expect(NAV.some((i) => i.href === old || i.href.startsWith(`${old}/`))).toBe(false);
    for (const i of NAV) expect(legacyRedirect(i.href), i.href).toBeNull();
  });

  it("la barre du bas du téléphone pointe vers des entrées existantes", () => {
    expect([...MOBILE_PRIMARY_HREFS]).toEqual(["/", "/messages", "/members", "/campaigns"]);
    for (const href of MOBILE_PRIMARY_HREFS) expect(NAV.some((i) => i.href === href)).toBe(true);
  });

  it("chaque entrée a son repère de visite guidée nav-<clé>", () => {
    expect(NAV.map(navTourId)).toEqual([
      "nav-home",
      "nav-campaigns",
      "nav-pages",
      "nav-channels",
      "nav-messages",
      "nav-members",
      "nav-stats",
      "nav-settings",
      "nav-help",
      "nav-account",
    ]);
  });
});

describe("visibleNav", () => {
  it("cache les entrées réservées aux administrateurs pour un manager", () => {
    const nav = [item("/"), item("/secret", { adminOnly: true, section: "bottom" })];
    expect(visibleNav(nav, false).map((i) => i.href)).toEqual(["/"]);
    expect(visibleNav(nav, true).map((i) => i.href)).toEqual(["/", "/secret"]);
  });
});

describe("navSections (barre de menu de l'ordinateur)", () => {
  it("sépare les entrées principales des entrées du bas, sans les entrées propres au téléphone", () => {
    const nav = [
      item("/"),
      item("/members"),
      item("/settings", { section: "bottom" }),
      item("/help", { section: "bottom", mobileOnly: true }),
      item("/secret", { section: "bottom", adminOnly: true }),
    ];
    const s = navSections(nav, true);
    expect(s.main.map((i) => i.href)).toEqual(["/", "/members"]);
    expect(s.bottom.map((i) => i.href)).toEqual(["/settings", "/secret"]);
    expect(navSections(nav, false).bottom.map((i) => i.href)).toEqual(["/settings"]);
  });

  it("menu réel : 7 entrées (6 + Pages) + Réglages, pour un administrateur comme pour un manager", () => {
    for (const isAdmin of [true, false]) {
      const s = navSections(NAV, isAdmin);
      expect(s.main).toHaveLength(7);
      expect(s.bottom.map((i) => i.href)).toEqual(["/settings"]);
    }
  });
});

describe("isActiveHref", () => {
  it("l'accueil n'est actif que sur « / »", () => {
    expect(isActiveHref("/", "/")).toBe(true);
    expect(isActiveHref("/members", "/")).toBe(false);
  });

  it("une entrée est active sur sa page et ses sous-pages, pas sur un préfixe de mot", () => {
    expect(isActiveHref("/members", "/members")).toBe(true);
    expect(isActiveHref("/members/abc", "/members")).toBe(true);
    expect(isActiveHref("/members-old", "/members")).toBe(false);
    expect(isActiveHref("/settings/bots", "/settings")).toBe(true);
    expect(isActiveHref("/settingsx", "/settings")).toBe(false);
  });
});

describe("activeHref", () => {
  it("retient l'entrée la plus précise", () => {
    const items = [item("/"), item("/members"), item("/members/broadcasts"), item("/settings")];
    expect(activeHref("/members/broadcasts/12", items)).toBe("/members/broadcasts");
    expect(activeHref("/members/12", items)).toBe("/members");
    expect(activeHref("/", items)).toBe("/");
    expect(activeHref("/inconnu", items)).toBeNull();
  });

  it("menu réel : les rubriques rangées sous une entrée l'allument", () => {
    const cases: Array<[string, string | null]> = [
      ["/", "/"],
      ["/members", "/members"],
      ["/members/clx1", "/members"],
      ["/members/broadcasts", "/members"],
      ["/members/broadcasts/new", "/members"],
      ["/members/broadcasts/ab/g1", "/members"],
      ["/members/automations", "/members"],
      ["/members/automations/r1/edit", "/members"],
      ["/campaigns", "/campaigns"],
      ["/campaigns/new", "/campaigns"],
      ["/campaigns/links", "/campaigns"],
      ["/campaigns/import", "/campaigns"],
      ["/pages", "/pages"],
      ["/pages/new", "/pages"],
      ["/pages/p1", "/pages"],
      ["/pagesx", null],
      ["/channels/ch1", "/channels"],
      ["/messages/new", "/messages"],
      ["/stats", "/stats"],
      ["/stats/ads", "/stats"],
      ["/settings", "/settings"],
      ["/settings/bots", "/settings"],
      ["/settings/journal/events", "/settings"],
      ["/settings/connectors/meta", "/settings"],
      ["/help", "/help"],
      ["/account", "/account"],
      ["/styleguide", null],
    ];
    for (const [path, expected] of cases) expect(activeHref(path, NAV), path).toBe(expected);
    // Barre de l'ordinateur : le guide et le compte n'y sont pas, aucune entrée n'est allumée.
    const { main, bottom } = navSections(NAV, true);
    expect(activeHref("/help", [...main, ...bottom])).toBeNull();
  });
});

describe("mobileNav", () => {
  const nav: NavItem[] = [
    item("/", { mobileLabel: "Accueil" }),
    item("/campaigns"),
    item("/channels"),
    item("/members"),
    item("/messages"),
    item("/stats"),
    item("/settings", { section: "bottom" }),
    item("/help", { section: "bottom", mobileOnly: true }),
    item("/secret", { section: "bottom", adminOnly: true }),
  ];

  it("met Accueil, Messages, Membres, Campagnes dans la barre, dans cet ordre", () => {
    const { primary } = mobileNav(nav, true, ["/", "/messages", "/members", "/campaigns"]);
    expect(primary.map((i) => i.href)).toEqual(["/", "/messages", "/members", "/campaigns"]);
  });

  it("range tout le reste dans « Plus », entrées du bas (dont celles du téléphone) à la fin", () => {
    const { more } = mobileNav(nav, true, ["/", "/messages", "/members", "/campaigns"]);
    expect(more.map((i) => i.href)).toEqual([
      "/channels",
      "/stats",
      "/settings",
      "/help",
      "/secret",
    ]);
  });

  it("ne montre pas une entrée réservée aux administrateurs à un manager", () => {
    const { more } = mobileNav(nav, false, ["/", "/messages", "/members", "/campaigns"]);
    expect(more.map((i) => i.href)).toEqual(["/channels", "/stats", "/settings", "/help"]);
  });

  it("ignore une adresse de la barre absente du menu (menu modifié plus tard)", () => {
    const { primary, more } = mobileNav(nav, true, ["/", "/inconnu", "/members"]);
    expect(primary.map((i) => i.href)).toEqual(["/", "/members"]);
    expect(more.map((i) => i.href)).not.toContain("/inconnu");
    expect(more.map((i) => i.href)).toContain("/messages");
  });

  it("menu réel : « Plus » contient Pages, Canaux, Statistiques, Réglages, Guide d'utilisation, Mon compte", () => {
    for (const isAdmin of [true, false]) {
      const { primary, more } = mobileNav(NAV, isAdmin);
      expect(primary.map((i) => i.href)).toEqual([...MOBILE_PRIMARY_HREFS]);
      expect(more.map((i) => i.label)).toEqual([
        "Pages",
        "Canaux",
        "Statistiques",
        "Réglages",
        "Guide d'utilisation",
        "Mon compte",
      ]);
      expect(primary.length + more.length).toBe(NAV.length);
    }
  });
});

describe("initials (pastille du menu utilisateur)", () => {
  it("prend l'initiale du prénom et celle du nom, en majuscules", () => {
    expect(initials("matheo gonneau")).toBe("MG");
    expect(initials("Marie Anne Dupont")).toBe("MD");
    expect(initials("Jean-Pierre Dupont")).toBe("JD");
  });

  it("ignore les particules du nom (de, du, des, la, le, d', l', van, von…)", () => {
    expect(initials("Compte de vérification")).toBe("CV");
    expect(initials("  Élodie   de la Tour ")).toBe("ÉT");
    expect(initials("Charles d'Artagnan")).toBe("CA");
    expect(initials("Anne l’Huillier")).toBe("AH");
    expect(initials("Ludwig van Beethoven")).toBe("LB");
    expect(initials("Jean Claude Van Damme")).toBe("JD");
    expect(initials("Paul du Pont des Arts")).toBe("PA");
  });

  it("garde le premier mot même s'il ressemble à une particule", () => {
    expect(initials("Van Damme")).toBe("VD");
    expect(initials("Le Goff")).toBe("LG");
    expect(initials("de la")).toBe("D");
  });

  it("une seule lettre pour un seul mot, « ? » si vide", () => {
    expect(initials("admin")).toBe("A");
    expect(initials("   ")).toBe("?");
    expect(initials("")).toBe("?");
  });

  it("ignore la ponctuation de tête (ex. adresse ou pseudo)", () => {
    expect(initials("@lucas")).toBe("L");
    expect(initials("jean-pierre")).toBe("J");
    expect(initials("(Lucas) Martin")).toBe("LM");
  });
});
