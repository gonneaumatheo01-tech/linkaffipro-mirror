import { beforeEach, describe, expect, it, vi } from "vitest";

// Réglages → Alertes : enregistrement des seuils et des cases « Alerte activée » dans le même réglage
// `alerts.thresholds`, sans perdre ses autres clés ; journal avec les interrupteurs ; message de retour.
const m = vi.hoisted(() => ({
  /** Valeur actuelle du réglage `alerts.thresholds` (`undefined` = absent). */
  stored: undefined as unknown,
  upserts: [] as Array<{
    where: { key: string };
    create: { key: string; value: unknown };
    update: { value: unknown };
  }>,
  audits: [] as Array<Record<string, unknown>>,
  requireAdmin: vi.fn(async () => ({ id: "admin1", role: "ADMIN" })),
}));

class Redirect extends Error {
  digest: string;
  constructor(readonly url: string) {
    super("NEXT_REDIRECT");
    this.digest = `NEXT_REDIRECT;${url}`;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key === "alerts.thresholds" && m.stored !== undefined ? { value: m.stored } : null,
      ),
      upsert: vi.fn(async (args: (typeof m.upserts)[number]) => {
        m.upserts.push(args);
        m.stored = args.update.value;
        return args.create;
      }),
    },
  },
  audit: vi.fn(async (a: Record<string, unknown>) => void m.audits.push(a)),
}));
vi.mock("@linkaffipro/queue", () => ({ enqueue: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: m.requireAdmin }));

import { saveAlertThresholdsAction } from "./actions";
import { parseAlertSwitches } from "@linkaffipro/core";
import { parseThresholds, thresholdsSavedMessage } from "./thresholds";

/** Lance l'action et renvoie les paramètres de la redirection (`ok` ou `error`). */
async function save(fields: Record<string, string>): Promise<URLSearchParams> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    await saveAlertThresholdsAction(form);
  } catch (err) {
    if (err instanceof Redirect) return new URL(err.url, "https://x").searchParams;
    throw err;
  }
  throw new Error("redirection attendue");
}

const SEUILS = { registrationsDropPct: "40", spendNoConversionEur: "75,5", channelLeakPct: "12" };

beforeEach(() => {
  m.stored = undefined;
  m.upserts.length = 0;
  m.audits.length = 0;
  m.requireAdmin.mockClear();
});

describe("enregistrer les alertes sur les chiffres", () => {
  it("toutes cochées : seuils et trois alertes activées, administrateur requis", async () => {
    const params = await save({
      ...SEUILS,
      registrationsDropEnabled: "on",
      spendNoConversionEnabled: "on",
      channelLeakEnabled: "on",
    });
    expect(m.requireAdmin).toHaveBeenCalledTimes(1);
    expect(m.upserts).toHaveLength(1);
    expect(m.upserts[0]?.where).toEqual({ key: "alerts.thresholds" });
    expect(m.upserts[0]?.update.value).toEqual({
      registrationsDropPct: 40,
      spendNoConversionEur: 75.5,
      channelLeakPct: 12,
      enabled: { registrations_drop: true, spend_no_conversion: true, channel_leak: true },
    });
    expect(m.upserts[0]?.create.value).toEqual(m.upserts[0]?.update.value);
    expect(params.get("ok")).toContain("Les trois alertes sont activées.");
    expect(params.get("ok")).toContain("dépense sans inscription 75,5 €");
  });

  it("case décochée = alerte désactivée ; le seuil est gardé ; autres clés du réglage conservées", async () => {
    m.stored = { registrationsDropPct: 50, autreReglage: { a: 1 } };
    const params = await save({ ...SEUILS, registrationsDropEnabled: "on" });
    const value = m.upserts[0]?.update.value as Record<string, unknown>;
    expect(value).toEqual({
      autreReglage: { a: 1 },
      registrationsDropPct: 40,
      spendNoConversionEur: 75.5,
      channelLeakPct: 12,
      enabled: { registrations_drop: true, spend_no_conversion: false, channel_leak: false },
    });
    // Même lecture que le worker et la page.
    expect(parseAlertSwitches(value)).toEqual({
      registrations_drop: true,
      spend_no_conversion: false,
      channel_leak: false,
    });
    expect(parseThresholds(value).channelLeakPct).toBe(12);
    expect(params.get("ok")).toContain(
      "Alertes désactivées : « Dépense sans inscription », « Canal qui perd ses membres », elles ne vous seront plus envoyées.",
    );
    // Journal : seuils et interrupteurs.
    expect(m.audits).toEqual([
      {
        userId: "admin1",
        action: "settings.alert_thresholds_updated",
        metadata: {
          registrationsDropPct: 40,
          spendNoConversionEur: 75.5,
          channelLeakPct: 12,
          enabled: { registrations_drop: true, spend_no_conversion: false, channel_leak: false },
        },
      },
    ]);
  });

  it("réactiver une alerte désactivée", async () => {
    m.stored = {
      registrationsDropPct: 40,
      enabled: { registrations_drop: true, spend_no_conversion: false, channel_leak: true },
    };
    await save({
      ...SEUILS,
      registrationsDropEnabled: "on",
      spendNoConversionEnabled: "on",
      channelLeakEnabled: "on",
    });
    expect(parseAlertSwitches(m.stored)).toEqual({
      registrations_drop: true,
      spend_no_conversion: true,
      channel_leak: true,
    });
  });

  it("seuil invalide : rien n'est enregistré, même si les cases changent", async () => {
    const params = await save({ ...SEUILS, channelLeakPct: "0" });
    expect(params.get("error")).toContain("Seuils invalides");
    expect(m.upserts).toHaveLength(0);
    expect(m.audits).toHaveLength(0);
  });
});

describe("message de retour", () => {
  const t = { registrationsDropPct: 50, spendNoConversionEur: 50, channelLeakPct: 10 };
  it("dit ce qui est désactivé", () => {
    expect(
      thresholdsSavedMessage(t, {
        registrations_drop: true,
        spend_no_conversion: false,
        channel_leak: true,
      }),
    ).toContain(
      "Alerte désactivée : « Dépense sans inscription », elle ne vous sera plus envoyée.",
    );
    expect(
      thresholdsSavedMessage(t, {
        registrations_drop: false,
        spend_no_conversion: false,
        channel_leak: false,
      }),
    ).toContain("Les trois alertes sont désactivées");
  });
});
