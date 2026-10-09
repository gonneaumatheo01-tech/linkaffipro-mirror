import { describe, expect, it } from "vitest";
import { DEFAULT_MAPPING, normalizeMapping, parseAmount, parsePostback, postbackExternalId, postbackUrlTemplate, summarizeParams } from "./parse";

describe("montants", () => {
  it("lit les formats usuels", () => {
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("1 250.00")).toBe(1250);
    expect(parseAmount("1,250.00")).toBe(1250);
    expect(parseAmount("€12")).toBe(12);
    expect(parseAmount(7)).toBe(7);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("mapping", () => {
  it("complète les valeurs manquantes et normalise eventMap", () => {
    const m = normalizeMapping({ sub_id: "subid", eventMap: { REG: "REGISTRATION" } });
    expect(m.sub_id).toBe("subid");
    expect(m.player_id).toBe("player_id");
    expect(m.eventMap).toEqual({ reg: "REGISTRATION" });
  });
  it("refuse un type d'événement inconnu ou un nom de paramètre invalide", () => {
    expect(() => normalizeMapping({ eventMap: { x: "BONUS" } })).toThrow(/inconnu/);
    expect(() => normalizeMapping({ amount: "a b" })).toThrow(/invalide/);
  });
});

describe("lecture d'un postback", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  it("lit les paramètres avec le mapping par défaut", () => {
    const p = parsePostback({ sub_id: "9jjjff9u4U9F", player_id: "241253", event: "FTD", amount: "20,00", currency: "eur" }, DEFAULT_MAPPING, now);
    expect(p).toMatchObject({ subId: "9jjjff9u4U9F", externalPlayerId: "241253", eventType: "FTD", amount: 20, currency: "EUR", txid: null });
    expect(p.occurredAt).toEqual(now);
  });
  it("respecte un mapping personnalisé, la casse des clés et la date en secondes", () => {
    const m = normalizeMapping({ sub_id: "clickid", player_id: "pid", event: "type", amount: "sum", eventMap: { dep: "DEPOSIT" } });
    const p = parsePostback({ ClickId: "abc", PID: "7", Type: "DEP", SUM: "5", date: "1760000000" }, m, now);
    expect(p.eventType).toBe("DEPOSIT");
    expect(p.subId).toBe("abc");
    expect(p.occurredAt.toISOString()).toBe("2025-10-09T08:53:20.000Z");
  });
  it("classe un événement inconnu en OTHER et ignore un sub_id mal formé", () => {
    const p = parsePostback({ player_id: "1", event: "bonus", sub_id: "a.b" }, DEFAULT_MAPPING, now);
    expect(p.eventType).toBe("OTHER");
    expect(p.subId).toBeNull();
  });
  it("exige l'identifiant joueur et l'événement", () => {
    expect(() => parsePostback({ event: "ftd" }, DEFAULT_MAPPING)).toThrow(/player_id/);
    expect(() => parsePostback({ player_id: "1" }, DEFAULT_MAPPING)).toThrow(/event/);
  });
  it("construit une clé d'idempotence stable", () => {
    const a = parsePostback({ player_id: "1", event: "ftd", amount: "20" }, DEFAULT_MAPPING, now);
    const b = parsePostback({ player_id: "1", event: "FTD", amount: "20,00" }, DEFAULT_MAPPING, new Date("2026-10-09T23:00:00Z"));
    expect(postbackExternalId(a)).toBe(postbackExternalId(b));
    expect(postbackExternalId(parsePostback({ player_id: "1", event: "ftd", txid: "T9" }, DEFAULT_MAPPING, now))).toBe("tx:T9");
  });
  it("résume sans exposer l'identifiant joueur complet", () => {
    const s = summarizeParams({ event: "ftd", player_id: "241253", amount: "20" }, DEFAULT_MAPPING);
    expect(s).toContain("event=ftd");
    expect(s).toContain("player_id=…1253");
    expect(s).not.toContain("241253");
  });
  it("génère l'URL modèle", () => {
    expect(postbackUrlTemplate("https://app.linkaffipro.com/", "tok", DEFAULT_MAPPING)).toBe("https://app.linkaffipro.com/api/postback/tok?sub_id={sub_id}&player_id={player_id}&event={event}&amount={amount}&currency={currency}");
  });
});
