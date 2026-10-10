import { describe, expect, it } from "vitest";
import {
  abLabel,
  broadcastActions,
  broadcastDateInfo,
  clickRate,
  notLaunched,
  progressSentence,
  resultsLine,
  sendLabel,
  variantColumn,
} from "./display";

const d = (iso: string) => new Date(iso);
const dates = {
  createdAt: d("2026-10-01T10:00:00Z"),
  scheduledAt: d("2026-10-12T16:00:00Z"),
  startedAt: d("2026-10-12T16:00:05Z"),
  finishedAt: d("2026-10-12T16:20:00Z"),
};

describe("affichage d'un envoi à un groupe", () => {
  it("date utile selon le statut", () => {
    expect(broadcastDateInfo({ ...dates, status: "DRAFT" })).toEqual({
      label: "Créé le",
      date: dates.createdAt,
    });
    expect(broadcastDateInfo({ ...dates, status: "SCHEDULED" })).toEqual({
      label: "Prévu le",
      date: dates.scheduledAt,
    });
    expect(broadcastDateInfo({ ...dates, status: "SENDING" }).label).toBe("Commencé le");
    expect(broadcastDateInfo({ ...dates, status: "SENT" })).toEqual({
      label: "Envoyé le",
      date: dates.finishedAt,
    });
    expect(broadcastDateInfo({ ...dates, status: "SENT", finishedAt: null }).date).toBe(
      dates.startedAt,
    );
    expect(broadcastDateInfo({ ...dates, status: "CANCELLED" }).label).toBe("Annulé le");
  });

  it("étiquette du test A/B", () => {
    expect(abLabel({ abGroupId: null, abVariant: null, abSplit: null })).toBeNull();
    expect(abLabel({ abGroupId: "g", abVariant: "A", abSplit: 40 })).toBe(
      "Test A/B · version A (40 %)",
    );
    expect(abLabel({ abGroupId: "g", abVariant: "REST", abSplit: null })).toBe(
      "Test A/B · envoi au reste",
    );
  });

  it("résultats en une ligne", () => {
    expect(resultsLine({ status: "DRAFT", sent: 0, uniqueClicks: 0 })).toBe("Pas encore parti");
    expect(resultsLine({ status: "SENT", sent: 1, uniqueClicks: 0 })).toBe("1 envoyé · aucun clic");
    expect(resultsLine({ status: "SENT", sent: 1200, uniqueClicks: 85 })).toMatch(
      /^1\s200 envoyés · 85 ont cliqué$/u,
    );
    expect(resultsLine({ status: "SENDING", sent: 3, uniqueClicks: 1 })).toBe(
      "3 envoyés · 1 a cliqué",
    );
    expect(notLaunched("SCHEDULED")).toBe(true);
    expect(notLaunched("SENDING")).toBe(false);
  });

  it("progression", () => {
    expect(progressSentence({ targeted: 0, sent: 0, failed: 0, blocked: 0 })).toEqual({
      done: 0,
      pct: 0,
      sentence: "Liste des destinataires en préparation…",
    });
    expect(progressSentence({ targeted: 10, sent: 7, failed: 1, blocked: 1 })).toEqual({
      done: 9,
      pct: 90,
      sentence: "9 traités sur 10 (90 %)",
    });
    expect(clickRate(0, 0)).toBe("—");
    expect(clickRate(200, 15)).toBe("7,5 %");
  });

  it("actions possibles : mêmes conditions que les actions serveur", () => {
    expect(broadcastActions("DRAFT", "MANAGER")).toEqual({
      send: true,
      schedule: "Programmer",
      cancel: false,
      remove: false,
      test: true,
    });
    expect(broadcastActions("DRAFT", "ADMIN").remove).toBe(true);
    expect(broadcastActions("SCHEDULED", "ADMIN")).toEqual({
      send: true,
      schedule: "Changer la date",
      cancel: true,
      remove: false,
      test: true,
    });
    expect(broadcastActions("SENDING", "ADMIN")).toMatchObject({
      send: false,
      schedule: null,
      cancel: true,
      remove: false,
    });
    expect(broadcastActions("SENT", "ADMIN")).toMatchObject({
      send: false,
      cancel: false,
      remove: false,
    });
    expect(broadcastActions("CANCELLED", "ADMIN").remove).toBe(true);
    expect(sendLabel("DRAFT")).toBe("Envoyer");
    expect(sendLabel("SCHEDULED")).toBe("Envoyer maintenant");
  });
});

describe("colonnes de la comparaison A/B", () => {
  it("en-tête court sur téléphone, nom complet pour tous", () => {
    expect(variantColumn("A")).toEqual({ short: "A", long: "Version A" });
    expect(variantColumn("B")).toEqual({ short: "B", long: "Version B" });
    expect(variantColumn("REST")).toEqual({ short: "Reste", long: "Reste du groupe" });
    expect(variantColumn(null)).toEqual({ short: "?", long: "Version ?" });
  });
});
