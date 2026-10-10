import { describe, expect, it } from "vitest";
import { counterSentence, counterSince, firstSendAt, isTestRun, weeklyCounters } from "./counter";

const now = new Date("2026-10-10T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
const entry = (type: string, at: Date, ok = true) => ({ step: 0, type, at: at.toISOString(), ok });

describe("compteur des cartes", () => {
  it("fenêtre : 7 jours glissants", () => {
    expect(counterSince(now).toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });

  it("premier message remis au membre (messages, message du bot, canal proposé), réussi et dans la fenêtre", () => {
    const since = counterSince(now);
    expect(firstSendAt([entry("wait", ago(30)), entry("send_message", ago(5))], since)).toEqual(
      ago(5),
    );
    expect(
      firstSendAt([entry("send_sequence", ago(2)), entry("suggest_channel", ago(3))], since),
    ).toEqual(ago(3));
    expect(firstSendAt([entry("send_message", ago(5), false)], since)).toBeNull();
    expect(firstSendAt([entry("tag", ago(5)), entry("notify_team", ago(5))], since)).toBeNull();
    expect(firstSendAt([entry("send_message", ago(8 * 24))], since)).toBeNull();
    expect(firstSendAt("n'importe quoi", since)).toBeNull();
    expect(
      firstSendAt([null, { type: "send_message", ok: true, at: "pas une date" }], since),
    ).toBeNull();
  });

  it("compte les membres distincts, puis ceux qui ont cliqué après leur message", () => {
    const runs = [
      { ruleId: "r1", memberId: "m1", context: {}, log: [entry("send_message", ago(48))] },
      // Même membre, deuxième exécution : compté une fois, à son premier message.
      { ruleId: "r1", memberId: "m1", context: {}, log: [entry("send_message", ago(10))] },
      { ruleId: "r1", memberId: "m2", context: {}, log: [entry("send_message", ago(20))] },
      // En attente, rien envoyé encore.
      { ruleId: "r1", memberId: "m3", context: {}, log: [entry("wait", ago(1))] },
      // Essai « Tester sur moi » : ignoré.
      {
        ruleId: "r1",
        memberId: "m4",
        context: { test: true },
        log: [entry("send_message", ago(1))],
      },
      { ruleId: "r2", memberId: "m2", context: {}, log: [entry("send_message", ago(30))] },
    ];
    const clicks = [
      { memberId: "m1", createdAt: ago(40) }, // après son premier message (48 h)
      { memberId: "m2", createdAt: ago(25) }, // avant son message de r1 (20 h), après celui de r2 (30 h)
      { memberId: "m4", createdAt: ago(0.5) },
      { memberId: null, createdAt: ago(1) },
    ];
    expect(weeklyCounters(runs, clicks, now)).toEqual({
      r1: { sent: 2, clicked: 1 },
      r2: { sent: 1, clicked: 1 },
    });
  });

  it("essais reconnus par leur contexte", () => {
    expect(isTestRun({ test: true })).toBe(true);
    expect(isTestRun({ test: "true" })).toBe(false);
    expect(isTestRun(null)).toBe(false);
  });

  it("phrase en français, pluriels compris", () => {
    expect(counterSentence(undefined)).toBe("Rien envoyé ces 7 derniers jours.");
    expect(counterSentence({ sent: 0, clicked: 0 })).toBe("Rien envoyé ces 7 derniers jours.");
    expect(counterSentence({ sent: 1, clicked: 0 })).toBe(
      "Envoyé à 1 personne cette semaine, personne n'a cliqué.",
    );
    expect(counterSentence({ sent: 1, clicked: 1 })).toBe(
      "Envoyé à 1 personne cette semaine, 1 a cliqué.",
    );
    expect(counterSentence({ sent: 1240, clicked: 37 })).toBe(
      "Envoyé à 1 240 personnes cette semaine, 37 ont cliqué.",
    );
  });
});
