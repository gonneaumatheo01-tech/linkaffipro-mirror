import { describe, expect, it } from "vitest";
import {
  MOBILE_PRIMARY_HREFS,
  NAV,
  activeHref,
  initials,
  isActiveHref,
  mobileNav,
  navSections,
  visibleNav,
  type NavItem,
} from "./nav-logic";

const item = (href: string, extra: Partial<NavItem> = {}): NavItem => ({
  href,
  label: href,
  icon: "Settings",
  section: "main",
  ...extra,
});

describe("NAV (liste du menu)", () => {
  it("chaque entrée a une adresse unique, un libellé et une section", () => {
    const hrefs = NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const i of NAV) {
      expect(i.label.trim()).not.toBe("");
      expect(["main", "bottom"]).toContain(i.section);
    }
  });

  it("Réglages et Aide sont en bas, séparés du reste", () => {
    const bottom = NAV.filter((i) => i.section === "bottom").map((i) => i.href);
    expect(bottom).toEqual(["/settings", "/help"]);
  });

  it("les entrées du bas suivent toutes les entrées principales", () => {
    const firstBottom = NAV.findIndex((i) => i.section === "bottom");
    expect(NAV.slice(firstBottom).every((i) => i.section === "bottom")).toBe(true);
  });

  it("la barre du bas du téléphone pointe vers des entrées existantes", () => {
    for (const href of MOBILE_PRIMARY_HREFS) expect(NAV.some((i) => i.href === href)).toBe(true);
  });
});

describe("visibleNav", () => {
  it("cache les entrées réservées aux administrateurs pour un manager", () => {
    const nav = [item("/"), item("/settings", { adminOnly: true, section: "bottom" })];
    expect(visibleNav(nav, false).map((i) => i.href)).toEqual(["/"]);
    expect(visibleNav(nav, true).map((i) => i.href)).toEqual(["/", "/settings"]);
  });
});

describe("navSections", () => {
  it("sépare les entrées principales des entrées du bas", () => {
    const nav = [
      item("/"),
      item("/members"),
      item("/settings", { section: "bottom", adminOnly: true }),
      item("/help", { section: "bottom" }),
    ];
    const s = navSections(nav, true);
    expect(s.main.map((i) => i.href)).toEqual(["/", "/members"]);
    expect(s.bottom.map((i) => i.href)).toEqual(["/settings", "/help"]);
    expect(navSections(nav, false).bottom.map((i) => i.href)).toEqual(["/help"]);
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
    expect(isActiveHref("/bots", "/broadcasts")).toBe(false);
    expect(isActiveHref("/broadcasts/new", "/bots")).toBe(false);
  });
});

describe("activeHref", () => {
  it("retient l'entrée la plus précise (sous-menus de l'étape 2)", () => {
    const items = [item("/"), item("/members"), item("/members/broadcasts"), item("/settings")];
    expect(activeHref("/members/broadcasts/12", items)).toBe("/members/broadcasts");
    expect(activeHref("/members/12", items)).toBe("/members");
    expect(activeHref("/", items)).toBe("/");
    expect(activeHref("/inconnu", items)).toBeNull();
  });
});

describe("mobileNav", () => {
  const nav: NavItem[] = [
    item("/", { mobileLabel: "Accueil" }),
    item("/campaigns"),
    item("/channels"),
    item("/members"),
    item("/messages"),
    item("/journal"),
    item("/settings", { section: "bottom", adminOnly: true }),
    item("/help", { section: "bottom" }),
  ];

  it("met Accueil, Messages, Membres, Campagnes dans la barre, dans cet ordre", () => {
    const { primary } = mobileNav(nav, true, ["/", "/messages", "/members", "/campaigns"]);
    expect(primary.map((i) => i.href)).toEqual(["/", "/messages", "/members", "/campaigns"]);
  });

  it("range tout le reste dans « Plus », entrées du bas à la fin", () => {
    const { more } = mobileNav(nav, true, ["/", "/messages", "/members", "/campaigns"]);
    expect(more.map((i) => i.href)).toEqual(["/channels", "/journal", "/settings", "/help"]);
  });

  it("ne montre pas Réglages à un manager", () => {
    const { more } = mobileNav(nav, false, ["/", "/messages", "/members", "/campaigns"]);
    expect(more.map((i) => i.href)).toEqual(["/channels", "/journal", "/help"]);
  });

  it("ignore une adresse de la barre absente du menu (menu modifié plus tard)", () => {
    const { primary, more } = mobileNav(nav, true, ["/", "/stats", "/members"]);
    expect(primary.map((i) => i.href)).toEqual(["/", "/members"]);
    expect(more.map((i) => i.href)).not.toContain("/stats");
    expect(more.map((i) => i.href)).toContain("/messages");
  });

  it("utilise la liste par défaut du menu réel", () => {
    const { primary, more } = mobileNav(NAV, true);
    expect(primary.map((i) => i.href)).toEqual([...MOBILE_PRIMARY_HREFS]);
    expect(primary.length + more.length).toBe(NAV.length);
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
