import { describe, expect, it } from "vitest";
import { heartbeatAgeSec, isWorkerDown, parseHeartbeat, type Heartbeat } from "./monitoring";

const now = new Date("2026-10-09T12:00:00Z");
const hb = (secAgo: number): Heartbeat => ({ at: new Date(now.getTime() - secAgo * 1000).toISOString(), version: "0.0.1", startedAt: "2026-10-09T10:00:00Z", pid: 1 });

describe("battement de cœur du worker", () => {
  it("calcule l'âge et détecte l'arrêt au-delà de 3 minutes", () => {
    expect(heartbeatAgeSec(null, now)).toBeNull();
    expect(heartbeatAgeSec(hb(45), now)).toBe(45);
    expect(isWorkerDown(hb(45), now)).toBe(false);
    expect(isWorkerDown(hb(181), now)).toBe(true);
    expect(isWorkerDown(null, now)).toBe(true);
  });
  it("lit un JSON valide et ignore le reste", () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat("{pas du json")).toBeNull();
    expect(parseHeartbeat(JSON.stringify({ at: "n'importe quoi" }))).toBeNull();
    expect(parseHeartbeat(JSON.stringify(hb(0)))?.version).toBe("0.0.1");
  });
});
