import { describe, expect, it } from "vitest";
import {
  BEST_HOURS_IN_CALENDAR,
  LEGACY_PREFIXES,
  legacyRedirect,
  statsTarget,
} from "./legacy-routes";

describe("anciennes rubriques déplacées (préfixes)", () => {
  it("chaque ancienne rubrique renvoie vers sa nouvelle place", () => {
    expect(legacyRedirect("/broadcasts")).toBe("/members/broadcasts");
    expect(legacyRedirect("/automations")).toBe("/members/automations");
    expect(legacyRedirect("/bots")).toBe("/settings/bots");
    expect(legacyRedirect("/journal")).toBe("/settings/journal");
    expect(legacyRedirect("/links")).toBe("/campaigns/links");
  });

  it("garde les sous-pages (fiches, création, A/B, exports, routes de page)", () => {
    expect(legacyRedirect("/broadcasts/new")).toBe("/members/broadcasts/new");
    expect(legacyRedirect("/broadcasts/clx123")).toBe("/members/broadcasts/clx123");
    expect(legacyRedirect("/broadcasts/ab/grp_1")).toBe("/members/broadcasts/ab/grp_1");
    expect(legacyRedirect("/broadcasts/export")).toBe("/members/broadcasts/export");
    expect(legacyRedirect("/broadcasts/count")).toBe("/members/broadcasts/count");
    expect(legacyRedirect("/automations/new")).toBe("/members/automations/new");
    expect(legacyRedirect("/automations/r1")).toBe("/members/automations/r1");
    expect(legacyRedirect("/automations/r1/edit")).toBe("/members/automations/r1/edit");
    expect(legacyRedirect("/journal/events")).toBe("/settings/journal/events");
    expect(legacyRedirect("/journal/export")).toBe("/settings/journal/export");
  });

  it("garde tous les paramètres de l'adresse, dans l'ordre", () => {
    expect(legacyRedirect("/broadcasts", "status=SENT&campaignId=c1&page=2")).toBe(
      "/members/broadcasts?status=SENT&campaignId=c1&page=2",
    );
    expect(legacyRedirect("/journal", new URLSearchParams("view=events&type=telegram."))).toBe(
      "/settings/journal?view=events&type=telegram.",
    );
    expect(legacyRedirect("/links", "?q=pub&ok=Lien+cr%C3%A9%C3%A9")).toBe(
      "/campaigns/links?q=pub&ok=Lien+cr%C3%A9%C3%A9",
    );
    expect(legacyRedirect("/automations/new", "template=welcome")).toBe(
      "/members/automations/new?template=welcome",
    );
    // Paramètre répété : toutes les valeurs restent.
    expect(legacyRedirect("/broadcasts", "tag=a&tag=b")).toBe("/members/broadcasts?tag=a&tag=b");
  });

  it("une barre finale ou un identifiant encodé passent tels quels", () => {
    expect(legacyRedirect("/bots/")).toBe("/settings/bots/");
    expect(legacyRedirect("/broadcasts/a%20b")).toBe("/members/broadcasts/a%20b");
  });

  it("ne confond pas un préfixe de mot", () => {
    expect(legacyRedirect("/botsx")).toBeNull();
    expect(legacyRedirect("/links-old")).toBeNull();
    expect(legacyRedirect("/journalism")).toBeNull();
    expect(legacyRedirect("/broadcasts2/new")).toBeNull();
  });

  it("la liste des préfixes est celle de docs/REFONTE-PLAN.md", () => {
    expect(Object.fromEntries(LEGACY_PREFIXES)).toEqual({
      "/broadcasts": "/members/broadcasts",
      "/automations": "/members/automations",
      "/bots": "/settings/bots",
      "/journal": "/settings/journal",
      "/links": "/campaigns/links",
    });
  });
});

describe("ancien tableau de bord (« / » avec ses paramètres) → Statistiques", () => {
  it("chaque onglet renvoie vers sa page des statistiques, en une seule redirection", () => {
    expect(legacyRedirect("/", "tab=ads")).toBe("/stats/ads");
    expect(legacyRedirect("/", "tab=funnel")).toBe("/stats/funnel");
    expect(legacyRedirect("/", "tab=cohorts")).toBe("/stats/cohorts");
    expect(legacyRedirect("/", "tab=channels")).toBe("/stats/channels");
  });

  it("« Vue d'ensemble » est l'onglet par défaut des statistiques (paramètre retiré)", () => {
    expect(legacyRedirect("/", "tab=overview")).toBe("/stats");
    expect(legacyRedirect("/", "tab=overview&range=30d")).toBe("/stats?range=30d");
  });

  it("garde la période, la comparaison et les filtres", () => {
    expect(
      legacyRedirect(
        "/",
        "tab=ads&range=custom&from=2026-09-01&to=2026-09-30&compare=1&sort=roas&dir=asc",
      ),
    ).toBe("/stats/ads?range=custom&from=2026-09-01&to=2026-09-30&compare=1&sort=roas&dir=asc");
    expect(legacyRedirect("/", "tab=funnel&dim=campaign%3Ac1&vertical=CASINO")).toBe(
      "/stats/funnel?dim=campaign%3Ac1&vertical=CASINO",
    );
    expect(legacyRedirect("/", "campaignId=c1&tab=cohorts")).toBe("/stats/cohorts?campaignId=c1");
  });

  it("une adresse de l'ancien tableau de bord sans onglet (vue d'ensemble filtrée) va aussi aux statistiques", () => {
    expect(legacyRedirect("/", "range=30d&compare=1")).toBe("/stats?range=30d&compare=1");
    expect(legacyRedirect("/", "campaignId=c1")).toBe("/stats?campaignId=c1");
    expect(legacyRedirect("/", "vertical=SPORTS&channelId=ch1")).toBe(
      "/stats?vertical=SPORTS&channelId=ch1",
    );
  });

  it("un onglet inconnu est traité comme la vue d'ensemble (comme l'ancien tableau de bord)", () => {
    expect(legacyRedirect("/", "tab=pirate")).toBe("/stats");
    expect(legacyRedirect("/", "tab=")).toBe("/stats");
  });

  it("garde les messages de retour d'une action (ok, error) avec le reste", () => {
    expect(legacyRedirect("/", "tab=ads&ok=Recalcul+lanc%C3%A9")).toBe(
      "/stats/ads?ok=Recalcul+lanc%C3%A9",
    );
  });

  it("l'accueil lui-même n'est pas redirigé (ni ses propres paramètres)", () => {
    expect(legacyRedirect("/")).toBeNull();
    expect(legacyRedirect("/", "")).toBeNull();
    expect(legacyRedirect("/", "forbidden=1")).toBeNull();
    expect(legacyRedirect("/", "ok=Fait")).toBeNull();
    expect(legacyRedirect("/", "error=Oups")).toBeNull();
    expect(legacyRedirect("/", "_rsc=abc")).toBeNull();
  });

  it("statsTarget : la cible de chaque onglet en un seul endroit (une page par onglet depuis l'étape 7)", () => {
    expect(statsTarget("overview")).toEqual({ path: "/stats", tab: null });
    expect(statsTarget("ads")).toEqual({ path: "/stats/ads", tab: null });
    expect(statsTarget("funnel")).toEqual({ path: "/stats/funnel", tab: null });
    expect(statsTarget("cohorts")).toEqual({ path: "/stats/cohorts", tab: null });
    expect(statsTarget("channels")).toEqual({ path: "/stats/channels", tab: null });
    expect(statsTarget("inconnu")).toEqual({ path: "/stats", tab: null });
    expect(statsTarget(null)).toEqual({ path: "/stats", tab: null });
  });
});

describe("statistiques à onglets (« /stats?tab=… ») → une page par onglet", () => {
  it("chaque onglet renvoie vers sa page", () => {
    expect(legacyRedirect("/stats", "tab=ads")).toBe("/stats/ads");
    expect(legacyRedirect("/stats", "tab=funnel")).toBe("/stats/funnel");
    expect(legacyRedirect("/stats", "tab=cohorts")).toBe("/stats/cohorts");
    expect(legacyRedirect("/stats", "tab=channels")).toBe("/stats/channels");
  });

  it("« Vue d'ensemble » ou un onglet inconnu : la vue d'ensemble, sans le paramètre", () => {
    expect(legacyRedirect("/stats", "tab=overview&range=30d")).toBe("/stats?range=30d");
    expect(legacyRedirect("/stats", "tab=pirate")).toBe("/stats");
    expect(legacyRedirect("/stats", "tab=")).toBe("/stats");
  });

  it("garde la période, la comparaison, les filtres, le tri, la dimension et les messages de retour", () => {
    expect(
      legacyRedirect(
        "/stats",
        "tab=ads&range=custom&from=2026-09-01&to=2026-09-30&compare=1&vertical=CASINO&campaignId=c1&sort=roas&dir=asc",
      ),
    ).toBe(
      "/stats/ads?range=custom&from=2026-09-01&to=2026-09-30&compare=1&vertical=CASINO&campaignId=c1&sort=roas&dir=asc",
    );
    expect(legacyRedirect("/stats", "tab=funnel&dim=channel%3Ach1")).toBe(
      "/stats/funnel?dim=channel%3Ach1",
    );
    expect(legacyRedirect("/stats", "channelId=ch1&tab=channels")).toBe(
      "/stats/channels?channelId=ch1",
    );
    expect(legacyRedirect("/stats", "tab=ads&ok=Recalcul+lanc%C3%A9")).toBe(
      "/stats/ads?ok=Recalcul+lanc%C3%A9",
    );
  });

  it("les nouvelles pages ne sont jamais redirigées, même avec un paramètre « tab »", () => {
    expect(legacyRedirect("/stats/ads", "tab=funnel")).toBeNull();
    expect(legacyRedirect("/stats/cohorts", "range=90d")).toBeNull();
  });
});

describe("onglet « Meilleurs horaires » d'un canal → calendrier des messages", () => {
  const on = { bestHoursInCalendar: true };

  it("renvoie vers le calendrier filtré sur le canal (quand le calendrier montre les créneaux)", () => {
    expect(legacyRedirect("/channels/ch_1", "tab=besthours", on)).toBe("/messages?channelId=ch_1");
    expect(legacyRedirect("/channels/ch_1", "tab=besthours&cat=k1&ok=Fait", on)).toBe(
      "/messages?channelId=ch_1&ok=Fait",
    );
    expect(legacyRedirect("/channels/a%20b", "tab=besthours", on)).toBe("/messages?channelId=a+b");
  });

  it("ne touche ni aux autres onglets du canal, ni à la liste, ni à l'import", () => {
    expect(legacyRedirect("/channels/ch_1", "tab=rules", on)).toBeNull();
    expect(legacyRedirect("/channels/ch_1", "", on)).toBeNull();
    expect(legacyRedirect("/channels", "tab=besthours", on)).toBeNull();
    expect(legacyRedirect("/channels/import", "tab=besthours", on)).toBeNull();
    expect(legacyRedirect("/channels/ch_1/sequences", "tab=besthours", on)).toBeNull();
  });

  it("est actif : le calendrier montre les meilleurs créneaux (étape 4)", () => {
    expect(BEST_HOURS_IN_CALENDAR).toBe(true);
    expect(legacyRedirect("/channels/ch_1", "tab=besthours")).toBe("/messages?channelId=ch_1");
  });

  it("l'interrupteur coupé ne redirige pas (rien ne disparaît tant que les créneaux ne sont pas affichés)", () => {
    expect(
      legacyRedirect("/channels/ch_1", "tab=besthours", { bestHoursInCalendar: false }),
    ).toBeNull();
  });
});

describe("adresses jamais redirigées", () => {
  it("rien pour les nouvelles adresses", () => {
    for (const p of [
      "/members",
      "/members/broadcasts",
      "/members/broadcasts/new",
      "/members/automations/r1/edit",
      "/settings",
      "/settings/bots",
      "/settings/journal",
      "/settings/journal/events",
      "/campaigns",
      "/campaigns/links",
      "/campaigns/c1",
      "/channels",
      "/channels/ch_1",
      "/messages",
      "/stats/ads",
      "/stats/funnel",
      "/stats/channels",
      "/stats/cohorts",
      "/help",
      "/account",
      "/styleguide",
      "/dashboard/export",
      "/login",
    ]) {
      expect(legacyRedirect(p), p).toBeNull();
      expect(legacyRedirect(p, "tab=ads&range=7d"), `${p}?tab=ads`).toBeNull();
    }
    // Les statistiques elles-mêmes : seulement sans l'ancien paramètre d'onglet (voir plus haut).
    expect(legacyRedirect("/stats")).toBeNull();
    expect(legacyRedirect("/stats", "range=30d&compare=1")).toBeNull();
  });

  it("rien pour les API, les redirections de liens traqués et les fichiers de Next", () => {
    for (const p of [
      "/api/search",
      "/api/broadcasts",
      "/api/bots/x",
      "/api/journal/export",
      "/api/telegram/bot_1",
      "/api/health",
      "/r/broadcasts",
      "/r",
      "/_next/static/chunks/links.js",
    ]) {
      expect(legacyRedirect(p, "tab=ads"), p).toBeNull();
    }
  });
});
