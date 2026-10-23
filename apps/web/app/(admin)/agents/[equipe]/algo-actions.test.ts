import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de « Ce qui marche » (phase 21) : Appliquer / Annuler / Refuser selon les droits, « Rapport maintenant » et
// réglages réservés aux administrateurs. Moteur des agents simulé (`vi.mock`).
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  rec: { id: "r1", status: "PROPOSED", size: "SMALL", target: "CHANNEL_PLAN", field: "mix" } as Record<string, string> | null,
  apply: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Mélange appliqué." })),
  undo: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" })),
  reject: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" })),
  report: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "Rapport envoyé.", reportIds: ["i1"] })),
  save: vi.fn(async (..._a: unknown[]) => {}),
  audit: vi.fn(async (_a: unknown) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/agents", () => ({
  applyRecommendation: m.apply,
  undoRecommendation: m.undo,
  rejectRecommendation: m.reject,
  runAlgoReportNow: m.report,
}));
vi.mock("@linkaffipro/db", () => ({
  audit: m.audit,
  prisma: { recommendation: { findUnique: vi.fn(async () => m.rec) } },
}));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/algo/save", () => ({ saveAlgoSettings: m.save }));

import { recommendationAction, runAlgoReportNowAction, saveAlgoSettingsAction } from "./algo-actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return decodeURIComponent(String((err as Error).message).replace(/\+/g, " "));
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.rec = { id: "r1", status: "PROPOSED", size: "SMALL", target: "CHANNEL_PLAN", field: "mix" };
  for (const f of [m.apply, m.undo, m.reject, m.report, m.save, m.audit]) f.mockClear();
});

describe("Appliquer / Annuler / Refuser", () => {
  it("un responsable applique un petit réglage ; retour sur la page avec ses filtres", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(
      recommendationAction(fd({ id: "r1", action: "apply", from: "/agents/algo?univers=casino&range=30d" })),
    );
    expect(m.apply).toHaveBeenCalledWith({}, "r1", { userId: "u2", via: "SITE" });
    expect(url).toContain("/agents/algo?univers=casino&range=30d&ok=Mélange appliqué.#recommandations");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agents.algo_recommendation_apply_requested" }));
  });

  it("réglage de persona : refusé à un responsable, sans appel au moteur", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    m.rec = { id: "r1", status: "PROPOSED", size: "BIG", target: "PERSONA", field: "messagesBeforeLink" };
    const url = await redirectOf(recommendationAction(fd({ id: "r1", action: "apply", from: "/conversations/personas/p1" })));
    expect(m.apply).not.toHaveBeenCalled();
    expect(url).toContain("/conversations/personas/p1?error=");
    expect(url).toContain("#propositions-algorithme");
  });

  it("annuler un réglage appliqué ; geste impossible selon l'état", async () => {
    m.rec = { id: "r1", status: "APPLIED", size: "SMALL", target: "CHANNEL_PLAN", field: "mix" };
    expect(await redirectOf(recommendationAction(fd({ id: "r1", action: "undo" })))).toContain("valeur d'avant");
    expect(m.undo).toHaveBeenCalled();
    const url = await redirectOf(recommendationAction(fd({ id: "r1", action: "reject" })));
    expect(url).toContain("déjà changé d'état");
    expect(m.reject).not.toHaveBeenCalled();
  });

  it("refus du moteur (bornes) : message d'erreur ; adresse de retour inconnue → page Ce qui marche", async () => {
    m.apply.mockResolvedValueOnce({ ok: false, message: "Hors des heures autorisées." });
    const url = await redirectOf(recommendationAction(fd({ id: "r1", action: "apply", from: "https://exemple.com" })));
    expect(url).toMatch(/^NEXT_REDIRECT \/agents\/algo\?error=Hors des heures autorisées\./);
  });
});

describe("Rapport maintenant et réglages", () => {
  it("rapport : administrateurs seulement", async () => {
    expect(await redirectOf(runAlgoReportNowAction(fd({})))).toContain("ok=Rapport envoyé.");
    expect(m.report).toHaveBeenCalledWith({}, { send: true });
    m.user = { id: "u2", role: "MANAGER" };
    m.report.mockClear();
    expect(await redirectOf(runAlgoReportNowAction(fd({})))).toContain("réservé aux administrateurs");
    expect(m.report).not.toHaveBeenCalled();
  });

  it("réglages : enregistrés pour un administrateur, refusés à un responsable, erreur de saisie dite", async () => {
    const ok = {
      minPosts: "20",
      minViews: "1000",
      minConversations: "30",
      maxMixPointsPerWeek: "20",
      maxPostsPerDay: "6",
      allowedStart: "08:00",
      allowedEnd: "23:00",
      frequency: "weekly",
    };
    expect(await redirectOf(saveAlgoSettingsAction(fd(ok)))).toContain("#reglages-algo");
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ maxPostsPerDay: 6 }), "u1");
    expect(await redirectOf(saveAlgoSettingsAction(fd({ ...ok, maxPostsPerDay: "0" })))).toContain("Posts par jour au maximum");
    m.user = { id: "u2", role: "MANAGER" };
    m.save.mockClear();
    expect(await redirectOf(saveAlgoSettingsAction(fd(ok)))).toContain("réservés aux administrateurs");
    expect(m.save).not.toHaveBeenCalled();
  });
});
