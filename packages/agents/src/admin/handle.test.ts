import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestKit } from "../human/test-kit";
import { BOOKMAKER_CREDENTIALS_REFUSAL, handleAdminText, VIDEO_BUDGET_REMOVED } from "./handle";

const lifecycle = vi.hoisted(() => ({
  continueMission: vi.fn(async () => undefined),
  cancelMission: vi.fn(async () => undefined),
}));
vi.mock("../missions/lifecycle", () => lifecycle);

// Le catalogue du Boss (confirmations de « vrai », « niveau », « budget vidéo ») se charge à la demande : préchargé ici.
beforeAll(async () => {
  await import("../boss/catalog");
  await import("../boss/execute");
}, 60_000);

beforeEach(() => lifecycle.continueMission.mockClear());

describe("commandes du dialogue admin", () => {
  it("« pause dating » puis « reprends dating » (échecs remis à zéro, cycle enfilé)", async () => {
    const kit = createTestKit();
    await kit.prisma.agentTeamConfig.create({ data: { teamKey: "dating", consecutiveFailures: 3 } as never });
    expect((await handleAdminText(kit.deps, { text: "pause dating", messageId: 1 })).reply).toBe("Équipe Rencontres en pause ⏸");
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

  it("« agents » : résumé de supervision en 8 lignes au plus", async () => {
    const kit = createTestKit();
    const r = await handleAdminText(kit.deps, { text: "agents", messageId: 1 });
    const lines = r.reply!.split("\n");
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines[0]).toContain("À valider : 0");
    expect(lines[1]).toContain("Rencontres : active, pour de faux, niveau 0.");
    expect(lines.at(-1)).toContain("Santé : aucun tour des équipes encore");
    // Lecture seule : aucune équipe créée par la commande.
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("« rapport » : rapport du jour (calculé si celui de 9 h n'est pas parti) et pubs", async () => {
    const kit = createTestKit();
    const r = await handleAdminText(kit.deps, { text: "Rapport", messageId: 1 });
    expect(r.reply).toContain("Rapport des agents</b> (2026-10-23, calculé maintenant)");
    expect(r.reply).toContain("• Rencontres : 0 publié");
    expect(r.reply).toContain("Pubs : aucun rapport encore");
    await kit.prisma.event.create({ data: { type: "agents.report.daily", occurredAt: new Date(), payload: { day: "2026-10-23", lines: ["Casino : 2 publiés <ok>"] } } as never });
    await kit.prisma.insightReport.create({ data: { teamKey: "ads", weekStart: "2026-10-23", content: "Dépense 12 €\nGains 30 €" } as never });
    const again = await handleAdminText(kit.deps, { text: "rapport", messageId: 2 });
    expect(again.reply).toContain("Rapport des agents</b> (2026-10-23)\n");
    expect(again.reply).toContain("• Casino : 2 publiés &lt;ok&gt;");
    expect(again.reply).toContain("📣 <b>Pubs</b>\n• Dépense 12 €\n• Gains 30 €");
  });

  // Phase 26 (relecture, défaut 6) : « vrai », « niveau » et la hausse du plafond vidéo passent par la confirmation du
  // Boss (10 minutes, OUI / NON, une seule à la fois) au lieu d'une demande CONFIRM sans expiration.
  it("« vrai casino » : résumé (canaux, niveau) avec OUI / NON, puis confirmation OUI", async () => {
    const kit = createTestKit();
    const ch = await kit.prisma.channel.create({ data: { title: "Casino VIP", vertical: "CASINO" } as never });
    const test = await kit.prisma.channel.create({ data: { title: "Test", isTest: true } as never });
    await kit.prisma.channelAgentPlan.create({ data: { channelId: ch.id, teamKey: "casino", enabled: true, postsPerDay: 4 } as never });
    await kit.prisma.channelAgentPlan.create({ data: { channelId: test.id, teamKey: "casino", enabled: true, postsPerDay: 9 } as never });
    const r = await handleAdminText(kit.deps, { text: "vrai casino", messageId: 1 });
    expect(r.handled).toBe(true);
    expect(r.reply).toMatch(/Casino en vrai \?/);
    expect(r.reply).toContain("Casino VIP");
    expect(r.reply).toContain("OUI pour confirmer");
    expect(r.pendingId).toBeTruthy();
    expect(r.buttons?.[0]?.map((b) => b.text)).toEqual(["✅ OUI", "❌ NON"]);
    expect(kit.tables("humanRequest")).toHaveLength(0);
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    const ok = await handleAdminText(kit.deps, { text: "OUI", messageId: 2 });
    expect(ok.reply).toContain("en vrai");
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ teamKey: "casino", simulation: false });
  });

  it("« vrai dating » puis « non » : rien ne change", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "vrai dating", messageId: 1 });
    const r = await handleAdminText(kit.deps, { text: "non", messageId: 2 });
    expect(r.reply).toMatch(/rien n'a changé|rien n'a bougé|rien touché/i);
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("« niveau casino 1 » puis « niveau casino 2 » : résumés et confirmés par OUI ; une baisse est immédiate", async () => {
    const kit = createTestKit();
    const one = await handleAdminText(kit.deps, { text: "niveau casino 1", messageId: 1 });
    expect(one.reply).toMatch(/Casino.*niveau 1/);
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")?.autonomyLevel ?? 0).toBe(0);
    await handleAdminText(kit.deps, { text: "oui", messageId: 2 });
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")).toMatchObject({ autonomyLevel: 1 });
    expect((await handleAdminText(kit.deps, { text: "niveau casino 1", messageId: 3 })).reply).toBe("L'équipe Casino est déjà au niveau 1.");
    const two = await handleAdminText(kit.deps, { text: "niveau casino 2", messageId: 4 });
    expect(two.reply).toContain("au niveau 2");
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")).toMatchObject({ autonomyLevel: 1 });
    await handleAdminText(kit.deps, { text: "oui", messageId: 5 });
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")).toMatchObject({ autonomyLevel: 2 });
    await handleAdminText(kit.deps, { text: "niveau casino 0", messageId: 6 });
    expect(kit.tables("agentTeamConfig").find((t) => t.teamKey === "casino")).toMatchObject({ autonomyLevel: 0 });
  });

  it("« budget vidéo N » : vidéos IA retirées, réponse claire, rien n'est changé", async () => {
    const kit = createTestKit();
    const r = await handleAdminText(kit.deps, { text: "budget vidéo 100", messageId: 1 });
    expect(r.reply).toBe(VIDEO_BUDGET_REMOVED);
    expect(r.pendingId).toBeUndefined();
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
  });

  it("« vrai » sur une équipe déjà en vrai : rien n'est demandé", async () => {
    const kit = createTestKit();
    await kit.prisma.agentTeamConfig.create({ data: { teamKey: "dating", simulation: false } as never });
    expect((await handleAdminText(kit.deps, { text: "vrai dating", messageId: 1 })).reply).toBe("L'équipe Rencontres est déjà en vrai.");
    expect(kit.sent).toHaveLength(0);
  });

  it("« bookmaker »", async () => {
    const kit = createTestKit();
    // Sites des bookmakers plus jamais lus (28 octobre 2026) : message effacé, rien n'est gardé.
    const r = await handleAdminText(kit.deps, { text: "bookmaker sportaza moi pass-wd99", messageId: 2 });
    expect(r).toMatchObject({ deleteMessage: true, reply: BOOKMAKER_CREDENTIALS_REFUSAL });
    expect(kit.tables("setting").map((s) => String(s.key)).filter((k) => k.includes("bookmakers"))).toEqual([]);
  });

  it("« demandes » et « plus tard »", async () => {
    const kit = createTestKit();
    expect((await handleAdminText(kit.deps, { text: "demandes", messageId: 1 })).reply).toBe("Aucune demande ouverte 👍");
    expect((await handleAdminText(kit.deps, { text: "plus tard", messageId: 2 })).reply).toBe("Aucune question en cours.");
  });
});
