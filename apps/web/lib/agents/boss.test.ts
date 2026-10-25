import { describe, expect, it } from "vitest";
import { BOSS_ORDERS_DEFAULT_MONTHLY_CENTS } from "@linkaffipro/agents";
import {
  DEFAULT_BOSS_BUDGET_CENTS,
  availabilityOf,
  bossBudgetGauge,
  parseBossBudget,
  parseBossBudgetForm,
  parseBossName,
  parseBossNameForm,
  responsibilitiesLabel,
  telegramLink,
  turnAuthor,
  unmetCsv,
} from "./boss";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("page Kevin : règles pures", () => {
  it("prénom et plafond lus en base, avec leurs valeurs par défaut", () => {
    expect(parseBossName(undefined)).toBe("Kevin");
    expect(parseBossName("  Bob ")).toBe("Bob");
    expect(parseBossName({ x: 1 })).toBe("Kevin");
    expect(parseBossBudget(undefined)).toBe(3000);
    expect(parseBossBudget({ monthlyCents: 0 })).toBe(0);
    expect(parseBossBudget({ monthlyCents: -3 })).toBe(3000);
    // Même défaut que le moteur de Kevin (phase 33).
    expect(DEFAULT_BOSS_BUDGET_CENTS).toBe(BOSS_ORDERS_DEFAULT_MONTHLY_CENTS);
  });

  it("formulaire du plafond : euros → centimes, bornes", () => {
    expect(parseBossBudgetForm(fd({ euros: "12,5" }))).toEqual({ ok: true, data: 1250 });
    expect(parseBossBudgetForm(fd({ euros: "0" }))).toEqual({ ok: true, data: 0 });
    expect(parseBossBudgetForm(fd({ euros: "15 €" }))).toEqual({ ok: true, data: 1500 });
    expect(parseBossBudgetForm(fd({ euros: "" })).ok).toBe(false);
    expect(parseBossBudgetForm(fd({ euros: "-1" })).ok).toBe(false);
    expect(parseBossBudgetForm(fd({ euros: "abc" })).ok).toBe(false);
    expect(parseBossBudgetForm(fd({ euros: "501" })).ok).toBe(false);
  });

  it("formulaire du prénom", () => {
    expect(parseBossNameForm(fd({ name: "  Jean-Kévin  " }))).toEqual({ ok: true, data: "Jean-Kévin" });
    expect(parseBossNameForm(fd({ name: "" })).ok).toBe(false);
    expect(parseBossNameForm(fd({ name: "<b>Kev</b>" })).ok).toBe(false);
    expect(parseBossNameForm(fd({ name: "x".repeat(41) })).ok).toBe(false);
  });

  it("jauge de la dépense", () => {
    expect(bossBudgetGauge(0, 1000)).toEqual({ percent: 0, tone: "success" });
    expect(bossBudgetGauge(850, 1000)).toEqual({ percent: 85, tone: "warning" });
    expect(bossBudgetGauge(1200, 1000)).toEqual({ percent: 100, tone: "danger" });
    expect(bossBudgetGauge(0, 0).percent).toBe(0);
  });

  it("équipe : responsabilités, disponibilité, auteur d'un tour, lien Telegram", () => {
    expect(responsibilitiesLabel({ teams: ["casino", "sports", "x"], kinds: ["media", "secret"] })).toBe("Casino, Paris sportifs · médias, clés");
    expect(responsibilitiesLabel({})).toBe("—");
    expect(responsibilitiesLabel(null)).toBe("—");
    const now = new Date("2026-10-24T10:00:00Z");
    expect(availabilityOf({ available: true, awayUntil: new Date("2026-10-26T00:00:00Z") }, now)).toEqual({ away: true, until: new Date("2026-10-26T00:00:00Z") });
    expect(availabilityOf({ available: true, awayUntil: new Date("2026-10-20T00:00:00Z") }, now)).toEqual({ away: false, until: null });
    expect(availabilityOf({ available: false, awayUntil: null }, now)).toEqual({ away: true, until: null });
    expect(turnAuthor("BOSS", "Kevin")).toBe("Kevin");
    expect(turnAuthor("ADMIN", "Kevin")).toBe("Vous");
    expect(telegramLink("@kevin_bot")).toBe("https://t.me/kevin_bot");
  });

  it("export CSV des besoins non couverts", () => {
    const csv = unmetCsv([{ text: 'fais un "export"; vite', count: 3, firstAt: new Date("2026-10-20T08:00:00Z"), lastAt: new Date("2026-10-24T08:00:00Z") }]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Demande;Nombre de fois;Première fois (Paris);Dernière fois (Paris)");
    expect(lines[1]).toContain('"fais un ""export""; vite";3;');
  });
});
