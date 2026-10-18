import { describe, expect, it } from "vitest";
import {
  PLANNED_ROUTES,
  PUBLIC_ROUTES,
  captureFileName,
  defaultRoutes,
  entityForRoute,
  fillRoute,
  isDynamicRoute,
  isPublicRoute,
  routeFromPageFile,
  routeSlug,
  sortRoutes,
} from "./routes";

describe("adresses des pages à partir des fichiers page.tsx", () => {
  it("racine, sous-pages, segments dynamiques ; groupes (x) retirés", () => {
    expect(routeFromPageFile("page.tsx")).toBe("/");
    expect(routeFromPageFile("campaigns/page.tsx")).toBe("/campaigns");
    expect(routeFromPageFile("campaigns/[id]/page.tsx")).toBe("/campaigns/[id]");
    expect(routeFromPageFile("(stats)/stats/ads/page.tsx")).toBe("/stats/ads");
    expect(routeFromPageFile("settings\\connectors\\meta\\page.tsx")).toBe(
      "/settings/connectors/meta",
    );
  });
  it("ignore les routes parallèles (@x), interceptées ((.)x), privées (_x) et les autres fichiers", () => {
    expect(routeFromPageFile("@modal/page.tsx")).toBeNull();
    expect(routeFromPageFile("(.)photo/page.tsx")).toBeNull();
    expect(routeFromPageFile("_parts/page.tsx")).toBeNull();
    expect(routeFromPageFile("campaigns/layout.tsx")).toBeNull();
  });
});

describe("liste par défaut", () => {
  it("réunit les pages existantes, les adresses prévues par la refonte et les pages publiques, sans doublon", () => {
    const list = defaultRoutes(["/", "/campaigns", "/links", "/stats"]);
    expect(list[0]).toBe("/");
    for (const r of [...PLANNED_ROUTES, ...PUBLIC_ROUTES, "/links"]) expect(list).toContain(r);
    expect(new Set(list).size).toBe(list.length);
  });
  it("ordre du menu : Accueil, Campagnes, Pages, Canaux, Messages, Membres, Statistiques, Réglages, puis le reste", () => {
    expect(
      sortRoutes([
        "/pages/[id]",
        "/pages",
        "/settings",
        "/login",
        "/links",
        "/members",
        "/stats/ads",
        "/campaigns/[id]",
        "/",
        "/campaigns",
        "/channels",
        "/messages",
      ]),
    ).toEqual([
      "/",
      "/campaigns",
      "/campaigns/[id]",
      "/pages",
      "/pages/[id]",
      "/channels",
      "/messages",
      "/members",
      "/stats/ads",
      "/settings",
      "/links",
      "/login",
    ]);
  });
  it("pages publiques (capturées sans connexion)", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/login?reset=1")).toBe(true);
    expect(isPublicRoute("/members")).toBe(false);
  });
});

describe("fiches : identifiants réels", () => {
  it("reconnaît l'objet d'une adresse dynamique (anciennes et nouvelles adresses)", () => {
    expect(isDynamicRoute("/campaigns/[id]")).toBe(true);
    expect(isDynamicRoute("/campaigns")).toBe(false);
    expect(entityForRoute("/campaigns/[id]")).toBe("campaign");
    expect(entityForRoute("/channels/[id]")).toBe("channel");
    expect(entityForRoute("/members/[id]")).toBe("member");
    expect(entityForRoute("/messages/[id]/edit")).toBe("post");
    expect(entityForRoute("/messages/ab/[groupId]")).toBe("postAbGroup");
    expect(entityForRoute("/broadcasts/[id]")).toBe("broadcast");
    expect(entityForRoute("/members/broadcasts/[id]")).toBe("broadcast");
    expect(entityForRoute("/members/broadcasts/ab/[groupId]")).toBe("broadcastAbGroup");
    expect(entityForRoute("/automations/[id]/edit")).toBe("automation");
    expect(entityForRoute("/members/automations/[id]")).toBe("automation");
    expect(entityForRoute("/campaigns/imports/[id]")).toBe("importBatch");
    // Phase 15 : fiche d'une page d'atterrissage (rubrique « Pages »).
    expect(entityForRoute("/pages/[id]")).toBe("landingPage");
    expect(fillRoute("/pages/[id]", { landingPage: "lp1" })).toBe("/pages/lp1");
    // Phase 17 : fil d'une conversation et fiche d'une persona.
    expect(entityForRoute("/conversations/[id]")).toBe("conversation");
    expect(entityForRoute("/conversations/personas/[id]")).toBe("persona");
    expect(fillRoute("/conversations/personas/[id]", { persona: "p1" })).toBe(
      "/conversations/personas/p1",
    );
    expect(entityForRoute("/inconnu/[id]")).toBeNull();
    expect(entityForRoute("/campaigns/[id]/ads/[adId]")).toBeNull();
  });
  it("remplace le segment par l'identifiant trouvé, ou rend null", () => {
    expect(fillRoute("/campaigns/[id]", { campaign: "c1" })).toBe("/campaigns/c1");
    expect(fillRoute("/messages/[id]/edit?x=1", { post: "p 1" })).toBe("/messages/p%201/edit?x=1");
    expect(fillRoute("/campaigns/[id]", {})).toBeNull();
    expect(fillRoute("/campaigns", {})).toBe("/campaigns");
  });
});

describe("noms de fichiers stables", () => {
  it("dérivés de l'adresse (jamais de l'identifiant), en minuscules sans accents", () => {
    expect(routeSlug("/")).toBe("accueil");
    expect(routeSlug("/campaigns")).toBe("campaigns");
    expect(routeSlug("/campaigns/[id]")).toBe("campaigns-id");
    expect(routeSlug("/messages/ab/[groupId]")).toBe("messages-ab-groupid");
    expect(routeSlug("/settings/connectors/meta/choose")).toBe("settings-connectors-meta-choose");
    expect(routeSlug("/members?filtre=Dépôt")).toBe("members-filtre-depot");
  });
  it("<nom>-<largeur>.webp", () => {
    expect(captureFileName("/", 1440)).toBe("accueil-1440.webp");
    expect(captureFileName("/campaigns/[id]", 390)).toBe("campaigns-id-390.webp");
    expect(captureFileName("/", 390, "png")).toBe("accueil-390.png");
  });
});
