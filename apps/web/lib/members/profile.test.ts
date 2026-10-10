import { describe, expect, it } from "vitest";
import {
  adLabel,
  initials,
  memberProfile,
  memberReach,
  memberSubline,
  plural,
  quickViewChannels,
  type ProfileMembership,
} from "./profile";

const t = (iso: string) => new Date(iso);

const casino = { id: "ch1", title: "Casino VIP", vertical: "CASINO" };
const sports = { id: "ch2", title: "Pronos foot", vertical: "SPORTS" };

// Ordre de la fiche : de la plus récente à la plus ancienne.
const memberships: ProfileMembership[] = [
  {
    status: "REQUESTED",
    requestedAt: t("2026-10-05T10:00:00Z"),
    channel: sports,
    inviteLink: null,
  },
  {
    status: "LEFT",
    requestedAt: t("2026-10-03T10:00:00Z"),
    approvedAt: t("2026-10-03T10:05:00Z"),
    joinedAt: t("2026-10-03T10:06:00Z"),
    leftAt: t("2026-10-04T10:00:00Z"),
    channel: casino,
    inviteLink: null,
  },
  {
    status: "APPROVED",
    requestedAt: t("2026-10-01T10:00:00Z"),
    approvedAt: t("2026-10-01T10:05:00Z"),
    channel: casino,
    inviteLink: {
      name: "Lien TT 1",
      adName: "Vidéo bonus",
      adPlatform: "TIKTOK",
      campaign: { id: "c1", name: "Casino octobre", vertical: "DATING" },
      offerName: "Celsius",
    },
  },
];

describe("l'essentiel d'un membre", () => {
  it("d'où il vient : sa première demande (campagne, pub, canal, univers de la campagne)", () => {
    const p = memberProfile({
      memberships,
      players: [],
      offerClicks: 0,
      botStates: [],
      lastSeenAt: t("2026-10-06T00:00:00Z"),
    });
    expect(p.origin).toEqual({
      at: t("2026-10-01T10:00:00Z"),
      channelId: "ch1",
      channelTitle: "Casino VIP",
      universe: "DATING",
      campaign: { id: "c1", name: "Casino octobre" },
      adName: "Vidéo bonus",
      adPlatform: "TIKTOK",
      linkName: "Lien TT 1",
      offerName: "Celsius",
    });
  });

  it("sans campagne : l'univers du canal ; sans demande : pas d'origine", () => {
    const p = memberProfile({
      memberships: [memberships[0]!],
      players: [],
      offerClicks: 0,
      botStates: [],
      lastSeenAt: t("2026-10-06T00:00:00Z"),
    });
    expect(p.origin?.universe).toBe("SPORTS");
    expect(p.origin?.campaign).toBeNull();
    expect(
      memberProfile({
        memberships: [],
        players: [],
        offerClicks: 0,
        botStates: [],
        lastSeenAt: t("2026-10-06T00:00:00Z"),
      }).origin,
    ).toBeNull();
  });

  it("ce qu'il a fait : demandes, entrées, canaux où il est encore, clics d'offre, dernière activité", () => {
    const p = memberProfile({
      memberships,
      players: [],
      offerClicks: 4,
      botStates: [],
      lastSeenAt: t("2026-10-06T00:00:00Z"),
      lastPlayerEventAt: t("2026-10-07T00:00:00Z"),
    });
    expect(p.activity).toEqual({
      requests: 3,
      entries: 2,
      currentChannels: 1,
      offerClicks: 4,
      lastActivityAt: t("2026-10-07T00:00:00Z"),
    });
  });

  it("combien il a déposé : premiers dépôts, dépôts, revenu net (somme des comptes joueurs)", () => {
    const p = memberProfile({
      memberships,
      players: [
        {
          ftdAt: t("2026-10-04T00:00:00Z"),
          ftdAmount: 50,
          depositCount: 3,
          depositTotal: 150,
          ngr: 40.5,
        },
        {
          ftdAt: t("2026-10-02T00:00:00Z"),
          ftdAmount: 20,
          depositCount: 1,
          depositTotal: 20,
          ngr: -5,
        },
        { ftdAt: null, ftdAmount: null, depositCount: 0, depositTotal: 0, ngr: 0 },
      ],
      offerClicks: 0,
      botStates: [],
      lastSeenAt: t("2026-10-08T00:00:00Z"),
      lastPlayerEventAt: t("2026-10-07T00:00:00Z"),
    });
    expect(p.money).toEqual({
      players: 3,
      ftdCount: 2,
      firstFtdAt: t("2026-10-02T00:00:00Z"),
      firstFtdAmount: 20,
      depositCount: 4,
      depositTotal: 170,
      ngr: 35.5,
    });
    expect(p.activity.lastActivityAt).toEqual(t("2026-10-08T00:00:00Z"));
  });
});

describe("joignable par le bot", () => {
  it("joignable dès qu'un bot peut lui écrire", () => {
    expect(
      memberReach([
        { canDm: false, blockedAt: t("2026-10-01T00:00:00Z"), bot: { username: "a_bot" } },
        { canDm: true, blockedAt: null, bot: { username: "b_bot" } },
      ]),
    ).toEqual({
      tone: "success",
      label: "Joignable par le bot",
      reachableBy: ["b_bot"],
      blockedBy: ["a_bot"],
    });
  });
  it("a bloqué tous les bots ; n'a jamais écrit au bot", () => {
    expect(
      memberReach([
        { canDm: false, blockedAt: t("2026-10-01T00:00:00Z"), bot: { username: "a_bot" } },
      ]).label,
    ).toBe("A bloqué le bot");
    expect(memberReach([]).label).toBe("Pas joignable en privé");
    expect(memberReach([{ canDm: false, blockedAt: null, bot: { username: "a_bot" } }]).tone).toBe(
      "muted",
    );
  });
});

describe("petits textes", () => {
  it("initiales", () => {
    expect(initials("Léa Martin")).toBe("LM");
    expect(initials("@lea_m")).toBe("LM");
    expect(initials("yanis")).toBe("Y");
    expect(initials("Membre anonymisé")).toBe("MA");
    expect(initials("")).toBe("?");
  });
  it("pluriels", () => {
    expect(plural(0, "clic")).toBe("0 clic");
    expect(plural(1, "demande")).toBe("1 demande");
    expect(plural(3, "demande")).toBe("3 demandes");
    expect(plural(2, "canal", "canaux")).toBe("2 canaux");
  });
});

describe("lignes d'identité et d'origine", () => {
  it("pseudo et langue", () => {
    expect(memberSubline({ username: "lea_m", languageCode: "fr" })).toBe("@lea_m · Français");
    expect(memberSubline({ username: null, languageCode: "en" })).toBe("Anglais");
    expect(memberSubline({ username: null, languageCode: null })).toBe("");
  });
  it("pub d'origine : nom de la pub et plateforme, sinon nom du lien", () => {
    expect(adLabel({ adName: "Vidéo bonus", adPlatform: "TIKTOK", linkName: "Lien 1" })).toBe(
      "Vidéo bonus (TikTok)",
    );
    expect(adLabel({ adName: null, adPlatform: null, linkName: "Lien 1" })).toBe("Lien 1");
    expect(adLabel({ adName: null, adPlatform: "META", linkName: null })).toBeNull();
  });
});

describe("canaux du volet de résumé : chaque canal une seule fois", () => {
  const origin = { channelTitle: "Rencontres Lyon" };
  it("un seul canal : il n'apparaît que dans « D'où il vient »", () => {
    expect(
      quickViewChannels({
        channels: ["Rencontres Lyon"],
        statusChannel: "Rencontres Lyon",
        origin,
      }),
    ).toEqual({ statusChannel: null, others: [] });
  });
  it("plusieurs canaux : le canal du statut sous le statut, les autres à part", () => {
    expect(
      quickViewChannels({
        channels: ["Pronos foot", "Casino VIP", "Rencontres Lyon"],
        statusChannel: "Pronos foot",
        origin,
      }),
    ).toEqual({ statusChannel: "Pronos foot", others: ["Casino VIP"] });
    expect(
      quickViewChannels({
        channels: ["Pronos foot", "Rencontres Lyon"],
        statusChannel: "Pronos foot",
        origin,
      }),
    ).toEqual({ statusChannel: "Pronos foot", others: [] });
  });
  it("sans demande pour rejoindre : rien à afficher", () => {
    expect(quickViewChannels({ channels: [], statusChannel: null, origin: null })).toEqual({
      statusChannel: null,
      others: [],
    });
  });
});
