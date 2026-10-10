import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUEUE_NAMES } from "@linkaffipro/queue";
import { SYNC_TABLES } from "@linkaffipro/linkaffi";
import {
  ALERT_KIND_LABELS,
  LINKAFFI_TABLE_LABELS,
  QUEUE_LABELS,
  alertKindLabel,
  fmtAgeSec,
  fmtBytes,
  linkAffiTableLabel,
  queueLabel,
} from "./labels";

const JARGON = /postback|webhook|sub-id|\bngr\b|\bftd\b|\bcpa\b|worker/i;

describe("libellés de Connexions et d'État du système", () => {
  it("chaque file de tâches a son libellé, sans jargon", () => {
    for (const q of QUEUE_NAMES) {
      expect(QUEUE_LABELS[q]).toBeTruthy();
      expect(QUEUE_LABELS[q]).not.toMatch(JARGON);
    }
    expect(queueLabel("inconnue")).toBe("Autre file");
  });

  it("chaque donnée Link Affi synchronisée a son libellé, sans jargon", () => {
    for (const t of SYNC_TABLES) {
      expect(LINKAFFI_TABLE_LABELS[t.table]).toBeTruthy();
      expect(LINKAFFI_TABLE_LABELS[t.table]).not.toMatch(JARGON);
    }
    expect(linkAffiTableLabel("players")).toBe("Joueurs");
    expect(linkAffiTableLabel("x")).toBe("Autre donnée Link Affi");
  });

  it("chaque type d'alerte du worker a son libellé, sans jargon", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "..", "worker", "src", "maintenance", "alert-rules.ts"),
      "utf8",
    );
    const union = /export type AlertKind =([^;]+);/.exec(src)?.[1] ?? "";
    const kinds = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(kinds.length).toBeGreaterThanOrEqual(13);
    for (const k of kinds) {
      expect(ALERT_KIND_LABELS[k], k).toBeTruthy();
      expect(ALERT_KIND_LABELS[k]).not.toMatch(JARGON);
    }
    expect(alertKindLabel("nouveau")).toBe("Autre alerte");
  });

  it("tailles et âges en français", () => {
    expect(fmtBytes(80)).toBe("80 o");
    expect(fmtBytes(2048)).toBe("2 Ko");
    expect(fmtBytes(13 * 1024 * 1024 + 400_000)).toBe("13,4 Mo");
    expect(fmtAgeSec(null)).toBe("—");
    expect(fmtAgeSec(20)).toBe("il y a 20 s");
    expect(fmtAgeSec(185)).toBe("il y a 3 min");
    expect(fmtAgeSec(7200)).toBe("il y a 2 h");
  });
});
