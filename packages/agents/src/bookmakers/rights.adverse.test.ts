/** Relecture adverse de la phase 35 : identifiants des bookmakers et test des sites réservés à l'admin. */
import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { teamAdminOnlyRequest } from "../human/delivery";
import { adminOnlyOrder } from "../orders/recap";
import { askBookmakerCredentials } from "./credentials";

describe("relecture adverse : droits", () => {
  it("les deux demandes d'identifiants des comptes bookmakers restent à l'admin (jamais à un membre)", async () => {
    const kit = createTestKit(new Date("2026-10-25T09:00:00Z"));
    await askBookmakerCredentials(kit.deps as never, { force: true } as never);
    const rows = kit.tables("humanRequest") as Array<{ kind: string; teamKey: string | null; onAnswer: unknown; key: string }>;
    const asked = rows.filter((r) => r.key.startsWith("providers.bookmakers.default."));
    expect(asked.length).toBe(2);
    for (const r of asked) expect(teamAdminOnlyRequest(r)).toBe(true);
    expect(teamAdminOnlyRequest({ kind: "CONFIRM", teamKey: "sports", onAnswer: { action: "bookmakers-test-all" } })).toBe(true);
  });

  it("un ordre « teste les bookmakers » est réservé à l'admin", () => {
    expect(adminOnlyOrder({ plannedSteps: [{ capability: "tester_site" }] } as never)).toBe(true);
  });
});
