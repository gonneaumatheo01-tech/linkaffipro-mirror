import { describe, expect, it } from "vitest";
import {
  HOUR_OPTIONS,
  hourLabel,
  lastSentLabel,
  readReportsConfig,
  reportsSummary,
  telegramToText,
} from "./report-view";

describe("Réglages → Rapports automatiques : réglage enregistré", () => {
  it("valeurs par défaut : tout activé, 9 h", () => {
    expect(readReportsConfig(undefined)).toEqual({ daily: true, weekly: true, hour: 9 });
    expect(readReportsConfig("n'importe quoi")).toEqual({ daily: true, weekly: true, hour: 9 });
  });

  it("garde les valeurs valides, remplace les autres", () => {
    expect(readReportsConfig({ daily: false, weekly: true, hour: 7 })).toEqual({
      daily: false,
      weekly: true,
      hour: 7,
    });
    expect(readReportsConfig({ daily: "oui", hour: 24 })).toEqual({
      daily: true,
      weekly: true,
      hour: 9,
    });
    expect(readReportsConfig({ hour: 8.6 }).hour).toBe(8);
  });
});

describe("Réglages → Rapports automatiques : affichage", () => {
  it("24 heures proposées, de 0 h à 23 h", () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: 0, label: "0 h" });
    expect(HOUR_OPTIONS[23]).toEqual({ value: 23, label: "23 h" });
    expect(hourLabel(9)).toBe("9 h");
  });

  it("aperçu : balises Telegram retirées, entités décodées", () => {
    expect(telegramToText("<b>Résumé</b> &lt;hier&gt; &amp; <i>bilan</i> <code>42</code>")).toBe(
      "Résumé <hier> & bilan 42",
    );
  });

  it("jour du dernier envoi en toutes lettres", () => {
    expect(lastSentLabel(null)).toBe("jamais");
    expect(lastSentLabel("2026-10-09")).toBe("9 octobre 2026");
    expect(lastSentLabel("semaine-41")).toBe("semaine-41");
  });

  it("phrase d'état selon ce qui est activé", () => {
    expect(reportsSummary({ daily: true, weekly: true, hour: 9 })).toBe(
      "Vous recevez le résumé quotidien et le rapport du lundi à 9 h (heure de Paris).",
    );
    expect(reportsSummary({ daily: false, weekly: true, hour: 8 })).toBe(
      "Vous recevez le rapport du lundi à 8 h (heure de Paris).",
    );
    expect(reportsSummary({ daily: false, weekly: false, hour: 8 })).toMatch(/désactivés/);
  });
});
