import { beforeEach, describe, expect, it, vi } from "vitest";

// Actions de l'Agent Ads (phase 24) : « Fait » / « Refuser » pour tous (moteur simulé), seuils réservés aux
// administrateurs. Rien n'est jamais envoyé vers Meta ou TikTok : seul `markAdsRecommendation` est appelé.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  rec: { teamKey: "ads", status: "PROPOSED" } as Record<string, string> | null,
  mark: vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "" })),
  save: vi.fn(async (..._a: unknown[]) => {}),
  saveAlerts: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/agents", () => ({ markAdsRecommendation: m.mark }));
vi.mock("@linkaffipro/db", () => ({
  audit: vi.fn(),
  prisma: { recommendation: { findUnique: vi.fn(async () => m.rec) } },
}));
vi.mock("@/lib/agents/deps", () => ({ buildAgentsDeps: () => ({}) }));
vi.mock("@/lib/agents/ads/save", () => ({ saveAdsThresholds: m.save, saveAdsAlertSettings: m.saveAlerts }));

import { markAdsRecommendationAction, saveAdsAlertSettingsAction, saveAdsThresholdsAction } from "./actions";

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

const thresholdsForm = (over: Record<string, string> = {}) => {
  const o: Record<string, string> = {};
  for (const u of ["CASINO", "SPORTS", "DATING"]) {
    o[`${u}.targetCostPerRegistration`] = "";
    o[`${u}.minRoas`] = "";
    o[`${u}.observationDays`] = "3";
    o[`${u}.minSpend`] = "20";
  }
  return fd({ ...o, ...over });
};

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.rec = { teamKey: "ads", status: "PROPOSED" };
  m.mark.mockClear();
  m.save.mockClear();
  m.saveAlerts.mockClear();
});

describe("Fait / Refuser", () => {
  it("un responsable marque « Fait » avec un commentaire ; retour sur la page avec ses filtres", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    const url = await redirectOf(
      markAdsRecommendationAction(
        fd({ id: "r1", status: "DONE", comment: "  budget   monté ", from: "/agents/ads?periode=28d" }),
      ),
    );
    expect(m.mark).toHaveBeenCalledWith({}, { id: "r1", status: "DONE", comment: "budget monté" }, { userId: "u2", via: "SITE" });
    expect(url).toContain("/agents/ads?periode=28d&ok=Noté");
    expect(url).toContain("#recommandations");
  });

  it("refuser sans commentaire", async () => {
    await redirectOf(markAdsRecommendationAction(fd({ id: "r1", status: "REJECTED" })));
    expect(m.mark).toHaveBeenCalledWith({}, { id: "r1", status: "REJECTED", comment: null }, expect.anything());
  });

  it("état inconnu, recommandation d'une autre équipe ou déjà traitée : rien n'est appelé", async () => {
    expect(await redirectOf(markAdsRecommendationAction(fd({ id: "r1", status: "APPLIED" })))).toContain("error=");
    m.rec = { teamKey: "algo", status: "PROPOSED" };
    expect(await redirectOf(markAdsRecommendationAction(fd({ id: "r1", status: "DONE" })))).toContain("introuvable");
    m.rec = { teamKey: "ads", status: "DONE" };
    expect(await redirectOf(markAdsRecommendationAction(fd({ id: "r1", status: "DONE" })))).toContain("déjà changé");
    expect(m.mark).not.toHaveBeenCalled();
  });

  it("adresse de retour étrangère : retour sur /agents/ads", async () => {
    const url = await redirectOf(markAdsRecommendationAction(fd({ id: "r1", status: "DONE", from: "https://exemple.com" })));
    expect(url).toMatch(/^NEXT_REDIRECT \/agents\/ads\?ok=/);
  });

  it("refus du moteur : message d'erreur", async () => {
    m.mark.mockResolvedValueOnce({ ok: false, message: "Déjà traitée." });
    expect(await redirectOf(markAdsRecommendationAction(fd({ id: "r1", status: "DONE" })))).toContain("error=Déjà traitée.");
  });
});

describe("seuils", () => {
  it("administrateur : enregistrés", async () => {
    const url = await redirectOf(saveAdsThresholdsAction(thresholdsForm({ "CASINO.targetCostPerRegistration": "12,5" })));
    expect(m.save).toHaveBeenCalledWith(
      expect.objectContaining({ CASINO: { targetCostPerRegistration: 12.5, minRoas: null, observationDays: 3, minSpend: 20 } }),
      "u1",
      "WEB",
    );
    expect(url).toContain("ok=Seuils enregistrés");
    expect(url).toContain("#seuils");
  });

  it("responsable : refusé", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(saveAdsThresholdsAction(thresholdsForm()))).toContain("réservés aux administrateurs");
    expect(m.save).not.toHaveBeenCalled();
  });

  it("valeur hors bornes : message clair, rien d'enregistré", async () => {
    const url = await redirectOf(saveAdsThresholdsAction(thresholdsForm({ "SPORTS.observationDays": "0" })));
    expect(url).toContain("Paris sportifs : jours d'observation");
    expect(m.save).not.toHaveBeenCalled();
  });
});

describe("réglages des alertes de l'Agent Ads", () => {
  const alertsForm = (o: Record<string, string> = {}) =>
    fd({ "alerts.spikePct": "80", "alerts.dropPct": "40", "alerts.minDailySpend": "12,5", "alerts.minRegistrations": "3", ...o });
  it("un administrateur enregistre les 4 réglages", async () => {
    const url = await redirectOf(saveAdsAlertSettingsAction(alertsForm()));
    expect(m.saveAlerts).toHaveBeenCalledWith({ spikePct: 80, dropPct: 40, minDailySpend: 12.5, minRegistrations: 3 }, "u1", "WEB");
    expect(url).toContain("ok=");
    expect(url).toContain("#seuils");
  });
  it("un responsable ne peut pas ; une valeur hors bornes est refusée", async () => {
    m.user = { id: "u2", role: "MANAGER" };
    expect(await redirectOf(saveAdsAlertSettingsAction(alertsForm()))).toContain("error=");
    m.user = { id: "u1", role: "ADMIN" };
    expect(await redirectOf(saveAdsAlertSettingsAction(alertsForm({ "alerts.dropPct": "150" })))).toContain("error=");
    expect(m.saveAlerts).not.toHaveBeenCalled();
  });
});
