import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import { handleAdminText } from "./handle";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);

beforeEach(() => lifecycle.continueMission.mockClear());

describe("commandes du dialogue admin", () => {
  it("« pause dating » puis « reprends dating » (échecs remis à zéro, cycle enfilé)", async () => {
    const kit = createTestKit();
    await kit.prisma.agentTeamConfig.create({ data: { teamKey: "dating", consecutiveFailures: 3 } as never });
    expect((await handleAdminText(kit.deps, { text: "pause dating", messageId: 1 })).reply).toBe("Équipe Dating en pause ⏸");
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ paused: true });
    await handleAdminText(kit.deps, { text: "Reprends Dating", messageId: 2 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ paused: false, consecutiveFailures: 0 });
    expect(kit.enqueue.orchestrator).toHaveBeenCalledWith({ type: "cycle", teamKey: "dating" });
    expect(kit.tables("auditLog").map((a) => a.action)).toEqual(["agents.team.paused", "agents.team.resumed"]);
  });

  it("« pause tout » : réglage général", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "pause tout", messageId: 1 });
    expect(kit.tables("setting").find((s) => s.key === "agents.pausedAll")?.value).toBe(true);
  });

  it("« agents » : état en 6 lignes", async () => {
    const kit = createTestKit();
    const r = await handleAdminText(kit.deps, { text: "agents", messageId: 1 });
    const lines = r.reply!.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain("Dating : ▶️ active · simulation · niveau 0");
  });

  it("« vrai casino » : passe par une confirmation OUI", async () => {
    const kit = createTestKit();
    const r = await handleAdminText(kit.deps, { text: "vrai casino", messageId: 1 });
    expect(r.handled).toBe(true);
    expect(kit.sent[0]!.html).toContain("Passer l'équipe Casino en vrai ?");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    const ok = await handleAdminText(kit.deps, { text: "OUI", messageId: 2, replyToMessageId: kit.sent[0]!.messageId });
    expect(ok.reply).toContain("Équipe Casino en vrai ✅");
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ teamKey: "casino", simulation: false });
  });

  it("« vrai dating » puis « non » : rien ne change", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "vrai dating", messageId: 1 });
    const r = await handleAdminText(kit.deps, { text: "non", messageId: 2 });
    expect(r.reply).toContain("reste en simulation");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("« niveau casino 1 » direct, « niveau casino 2 » confirmé", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "niveau casino 1", messageId: 1 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ autonomyLevel: 1 });
    await handleAdminText(kit.deps, { text: "niveau casino 2", messageId: 2 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ autonomyLevel: 1 });
    await handleAdminText(kit.deps, { text: "oui", messageId: 3 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ autonomyLevel: 2 });
  });

  it("« budget vidéo 100 » et « bookmaker »", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "budget vidéo 100", messageId: 1 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ teamKey: "dating", monthlyBudgetCents: { video: 10000 } });
    const r = await handleAdminText(kit.deps, { text: "bookmaker sportaza moi pass-wd99", messageId: 2 });
    expect(r).toMatchObject({ deleteMessage: true, reply: "Mot de passe sportaza enregistrée (…wd99) ✅" });
    // Deux clés séparées : identifiant puis mot de passe.
    const keys = kit.tables("setting").map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["agents.secret.providers.bookmakers.sportaza.login", "agents.secret.providers.bookmakers.sportaza.password"]));
  });

  it("« demandes » et « plus tard »", async () => {
    const kit = createTestKit();
    expect((await handleAdminText(kit.deps, { text: "demandes", messageId: 1 })).reply).toBe("Aucune demande ouverte 👍");
    expect((await handleAdminText(kit.deps, { text: "plus tard", messageId: 2 })).reply).toBe("Aucune question en cours.");
  });
});
