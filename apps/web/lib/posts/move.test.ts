import { describe, expect, it } from "vitest";
import { checkMove, siblingMoves } from "./move";

const NOW = new Date("2026-10-09T12:00:00Z"); // vendredi 14:00 à Paris
const scheduled = {
  status: "SCHEDULED" as const,
  isTemplate: false,
  scheduledAt: new Date("2026-10-10T08:00:00Z"),
};

describe("déplacer un message : contrôles", () => {
  it("accepte un message programmé ou un brouillon vers un moment à venir (heure de Paris)", () => {
    const r = checkMove(scheduled, "2026-10-12T19:30", NOW);
    expect(r).toEqual({ ok: true, at: new Date("2026-10-12T17:30:00.000Z") });
    expect(
      checkMove({ ...scheduled, status: "DRAFT", scheduledAt: null }, "2026-10-12T19:30", NOW).ok,
    ).toBe(true);
  });
  it("refuse un message déjà parti, en cours d'envoi ou supprimé", () => {
    for (const status of ["SENT", "SENDING", "DELETED"] as const) {
      const r = checkMove({ ...scheduled, status }, "2026-10-12T19:30", NOW);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/part/);
    }
  });
  it("refuse un message annulé ou en échec (à reprogrammer par le formulaire) et un modèle", () => {
    expect(checkMove({ ...scheduled, status: "CANCELLED" }, "2026-10-12T19:30", NOW).ok).toBe(
      false,
    );
    expect(checkMove({ ...scheduled, status: "FAILED" }, "2026-10-12T19:30", NOW).ok).toBe(false);
    const tpl = checkMove(
      { ...scheduled, status: "DRAFT", isTemplate: true },
      "2026-10-12T19:30",
      NOW,
    );
    expect(!tpl.ok && tpl.error).toMatch(/modèle/);
  });
  it("refuse une date passée (au-delà d'une minute) ou illisible", () => {
    const past = checkMove(scheduled, "2026-10-09T13:00", NOW);
    expect(!past.ok && past.error).toMatch(/passé/);
    expect(checkMove(scheduled, "2026-10-09T13:59", NOW).ok).toBe(true);
    expect(checkMove(scheduled, "2026-13-40T10:00", NOW).ok).toBe(false);
    expect(checkMove(scheduled, "demain", NOW).ok).toBe(false);
  });
  it("message introuvable", () => {
    expect(checkMove(null, "2026-10-12T19:30", NOW).ok).toBe(false);
  });
});

describe("test A/B : l'autre version suit du même écart", () => {
  const b = {
    id: "b",
    status: "SCHEDULED" as const,
    scheduledAt: new Date("2026-10-10T08:30:00Z"),
  };
  it("décale la version B du même écart que A", () => {
    const r = siblingMoves([b], 2 * 3_600_000, NOW);
    expect(r).toEqual({
      ok: true,
      moves: [
        { id: "b", status: "SCHEDULED", from: b.scheduledAt, to: new Date("2026-10-10T10:30:00Z") },
      ],
    });
  });
  it("une version déjà partie ne bouge pas", () => {
    const r = siblingMoves([{ ...b, status: "SENT" }], 3_600_000, NOW);
    expect(r).toEqual({ ok: true, moves: [] });
  });
  it("refuse si l'autre version tomberait dans le passé", () => {
    const r = siblingMoves([b], -25 * 3_600_000, NOW);
    expect(r.ok).toBe(false);
  });
});
