import { describe, expect, it } from "vitest";
import { accountPrimaryAction } from "./account-view";

describe("Mon compte : un seul bouton principal", () => {
  it("relier Telegram d'abord, tant que ce n'est pas fait", () => {
    expect(accountPrimaryAction({ linked: false, activeBots: 2, hasLinkToken: false })).toBe(
      "telegram",
    );
  });

  it("le mot de passe sinon : déjà lié, lien déjà généré, ou aucun bot pour le faire", () => {
    expect(accountPrimaryAction({ linked: true, activeBots: 2, hasLinkToken: false })).toBe(
      "password",
    );
    expect(accountPrimaryAction({ linked: false, activeBots: 2, hasLinkToken: true })).toBe(
      "password",
    );
    expect(accountPrimaryAction({ linked: false, activeBots: 0, hasLinkToken: false })).toBe(
      "password",
    );
  });
});
