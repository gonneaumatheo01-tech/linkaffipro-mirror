import { describe, expect, it } from "vitest";
import { alertKindLabel } from "@linkaffipro/core";
import { detectAgentsTeamPaused, formatAlert } from "./alert-rules";

describe("alerte « équipe d'agents mise en pause » (phase 19)", () => {
  it("seulement une pause automatique (3 échecs de suite)", () => {
    expect(detectAgentsTeamPaused([{ label: "Dating", paused: true, consecutiveFailures: 0, pausedReason: "pause demandée" }])).toBeNull();
    expect(detectAgentsTeamPaused([{ label: "Dating", paused: false, consecutiveFailures: 3, pausedReason: null }])).toBeNull();
    const d = detectAgentsTeamPaused([{ label: "Dating", paused: true, consecutiveFailures: 3, pausedReason: "3 missions échouées de suite" }]);
    expect(d).toMatchObject({ kind: "agents_team_paused", severity: "WARNING", payload: { teams: ["Dating"] } });
    expect(d!.message).toContain("L'équipe d'agents Dating est en pause");
  });
  it("libellé en français, jamais le code", () => {
    expect(alertKindLabel("agents_team_paused")).toBe("Équipe d'agents mise en pause");
    const d = detectAgentsTeamPaused([
      { label: "Dating", paused: true, consecutiveFailures: 3, pausedReason: null },
      { label: "Casino", paused: true, consecutiveFailures: 4, pausedReason: null },
    ])!;
    expect(d.message).toContain("Les équipes d'agents Dating, Casino sont");
    expect(formatAlert(d)).not.toContain("agents_team_paused");
  });
});
