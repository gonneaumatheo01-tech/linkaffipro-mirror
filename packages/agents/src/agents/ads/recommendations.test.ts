import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import type { AgentsDeps } from "../../types";
import { applyRecommendation } from "../../algo/contracts";
import { autoApplyPending } from "../synthese/index";
import { markAdsRecommendation } from "../../ads/contracts";
import { ADS_NEVER_APPLIED, ADS_OUTDATED_COMMENT, saveAdsRecommendations } from "./recommendations";
import type { AdsProposal } from "../../rules/ads";

const NOW = new Date("2026-10-24T10:00:00Z");

function depsWith(seed: Record<string, Record<string, unknown>[]> = {}) {
  const prisma = createFakePrisma(seed);
  const deps: AgentsDeps = { prisma, now: () => NOW, enqueue: { async orchestrator() {}, async step() {} } };
  return { prisma, deps };
}

const rec = (p: Record<string, unknown> = {}) => ({
  id: "r1",
  teamKey: "ads",
  target: "AD",
  targetId: "a1",
  field: "action",
  action: "STOP",
  after: { action: "STOP" },
  evidence: {},
  size: "SMALL",
  status: "PROPOSED",
  doneAt: null,
  rejectedAt: null,
  comment: null,
  createdAt: NOW,
  ...p,
});

const proposal = (action: AdsProposal["action"], targetId = "a1"): AdsProposal => ({
  action,
  level: "ad",
  targetId,
  evidence: { sentence: "preuve", name: "Vidéo", priority: 1 } as never,
});

describe("recommandations de l'Agent Ads : jamais appliquées", () => {
  it("applyRecommendation refuse proprement une recommandation ads (rien n'est écrit)", async () => {
    const { prisma, deps } = depsWith({ recommendation: [rec()] });
    const r = await applyRecommendation(deps, "r1", { userId: "u1", via: "SITE" });
    expect(r).toEqual({ ok: false, message: ADS_NEVER_APPLIED });
    expect(prisma._tables.recommendation![0]!.status).toBe("PROPOSED");
    // Le Grand Chef non plus (application automatique des réglages de l'équipe Algorithme).
    const auto = await autoApplyPending(deps, 2);
    expect(auto).toEqual({ applied: [], refused: [] });
  });

  it("« Fait » avec commentaire : DONE, date, auteur, AuditLog ; une seconde fois refusé", async () => {
    const { prisma, deps } = depsWith({ recommendation: [rec()] });
    const r = await markAdsRecommendation(deps, { id: "r1", status: "DONE", comment: "  coupée chez TikTok " }, { userId: "u1", via: "SITE" });
    expect(r.ok).toBe(true);
    const row = prisma._tables.recommendation![0]!;
    expect(row).toMatchObject({ status: "DONE", doneById: "u1", comment: "coupée chez TikTok" });
    expect(row.doneAt).toEqual(NOW);
    expect(prisma._tables.auditLog?.[0]).toMatchObject({ userId: "u1", action: "agents.ads.recommendation_done", entityId: "r1" });
    expect((await markAdsRecommendation(deps, { id: "r1", status: "REJECTED" }, { via: "SITE" })).ok).toBe(false);
  });

  it("« Refusé » ; une recommandation d'une autre équipe est introuvable", async () => {
    const { prisma, deps } = depsWith({ recommendation: [rec(), rec({ id: "r2", teamKey: "algo" })] });
    expect((await markAdsRecommendation(deps, { id: "r1", status: "REJECTED", comment: "non" }, { via: "TELEGRAM" })).ok).toBe(true);
    expect(prisma._tables.recommendation![0]).toMatchObject({ status: "REJECTED", comment: "non" });
    expect((await markAdsRecommendation(deps, { id: "r2", status: "DONE" }, { via: "SITE" })).ok).toBe(false);
  });
});

describe("enregistrement des propositions", () => {
  it("même cible et même action : mise à jour, pas de doublon ; plus justifiée : close ; traitée récemment : pas re-proposée", async () => {
    const { prisma, deps } = depsWith({
      recommendation: [rec(), rec({ id: "r2", targetId: "a2", action: "WATCH" }), rec({ id: "r3", targetId: "a3", action: "STOP", status: "DONE", doneAt: new Date(NOW.getTime() - 86_400_000) })],
    });
    const out = await saveAdsRecommendations(deps, [proposal("STOP", "a1"), proposal("STOP", "a3"), proposal("SCALE", "a4")]);
    expect(out.updated).toEqual(["r1"]);
    expect(out.created).toHaveLength(1);
    expect(out.closed).toEqual(["r2"]);
    expect(out.skipped).toBe(1);
    const rows = prisma._tables.recommendation!;
    expect(rows.filter((r) => r.status === "PROPOSED").map((r) => r.targetId).sort()).toEqual(["a1", "a4"]);
    expect(rows.find((r) => r.id === "r2")).toMatchObject({ status: "REJECTED", comment: ADS_OUTDATED_COMMENT });
    expect(rows.find((r) => r.targetId === "a4")).toMatchObject({ teamKey: "ads", target: "AD", action: "SCALE", status: "PROPOSED" });
  });
});

describe("aucune écriture vers Meta / TikTok", () => {
  const dir = join(__dirname);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  it("l'agent n'importe ni les connecteurs ni un client HTTP, et n'appelle aucune adresse des plateformes", () => {
    for (const f of [...files.map((x) => join(dir, x)), join(dir, "../../rules/ads.ts")]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/@linkaffipro\/connectors/);
      expect(src, f).not.toMatch(/\bfetch\s*\(|node:https?|axios|undici/);
      expect(src, f).not.toMatch(/graph\.facebook\.com|business-api\.tiktok|ads\.tiktok/);
    }
  });
  it("le chargement des données ne fait que lire (aucun create / update / delete / upsert)", () => {
    const src = readFileSync(join(dir, "dataset.ts"), "utf8");
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  });
});
