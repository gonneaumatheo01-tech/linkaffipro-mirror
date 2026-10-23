import { describe, expect, it } from "vitest";
import { AGENT_KEYS, TEAM_KEYS } from "@linkaffipro/agents";
import { jargonIn } from "@/tests/vocabulary/jargon-scan";
import {
  centsToEurField,
  parseAgentsModels,
  parseBudgets,
  parseLibraryChannelId,
  parsePausedAll,
  parseQuietHours,
  quietHoursText,
  teamConfigView,
  DEFAULT_AGENTS_MODELS,
} from "./config";
import { spendView, teamPills } from "./display";
import { missionsCsv, runsCsv } from "./csv";
import {
  parseAgentsSettingsForm,
  parseChannelPlanForm,
  parseQuietHoursText,
  parseSecretValue,
  parseTeamSettingsForm,
  planFitsWindow,
  splitList,
} from "./forms";
import { journalParams, parseJournalFilters } from "./journal";
import {
  missionsWhere,
  parseDailyReport,
  parseMissionFilters,
  parseSteps,
  payloadSummary,
  rangeStart,
  stuckReason,
} from "./missions";
import { isKnownSecretKey, secretInfo } from "./secrets";
import { cycleLate } from "./system-status";
import {
  PROVIDER_LABELS,
  TEAM_CHAINS,
  TEAM_NAMES,
  TEAM_PROVIDERS,
  canOpenAgentsSettings,
  canSetLevel,
  canSetSimulation,
  parseLevel,
  parseTeamParam,
} from "./teams";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("équipes", () => {
  it("quatre équipes, jamais « Dating » affiché, une chaîne d'agents connus chacune", () => {
    expect(Object.keys(TEAM_NAMES).sort()).toEqual([...TEAM_KEYS].sort());
    for (const t of TEAM_KEYS) {
      expect(jargonIn(TEAM_NAMES[t])).toEqual([]);
      for (const a of TEAM_CHAINS[t]) expect(AGENT_KEYS).toContain(a);
    }
    expect(TEAM_NAMES.dating).toBe("Rencontres");
    expect(TEAM_CHAINS.dating.at(-1)).toBe("publication");
  });

  it("adresse : équipe connue, sinon null (404)", () => {
    expect(parseTeamParam("casino")).toBe("casino");
    expect(parseTeamParam("Casino")).toBeNull();
    expect(parseTeamParam("validations")).toBeNull();
    expect(parseTeamParam(undefined)).toBeNull();
  });

  it("droits : niveau 2 et vrais canaux réservés aux administrateurs, réglages aussi", () => {
    expect(canSetLevel("MANAGER", 1)).toBe(true);
    expect(canSetLevel("MANAGER", 2)).toBe(false);
    expect(canSetLevel("ADMIN", 2)).toBe(true);
    expect(canSetSimulation("MANAGER", true)).toBe(true);
    expect(canSetSimulation("MANAGER", false)).toBe(false);
    expect(canSetSimulation("ADMIN", false)).toBe(true);
    expect(canOpenAgentsSettings("MANAGER")).toBe(false);
    expect(canOpenAgentsSettings("ADMIN")).toBe(true);
  });

  it("niveau lu dans un formulaire", () => {
    expect(parseLevel("0")).toBe(0);
    expect(parseLevel(" 2 ")).toBe(2);
    expect(parseLevel("3")).toBeNull();
    expect(parseLevel("")).toBeNull();
  });
});

describe("réglages d'une équipe", () => {
  it("sans ligne en base : simulation active, niveau 0, 900 caractères", () => {
    const c = teamConfigView("dating", null);
    expect(c).toMatchObject({ exists: false, simulation: true, paused: false, autonomyLevel: 0, maxTextLength: 900 });
  });

  it("relit les champs abîmés sans planter", () => {
    expect(parseBudgets({ llm: 500, video: -1, odds: "x", other: 3 })).toEqual({ llm: 500 });
    expect(parseBudgets(null)).toEqual({});
    expect(parseQuietHours([{ start: "23:00", end: "08:00" }, { start: "25:00", end: "1" }, 3])).toEqual([
      { start: "23:00", end: "08:00" },
    ]);
    expect(quietHoursText([{ start: "23:00", end: "08:00" }])).toBe("23:00-08:00");
    expect(centsToEurField(1250)).toBe("12,5");
    expect(centsToEurField(undefined)).toBe("");
  });

  it("modèles, médiathèque et pause générale", () => {
    expect(parseAgentsModels(null)).toEqual(DEFAULT_AGENTS_MODELS);
    expect(parseAgentsModels({ fast: "inconnu", strong: DEFAULT_AGENTS_MODELS.fast })).toEqual({
      fast: DEFAULT_AGENTS_MODELS.fast,
      strong: DEFAULT_AGENTS_MODELS.fast,
    });
    expect(parseLibraryChannelId("ch1")).toBe("ch1");
    expect(parseLibraryChannelId({ channelId: "ch2" })).toBe("ch2");
    expect(parseLibraryChannelId("")).toBeNull();
    expect(parsePausedAll(true)).toBe(true);
    expect(parsePausedAll({ paused: true })).toBe(true);
    expect(parsePausedAll(null)).toBe(false);
  });
});

describe("formulaires", () => {
  it("liste : virgules ou lignes, sans doublon", () => {
    expect(splitList("casino, Casino\nbonus ; ")).toEqual(["casino", "bonus"]);
  });

  it("heures calmes : plages valides, minuit compris, erreurs claires", () => {
    expect(parseQuietHoursText("23:00-08:00\n12h30 - 13h00")).toEqual({
      ok: true,
      data: [
        { start: "23:00", end: "08:00" },
        { start: "12:30", end: "13:00" },
      ],
    });
    expect(parseQuietHoursText("9:00-9:00").ok).toBe(false);
    expect(parseQuietHoursText("demain").ok).toBe(false);
  });

  it("réglages d'équipe : longueur bornée, plafonds en euros → centimes, vide = aucun plafond", () => {
    const ok = parseTeamSettingsForm(
      fd({ styleGuidelines: " court ", forbiddenWords: "gratuit\nargent facile", maxTextLength: "600", budget_llm: "12,5", budget_video: "" }),
      TEAM_PROVIDERS.dating,
      PROVIDER_LABELS,
    );
    expect(ok).toEqual({
      ok: true,
      data: {
        styleGuidelines: "court",
        forbiddenWords: ["gratuit", "argent facile"],
        maxTextLength: 600,
        quietHours: [],
        budgets: { llm: 1250 },
      },
    });
    expect(parseTeamSettingsForm(fd({ maxTextLength: "10" }), ["llm"], PROVIDER_LABELS).ok).toBe(false);
    expect(parseTeamSettingsForm(fd({ budget_llm: "-3" }), ["llm"], PROVIDER_LABELS).ok).toBe(false);
  });

  it("plan d'un canal : fenêtre dans la journée, mélange non vide", () => {
    const base = {
      channelId: "c1",
      enabled: "on",
      postsPerDay: "3",
      windowStart: "09:00",
      windowEnd: "22:00",
      minSpacingMinutes: "90",
      mix_text: "1",
      mix_photo: "2",
      themes: "soirée, week-end",
    };
    const r = parseChannelPlanForm(fd(base));
    expect(r).toMatchObject({
      ok: true,
      data: { enabled: true, postsPerDay: 3, mix: { video: 0, photo: 2, text: 1 }, themes: ["soirée", "week-end"], personaId: null },
    });
    expect(parseChannelPlanForm(fd({ ...base, windowEnd: "08:00" })).ok).toBe(false);
    expect(parseChannelPlanForm(fd({ ...base, mix_text: "0", mix_photo: "0" })).ok).toBe(false);
    expect(parseChannelPlanForm(fd({ ...base, postsPerDay: "99" })).ok).toBe(false);
    expect(planFitsWindow({ postsPerDay: 3, windowStart: "09:00", windowEnd: "10:00", minSpacingMinutes: 90 })).toBe(false);
    expect(planFitsWindow({ postsPerDay: 3, windowStart: "09:00", windowEnd: "22:00", minSpacingMinutes: 90 })).toBe(true);
  });

  it("réglages généraux : modèle de la liste seulement", () => {
    const m = DEFAULT_AGENTS_MODELS;
    expect(parseAgentsSettingsForm(fd({ modelFast: m.fast, modelStrong: m.strong, libraryChannelId: "" }))).toEqual({
      ok: true,
      data: { fast: m.fast, strong: m.strong, libraryChannelId: null },
    });
    expect(parseAgentsSettingsForm(fd({ modelFast: "gpt", modelStrong: m.strong })).ok).toBe(false);
  });

  it("clé collée : seule, sans espace", () => {
    expect(parseSecretValue("  abcdefgh1234 ")).toEqual({ ok: true, data: "abcdefgh1234" });
    expect(parseSecretValue("").ok).toBe(false);
    expect(parseSecretValue("ma clé abc").ok).toBe(false);
  });
});

describe("missions", () => {
  const now = new Date("2026-10-23T10:00:00Z");

  it("étapes : une étape abîmée est ignorée, le statut inconnu retombe sur « À venir »", () => {
    const steps = parseSteps([
      { agent: "redaction", status: "DONE", startedAt: "2026-10-23T09:00:00Z", costCents: 3, summary: "Accroche" },
      { agent: "controle", status: "BIZARRE" },
      "x",
      { status: "DONE" },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ agent: "redaction", status: "DONE", costCents: 3, summary: "Accroche" });
    expect(steps[0]!.startedAt?.toISOString()).toBe("2026-10-23T09:00:00.000Z");
    expect(steps[1]!.status).toBe("PENDING");
    expect(parseSteps(null)).toEqual([]);
  });

  it("filtres : valeurs inconnues ignorées, période en jours de Paris", () => {
    expect(parseMissionFilters({ status: "DONE", range: "30d", channel: "c1" })).toEqual({
      status: "DONE",
      range: "30d",
      channelId: "c1",
    });
    expect(parseMissionFilters({ status: "x", range: "y" })).toEqual({ status: "", range: "7d", channelId: "" });
    // Minuit à Paris le 23 octobre (heure d'été) = 22 h UTC la veille.
    expect(rangeStart("today", now)?.toISOString()).toBe("2026-10-22T22:00:00.000Z");
    expect(rangeStart("all", now)).toBeNull();
    expect(missionsWhere({ status: "", range: "all", channelId: "" }, now, "dating")).toEqual({ teamKey: "dating" });
  });

  it("missions bloquées : en cours muette 15 min, plafond, attente de plus de 24 h", () => {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(stuckReason({ status: "RUNNING", lastActivityAt: ago(20 * 60000) }, now)).toMatch(/20 min/);
    expect(stuckReason({ status: "RUNNING", lastActivityAt: ago(5 * 60000) }, now)).toBeNull();
    expect(stuckReason({ status: "BLOCKED_BUDGET", lastActivityAt: now }, now)).toMatch(/Plafond/);
    expect(stuckReason({ status: "WAITING_VALIDATION", lastActivityAt: ago(25 * 3600000) }, now)).toMatch(/24 h/);
    expect(stuckReason({ status: "WAITING_HUMAN", lastActivityAt: ago(3600000) }, now)).toBeNull();
    expect(stuckReason({ status: "DONE", lastActivityAt: ago(99 * 3600000) }, now)).toBeNull();
  });

  it("résumé de la charge utile et rapport du matin", () => {
    expect(payloadSummary({ format: "text", simulation: true, reasons: ["doute", 3] })).toMatchObject({
      format: "Texte",
      simulation: true,
      reasons: ["doute"],
    });
    expect(payloadSummary(null).simulation).toBe(true);
    const r = parseDailyReport({ id: "e1", occurredAt: now, payload: { day: "2026-10-23", lines: ["Rencontres : 2 publiés", 4] } });
    expect(r).toMatchObject({ day: "2026-10-23", lines: ["Rencontres : 2 publiés"] });
    expect(parseDailyReport({ id: "e2", occurredAt: now, payload: null }).day).toBe("2026-10-23");
  });

  it("Grand Chef en retard au-delà d'une heure sans passage", () => {
    expect(cycleLate(null, now)).toBe(true);
    expect(cycleLate(new Date(now.getTime() - 30 * 60000), now)).toBe(false);
    expect(cycleLate(new Date(now.getTime() - 61 * 60000), now)).toBe(true);
  });
});

describe("affichage", () => {
  it("pastilles : pause générale prioritaire, simulation toujours dite", () => {
    const c = teamConfigView("casino", null);
    expect(teamPills(c, false).map((p) => p.label)).toEqual(["Active", "Simulation", "Niveau 0"]);
    expect(teamPills({ ...c, paused: true }, true)[0]!.label).toBe("Pause générale");
    expect(teamPills({ ...c, paused: true, simulation: false }, false).map((p) => p.label)).toEqual([
      "En pause",
      "Vrais canaux",
      "Niveau 0",
    ]);
  });

  it("dépense face au plafond : 80 % en ambre, 100 % en rouge, sans plafond la dépense seule", () => {
    expect(spendView(500, {}).capCents).toBeNull();
    expect(spendView(500, {}).text).toMatch(/aucun plafond/);
    expect(spendView(800, { llm: 1000 })).toMatchObject({ pct: 80, tone: "warning" });
    expect(spendView(1500, { llm: 1000 })).toMatchObject({ pct: 100, tone: "danger" });
    expect(spendView(100, { llm: 500, video: 500 })).toMatchObject({ pct: 10, tone: "brand", capCents: 1000 });
  });
});

describe("journal et exports", () => {
  it("filtres du journal et adresse d'export", () => {
    const f = parseJournalFilters({ view: "runs", team: "sports", status: "FAILED", range: "7d" });
    expect(f).toMatchObject({ view: "runs", team: "sports", status: "FAILED" });
    expect(journalParams(f)).toBe("?view=runs&team=sports&status=FAILED");
    expect(journalParams(f, { view: "missions" })).toBe("?team=sports&status=FAILED");
    expect(parseJournalFilters({ team: "x" }).team).toBeNull();
  });

  it("CSV des missions et des passages : libellés du client, jamais le texte d'un post", () => {
    const m = missionsCsv([
      {
        id: "m1",
        createdAt: new Date("2026-10-23T08:00:00Z"),
        teamKey: "dating",
        kind: "POST",
        channelTitle: "Canal Test",
        status: "WAITING_VALIDATION",
        currentAgent: "controle",
        createdBy: "HUMAN",
        isTest: true,
        costCents: 12,
        scheduledFor: null,
        lastError: null,
      },
    ]);
    expect(m).toContain("Rencontres;Post;Canal Test;Attend votre validation;Contrôle qualité;Équipe;oui;0,12");
    const r = runsCsv([
      {
        id: "r1",
        missionId: "m1",
        teamKey: "casino",
        agentKey: "redaction",
        status: "OK",
        startedAt: new Date("2026-10-23T08:00:00Z"),
        durationMs: 1500,
        costCents: 3,
        inputSummary: "canal Casino",
        outputSummary: "accroche bonus",
        error: null,
      },
    ]);
    expect(r).toContain("Casino;Rédaction;Réussi;1,5;0,03;canal Casino;accroche bonus;;m1");
    expect(jargonIn(m + r)).toEqual([]);
  });

  it("clés connues : libellé et adresse de création", () => {
    expect(isKnownSecretKey("providers.fal.apiKey")).toBe(true);
    expect(isKnownSecretKey("autre")).toBe(false);
    expect(secretInfo("providers.fal.apiKey").label).toBe("fal.ai");
    expect(secretInfo("providers.x.apiKey").label).toBe("x");
  });
});
