import { describe, expect, it } from "vitest";
import { GROUP_STATUSES } from "@/lib/broadcasts/group";
import {
  BROADCAST_STATUSES,
  activeFilterCount,
  activityChips,
  clearedFilters,
  broadcastLink,
  broadcastNote,
  describeMemberFilters,
  filterEntries,
  filtersToQuery,
  hiddenFilterFields,
  joinFr,
  languageName,
  membersHref,
  parseMemberFilters,
  sortLinks,
  universeChips,
} from "./filters";

const names = {
  campaigns: { c1: "Casino octobre" },
  inviteLinks: { il1: "TT vidéo 1" },
  channels: { ch1: "Casino VIP" },
};

describe("paramètres d'adresse de la liste des membres", () => {
  it("garde valides les anciens paramètres (q, canal, statut, lien, campagne, niveau, langue, étiquette, dates, tri, page)", () => {
    const sp = {
      q: " léa ",
      channelId: "ch1",
      status: "APPROVED",
      inviteLinkId: "il1",
      campaignId: "c1",
      level: "VIP",
      language: "FR",
      tag: " vip ",
      since: "2026-10-01",
      until: "2026-10-09",
      sort: "firstSeen",
      page: "3",
    };
    const f = parseMemberFilters(sp);
    expect(f).toMatchObject({
      q: "léa",
      channelId: "ch1",
      status: "APPROVED",
      inviteLinkId: "il1",
      campaignId: "c1",
      level: "VIP",
      language: "fr",
      tag: "vip",
      since: "2026-10-01",
      until: "2026-10-09",
      sort: "firstSeen",
      page: 3,
      deposited: false,
      ftd: "",
      inactive: "",
      universe: "",
    });
    expect(filtersToQuery(f)).toBe(
      "?q=l%C3%A9a&channelId=ch1&status=APPROVED&inviteLinkId=il1&campaignId=c1&level=VIP&language=fr&tag=vip&since=2026-10-01&until=2026-10-09&sort=firstSeen&page=3",
    );
  });

  it("lit les nouveaux filtres en langage courant et les réécrit à l'identique", () => {
    const f = parseMemberFilters({ deposited: "1", ftd: "7d", inactive: "30", universe: "casino" });
    expect(f).toMatchObject({ deposited: true, ftd: "7d", inactive: 30, universe: "CASINO" });
    expect(filtersToQuery(f)).toBe("?deposited=1&ftd=7d&inactive=30&universe=CASINO");
    expect(parseMemberFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f))))).toEqual(
      f,
    );
  });

  it("ignore les valeurs inconnues ou hors bornes", () => {
    const f = parseMemberFilters({
      deposited: "peut-être",
      ftd: "1y",
      inactive: "0",
      universe: "poker",
      level: "OR",
      sort: "x",
      page: "-2",
    });
    expect(f).toMatchObject({
      deposited: false,
      ftd: "",
      inactive: "",
      universe: "",
      level: "",
      sort: "lastSeen",
      page: 1,
    });
    expect(filtersToQuery(f)).toBe("");
    expect(parseMemberFilters({ inactive: "400" }).inactive).toBe("");
    expect(parseMemberFilters({ inactive: "12" }).inactive).toBe(12);
    expect(parseMemberFilters({ deposited: "true" }).deposited).toBe(true);
  });

  it("prend la première valeur d'un paramètre répété", () => {
    expect(parseMemberFilters({ channelId: ["a", "b"] }).channelId).toBe("a");
  });

  it("lien de liste : revient en page 1 et garde le tri", () => {
    const f = parseMemberFilters({ campaignId: "c1", sort: "name", page: "4" });
    expect(membersHref(f)).toBe("/members?campaignId=c1&sort=name");
    expect(membersHref(f, { page: 2 })).toBe("/members?campaignId=c1&sort=name&page=2");
  });

  it("liste sans filtre : jamais l'adresse nue (elle ramènerait les filtres mémorisés)", () => {
    const f = parseMemberFilters({ universe: "CASINO" });
    expect(membersHref(f, { universe: "" })).toBe("/members?sort=lastSeen");
    expect(
      membersHref(
        parseMemberFilters({ deposited: "1", tag: "vip", sort: "name" }),
        clearedFilters(),
      ),
    ).toBe("/members?sort=name");
    expect(describeMemberFilters(f)[0]!.removeHref).toBe("/members?sort=lastSeen");
    expect(universeChips(f)[0]!.href).toBe("/members?sort=lastSeen");
  });

  it("champs cachés : les autres filtres et le tri, jamais la page ni les champs du formulaire", () => {
    const f = parseMemberFilters({ q: "léa", deposited: "1", sort: "name", page: "2" });
    expect(hiddenFilterFields(f, ["q"])).toEqual([
      ["deposited", "1"],
      ["sort", "name"],
    ]);
    expect(filterEntries(f, { q: "" })).toEqual([
      ["deposited", "1"],
      ["sort", "name"],
      ["page", "2"],
    ]);
  });

  it("compte les filtres actifs (les deux dates d'arrivée n'en font qu'un)", () => {
    expect(activeFilterCount(parseMemberFilters({}))).toBe(0);
    expect(
      activeFilterCount(
        parseMemberFilters({ since: "2026-10-01", until: "2026-10-09", deposited: "1" }),
      ),
    ).toBe(2);
    expect(activeFilterCount(parseMemberFilters({ until: "2026-10-09" }))).toBe(1);
    expect(
      activeFilterCount(parseMemberFilters({ q: "léa", sort: "name", page: "3" }), [
        "channelId",
        "tag",
      ]),
    ).toBe(0);
  });
});

describe("filtres en phrases", () => {
  it("décrit chaque filtre en français simple, avec un lien qui le retire et garde les autres", () => {
    const f = parseMemberFilters({
      deposited: "1",
      campaignId: "c1",
      inviteLinkId: "il1",
      inactive: "7",
      universe: "SPORTS",
      channelId: "ch1",
      status: "APPROVED",
      language: "fr",
      tag: "vip",
      sort: "name",
      page: "2",
    });
    const chips = describeMemberFilters(f, names);
    expect(chips.map((c) => c.label)).toEqual([
      "Ont déposé",
      "Rien fait depuis 7 jours",
      "Univers : Paris sportifs",
      "Venus de la campagne « Casino octobre »",
      "Venus de la pub « TT vidéo 1 »",
      "Canal : Casino VIP",
      "Étiquette : vip",
      "Statut : Accepté",
      "Langue : Français",
    ]);
    const campaign = chips.find((c) => c.key === "campaignId")!;
    const params = new URLSearchParams(campaign.removeHref.split("?")[1]);
    expect(params.get("campaignId")).toBeNull();
    expect(params.get("deposited")).toBe("1");
    expect(params.get("sort")).toBe("name");
    expect(params.get("page")).toBeNull();
  });

  it("premier dépôt, niveau, recherche et dates d'arrivée", () => {
    const f = parseMemberFilters({
      ftd: "month",
      level: "VIP",
      q: "léa",
      since: "2026-10-01",
      until: "2026-10-09",
    });
    const chips = describeMemberFilters(f);
    expect(chips.map((c) => c.label)).toEqual([
      "Recherche : « léa »",
      "Premier dépôt ce mois-ci",
      "Niveau : VIP",
      "Arrivés du 1 oct. 2026 au 9 oct. 2026",
    ]);
    // La pastille des dates retire les deux bornes.
    expect(chips.at(-1)!.removeHref).toBe("/members?q=l%C3%A9a&level=VIP&ftd=month");
    expect(describeMemberFilters(parseMemberFilters({ since: "2026-10-01" }))[0]!.label).toBe(
      "Arrivés depuis le 1 oct. 2026",
    );
    expect(describeMemberFilters(parseMemberFilters({ until: "2026-10-09" }))[0]!.label).toBe(
      "Arrivés jusqu'au 9 oct. 2026",
    );
  });

  it("nom inconnu : la phrase reste lisible", () => {
    const chips = describeMemberFilters(parseMemberFilters({ campaignId: "zz", channelId: "yy" }));
    expect(chips.map((c) => c.label)).toEqual([
      "Venus de la campagne « inconnue »",
      "Canal : inconnu",
    ]);
  });

  it("aucun filtre : aucune pastille", () => {
    expect(describeMemberFilters(parseMemberFilters({ sort: "name", page: "2" }))).toEqual([]);
  });
});

describe("raccourcis", () => {
  it("activité : un clic ajoute le filtre, un second clic le retire", () => {
    const none = activityChips(parseMemberFilters({ campaignId: "c1" }));
    expect(none.map((c) => [c.label, c.selected])).toEqual([
      ["Ont déposé", false],
      ["Premier dépôt ces 7 jours", false],
      ["Rien fait depuis 7 jours", false],
      ["Rien fait depuis 30 jours", false],
    ]);
    expect(none[0]!.href).toBe("/members?campaignId=c1&deposited=1");
    expect(none[1]!.href).toBe("/members?campaignId=c1&ftd=7d");
    expect(none[3]!.href).toBe("/members?campaignId=c1&inactive=30");

    const on = activityChips(parseMemberFilters({ deposited: "1", inactive: "7", page: "3" }));
    expect(on[0]!.selected).toBe(true);
    expect(on[0]!.href).toBe("/members?inactive=7");
    expect(on[2]!.selected).toBe(true);
    expect(on[2]!.href).toBe("/members?deposited=1");
    // Passer de 7 à 30 jours remplace la durée.
    expect(on[3]!.href).toBe("/members?deposited=1&inactive=30");
  });

  it("univers : un seul à la fois, « Tous » retire le filtre", () => {
    const chips = universeChips(parseMemberFilters({ universe: "DATING", tag: "vip" }));
    expect(chips.map((c) => [c.label, c.selected])).toEqual([
      ["Tous", false],
      ["Casino", false],
      ["Paris sportifs", false],
      ["Rencontres", true],
    ]);
    expect(chips[0]!.href).toBe("/members?tag=vip");
    expect(chips[1]!.href).toBe("/members?tag=vip&universe=CASINO");
  });

  it("tri : trois liens, le courant est marqué, les filtres sont gardés", () => {
    const links = sortLinks(parseMemberFilters({ deposited: "1", sort: "name" }));
    expect(links.map((l) => [l.label, l.current])).toEqual([
      ["Dernière activité", false],
      ["Arrivée", false],
      ["Nom", true],
    ]);
    expect(links[0]!.href).toBe("/members?deposited=1");
    expect(links[1]!.href).toBe("/members?deposited=1&sort=firstSeen");
  });
});

describe("lien vers « Écrire à un groupe »", () => {
  const byUniverse = { CASINO: ["ch1", "ch2"], SPORTS: [] };

  it("sans filtre : le formulaire vide", () => {
    expect(broadcastLink(parseMemberFilters({}))).toEqual({
      href: "/members/broadcasts/new",
      dropped: [],
      carried: false,
    });
  });

  it("traduit les filtres en groupe de membres (noms du segment)", () => {
    const l = broadcastLink(
      parseMemberFilters({
        status: "APPROVED",
        inviteLinkId: "il1",
        language: "fr",
        inactive: "7",
        tag: "vip",
        deposited: "1",
        universe: "CASINO",
      }),
      byUniverse,
    );
    const p = new URLSearchParams(l.href.split("?")[1]);
    expect(l.href.startsWith("/members/broadcasts/new?")).toBe(true);
    expect(p.getAll("channelIds")).toEqual(["ch1", "ch2"]);
    expect(p.getAll("membershipStatuses")).toEqual(["APPROVED"]);
    expect(p.getAll("spendLevels")).toEqual(["DEPOSANT", "REGULIER", "VIP"]);
    expect(p.getAll("inviteLinkIds")).toEqual(["il1"]);
    expect(p.getAll("campaignIds")).toEqual([]);
    expect(p.getAll("languages")).toEqual(["fr"]);
    expect(p.get("inactiveDays")).toBe("7");
    expect(p.getAll("tags")).toEqual(["vip"]);
    expect(l.dropped).toEqual([]);
    expect(l.carried).toBe(true);
  });

  it("la campagne est reprise seule ou avec ce qui ne porte pas sur une demande (langue, activité, étiquette, dépôts)", () => {
    const l = broadcastLink(
      parseMemberFilters({
        campaignId: "c1",
        language: "fr",
        inactive: "7",
        tag: "vip",
        deposited: "1",
      }),
      byUniverse,
    );
    const p = new URLSearchParams(l.href.split("?")[1]);
    expect(p.getAll("campaignIds")).toEqual(["c1"]);
    expect(p.getAll("languages")).toEqual(["fr"]);
    expect(p.get("inactiveDays")).toBe("7");
    expect(l.dropped).toEqual([]);
  });

  it("la campagne n'est pas reprise avec un canal, un statut, un univers ou une pub (le groupe les lirait sur la même demande)", () => {
    const status = broadcastLink(
      parseMemberFilters({ campaignId: "c1", status: "APPROVED" }),
      byUniverse,
    );
    const p = new URLSearchParams(status.href.split("?")[1]);
    expect(p.getAll("campaignIds")).toEqual([]);
    expect(p.getAll("membershipStatuses")).toEqual(["APPROVED"]);
    expect(status.carried).toBe(true);
    expect(status.dropped).toEqual(["la campagne, qui ne s'y combine pas avec le statut"]);

    const all = broadcastLink(
      parseMemberFilters({
        campaignId: "c1",
        channelId: "ch9",
        status: "LEFT",
        inviteLinkId: "il1",
        q: "léa",
      }),
      byUniverse,
    );
    expect(new URLSearchParams(all.href.split("?")[1]).getAll("campaignIds")).toEqual([]);
    expect(all.dropped).toEqual([
      "la recherche",
      "la campagne, qui ne s'y combine pas avec le canal, le statut ou la pub",
    ]);

    const universe = broadcastLink(
      parseMemberFilters({ campaignId: "c1", universe: "CASINO" }),
      byUniverse,
    );
    expect(universe.dropped).toEqual(["la campagne, qui ne s'y combine pas avec l'univers"]);
    expect(new URLSearchParams(universe.href.split("?")[1]).getAll("channelIds")).toEqual([
      "ch1",
      "ch2",
    ]);
  });

  it("un univers sans canal ou un statut non repris ne bloque pas la campagne", () => {
    const l = broadcastLink(
      parseMemberFilters({ campaignId: "c1", universe: "SPORTS", status: "DECLINED" }),
      byUniverse,
    );
    const p = new URLSearchParams(l.href.split("?")[1]);
    expect(p.getAll("campaignIds")).toEqual(["c1"]);
    expect(p.getAll("membershipStatuses")).toEqual([]);
    expect(l.dropped).toEqual(["l'univers", "le statut « Refusé »"]);
  });

  it("les statuts que le groupe ne propose pas ne sont pas repris (mêmes statuts que l'assistant)", () => {
    expect([...BROADCAST_STATUSES]).toEqual([...GROUP_STATUSES]);
    for (const status of ["DECLINED", "FAILED"]) {
      const l = broadcastLink(parseMemberFilters({ status }), byUniverse);
      expect(l.carried).toBe(false);
      expect(l.dropped).toHaveLength(1);
      expect(l.dropped[0]).toMatch(/^le statut « .+ »$/);
    }
    expect(broadcastLink(parseMemberFilters({ status: "EXPIRED" }), byUniverse).dropped).toEqual(
      [],
    );
  });

  it("le canal choisi l'emporte sur l'univers ; le niveau l'emporte sur « ont déposé »", () => {
    const l = broadcastLink(
      parseMemberFilters({ channelId: "ch9", universe: "CASINO", level: "VIP", deposited: "1" }),
      byUniverse,
    );
    const p = new URLSearchParams(l.href.split("?")[1]);
    expect(p.getAll("channelIds")).toEqual(["ch9"]);
    expect(p.getAll("spendLevels")).toEqual(["VIP"]);
  });

  it("signale ce qui ne peut pas être repris", () => {
    const l = broadcastLink(
      parseMemberFilters({ q: "léa", ftd: "7d", since: "2026-10-01", universe: "SPORTS" }),
      byUniverse,
    );
    expect(l.href).toBe("/members/broadcasts/new");
    expect(l.carried).toBe(false);
    expect(l.dropped).toEqual([
      "l'univers",
      "la recherche",
      "le premier dépôt",
      "les dates d'arrivée",
    ]);
    expect(joinFr(l.dropped)).toBe(
      "l'univers, la recherche, le premier dépôt et les dates d'arrivée",
    );
    expect(joinFr(["la recherche"])).toBe("la recherche");
    expect(joinFr([])).toBe("");
  });
});

describe("phrase de la liste sur « Écrire à un groupe »", () => {
  const byUniverse = { CASINO: ["ch1"] };
  const note = (sp: Record<string, string>) =>
    broadcastNote(broadcastLink(parseMemberFilters(sp), byUniverse));

  it("rien sans filtre", () => {
    expect(note({})).toBeNull();
  });
  it("tout est repris", () => {
    expect(note({ deposited: "1", universe: "CASINO", tag: "VIP" })).toBe(
      "« Écrire à un groupe » reprend vos filtres.",
    );
  });
  it("une partie est reprise", () => {
    expect(note({ deposited: "1", q: "léa", since: "2026-10-01" })).toBe(
      "« Écrire à un groupe » reprend vos filtres, sauf la recherche et les dates d'arrivée.",
    );
  });
  it("rien n'est repris", () => {
    expect(note({ q: "léa", ftd: "7d" })).toBe(
      "« Écrire à un groupe » ne reprend pas ces filtres : vous choisirez le groupe vous-même.",
    );
    expect(note({ q: "léa" })).toBe(
      "« Écrire à un groupe » ne reprend pas ce filtre : vous choisirez le groupe vous-même.",
    );
  });
});

describe("nom des langues", () => {
  it("en français, avec une majuscule ; le code s'il est inconnu", () => {
    expect(languageName("fr")).toBe("Français");
    expect(languageName("en")).toBe("Anglais");
    expect(languageName("pt-br")).toMatch(/^Portugais/);
    expect(languageName("")).toBe("");
    expect(languageName(null)).toBe("");
    expect(languageName("zz-not a code")).toBe("zz-not a code");
  });
});
