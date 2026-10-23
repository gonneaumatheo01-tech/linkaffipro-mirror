/**
 * Moteur de l'équipe Casino (phase 22), sans base ni réseau : stock et seuil, demande groupée (une par jour, pas de
 * relance avant 3 jours), choix du média (rotation 30 jours, jamais deux canaux le même jour, pondération), replis en
 * cascade, refus d'un média IA, Rédaction avec l'offre, Planification (fenêtres de l'Algorithme, 4 h entre vidéos),
 * validations « toujours ».
 */
import { describe, expect, it, vi } from "vitest";
import type * as Db from "@linkaffipro/db";

vi.mock("@linkaffipro/db", async (importOriginal) => {
  const orig = await importOriginal<typeof Db>();
  return {
    ...orig,
    createAgentPost: vi.fn(async (db: { post: { create(a: unknown): Promise<{ id: string }> } }, input: Record<string, unknown>) => {
      const post = await db.post.create({
        data: {
          channelId: input.channelId,
          botId: "bot",
          status: "SCHEDULED",
          scheduledAt: input.scheduledAt,
          text: input.text,
          mediaAssetIds: input.mediaAssetIds,
          agentMissionId: input.agentMissionId,
          buttons: input.offer ? [[{ text: "offre", type: "OFFER" }]] : [],
        },
      });
      return { postId: post.id, botId: "bot", publisher: "BOT", trackingLinkId: null };
    }),
  };
});

import { createEngineKit } from "../testing/engine-kit";
import { createMission } from "../missions/lifecycle";
import { createFakeLlm } from "../providers/fake";
import { alwaysValidateReason } from "../orchestrator/autonomy";
import { preferenceFor } from "../agents/planification/plan";
import { videoGapMinutes } from "../rules/slots";
import { parisWeekday } from "../rules/time";
import { inventedFigures } from "../rules/figures";
import { buildDailyReport } from "../orchestrator/reports";
import { casinoAttempts, casinoFallbackNotes, casinoMix, CASINO_DEFAULT_MIX } from "./format";
import { pickCasinoAsset, stockState, type CasinoAsset, type CasinoUsage } from "./pick";
import { pickDayTheme, parsePlanThemes, themeFactors } from "./rotation";
import { stockRows } from "./stock";
import { casinoRequestQuestion, planCasinoRequest, runCasinoStockCheck, CASINO_MEDIA_ASKED_KEY } from "./requests";
import { casinoMediaRefusal, offerButtonProblem } from "./control";
import { parseCasinoSettings } from "./settings";
import { setupThemeAsks, ensureCasinoSetupQuestions } from "./setup";
import { casinoStock } from "./contracts";
import { respondToRequest, type HumanRequestRow } from "../human/respond";

const NOW = new Date("2026-10-23T08:07:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function asset(id: string, theme: string, o: Partial<CasinoAsset> & { kind?: "video" | "photo" } = {}): CasinoAsset {
  return {
    id,
    createdAt: o.createdAt ?? new Date("2026-10-01"),
    mimeType: o.kind === "photo" ? "image/jpeg" : "video/mp4",
    origin: o.origin === undefined ? "HUMAN" : o.origin,
    theme,
    tags: o.tags ?? [`theme:${theme}`],
  };
}

describe("réglages et thèmes", () => {
  it("réglages : défauts, valeurs bornées, clés de thème ASCII", () => {
    expect(parseCasinoSettings({})).toMatchObject({ lowStock: 3, rotationDays: 30 });
    expect(parseCasinoSettings({}).themes).toContain("machines-a-sous");
    expect(parseCasinoSettings({ casino: { themes: ["Roulette", "Machines à sous"], lowStock: 5, rotationDays: 0 } })).toEqual({
      themes: ["roulette", "machines-a-sous"],
      lowStock: 5,
      rotationDays: 30,
    });
  });
  it("thèmes d'un plan : objets pondérés et ancien format texte", () => {
    expect(parsePlanThemes([{ theme: "roulette", weight: 3 }, "bonus", { theme: "x", weight: -1 }, "bonus"])).toEqual([
      { theme: "roulette", weight: 3 },
      { theme: "bonus", weight: 1 },
      { theme: "x", weight: 1 },
    ]);
  });
});

describe("stock et seuil", () => {
  it("vidéos fournies non utilisées sur le canal depuis 30 jours ; manque sous 3, vide à 0", () => {
    const assets = [asset("a", "roulette"), asset("b", "roulette"), asset("c", "roulette"), asset("p", "roulette", { kind: "photo" }), asset("ai", "roulette", { origin: "AI" })];
    const usages: CasinoUsage[] = [
      { assetId: "a", channelId: "c1", usedAt: ago(10) },
      { assetId: "b", channelId: "c1", usedAt: ago(40) },
    ];
    const rows = stockRows(
      [
        { id: "c1", title: "Casino VIP", themes: [{ theme: "roulette", weight: 1 }, { theme: "bonus", weight: 1 }] },
        { id: "c2", title: "Casino Live", themes: [{ theme: "roulette", weight: 1 }] },
      ],
      assets,
      usages,
      { lowStock: 3, rotationDays: 30 },
      NOW,
    );
    expect(rows).toEqual([
      { channelId: "c1", channelTitle: "Casino VIP", theme: "roulette", unused: 2, state: "low" },
      { channelId: "c1", channelTitle: "Casino VIP", theme: "bonus", unused: 0, state: "empty" },
      { channelId: "c2", channelTitle: "Casino Live", theme: "roulette", unused: 3, state: "ok" },
    ]);
    expect(stockState(3, 3)).toBe("ok");
    expect(stockState(2, 3)).toBe("low");
    expect(stockState(0, 3)).toBe("empty");
  });
});

describe("demande groupée", () => {
  const low = [
    { channelId: "c1", channelTitle: "Casino VIP", theme: "roulette", unused: 1, state: "low" as const },
    { channelId: "c2", channelTitle: "Casino Live", theme: "roulette", unused: 2, state: "low" as const },
    { channelId: "c1", channelTitle: "Casino VIP", theme: "bonus", unused: 0, state: "empty" as const },
  ];
  it("un thème par ligne, tous ses canaux, nombre souhaité et mot-clé exact", () => {
    const needs = planCasinoRequest(low, { lastDay: null, themes: {} }, "2026-10-23", 3)!;
    expect(needs).toEqual([
      { theme: "bonus", wanted: 5, channels: ["Casino VIP"], channelIds: ["c1"] },
      { theme: "roulette", wanted: 4, channels: ["Casino VIP", "Casino Live"], channelIds: ["c1", "c2"] },
    ]);
    const q = casinoRequestQuestion(needs);
    expect(q).toContain("4 vidéos roulette avec #casino #roulette (Casino VIP, Casino Live)");
    expect(q).toContain("#casino #bonus");
    expect(q.split("\n").length).toBeLessThanOrEqual(5);
  });
  it("une par jour au plus ; un thème n'est pas redemandé avant 3 jours", () => {
    expect(planCasinoRequest(low, { lastDay: "2026-10-23", themes: {} }, "2026-10-23", 3)).toBeNull();
    const twoDays = planCasinoRequest(low, { lastDay: "2026-10-21", themes: { roulette: "2026-10-21", bonus: "2026-10-21" } }, "2026-10-23", 3);
    expect(twoDays).toBeNull();
    const three = planCasinoRequest(low, { lastDay: "2026-10-20", themes: { roulette: "2026-10-20", bonus: "2026-10-22" } }, "2026-10-23", 3);
    expect(three?.map((n) => n.theme)).toEqual(["roulette"]);
  });
});

describe("choix du média", () => {
  const o = { channelId: "c1", now: NOW, rotationDays: 30, theme: "roulette", kind: "video" as const };
  it("jamais republié sur le même canal avant 30 jours", () => {
    const assets = [asset("a", "roulette"), asset("b", "roulette", { createdAt: new Date("2026-10-05") })];
    expect(pickCasinoAsset(assets, [{ assetId: "a", channelId: "c1", usedAt: ago(29) }], o)).toBe("b");
    expect(pickCasinoAsset(assets.slice(0, 1), [{ assetId: "a", channelId: "c1", usedAt: ago(29) }], o)).toBeNull();
    expect(pickCasinoAsset(assets.slice(0, 1), [{ assetId: "a", channelId: "c1", usedAt: ago(31) }], o)).toBe("a");
    expect(pickCasinoAsset(assets.slice(0, 1), [{ assetId: "a", channelId: "c1", usedAt: ago(31) }], { ...o, rotationDays: 45 })).toBeNull();
  });
  it("jamais le même jour sur deux canaux casino ; le moins récemment utilisé d'abord", () => {
    const assets = [asset("a", "roulette"), asset("b", "roulette"), asset("c", "roulette")];
    expect(pickCasinoAsset(assets, [{ assetId: "a", channelId: "c2", usedAt: new Date(NOW.getTime() - 3600_000) }], o)).toBe("b");
    // a utilisé ailleurs hier, b avant-hier, c jamais : c d'abord, puis b.
    const used: CasinoUsage[] = [
      { assetId: "a", channelId: "c2", usedAt: ago(1) },
      { assetId: "b", channelId: "c2", usedAt: ago(2) },
    ];
    expect(pickCasinoAsset(assets, used, o)).toBe("c");
    expect(pickCasinoAsset(assets.slice(0, 2), used, o)).toBe("b");
  });
  it("seulement des médias fournis, du bon type et du bon thème (tags compris)", () => {
    const assets = [asset("ai", "roulette", { origin: "AI" }), asset("none", "roulette", { origin: null }), asset("ph", "roulette", { kind: "photo" }), asset("bo", "bonus", { tags: ["theme:bonus", "theme:roulette"] })];
    expect(pickCasinoAsset(assets, [], o)).toBe("bo");
    expect(pickCasinoAsset(assets, [], { ...o, kind: "photo" })).toBe("ph");
    expect(pickCasinoAsset(assets.slice(0, 2), [], o)).toBeNull();
  });
  it("thème du jour pondéré : poids 2 / 1 → 4 jours roulette, 2 jours bonus sur 6 ; corrigé par les résultats", () => {
    const themes = [
      { theme: "roulette", weight: 2 },
      { theme: "bonus", weight: 1 },
    ];
    const history: string[] = [];
    for (let i = 0; i < 6; i++) history.unshift(pickDayTheme(themes, history)!);
    expect(history.filter((t) => t === "roulette")).toHaveLength(4);
    expect(history.filter((t) => t === "bonus")).toHaveLength(2);
    // Jamais deux fois de suite le même thème quand l'autre est aussi en retard.
    expect(pickDayTheme(themes, ["roulette", "bonus"])).toBe("roulette");
    // L'équipe Algorithme a mesuré le bonus bien meilleur : il passe devant.
    const factors = themeFactors([
      ...Array.from({ length: 3 }, () => ({ theme: "bonus", views: 900 })),
      ...Array.from({ length: 3 }, () => ({ theme: "roulette", views: 100 })),
    ]);
    expect(factors.get("bonus")).toBe(1.8);
    expect(factors.get("roulette")).toBe(0.5);
    const weighted: string[] = [];
    for (let i = 0; i < 6; i++) weighted.unshift(pickDayTheme(themes, weighted, factors)!);
    expect(weighted.filter((t) => t === "bonus").length).toBeGreaterThan(weighted.filter((t) => t === "roulette").length);
    // Pas assez de posts : poids inchangé.
    expect(themeFactors([{ theme: "bonus", views: 900 }, { theme: "roulette", views: 1 }]).size).toBe(0);
  });
});

describe("replis et rapport", () => {
  it("cascade : autre thème du canal → image → texte", () => {
    expect(casinoAttempts("video", ["roulette", "bonus"])).toEqual([
      { format: "video", theme: "roulette" },
      { format: "video", theme: "bonus" },
      { format: "photo", theme: "roulette" },
      { format: "photo", theme: "bonus" },
      { format: "text", theme: "roulette" },
    ]);
    expect(casinoAttempts("photo", ["roulette"])).toEqual([
      { format: "photo", theme: "roulette" },
      { format: "text", theme: "roulette" },
    ]);
  });
  it("lignes du rapport du matin", () => {
    const f = (from: "video" | "photo", to: "video" | "photo" | "text", fromTheme: string) => ({ from, to, fromTheme, toTheme: fromTheme });
    expect(casinoFallbackNotes([f("video", "text", "roulette"), f("video", "text", "roulette"), f("video", "text", "roulette"), f("video", "photo", "bonus"), f("video", "video", "bonus")])).toEqual([
      "3 posts texte faute de vidéos : roulette",
      "1 image faute de vidéos : bonus",
      "1 vidéo sur un autre thème faute de vidéos : bonus",
    ]);
  });
  it("mélange par défaut d'un canal casino : 2 vidéos, 1 image, 1 texte", () => {
    expect(casinoMix(null)).toEqual(CASINO_DEFAULT_MIX);
    expect(casinoMix({ video: 0, photo: 0, text: 1 })).toEqual(CASINO_DEFAULT_MIX);
    expect(casinoMix({ video: 1, photo: 0, text: 3 })).toEqual({ video: 1, photo: 0, text: 3 });
  });
});

describe("règles du contrôle", () => {
  it("média IA ou d'origine inconnue refusé sur un canal casino", () => {
    expect(casinoMediaRefusal({ origin: "AI" })).toMatch(/IA/);
    expect(casinoMediaRefusal({ origin: null })).toMatch(/fournis par le client/);
    expect(casinoMediaRefusal({ origin: "HUMAN" })).toBeNull();
  });
  it("chiffres : seulement ceux de la fiche de l'offre", () => {
    expect(inventedFigures("Jusqu'à <b>200 €</b> de bonus et 50 tours gratuits", null)).toEqual(["200", "50"]);
    expect(inventedFigures("Jusqu'à 200 € de bonus et 50 tours gratuits", "Bonus de bienvenue 200 € + 50 free spins")).toEqual([]);
    expect(inventedFigures("Mise x10 ce soir", "Bonus de 100 %")).toEqual(["10"]);
    expect(inventedFigures("Rendez-vous à 21h, la roulette tourne", null)).toEqual([]);
    expect(inventedFigures("Bonus de 1 000 €", "jusqu'à 1000 € offerts")).toEqual([]);
  });
  it("bouton Offre : campagne introuvable ou sans offre active → problème", () => {
    expect(offerButtonProblem({ campaignId: null, offer: null, text: "x" })).toBeNull();
    expect(offerButtonProblem({ campaignId: "k", offer: null, text: "x" })).toMatch(/introuvable/);
    expect(offerButtonProblem({ campaignId: "k", offer: { name: "Lucky", buttonReady: false }, text: "x" })).toMatch(/aucune offre active/);
    expect(offerButtonProblem({ campaignId: "k", offer: { name: "Lucky", buttonReady: true }, text: "x" })).toBeNull();
  });
  it("« toujours validé » casino : nouveau canal, nouveau thème, offre jamais utilisée", () => {
    const base = { teamKey: "casino", format: "video" as const, personaVideosDone: 0, personaPhotosDone: 0, casinoChannel: true };
    expect(alwaysValidateReason({ ...base, firstPostOfChannel: false })).toBeNull();
    expect(alwaysValidateReason({ ...base, firstPostOfChannel: true })).toBe("toujours validé : nouveau canal");
    expect(alwaysValidateReason({ ...base, firstPostOfChannel: false, newTheme: true, theme: "roulette" })).toBe("toujours validé : nouveau thème (roulette)");
    expect(alwaysValidateReason({ ...base, firstPostOfChannel: false, newOffer: true, offerName: "Lucky" })).toBe("toujours validé : offre jamais utilisée (Lucky)");
    // Mission de test (canal Test) : seules les impossibilités du bouton Offre comptent.
    expect(alwaysValidateReason({ ...base, casinoChannel: false, firstPostOfChannel: true, newTheme: true })).toBeNull();
  });
});

describe("planification", () => {
  it("fenêtres de l'équipe Algorithme quand elles existent, sinon meilleurs horaires ; 4 h entre vidéos", () => {
    const best = new Map([["5-10", 3]]);
    const windows = [{ day: 5, start: "20:00", end: "22:00", score: 2 }];
    const m = { payload: { format: "text" as const } };
    const withWindows = preferenceFor("casino", best, windows, m);
    expect(withWindows.get("5-20")).toBe(2);
    expect(withWindows.has("5-10")).toBe(false);
    expect(preferenceFor("casino", best, [], m).get("5-10")).toBe(3);
    // Les autres équipes additionnent les deux (phase 21).
    expect(preferenceFor("dating", best, windows, m).get("5-10")).toBe(3);
    expect(videoGapMinutes("casino")).toBe(240);
    expect(videoGapMinutes("dating")).toBe(360);
  });
});

describe("mise en route", () => {
  it("thèmes demandés regroupés par thème ; canal sans thème → 3 premiers thèmes de départ", () => {
    expect(setupThemeAsks([{ title: "A", themes: ["roulette"] }, { title: "B", themes: [] }])).toEqual([
      { theme: "roulette", channels: ["A", "B"], channelIds: [], defaulted: false },
      { theme: "machines-a-sous", channels: ["B"], channelIds: [], defaulted: true },
      { theme: "blackjack", channels: ["B"], channelIds: [], defaulted: true },
    ]);
  });
});

/* ------------------------------------------------------------------------------------------------------------- */
/* Chaîne complète en mémoire.                                                                                     */
/* ------------------------------------------------------------------------------------------------------------- */

type Kit = ReturnType<typeof createEngineKit>;

function setup(o: { level?: 0 | 1 | 2; campaign?: boolean; llm?: ReturnType<typeof createFakeLlm>; windows?: unknown[] } = {}) {
  const kit = createEngineKit({ start: NOW, ...(o.llm ? { llm: o.llm } : {}) });
  const t = kit.prisma._model;
  t("channel").rows.push(
    { id: "c1", title: "Casino VIP", vertical: "CASINO", isTest: false, isActive: true, language: "fr", type: "CHANNEL", telegramChatId: -1003n, createdAt: new Date("2026-01-01") },
    { id: "c2", title: "Casino Live", vertical: "CASINO", isTest: false, isActive: true, language: "fr", type: "CHANNEL", telegramChatId: -1004n, createdAt: new Date("2026-01-02") },
  );
  t("agentTeamConfig").rows.push({ id: "cfg", teamKey: "casino", enabled: true, simulation: true, paused: false, autonomyLevel: o.level ?? 2, monthlyBudgetCents: {}, settings: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [], consecutiveFailures: 0 });
  for (const id of ["c1", "c2"])
    t("channelAgentPlan").rows.push({
      id: `plan-${id}`,
      channelId: id,
      teamKey: "casino",
      enabled: true,
      postsPerDay: 6,
      windowStart: "00:00",
      windowEnd: "24:00",
      minSpacingMinutes: 0,
      mix: CASINO_DEFAULT_MIX,
      personaId: null,
      campaignId: o.campaign && id === "c1" ? "camp1" : null,
      themes: [
        { theme: "roulette", weight: 2 },
        { theme: "bonus", weight: 1 },
      ],
      suggestedWindows: id === "c1" && o.windows ? o.windows : [],
      styleNotes: "les questions courtes marchent",
    });
  if (o.campaign) {
    t("campaign").rows.push({ id: "camp1", name: "Lucky Spin octobre", vertical: "CASINO", status: "ACTIVE", affiliateCampaignIds: ["off1"], createdAt: new Date() });
    t("affiliateCampaign").rows.push({ id: "off1", name: "Lucky Spin", isActive: true, trackingUrlTemplate: "https://x.example/{subid}" });
    t("persona").rows.push({ id: "pp", name: "Mia", campaignId: "camp1", affiliateCampaignId: null, offerPitch: "Bonus de bienvenue 100 % jusqu'à 200 €.", createdAt: new Date() });
  }
  return kit;
}

let seq = 0;
function addMedia(kit: Kit, theme: string, o: { kind?: "video" | "photo"; origin?: string | null } = {}): string {
  const id = `m${++seq}`;
  kit.prisma._model("mediaAsset").rows.push({
    id,
    filename: `${id}.${o.kind === "photo" ? "jpg" : "mp4"}`,
    mimeType: o.kind === "photo" ? "image/jpeg" : "video/mp4",
    size: 3,
    bytes: new Uint8Array([1, 2, 3]),
    duration: 8,
    teamKey: "casino",
    theme,
    tags: ["casino", `theme:${theme}`],
    kind: o.kind === "photo" ? "PHOTO" : "SOURCE",
    origin: o.origin === undefined ? "HUMAN" : o.origin,
    createdAt: new Date(NOW.getTime() - seq * 60_000),
  });
  return id;
}

/** Missions déjà publiées : le canal, les thèmes et l'offre ne sont plus des nouveautés. */
function history(kit: Kit, channelId: string, extra: Record<string, unknown> = {}) {
  for (const theme of ["roulette", "bonus"])
    kit.prisma._model("agentMission").rows.push({ id: `h-${channelId}-${theme}`, teamKey: "casino", channelId, status: "DONE", payload: { theme, ...extra }, steps: [], createdAt: ago(40), planDay: "2026-09-13" });
}

async function mission(kit: Kit, format?: "video" | "photo" | "text", channelId = "c1") {
  const r = await createMission(kit.deps, { teamKey: "casino", channelId, createdBy: "GRAND_CHEF", ...(format ? { format } : {}) });
  if (!r.ok) throw new Error(r.reason);
  return r.missionId;
}

const pay = (kit: Kit, id: string) => kit.mission(id).payload as Record<string, unknown>;

describe("chaîne Casino (en mémoire)", () => {
  it("vidéo fournie → Rédaction → Planification → Contrôle → Publication sur le canal Test ; utilisation comptée sur le canal visé", async () => {
    const kit = setup();
    history(kit, "c1");
    const v = addMedia(kit, "roulette");
    const id = await mission(kit, "video");
    expect(await kit.drain()).toEqual(["next", "next", "next", "next", "done"]);
    const p = pay(kit, id);
    expect(p).toMatchObject({ format: "video", theme: "roulette", dayTheme: "roulette", mediaAssetId: v });
    const post = kit.t("post")[0]!;
    expect(post).toMatchObject({ channelId: "test", mediaAssetIds: [v] });
    expect(String(post.text)).toMatch(/^\[SIMULATION équipe Casino → Casino VIP\]\n/);
    expect(kit.t("mediaUsage")).toEqual([expect.objectContaining({ assetId: v, channelId: "c1" })]);
    expect((kit.mission(id).steps as Array<{ agent: string }>).map((s) => s.agent)).not.toContain("media-ia");
  });

  it("replis en cascade : autre thème → image → texte, journalisés", async () => {
    const kit = setup();
    history(kit, "c1");
    addMedia(kit, "bonus");
    addMedia(kit, "roulette", { kind: "photo" });
    const a = await mission(kit, "video");
    await kit.drain();
    expect(pay(kit, a)).toMatchObject({ format: "video", theme: "bonus", dayTheme: "roulette" });
    const b = await mission(kit, "video");
    await kit.drain();
    expect(pay(kit, b)).toMatchObject({ format: "photo", theme: "roulette" });
    const c = await mission(kit, "video");
    await kit.drain();
    expect(pay(kit, c)).toMatchObject({ format: "text", mediaAssetId: null });
    const events = kit.t("event").filter((e) => e.type === "agents.casino.fallback").map((e) => e.payload as Record<string, unknown>);
    expect(events.map((e) => `${e.from}>${e.to}:${e.toTheme}`)).toEqual(["video>video:bonus", "video>photo:roulette", "video>text:roulette"]);
    // Rapport du lendemain : les replis comptés.
    kit.setNow(new Date(NOW.getTime() + DAY));
    const report = await buildDailyReport(kit.deps);
    const line = report.lines.find((l) => l.startsWith("Casino"))!;
    expect(line).toContain("1 post texte faute de vidéos : roulette");
    expect(line).toContain("1 image faute de vidéos : roulette");
  });

  it("le même média n'est jamais pris le même jour par deux canaux", async () => {
    const kit = setup();
    history(kit, "c1");
    history(kit, "c2");
    const v = addMedia(kit, "roulette");
    const a = await mission(kit, "video", "c1");
    await kit.drain();
    const b = await mission(kit, "video", "c2");
    await kit.drain();
    expect(pay(kit, a).mediaAssetId).toBe(v);
    expect(pay(kit, b).mediaAssetId).not.toBe(v);
  });

  it("média IA sur un canal casino : refusé par le Contrôle, jamais publié, repli texte", async () => {
    const kit = setup();
    history(kit, "c1");
    const ai = addMedia(kit, "roulette", { origin: "AI" });
    addMedia(kit, "roulette");
    const id = await mission(kit, "video");
    await kit.drain(1);
    // Média IA glissé dans la mission (jamais choisi par la Médiathèque) : le Contrôle doit le refuser.
    const row = kit.t("agentMission").find((m) => m.id === id)!;
    row.payload = { ...(row.payload as object), mediaAssetId: ai };
    const out = await kit.drain();
    expect(out).toContain("redo");
    expect(pay(kit, id)).toMatchObject({ format: "text", mediaAssetId: null });
    expect(kit.t("post")[0]!.mediaAssetIds).toEqual([]);
    expect(kit.t("mediaUsage")).toHaveLength(0);
  });

  it("Rédaction : offre du moment, fiche de l'offre, ton du canal ; chiffre hors fiche refusé", async () => {
    const llm = createFakeLlm({
      responses: {
        redaction: (req) =>
          JSON.stringify({ text: req.user.includes("refusé") ? "La roulette t'attend avec <b>200 €</b> de bonus" : "La roulette t'attend : 500 € offerts ce soir", hook: "x", topic: "roulette" }),
      },
    });
    const kit = setup({ campaign: true, llm });
    history(kit, "c1", { offerCampaignId: "camp1" });
    addMedia(kit, "roulette");
    const id = await mission(kit, "video");
    const out = await kit.drain();
    const first = llm.calls.find((c) => c.user.startsWith("Tâche : redaction"))!;
    expect(first.user).toContain("Offre du moment (le bouton sous le post y mène) : Lucky Spin");
    expect(first.user).toContain("Bonus de bienvenue 100 % jusqu'à 200 €.");
    expect(first.user).toContain("les questions courtes marchent");
    expect(first.user).toContain("Thème de ce post : roulette");
    expect(out).toContain("redo");
    expect(kit.t("agentRun").some((r) => String(r.outputSummary).includes("chiffre absent de la fiche"))).toBe(true);
    expect(out.at(-1)).toBe("done");
    expect(kit.t("post")[0]!.buttons).toEqual([[{ text: "offre", type: "OFFER" }]]);
    expect(pay(kit, id).offerCampaignId).toBe("camp1");
  });

  it("sans fiche : la Rédaction est prévenue de n'écrire aucun chiffre", async () => {
    const llm = createFakeLlm();
    const kit = setup({ campaign: true, llm });
    kit.prisma._model("persona").rows.length = 0;
    history(kit, "c1", { offerCampaignId: "camp1" });
    await mission(kit, "text");
    await kit.drain();
    expect(llm.calls.find((c) => c.user.startsWith("Tâche : redaction"))!.user).toContain("Aucune fiche pour cette offre");
  });

  it("toujours validé au niveau 2 : nouveau canal, nouveau thème, offre jamais utilisée", async () => {
    const kit = setup({ campaign: true });
    addMedia(kit, "roulette");
    await mission(kit, "video");
    expect((await kit.drain()).at(-1)).toBe("validation");
    const reason = String(kit.t("agentValidation")[0]!.reason);
    expect(reason).toContain("nouveau canal");
    expect(reason).toContain("nouveau thème (roulette)");
    expect(reason).toContain("offre jamais utilisée (Lucky Spin)");
  });

  it("Planification : fenêtre de l'Algorithme suivie, deux vidéos à 4 h d'écart", async () => {
    const day = parisWeekday(NOW);
    const kit = setup({ windows: [{ day, start: "20:00", end: "21:00", score: 5 }] });
    history(kit, "c1");
    const t = await mission(kit, "text");
    await kit.drain();
    expect(new Date(String(pay(kit, t).slot)).toISOString()).toBe("2026-10-23T18:00:00.000Z");
    const kit2 = setup();
    history(kit2, "c1");
    addMedia(kit2, "roulette");
    addMedia(kit2, "roulette");
    const a = await mission(kit2, "video");
    await kit2.drain();
    const b = await mission(kit2, "video");
    await kit2.drain();
    const gap = Math.abs(new Date(String(pay(kit2, b).slot)).getTime() - new Date(String(pay(kit2, a).slot)).getTime());
    expect(gap).toBeGreaterThanOrEqual(4 * 3600_000);
    expect(gap).toBeLessThan(6 * 3600_000);
  });
});

describe("stock et demande groupée (en mémoire)", () => {
  it("casinoStock : par canal casino et thème du plan", async () => {
    const kit = setup();
    addMedia(kit, "roulette");
    const rows = await casinoStock(kit.prisma as never, { now: NOW });
    expect(rows.find((r) => r.channelId === "c1" && r.theme === "roulette")).toMatchObject({ unused: 1, state: "low" });
    expect(rows.find((r) => r.channelId === "c2" && r.theme === "bonus")).toMatchObject({ unused: 0, state: "empty" });
  });

  it("une demande par jour au plus, pas de relance avant 3 jours, alerte par canal", async () => {
    const kit = setup();
    addMedia(kit, "roulette");
    const r1 = await runCasinoStockCheck(kit.deps);
    expect(r1).toMatchObject({ requested: ["bonus", "roulette"] });
    expect(kit.t("humanRequest")).toHaveLength(1);
    expect(kit.sent.filter((s) => s.html.includes("#casino #roulette"))).toHaveLength(1);
    expect(kit.t("alert").filter((a) => a.kind === "agents_media_low")).toHaveLength(2);
    expect(await runCasinoStockCheck(kit.deps)).toMatchObject({ requested: null });
    // Le client a répondu « plus tard » ; le lendemain et le surlendemain : rien de nouveau.
    const req = kit.t("humanRequest")[0] as unknown as HumanRequestRow;
    await respondToRequest(kit.deps, req, "plus tard", { via: "TELEGRAM", userId: null });
    for (const d of [1, 2]) {
      kit.setNow(new Date(NOW.getTime() + d * DAY));
      expect(await runCasinoStockCheck(kit.deps)).toMatchObject({ requested: null });
    }
    kit.setNow(new Date(NOW.getTime() + 3 * DAY));
    expect(await runCasinoStockCheck(kit.deps)).toMatchObject({ requested: ["bonus", "roulette"] });
    expect(kit.t("humanRequest")).toHaveLength(2);
    expect((kit.t("setting").find((s) => s.key === CASINO_MEDIA_ASKED_KEY)!.value as { lastDay: string }).lastDay).toBe("2026-10-26");
  });

  it("alerte coupée dans Réglages → Alertes : aucune alerte, la demande part quand même", async () => {
    const kit = setup();
    await kit.prisma.setting.create({ data: { key: "alerts.thresholds", value: { enabled: { agents_media_low: false } } } });
    expect(await runCasinoStockCheck(kit.deps)).toMatchObject({ alerts: { skipped: "alerte désactivée" } });
    expect(kit.t("alert")).toHaveLength(0);
    expect(kit.t("humanRequest")).toHaveLength(1);
  });

  it("mise en route : campagne du bouton par canal (choix numéroté) puis vidéos par thème, une seule fois", async () => {
    const kit = setup({ campaign: true });
    const r = await ensureCasinoSetupQuestions(kit.deps);
    // c1 a déjà sa campagne : un choix pour c2, puis roulette et bonus.
    expect(r.queued).toBe(3);
    expect((await ensureCasinoSetupQuestions(kit.deps)).queued).toBe(0);
    const choice = kit.t("humanRequest").find((h) => h.kind === "CHOICE")! as unknown as HumanRequestRow;
    expect(choice.question).toContain("« Casino Live »");
    expect(kit.sent[0]!.html).toContain("1. Lucky Spin octobre");
    const res = await respondToRequest(kit.deps, choice, "1", { via: "TELEGRAM", userId: null });
    expect(res.message).toContain("Lucky Spin octobre");
    expect(kit.t("channelAgentPlan").find((p) => p.channelId === "c2")!.campaignId).toBe("camp1");
    const media = kit.t("humanRequest").filter((h) => h.kind === "MEDIA").map((h) => h.question);
    expect(media[0]).toContain("#casino #roulette");
  });
});
