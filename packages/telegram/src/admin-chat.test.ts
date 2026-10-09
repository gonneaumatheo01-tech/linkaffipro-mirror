import { describe, expect, it } from "vitest";
import { chooseAdminTelegramId, inboxMessageFromPayload, splitMessage } from "./admin-chat";

describe("découpage des messages", () => {
  it("laisse un message court intact", () => {
    expect(splitMessage("Bonjour")).toEqual(["Bonjour"]);
  });
  it("coupe aux sauts de ligne au-delà de la limite", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `ligne ${i} ${"x".repeat(20)}`);
    const parts = splitMessage(lines.join("\n"), 4000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4000);
    expect(parts.join("\n")).toBe(lines.join("\n"));
  });
  it("coupe aux espaces sinon, et en dur en dernier recours", () => {
    const parts = splitMessage(`${"mot ".repeat(50)}${"y".repeat(120)}`, 100);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(splitMessage("z".repeat(250), 100)).toEqual(["z".repeat(100), "z".repeat(100), "z".repeat(50)]);
  });
});

const starts = [
  { telegramUserId: 300n, username: "dernier", firstName: "D", startedAt: new Date("2026-10-09T12:00:00Z") },
  { telegramUserId: 200n, username: "Matheo_tg", firstName: "M", startedAt: new Date("2026-10-09T11:00:00Z") },
];

describe("choix de l'identifiant admin", () => {
  it("préfère le réglage mémorisé", () => {
    expect(chooseAdminTelegramId({ settingId: 1n, adminUserTelegramId: 2n, starts })).toEqual({ id: 1n, source: "setting" });
  });
  it("puis le telegramUserId du premier ADMIN", () => {
    expect(chooseAdminTelegramId({ adminUserTelegramId: 2n, starts })).toEqual({ id: 2n, source: "user" });
  });
  it("puis le nom d'utilisateur de ADMIN_TELEGRAM_USERNAME (sans tenir compte de @ ni de la casse)", () => {
    expect(chooseAdminTelegramId({ envUsername: "@matheo_TG", starts })).toEqual({ id: 200n, source: "username" });
  });
  it("sinon le dernier /start, à confirmer", () => {
    const c = chooseAdminTelegramId({ envUsername: "inconnu", starts });
    expect(c).toMatchObject({ id: 300n, source: "last-start", needsConfirmation: true });
  });
  it("renvoie null sans aucun candidat", () => {
    expect(chooseAdminTelegramId({ starts: [] })).toBeNull();
  });
});

describe("inbox", () => {
  const payload = (fromId: number, type = "private", text = "ok") => ({ update_id: 5, message: { date: 1760000000, text, chat: { id: fromId, type }, from: { id: fromId } } });
  it("garde les messages privés de l'admin", () => {
    expect(inboxMessageFromPayload(payload(42), 42n)).toMatchObject({ text: "ok", updateId: 5 });
  });
  it("ignore les autres identifiants et les canaux", () => {
    expect(inboxMessageFromPayload(payload(43), 42n)).toBeNull();
    expect(inboxMessageFromPayload(payload(42, "channel"), 42n)).toBeNull();
    expect(inboxMessageFromPayload({ update_id: 1, my_chat_member: {} }, 42n)).toBeNull();
  });
});
