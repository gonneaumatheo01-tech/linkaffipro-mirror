/**
 * Phase 32 — cœurs des pages avancées de la Prospection : refus des rôles (calibrage), essai à blanc sans écriture,
 * journal avec `via`, alerte hors périmètre introuvable, types d'alerte en mots, recherche par compte seulement
 * coupée, fonctions des chantiers appelées pour la fusion et le rattachement. Base simulée ; aucun envoi possible.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteOpActor } from "@linkaffipro/agents";

type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  prospects: new Map<string, Row>(),
  alerts: new Map<string, Row>(),
  settings: new Map<string, unknown>(),
  recos: [] as Row[],
  writes: [] as Array<{ op: string; args: unknown }>,
  audits: [] as Record<string, unknown>[],
  events: [] as Row[],
  merged: [] as string[][],
  linked: [] as Array<[string, string]>,
}));

vi.mock("@linkaffipro/db", () => {
  const prisma = {
    prospect: {
      findFirst: vi.fn(async ({ where }: { where: unknown }) => {
        const s = JSON.stringify(where);
        const id = s.match(/"id":"([^"]+)"/)?.[1];
        const aff = s.match(/"linkAffiAffiliateId":"([^"]+)"/)?.[1];
        if (aff) return [...m.prospects.values()].find((p) => p.linkAffiAffiliateId === aff && p.id !== id) ?? null;
        const p = id ? m.prospects.get(id) : undefined;
        return p && p.region !== "NON_EU" ? p : null;
      }),
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        const ids = JSON.stringify(where).match(/"in":\[([^\]]*)\]/)?.[1]?.replace(/"/g, "").split(",") ?? [];
        return [...m.prospects.values()].filter((p) => ids.includes(p.id as string) && p.region !== "NON_EU");
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Row }) => {
        m.writes.push({ op: "prospect.update", args });
        Object.assign(m.prospects.get(args.where.id)!, args.data);
        return {};
      }),
    },
    prospectAlert: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = m.alerts.get(where.id);
        if (!a) return null;
        const p = m.prospects.get(a.prospectId as string)!;
        return p.region === "NON_EU" ? null : { ...a, prospect: p };
      }),
      findMany: vi.fn(async () => [...m.alerts.values()].filter((a) => a.status === "NEW" || a.status === "SENT")),
      update: vi.fn(async (args: { where: { id: string }; data: Row }) => {
        m.writes.push({ op: "alert.update", args });
        Object.assign(m.alerts.get(args.where.id)!, args.data);
        return {};
      }),
      updateMany: vi.fn(async (args: unknown) => {
        m.writes.push({ op: "alert.updateMany", args });
        return { count: 1 };
      }),
    },
    prospectEvent: { create: vi.fn(async ({ data }: { data: Row }) => m.events.push(data)) },
    recommendation: {
      findMany: vi.fn(async () => m.recos.filter((r) => r.status === "PROPOSED")),
      findFirst: vi.fn(async () => m.recos.find((r) => r.status === "APPLIED") ?? null),
    },
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (m.settings.has(where.key) ? { value: m.settings.get(where.key) } : null)),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (args: { where: { key: string }; update: { value: unknown } }) => {
        m.writes.push({ op: "setting.upsert", args });
        m.settings.set(args.where.key, args.update.value);
        return {};
      }),
      update: vi.fn(async (args: { where: { key: string }; data: { value: unknown } }) => {
        m.writes.push({ op: "setting.update", args });
        m.settings.set(args.where.key, args.data.value);
        return {};
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, audit: vi.fn(async (a: Record<string, unknown>) => m.audits.push(a)) };
});

vi.mock("@linkaffipro/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linkaffipro/agents")>()),
  mergeProspects: vi.fn(async (_d: unknown, ids: string[]) => {
    m.merged.push(ids);
    return { ok: true, networkId: "net0000000001" };
  }),
  splitProspect: vi.fn(async () => ({ ok: true })),
  linkAffiliate: vi.fn(async (_d: unknown, id: string, aff: string) => {
    m.linked.push([id, aff]);
    return { ok: true };
  }),
}));
vi.mock("@/lib/agents/prospection/deps", () => ({ buildProspectionDeps: () => ({}) }));
vi.mock("@/lib/agents/prospection/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/prospection/queries")>()),
  loadScope: vi.fn(async () => ["FR", "BE"]),
}));

import { ACCOUNT_SEARCH } from "@linkaffipro/agents";
import { MUTED_KINDS_KEY } from "@/lib/agents/prospection/advanced";
import { formOf } from "../lot-d/kit";
import {
  alertKindFromWords,
  runAccountSearchStop,
  runAffiliateLink,
  runAlertSeen,
  runAlertsChannel,
  runAlertsKind,
  runCalibrationApply,
  runCalibrationUndo,
  runNetworkMerge,
} from "./advanced";

const ADMIN: SiteOpActor = { userId: "u1", role: "ADMIN", via: "WEB" };
const MANAGER: SiteOpActor = { userId: "u2", role: "MANAGER", via: "TELEGRAM" };

const prospect = (id: string, over: Row = {}): Row => ({ id, title: id, username: id, channelUrl: `https://t.me/${id}`, status: "QUALIFIED", networkId: null, watchMuted: false, region: "EU", ...over });

beforeEach(() => {
  m.prospects.clear();
  m.alerts.clear();
  m.settings.clear();
  m.recos = [];
  m.writes = [];
  m.audits = [];
  m.events = [];
  m.merged = [];
  m.linked = [];
  m.prospects.set("parisfoot01", prospect("parisfoot01"));
  m.prospects.set("tipsitalia1", prospect("tipsitalia1", { status: "SIGNED" }));
  m.prospects.set("horseurope1", prospect("horseurope1", { region: "NON_EU" }));
  m.alerts.set("alert0000001", { id: "alert0000001", kind: "GROWTH_SPIKE", status: "SENT", prospectId: "parisfoot01" });
  m.alerts.set("alert0000002", { id: "alert0000002", kind: "DECLINE", status: "NEW", prospectId: "horseurope1" });
});

describe("alertes", () => {
  it("« Vu » : essai à blanc sans écriture, puis statut et journal", async () => {
    const dry = await runAlertSeen(formOf({ alertId: "alert0000001" }), MANAGER, { dryRun: true });
    expect(dry).toMatchObject({ ok: true, preview: expect.anything() });
    expect(m.writes).toEqual([]);
    const r = await runAlertSeen(formOf({ alertId: "alert0000001" }), MANAGER);
    expect(r.ok).toBe(true);
    expect(m.alerts.get("alert0000001")!.status).toBe("SEEN");
    expect(m.audits[0]).toMatchObject({ action: "agents.prospection_alert_seen", metadata: expect.objectContaining({ via: "TELEGRAM" }) });
    expect(await runAlertSeen(formOf({ alertId: "alert0000001" }), MANAGER)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("alerte d'un canal hors périmètre : introuvable", async () => {
    expect(await runAlertSeen(formOf({ alertId: "alert0000002" }), ADMIN)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("« Plus pour ce canal » : canal coupé, alertes ouvertes coupées, chronologie", async () => {
    const r = await runAlertsChannel(formOf({ prospectId: "parisfoot01", action: "mute" }), MANAGER);
    expect(r.ok).toBe(true);
    expect(m.prospects.get("parisfoot01")!.watchMuted).toBe(true);
    expect(m.writes.some((w) => w.op === "alert.updateMany")).toBe(true);
    expect(m.events[0]).toMatchObject({ prospectId: "parisfoot01", type: "ALERTS_MUTED" });
    expect(await runAlertsChannel(formOf({ prospectId: "parisfoot01", action: "mute" }), MANAGER)).toMatchObject({ ok: false, code: "conflict" });
    expect((await runAlertsChannel(formOf({ prospectId: "parisfoot01", action: "unmute" }), MANAGER)).ok).toBe(true);
  });

  it("couper puis rétablir un type", async () => {
    expect((await runAlertsKind(formOf({ kind: "DECLINE", action: "mute" }), MANAGER)).ok).toBe(true);
    expect(m.settings.get(MUTED_KINDS_KEY)).toEqual(["DECLINE"]);
    expect(await runAlertsKind(formOf({ kind: "DECLINE", action: "mute" }), MANAGER)).toMatchObject({ code: "conflict" });
    expect((await runAlertsKind(formOf({ kind: "DECLINE", action: "unmute" }), MANAGER)).ok).toBe(true);
    expect(m.settings.get(MUTED_KINDS_KEY)).toEqual([]);
    expect(await runAlertsKind(formOf({ kind: "NOPE" }), MANAGER)).toMatchObject({ code: "invalid" });
  });

  it("type d'alerte en mots (Kevin)", () => {
    expect(alertKindFromWords("en baisse")).toBe("DECLINE");
    expect(alertKindFromWords("canaux en hausse")).toBe("GROWTH_SPIKE");
    expect(alertKindFromWords("niveau en hausse")).toBe("TIER_UP");
    expect(alertKindFromWords("qui a lâché son bookmaker")).toBe("AFFILIATE_DROPPED");
    expect(alertKindFromWords("contact changé")).toBe("CONTACT_CHANGED");
    expect(alertKindFromWords("affilié qui pousse un concurrent")).toBe("AFFILIATE_PUSHES_COMPETITOR");
    expect(alertKindFromWords("WENT_SILENT")).toBe("WENT_SILENT");
    expect(alertKindFromWords("bonjour")).toBeNull();
  });
});

describe("réseaux et affiliés", () => {
  it("regrouper : deux canaux au moins, par @nom, fonction de l'équipe appelée", async () => {
    expect(await runNetworkMerge(formOf({ ids: ["parisfoot01"] }), MANAGER)).toMatchObject({ code: "invalid" });
    const r = await runNetworkMerge(formOf({ ids: ["parisfoot01", "tipsitalia1"] }), MANAGER);
    expect(r).toMatchObject({ ok: true, data: { networkId: "net0000000001" } });
    expect(m.merged).toEqual([["parisfoot01", "tipsitalia1"]]);
    expect(await runNetworkMerge(formOf({ ids: ["parisfoot01", "horseurope1"] }), MANAGER)).toMatchObject({ code: "not_found" });
  });

  it("rattacher : signé seulement, identifiant simple", async () => {
    expect(await runAffiliateLink(formOf({ prospectId: "parisfoot01", affiliateId: "1234" }), MANAGER)).toMatchObject({ code: "conflict" });
    expect(await runAffiliateLink(formOf({ prospectId: "tipsitalia1", affiliateId: "a b" }), MANAGER)).toMatchObject({ code: "invalid" });
    expect((await runAffiliateLink(formOf({ prospectId: "tipsitalia1", affiliateId: "1234" }), MANAGER)).ok).toBe(true);
    expect(m.linked).toEqual([["tipsitalia1", "1234"]]);
  });
});

describe("calibrage et recherche par compte", () => {
  it("calibrage : administrateurs seulement ; numéro inconnu refusé ; essai à blanc", async () => {
    m.recos = [{ id: "reco00000001", status: "PROPOSED", targetId: "SPORTS|FR|?|A", field: "ctrFactor", before: 1, after: 1.3, evidence: {}, expectedGain: null, createdAt: new Date("2026-10-01") }];
    expect(await runCalibrationApply(formOf({ numbers: ["1"] }), MANAGER)).toMatchObject({ code: "forbidden" });
    expect(await runCalibrationUndo(new FormData(), MANAGER)).toMatchObject({ code: "forbidden" });
    expect(await runCalibrationApply(formOf({ numbers: ["4"] }), ADMIN)).toMatchObject({ code: "not_found" });
    expect(await runCalibrationApply(formOf({ numbers: ["1"] }), ADMIN, { dryRun: true })).toMatchObject({ ok: true, preview: expect.anything() });
    expect(await runCalibrationUndo(new FormData(), ADMIN)).toMatchObject({ code: "conflict" });
  });

  it("recherche par compte : seulement coupée, jamais rallumée par le site", async () => {
    expect(await runAccountSearchStop(new FormData(), MANAGER)).toMatchObject({ code: "conflict" });
    m.settings.set(ACCOUNT_SEARCH.enabled.key, true);
    expect((await runAccountSearchStop(new FormData(), MANAGER)).ok).toBe(true);
    expect(m.settings.get(ACCOUNT_SEARCH.enabled.key)).toBe(false);
    expect(m.audits.at(-1)).toMatchObject({ action: "agents.prospection_account_search_stopped" });
  });
});
