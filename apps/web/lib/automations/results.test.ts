import { describe, expect, it } from "vitest";
import {
  EMPTY_RESULTS,
  hasResults,
  playerCommission,
  resultsParts,
  resultsSentence,
  resultsSince,
  resultsSinceLabel,
  resultsSinceNote,
  ruleResults,
  showsAttribution,
} from "./results";

describe("résultats d'une relance", () => {
  it("commission d'un joueur : somme de ses événements de commission (annulation retirée)", () => {
    expect(playerCommission({ commissionEvents: [50, -50] })).toBe(0);
    expect(playerCommission({ commissionEvents: [70] })).toBe(70);
    expect(playerCommission({ commissionEvents: [] })).toBe(0);
  });

  it("envoyés, clics, inscriptions, premiers dépôts et gains par relance ; relance sans rien = zéros", () => {
    const d = new Date("2026-10-11T10:00:00Z");
    const after = new Date("2026-10-11T11:00:00Z");
    const r = ruleResults(["r1", "r2"], {
      sent: [{ ruleId: "r1", count: 12 }],
      firstSends: [
        { ruleId: "r1", memberId: "a", at: d },
        { ruleId: "r1", memberId: "b", at: d },
        { ruleId: "r1", memberId: "c", at: d },
        { ruleId: "r1", memberId: "e", at: d },
        { ruleId: "ailleurs", memberId: "z", at: d },
      ],
      clicks: [
        { ruleId: "r1", memberId: "a", at: after },
        { ruleId: "r1", memberId: "a", at: after },
        { ruleId: "r1", memberId: "b", at: after },
        { ruleId: "r1", memberId: "c", at: d },
        { ruleId: "ailleurs", memberId: "z", at: after },
      ],
      players: [
        { ruleId: "r1", clickMemberId: "a", clickAt: after, ftdAt: d, commissionEvents: [50] },
        { ruleId: "r1", clickMemberId: "b", clickAt: after, ftdAt: null, commissionEvents: [] },
        {
          ruleId: "r1",
          clickMemberId: "c",
          clickAt: d,
          ftdAt: d,
          commissionEvents: [45.5, -45.5],
        },
        {
          ruleId: "r1",
          clickMemberId: "e",
          clickAt: after,
          ftdAt: d,
          commissionEvents: [0.1, 0.2],
        },
      ],
    });
    expect(r.r1).toEqual({
      sent: 12,
      clicks: 4,
      clickers: 3,
      registrations: 4,
      ftds: 3,
      commissions: 50.3,
      gains: 50.3,
    });
    expect(r.r2).toEqual(EMPTY_RESULTS);
    expect(r.ailleurs).toBeUndefined();
    expect(hasResults(r.r1)).toBe(true);
    expect(hasResults(r.r2)).toBe(false);
  });

  it("« Tester sur moi » : les clics et joueurs d'un membre qui n'a reçu la relance qu'en essai ne comptent pas", () => {
    const sentAt = new Date("2026-10-11T10:00:00Z");
    const r = ruleResults(["r1"], {
      sent: [{ ruleId: "r1", count: 0 }],
      // L'admin n'a reçu que des essais : aucun envoi réel à son nom.
      firstSends: [],
      clicks: [
        { ruleId: "r1", memberId: "admin", at: sentAt },
        { ruleId: "r1", memberId: "admin", at: sentAt },
      ],
      players: [
        {
          ruleId: "r1",
          clickMemberId: "admin",
          clickAt: sentAt,
          ftdAt: sentAt,
          commissionEvents: [50],
        },
      ],
    });
    expect(r.r1).toEqual(EMPTY_RESULTS);
  });

  it("clic d'avant l'envoi réel (pendant un essai) : pas compté ; clic sans membre : pas compté", () => {
    const sentAt = new Date("2026-10-11T10:00:00Z");
    const r = ruleResults(["r1"], {
      sent: [{ ruleId: "r1", count: 1 }],
      firstSends: [{ ruleId: "r1", memberId: "admin", at: sentAt }],
      clicks: [
        { ruleId: "r1", memberId: "admin", at: new Date("2026-10-11T09:59:00Z") },
        { ruleId: "r1", memberId: null, at: new Date("2026-10-11T10:05:00Z") },
        { ruleId: "r1", memberId: "admin", at: new Date("2026-10-11T10:05:00Z") },
      ],
      players: [],
    });
    expect(r.r1).toMatchObject({ sent: 1, clicks: 1, clickers: 1 });
  });

  it("boutons Offre à montrer : relance avec un bouton Offre, ou des clics, joueurs ou gains déjà venus", () => {
    expect(showsAttribution(EMPTY_RESULTS, true)).toBe(true);
    expect(showsAttribution(EMPTY_RESULTS, false)).toBe(false);
    expect(showsAttribution({ ...EMPTY_RESULTS, sent: 40 }, false)).toBe(false);
    expect(showsAttribution({ ...EMPTY_RESULTS, clicks: 1 }, false)).toBe(true);
    expect(showsAttribution({ ...EMPTY_RESULTS, registrations: 1 }, false)).toBe(true);
    expect(showsAttribution({ ...EMPTY_RESULTS, commissions: -5 }, false)).toBe(true);
  });
});

describe("période comptée des résultats", () => {
  const start = new Date("2026-10-11T14:00:00Z");
  it("relance créée avant le suivi par relance : comptée depuis cette date ; sinon depuis le début", () => {
    expect(resultsSince(new Date("2026-09-01T10:00:00Z"), start)).toEqual(start);
    expect(resultsSince(new Date("2026-10-11T15:00:00Z"), start)).toBeNull();
    expect(resultsSince(new Date("2026-09-01T10:00:00Z"), null)).toBeNull();
  });
  it("libellés en français (date de Paris)", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(resultsSinceLabel(null, now)).toBe("Depuis le début");
    expect(resultsSinceLabel(start, now)).toBe("Depuis le 11 oct.");
    expect(resultsSinceNote(null, now)).toBeNull();
    expect(resultsSinceNote(start, now)).toBe(
      "Les messages envoyés avant le 11 oct. ne sont pas comptés.",
    );
  });
});

describe("résultats d'une relance en une ligne", () => {
  const money = (n: number) => `${n} €`;
  it("singulier et pluriel, gains avec le format de l'écran", () => {
    expect(
      resultsSentence(
        { ...EMPTY_RESULTS, sent: 1, clicks: 1, registrations: 1, ftds: 1, gains: 50 },
        money,
      ),
    ).toBe("1 envoyé · 1 clic · 1 inscription · 1 premier dépôt · 50 € de gains");
    expect(
      resultsSentence(
        { ...EMPTY_RESULTS, sent: 1200, clicks: 7, registrations: 4, ftds: 3, gains: -10 },
        money,
      ),
    ).toBe("1\u202f200 envoyés · 7 clics · 4 inscriptions · 3 premiers dépôts · -10 € de gains");
    expect(resultsParts(EMPTY_RESULTS, money)[0]).toEqual({ figure: "0", words: "envoyé" });
  });
  it("relance sans bouton Offre : les envoyés seulement (pas de zéros qui ne bougeront jamais)", () => {
    const r = { ...EMPTY_RESULTS, sent: 12 };
    expect(resultsSentence(r, money, { attribution: false })).toBe("12 envoyés");
    expect(resultsParts(r, money, { attribution: true })).toHaveLength(5);
  });
});
