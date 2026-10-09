import { describe, expect, it } from "vitest";
import { isEventRetained, isPurgeable, lastActivity, parseRetentionMonths, retentionCutoff } from "./retention";

describe("rétention", () => {
  it("lit le réglage avec repli et plancher", () => {
    expect(parseRetentionMonths(undefined)).toBe(24);
    expect(parseRetentionMonths("12")).toBe(12);
    expect(parseRetentionMonths(3)).toBe(6);
    expect(parseRetentionMonths("abc")).toBe(24);
    expect(parseRetentionMonths(36.7)).toBe(36);
  });
  it("calcule le seuil N mois en arrière", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(retentionCutoff(24, now).toISOString()).toBe("2024-10-09T12:00:00.000Z");
    expect(retentionCutoff(6, now).toISOString()).toBe("2026-04-09T12:00:00.000Z");
  });
  it("prend la date d'activité la plus récente", () => {
    const a = { lastSeenAt: new Date("2024-01-01"), lastMembershipAt: new Date("2025-06-01"), lastClickAt: null, lastOutboundAt: new Date("2025-01-01"), anonymizedAt: null };
    expect(lastActivity(a)?.toISOString()).toBe("2025-06-01T00:00:00.000Z");
    expect(lastActivity({ lastSeenAt: null, lastMembershipAt: null, lastClickAt: null, lastOutboundAt: null, anonymizedAt: null })).toBeNull();
  });
  it("décide de la purge", () => {
    const cutoff = new Date("2024-10-09T00:00:00Z");
    const base = { lastMembershipAt: null, lastClickAt: null, lastOutboundAt: null, anonymizedAt: null };
    expect(isPurgeable({ ...base, lastSeenAt: new Date("2024-01-01") }, cutoff)).toBe(true);
    expect(isPurgeable({ ...base, lastSeenAt: new Date("2025-01-01") }, cutoff)).toBe(false);
    expect(isPurgeable({ ...base, lastSeenAt: new Date("2024-01-01"), lastClickAt: new Date("2025-03-01") }, cutoff)).toBe(false);
    expect(isPurgeable({ ...base, lastSeenAt: new Date("2024-01-01"), anonymizedAt: new Date("2024-02-01") }, cutoff)).toBe(false);
    expect(isPurgeable({ ...base, lastSeenAt: null }, cutoff)).toBe(true);
  });
  it("conserve les événements joueurs", () => {
    expect(isEventRetained("player.ftd")).toBe(true);
    expect(isEventRetained("telegram.message")).toBe(false);
  });
});
