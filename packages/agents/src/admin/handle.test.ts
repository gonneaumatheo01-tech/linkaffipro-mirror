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
    expect(lines[0]).toContain("à valider : 0");
    expect(lines[1]).toContain("Rencontres : ▶️ active · simulation · niveau 0");
    expect(lines.at(-1)).toContain("Santé : Grand Chef jamais");
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

  it("« vrai casino » : résumé (canaux, quota, niveau) puis confirmation OUI", async () => {
    const kit = createTestKit();
    const ch = await kit.prisma.channel.create({ data: { title: "Casino VIP", vertical: "CASINO" } as never });
    const test = await kit.prisma.channel.create({ data: { title: "Test", isTest: true } as never });
    await kit.prisma.channelAgentPlan.create({ data: { channelId: ch.id, teamKey: "casino", enabled: true, postsPerDay: 4 } as never });
    await kit.prisma.channelAgentPlan.create({ data: { channelId: test.id, teamKey: "casino", enabled: true, postsPerDay: 9 } as never });
    const r = await handleAdminText(kit.deps, { text: "vrai casino", messageId: 1 });
    expect(r.handled).toBe(true);
    const q = kit.sent[0]!.html;
    expect(q).toContain("Passer l'équipe Casino en vrai ?");
    expect(q).toContain("4 posts par jour au plus sur 1 canal : Casino VIP.");
    expect(q).toContain("Niveau 0 : tu valides chaque post");
    expect(q).toContain("Réponds OUI pour confirmer");
    expect(q.split("\n").length).toBeLessThanOrEqual(5);
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

  it("« niveau casino 1 » puis « niveau casino 2 » : résumés et confirmés par OUI", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "niveau casino 1", messageId: 1 });
    expect(kit.sent.at(-1)!.html).toContain("Passer l'équipe Casino au niveau 1 (je valide les nouveautés) ? Elle est aujourd'hui au niveau 0, en simulation");
    expect(kit.tables("agentTeamConfig")).toHaveLength(0);
    await handleAdminText(kit.deps, { text: "oui", messageId: 2 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ autonomyLevel: 1 });
    expect((await handleAdminText(kit.deps, { text: "niveau casino 1", messageId: 3 })).reply).toBe("L'équipe Casino est déjà au niveau 1.");
    await handleAdminText(kit.deps, { text: "niveau casino 2", messageId: 4 });
    expect(kit.sent.at(-1)!.html).toContain("Niveau 2 : autonomie totale");
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ autonomyLevel: 1 });
    await handleAdminText(kit.deps, { text: "oui", messageId: 5 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ autonomyLevel: 2 });
  });

  it("« vrai » sur une équipe déjà en vrai : rien n'est demandé", async () => {
    const kit = createTestKit();
    await kit.prisma.agentTeamConfig.create({ data: { teamKey: "dating", simulation: false } as never });
    expect((await handleAdminText(kit.deps, { text: "vrai dating", messageId: 1 })).reply).toBe("L'équipe Rencontres est déjà en vrai.");
    expect(kit.sent).toHaveLength(0);
  });

  it("« budget vidéo 100 » et « bookmaker »", async () => {
    const kit = createTestKit();
    await handleAdminText(kit.deps, { text: "budget vidéo 100", messageId: 1 });
    expect(kit.tables("agentTeamConfig")[0]).toMatchObject({ teamKey: "dating", monthlyBudgetCents: { video: 10000 } });
    const r = await handleAdminText(kit.deps, { text: "bookmaker sportaza moi pass-wd99", messageId: 2 });
    expect(r).toMatchObject({ deleteMessage: true, reply: "Mot de passe sportaza enregistré ✅" });
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
