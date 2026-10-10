import { describe, expect, it } from "vitest";
import { parseAiConfig } from "./config";

describe("réglages IA", () => {
  it("applique les valeurs par défaut et ignore les valeurs invalides", () => {
    const c = parseAiConfig(null);
    expect(c).toMatchObject({ apiKeyEncrypted: null, defaultModel: "claude-haiku-5-5", qualityModel: "claude-sonnet-5-5", monthlyCapEur: 20, perUserDailyLimit: 50, verifiedAt: null });
    expect(c.riskNotice.casino).toContain("Jouer comporte des risques");
    const d = parseAiConfig({ defaultModel: "gpt-4", monthlyCapEur: -3, perUserDailyLimit: "x", riskNotice: { casino: " " }, apiKeyEncrypted: "v1.a.b.c" });
    expect(d.defaultModel).toBe("claude-haiku-5-5");
    expect(d.monthlyCapEur).toBe(20);
    expect(d.perUserDailyLimit).toBe(50);
    expect(d.riskNotice.casino).toContain("Jouer comporte");
    expect(d.apiKeyEncrypted).toBe("v1.a.b.c");
  });
});
