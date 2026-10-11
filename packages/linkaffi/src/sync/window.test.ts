import { describe, expect, it } from "vitest";
import { computeWindow, cursorAfterPage, cursorAfterSuccess, OVERLAP_MS, SYNC_TABLES, windowQuery } from "./window";

const now = new Date("2026-10-09T12:00:00.000Z");

describe("fenêtre incrémentale", () => {
  it("relit tout l'historique sans curseur", () => {
    const w = computeWindow("updated_at", {}, now);
    expect(w).toEqual({ from: undefined, to: now.toISOString(), dateCol: "updated_at", offset: 0 });
    expect(windowQuery(w)).toEqual({ date_col: "updated_at", order: "updated_at", to: "2026-10-09" });
  });
  it("recule de 15 minutes par rapport au dernier succès", () => {
    const w = computeWindow("updated_at", { since: "2026-10-09T11:00:00.000Z" }, now);
    expect(new Date(w.from!).getTime()).toBe(new Date("2026-10-09T11:00:00.000Z").getTime() - OVERLAP_MS);
    expect(windowQuery(w)).toEqual({ date_col: "updated_at", order: "updated_at", from: "2026-10-09", to: "2026-10-09" });
  });
  it("reprend une fenêtre interrompue à son offset avec sa borne figée", () => {
    const w = computeWindow("created_at", { since: "2026-10-01T00:00:00.000Z", until: "2026-10-09T11:30:00.000Z", offset: 10000 }, now);
    expect(w.to).toBe("2026-10-09T11:30:00.000Z");
    expect(w.offset).toBe(10000);
  });
  it("force la resynchro complète", () => {
    expect(computeWindow("updated_at", { since: "2026-10-09T11:00:00.000Z" }, now, true).from).toBeUndefined();
  });
  it("relit entièrement une table sans colonne de date", () => {
    const w = computeWindow(null, { since: "2026-10-09T11:00:00.000Z" }, now);
    expect(w.from).toBeUndefined();
    expect(windowQuery(w)).toEqual({});
  });
  it("fait avancer le curseur", () => {
    const w = computeWindow("updated_at", { since: "2026-10-09T11:00:00.000Z" }, now);
    expect(cursorAfterPage({ since: "2026-10-09T11:00:00.000Z" }, w, 5000)).toEqual({ since: "2026-10-09T11:00:00.000Z", until: now.toISOString(), offset: 5000 });
    expect(cursorAfterSuccess(w)).toEqual({ since: now.toISOString() });
  });
  it("liste les tables dans l'ordre attendu", () => {
    expect(SYNC_TABLES.map((t) => t.table)).toEqual(["casinos", "campaigns", "currency_rates", "players", "player_events", "player_financials", "revshare_snapshots", "deposit_snapshots", "ftd_invalidations", "clicks", "stats"]);
  });
});
