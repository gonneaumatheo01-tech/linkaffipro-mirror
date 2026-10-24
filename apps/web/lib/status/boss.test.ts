import { describe, expect, it } from "vitest";
import { bossHealthView, webhookCheckLine } from "./boss";

const NOW = new Date("2026-10-24T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("État du système : le Boss répond-il ? (phase 26)", () => {
  it("tâche en attente depuis plus de 2 min → ne répond plus ; échecs → ratés ; sinon répond", () => {
    expect(bossHealthView({ waiting: [ago(180_000)], failed24h: 0, webhookCheck: null }, NOW)).toMatchObject({ tone: "danger", label: "Le Boss ne répond plus" });
    expect(bossHealthView({ waiting: [ago(30_000)], failed24h: 2, webhookCheck: null }, NOW).tone).toBe("warning");
    expect(bossHealthView({ waiting: [], failed24h: 0, webhookCheck: null }, NOW).tone).toBe("success");
  });
  it("dernier contrôle des connexions Telegram en une ligne", () => {
    const fmt = () => "24/10 14:00";
    expect(webhookCheckLine(null, fmt)).toContain("pas encore fait");
    const check = { at: NOW.toISOString(), bots: [{ botId: "b", username: "kevin_bot", ok: true, problems: ["forbidden" as const], repaired: true }] };
    expect(webhookCheckLine(check, fmt)).toBe("Dernier contrôle des connexions Telegram : 24/10 14:00, réparée : @kevin_bot.");
  });
});
