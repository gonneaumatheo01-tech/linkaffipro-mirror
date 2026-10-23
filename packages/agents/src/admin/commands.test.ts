import { describe, expect, it } from "vitest";
import { isSecretAdminText, parseAdminCommand } from "./commands";

describe("commandes du dialogue admin", () => {
  it("reconnaît les commandes, sans tenir compte des accents ni de la casse", () => {
    expect(parseAdminCommand("Agents")).toEqual({ type: "status" });
    expect(parseAdminCommand("pause dating")).toEqual({ type: "pause", team: "dating" });
    expect(parseAdminCommand("Reprends Paris sportifs")).toEqual({ type: "resume", team: "sports" });
    expect(parseAdminCommand("pause TOUT")).toEqual({ type: "pause", team: "all" });
    expect(parseAdminCommand("reprends algorithme")).toEqual({ type: "resume", team: "algo" });
    expect(parseAdminCommand("ok 12")).toEqual({ type: "approve", number: 12 });
    expect(parseAdminCommand("non 12 trop long")).toEqual({ type: "reject", number: 12, reason: "trop long" });
    expect(parseAdminCommand("non 3")).toEqual({ type: "reject", number: 3, reason: null });
    expect(parseAdminCommand("demandes")).toEqual({ type: "requests" });
    expect(parseAdminCommand("Plus tard")).toEqual({ type: "later" });
    expect(parseAdminCommand("budget vidéo 120,5")).toEqual({ type: "budget", provider: "video", euros: 120.5 });
    expect(parseAdminCommand("vrai casino")).toEqual({ type: "live", team: "casino" });
    expect(parseAdminCommand("niveau paris 1")).toEqual({ type: "level", team: "sports", level: 1 });
    expect(parseAdminCommand("niveau dating 3")).toBeNull();
  });
  it("garde les valeurs secrètes telles quelles", () => {
    expect(parseAdminCommand("Clé fal AbC:123xyZ")).toEqual({ type: "secret", key: "providers.fal.apiKey", value: "AbC:123xyZ" });
    expect(parseAdminCommand("cle cotes K3y")).toEqual({ type: "secret", key: "providers.odds.apiKey", value: "K3y" });
    expect(parseAdminCommand("bookmaker Sportaza moi@x.fr Mot de Passe")).toEqual({
      type: "bookmaker",
      name: "sportaza",
      login: "moi@x.fr",
      password: "Mot de Passe",
    });
  });
  it("tout le reste n'est pas une commande", () => {
    expect(parseAdminCommand("fait")).toBeNull();
    expect(parseAdminCommand("ok")).toBeNull();
    expect(parseAdminCommand("pause café")).toBeNull();
  });
  it("repère les textes à ne jamais journaliser", () => {
    expect(isSecretAdminText("clé fal abcdef123")).toBe(true);
    expect(isSecretAdminText("bookmaker x y z")).toBe(true);
    expect(isSecretAdminText("fait")).toBe(false);
    expect(isSecretAdminText("sk-123456789", { kind: "SECRET" })).toBe(true);
    expect(isSecretAdminText("agents", { kind: "SECRET" })).toBe(false);
    expect(isSecretAdminText("sk-123456789", { kind: "CONFIRM" })).toBe(false);
  });
});
