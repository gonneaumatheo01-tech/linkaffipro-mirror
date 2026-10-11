import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({
  prisma: {},
  recordEvent: vi.fn(),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { accountPublishProblem } from "@linkaffipro/core";
import {
  APP_MISSING_MESSAGE,
  NOT_CONNECTED_MESSAGE,
  parsePublishStatus,
  SESSION_EXPIRED_MESSAGE,
  sessionProblemMessage,
} from "./account";

describe("raison lisible quand le compte Telegram connecté est inutilisable", () => {
  it("d'après la raison de loadActiveSession", () => {
    expect(sessionProblemMessage("compte Telegram non connecté")).toBe(NOT_CONNECTED_MESSAGE);
    expect(sessionProblemMessage("compte Telegram non prêt (ERROR)")).toBe(SESSION_EXPIRED_MESSAGE);
    expect(sessionProblemMessage("compte Telegram non prêt (PENDING_CODE)")).toBe(
      NOT_CONNECTED_MESSAGE,
    );
    expect(sessionProblemMessage("application Telegram (api_id / api_hash) non configurée")).toBe(
      APP_MISSING_MESSAGE,
    );
    expect(sessionProblemMessage("session Telegram illisible (clé de chiffrement changée ?)")).toBe(
      SESSION_EXPIRED_MESSAGE,
    );
    expect(sessionProblemMessage(null)).toBe(SESSION_EXPIRED_MESSAGE);
  });
  it("aucun terme technique dans ces messages", () => {
    for (const m of [NOT_CONNECTED_MESSAGE, SESSION_EXPIRED_MESSAGE, APP_MISSING_MESSAGE])
      expect(m).not.toMatch(/mtproto|api_id|api_hash|session string|gramjs/i);
  });
});

describe("état du compte pour publier (Setting mtproto.publishStatus)", () => {
  it("lit la forme MtprotoPublishStatus, refuse le reste", () => {
    expect(parsePublishStatus(null)).toBeNull();
    expect(parsePublishStatus({ connected: true })).toBeNull();
    const s = parsePublishStatus({
      checkedAt: "2026-10-11T10:00:00.000Z",
      connected: true,
      premium: true,
      user: { id: "1", firstName: "A", username: null },
      error: null,
      channels: { ch1: { canPost: true, checkedAt: "2026-10-11T10:00:00.000Z", error: null } },
    });
    expect(s?.channels.ch1?.canPost).toBe(true);
    // Le site lit ce même état : rien n'empêche de publier dans ch1.
    expect(accountPublishProblem(s, "ch1")).toBeNull();
    expect(accountPublishProblem(s, "ch2")).toMatch(/Vérifier/);
    expect(parsePublishStatus({ checkedAt: "x", connected: false, premium: "oui" })).toMatchObject({
      premium: null,
      channels: {},
    });
  });
});
