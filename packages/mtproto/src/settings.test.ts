import { describe, expect, it } from "vitest";
import { isValidApiHash, maskPhone, normalizePhone, parseTelegramUserApi } from "./settings";

describe("parseTelegramUserApi", () => {
  it("accepte un objet valide (apiId nombre ou chaîne numérique)", () => {
    expect(parseTelegramUserApi({ apiId: 12345, apiHashEncrypted: "abc" })).toEqual({ apiId: 12345, apiHashEncrypted: "abc" });
    expect(parseTelegramUserApi({ apiId: "12345", apiHashEncrypted: "abc" })).toEqual({ apiId: 12345, apiHashEncrypted: "abc" });
  });
  it("refuse les valeurs absentes ou mal formées", () => {
    expect(parseTelegramUserApi(null)).toBeNull();
    expect(parseTelegramUserApi({ apiId: 0, apiHashEncrypted: "abc" })).toBeNull();
    expect(parseTelegramUserApi({ apiId: 1, apiHashEncrypted: "" })).toBeNull();
    expect(parseTelegramUserApi("x")).toBeNull();
  });
});

describe("normalizePhone / maskPhone / isValidApiHash", () => {
  it("normalise les formats courants", () => {
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("0033612345678")).toBe("+33612345678");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizePhone("0612345678")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("masque le milieu du numéro", () => {
    expect(maskPhone("+33612345678")).toBe("+33 ••••••• 78");
    expect(maskPhone("12")).toBe("••••");
  });
  it("valide un api_hash hexadécimal de 32 caractères", () => {
    expect(isValidApiHash("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidApiHash("0123456789ABCDEF0123456789ABCDEF ")).toBe(true);
    expect(isValidApiHash("trop-court")).toBe(false);
  });
});
