import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { visibleText } from "@/app/(admin)/settings/categories/page-checks";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";

// Carte « Agents » de l'État du système (phase 25) : files, Grand Chef, missions bloquées à relancer, fournisseurs.
const m = vi.hoisted(() => ({ overviewOk: true }));

vi.mock("@/app/(admin)/settings/status/actions", () => ({ resumeAgentMissionsAction: vi.fn() }));
vi.mock("@/lib/agents/system-status", () => ({
  cycleLate: (d: Date | null, now: Date) => !d || now.getTime() - d.getTime() > 3_600_000,
  loadAgentsSystemStatus: vi.fn(async () => ({
    queues: [{ name: "agents-orchestrator", label: "Grand Chef", waiting: 1, active: 0, delayed: 0, failed: 0 }],
    queuesError: null,
    lastCycleAt: new Date("2026-10-24T05:00:00Z"),
    stuck: [{ id: "m1", teamKey: "casino", status: "RUNNING", channelTitle: "Canal Test", reason: "En cours sans activité depuis 40 min" }],
    stuckTotal: 1,
  })),
}));
vi.mock("@/lib/agents/overview", () => ({
  loadAgentsOverview: vi.fn(async () =>
    m.overviewOk
      ? {
          ok: true,
          overview: {
            health: {
              lastGrandChefAt: "2026-10-24T07:45:00Z",
              stuckMissions: 1,
              providers: [
                { key: "fal", label: "fal.ai", keyPresent: true, lastOkAt: "2026-10-24T07:00:00Z", errors24h: 2 },
                { key: "odds", label: "Cotes sportives", keyPresent: false, lastOkAt: null, errors24h: 0 },
              ],
            },
          },
        }
      : { ok: false, error: "moteur muet" },
  ),
}));

import { SystemAgentsCard } from "./system-agents-card";

const now = new Date("2026-10-24T08:00:00Z");

describe("carte Agents de l'État du système", () => {
  it("dernier passage du Grand Chef du résumé, relance des missions bloquées, fournisseurs", async () => {
    m.overviewOk = true;
    const text = visibleText(renderToStaticMarkup(await SystemAgentsCard({ now })));
    expect(jargonIn(text)).toEqual([]);
    for (const t of ["Grand Chef", "1 mission bloquée", "Relancer les missions bloquées", "Fournisseurs", "fal.ai", "2 erreurs en 24 h", "Clé absente", "À voir"])
      expect(text, t).toContain(t);
    expect(text).not.toContain("plus d'une heure sans passage");
  });

  it("résumé indisponible : la carte reste lisible", async () => {
    m.overviewOk = false;
    const text = visibleText(renderToStaticMarkup(await SystemAgentsCard({ now })));
    expect(text).toContain("État des fournisseurs illisible");
    expect(text).toContain("Relancer les missions bloquées");
  });
});
