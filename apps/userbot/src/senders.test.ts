import { describe, expect, it } from "vitest";
import { isTelegramServiceSender } from "./senders";

describe("comptes de service de Telegram", () => {
  it("le compte « Telegram » (codes de connexion) n'est jamais une personne à qui répondre", () => {
    expect(isTelegramServiceSender({ id: "777000" })).toBe(true);
    expect(isTelegramServiceSender({ id: 777000 })).toBe(true);
    expect(isTelegramServiceSender({ id: BigInt(777000) })).toBe(true);
    expect(isTelegramServiceSender({ id: { toString: () => "42777" } })).toBe(true);
    expect(isTelegramServiceSender({ id: "12345", support: true })).toBe(true);
  });

  it("une vraie personne passe", () => {
    expect(isTelegramServiceSender({ id: "6123456789" })).toBe(false);
    expect(isTelegramServiceSender({ id: "6123456789", support: false })).toBe(false);
  });
});
