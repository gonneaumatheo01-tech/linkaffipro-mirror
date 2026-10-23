import { describe, expect, it } from "vitest";
import { abTestsToConclude, type AbPostRow } from "./ab";

const now = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const post = (
  groupId: string,
  variant: "A" | "B",
  sentHoursAgo: number | null,
  stats: Partial<NonNullable<AbPostRow["stats"]>> = {},
  title = "Casino VIP",
): AbPostRow => ({
  abGroupId: groupId,
  abVariant: variant,
  status: sentHoursAgo === null ? "SCHEDULED" : "SENT",
  sentAt: sentHoursAgo === null ? null : hoursAgo(sentHoursAgo),
  channel: { title },
  stats: { views: 0, clicks: 0, uniqueClickers: 0, reactionsTotal: 0, ...stats },
});

describe("tests A/B à conclure", () => {
  it("gagnante ou égalité, entre 24 h et 7 jours après la dernière version", () => {
    const out = abTestsToConclude(
      [
        // g1 : B gagne (plus de cliqueurs uniques), parti il y a 2 jours.
        post("g1", "A", 49, { clicks: 3, uniqueClickers: 2 }),
        post("g1", "B", 48, { clicks: 9, uniqueClickers: 7 }),
        // g2 : égalité, parti il y a 30 h.
        post("g2", "A", 30, { clicks: 4, uniqueClickers: 4 }, "Foot"),
        post("g2", "B", 30, { clicks: 4, uniqueClickers: 4 }, "Foot"),
        // g3 : trop récent (B parti il y a 3 h).
        post("g3", "A", 4, { clicks: 5, uniqueClickers: 5 }),
        post("g3", "B", 3, { clicks: 1, uniqueClickers: 1 }),
        // g4 : trop ancien (8 jours).
        post("g4", "A", 8 * 24, { clicks: 5, uniqueClickers: 5 }),
        post("g4", "B", 8 * 24, { clicks: 1, uniqueClickers: 1 }),
        // g5 : B pas encore parti.
        post("g5", "A", 40, { clicks: 5, uniqueClickers: 5 }),
        post("g5", "B", null),
        // g6 : aucun clic ni réaction : rien à conclure.
        post("g6", "A", 40),
        post("g6", "B", 40),
      ],
      now,
    );
    expect(out).toEqual([
      { groupId: "g2", channelTitle: "Foot", winner: null },
      { groupId: "g1", channelTitle: "Casino VIP", winner: "B" },
    ]);
  });

  it("taux de clic quand les vues sont connues", () => {
    const out = abTestsToConclude(
      [
        post("g", "A", 30, { views: 100, clicks: 10, uniqueClickers: 10 }),
        post("g", "B", 30, { views: 1000, clicks: 20, uniqueClickers: 20 }),
      ],
      now,
    );
    expect(out[0]!.winner).toBe("A");
  });
});

describe("tests de l'équipe Algorithme", () => {
  it("un groupe exp_… n'est jamais proposé à conclure", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const row = (variant: string) => ({
      id: variant,
      abGroupId: "exp_abc",
      abVariant: variant,
      status: "SENT",
      sentAt: new Date("2026-10-10T12:00:00Z"),
      channel: { title: "Test" },
      stats: { views: 5000, clicks: 300, uniqueClickers: 300, reactionsTotal: 10 },
    });
    expect(abTestsToConclude([row("A"), row("B")] as never, now)).toEqual([]);
  });
});

