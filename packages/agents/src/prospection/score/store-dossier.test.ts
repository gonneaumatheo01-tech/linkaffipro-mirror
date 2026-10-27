/** Phase 31, chantier C — score enregistré, mise en file des dossiers, dossier Opus (chiffres, QA, plafonds). */
import { beforeEach, describe, expect, it } from "vitest";
import { resetVoiceRotation } from "../../boss/voice";
import { createFakeQaLlm } from "../../qa/testing";
import { PROSPECTION_MODELS } from "../contract";
import { buildDossier, DOSSIER_LEGAL_LINE } from "./dossier";
import { createProspectKit, fakeLlm } from "./prospect-test-kit";
import { scoreAndStore } from "./store";

beforeEach(() => resetVoiceRotation());

describe("scoreAndStore", () => {
  it("écrit score, niveau, statut et SCORED ; enfile le dossier d'un A", async () => {
    const k = createProspectKit();
    const o = await k.offer();
    const p = await k.prospect({ status: "ENRICHING", score: null, tier: null });
    const r = await scoreAndStore(k.deps, p.id);
    expect(r.tier).toBe("A");
    expect(r.dossierQueued).toBe(true);
    const row = await k.row(p.id);
    expect(row.status).toBe("QUALIFIED");
    expect(row.score).toBe(r.score);
    expect(row.matchedOfferId).toBe(o.id);
    expect(k.events("SCORED")).toHaveLength(1);
    expect(k.jobs).toEqual([{ type: "prospection.dossier", prospectId: p.id }]);
  });

  it("ne rétrograde jamais un prospect du pipeline client", async () => {
    const k = createProspectKit();
    const p = await k.prospect({ status: "CONTACTED", region: "NON_EU" });
    const r = await scoreAndStore(k.deps, p.id);
    expect(r.tier).toBe("D");
    expect((await k.row(p.id)).status).toBe("CONTACTED");
    expect(r.dossierQueued).toBe(false);
  });

  it("plafond hebdomadaire des dossiers", async () => {
    const k = createProspectKit();
    await k.prisma.setting.create({ data: { key: "prospection.dossier_weekly_cap", value: 1 } as never });
    const a = await k.prospect({ status: "ENRICHING" });
    const b = await k.prospect({ status: "ENRICHING" });
    expect((await scoreAndStore(k.deps, a.id)).dossierQueued).toBe(true);
    expect((await scoreAndStore(k.deps, b.id)).dossierQueued).toBe(false);
    expect(k.jobs).toHaveLength(1);
  });

  it("un D est écarté sans dossier", async () => {
    const k = createProspectKit();
    const p = await k.prospect({ status: "ENRICHING", riskFlags: ["SCAM_FIXED_MATCHES"] });
    const r = await scoreAndStore(k.deps, p.id);
    expect(r.status).toBe("DISQUALIFIED");
    expect((await k.row(p.id)).status).toBe("DISQUALIFIED");
    expect(k.jobs).toHaveLength(0);
  });
});

const GOOD = [
  "Canal de pronostics foot en français, actif chaque jour.",
  "Audience réelle : 2,1k vues médianes, 12 % des 17k abonnés.",
  "Pays : France, langue française.",
  "Pousse 1xbet avec le code XYZ depuis 4 mois.",
  "Vend ses posts 40 € et un VIP à 29 €/mois.",
  "Contact : @admin_pub, sûr.",
  "Risques : aucun signal de faux.",
  "Pourquoi maintenant : concurrent rotatif, une CPA colle ; 2 questions : ses tarifs, ses résultats.",
].join("\n");

describe("buildDossier", () => {
  it("dossier accepté : stocké, Opus, dépense comptée, QA appelé", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    const llm = fakeLlm([GOOD]);
    k.deps.prospectionLlm = llm;
    const qa = createFakeQaLlm();
    k.deps.qaLlm = qa;
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(true);
    expect(llm.calls[0]!.model).toBe(PROSPECTION_MODELS.dossier);
    expect(qa.calls.length).toBeGreaterThan(0);
    expect((await k.row(p.id)).dossier).toContain("1xbet");
    const usage = k.tables("agentUsage").find((u) => u.teamKey === "prospection");
    expect(usage?.cents).toBe(12);
  });

  it("chiffre inventé → rejeté, rien de stocké", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    k.deps.prospectionLlm = fakeLlm([`${GOOD.split("\n").slice(0, 7).join("\n")}\nIl gagne 4500 € par mois avec la pub.`]);
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("chiffre absent des données");
    expect((await k.row(p.id)).dossier).toBeNull();
  });

  it("avis sur la légalité → rejeté", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    k.deps.prospectionLlm = fakeLlm(["Le casino en ligne est illégal en France."]);
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(false);
  });

  it("refus du QA → pas de dossier", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    k.deps.prospectionLlm = fakeLlm([GOOD]);
    k.deps.qaLlm = createFakeQaLlm({ responses: [{ verdict: "REJECTED", reasons: [{ code: "invented_number", message: "chiffre douteux", severity: "critical" }] }] });
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(false);
    expect((await k.row(p.id)).dossier).toBeNull();
  });

  it("QA en panne → pas de dossier", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    k.deps.prospectionLlm = fakeLlm([GOOD]);
    k.deps.qaLlm = null;
    expect((await buildDossier(k.deps, p.id)).ok).toBe(false);
  });

  it("pays signalé : ligne «\u00a0vérifie avec un avocat\u00a0» ajoutée par le code", async () => {
    const k = createProspectKit();
    const p = await k.prospect({ regulatoryFlag: "FR: casino en ligne non autorisé" });
    k.deps.prospectionLlm = fakeLlm([GOOD.split("\n").slice(0, 7).join("\n")]);
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dossier.split("\n").at(-1)).toBe(DOSSIER_LEGAL_LINE);
  });

  it("plafond mensuel atteint → aucun appel", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    const llm = fakeLlm([GOOD]);
    k.deps.prospectionLlm = llm;
    k.deps.monthlyBudgetCents = 0;
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(false);
    expect(llm.calls).toHaveLength(0);
  });

  it("échec d'Opus : aucun autre modèle essayé", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    const models: string[] = [];
    k.deps.prospectionLlm = {
      async complete(req) {
        models.push(req.model);
        throw new Error("surcharge");
      },
    };
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(false);
    expect(models).toEqual([PROSPECTION_MODELS.dossier]);
  });

  it("propositions de message seulement si le réglage est actif (Sonnet)", async () => {
    const k = createProspectKit();
    await k.prisma.setting.create({ data: { key: "prospection.pitch_drafts", value: true } as never });
    const p = await k.prospect();
    const llm = fakeLlm([GOOD, "Salut, j'aime tes pronos foot, on parle d'une offre CPA ?\nTon canal colle à notre offre, tu veux en discuter ?"]);
    k.deps.prospectionLlm = llm;
    const r = await buildDossier(k.deps, p.id);
    expect(r.ok).toBe(true);
    expect(llm.calls[1]!.model).toBe(PROSPECTION_MODELS.analyze);
    if (r.ok) expect(r.dossier).toMatch(/je n'envoie rien|rien n'est envoyé/);
  });

  it("dossier demandé par le bouton : envoyé au client dès qu'il est prêt", async () => {
    const k = createProspectKit();
    const p = await k.prospect();
    k.deps.prospectionLlm = fakeLlm([GOOD]);
    await k.prisma.setting.create({ data: { key: `prospection.dossier_request.${p.id}`, value: { chatId: "4242", at: k.now().toISOString() } } as never });
    await buildDossier(k.deps, p.id);
    expect(k.sent.some((m) => m.html.includes("1xbet"))).toBe(true);
    expect(k.tables("setting").some((s) => String(s.key).startsWith("prospection.dossier_request."))).toBe(false);
  });
});
