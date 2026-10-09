import { describe, expect, it } from "vitest";
import { GrammyError, HttpError } from "grammy";
import { describeTelegramError, withTelegramRetry } from "./errors";

function grammyError(code: number, description: string, parameters: Record<string, number> = {}) {
  return new GrammyError("call failed", { ok: false, error_code: code, description, parameters }, "sendMessage", {});
}

describe("erreurs Telegram", () => {
  it("traduit les erreurs 400 courantes en français", () => {
    expect(describeTelegramError(grammyError(400, "Bad Request: message is too long"))).toMatchObject({ retryable: false, message: expect.stringMatching(/trop long/) });
    expect(describeTelegramError(grammyError(400, "Bad Request: not enough rights to send text messages to the chat"))).toMatchObject({ retryable: false, message: expect.stringMatching(/administrateur/) });
    expect(describeTelegramError(grammyError(400, "Bad Request: can't parse entities: Unsupported start tag"))).toMatchObject({ message: expect.stringMatching(/HTML/) });
  });
  it("reconnaît le 429 avec retry_after et le 403 (bloqué)", () => {
    expect(describeTelegramError(grammyError(429, "Too Many Requests: retry after 7", { retry_after: 7 }))).toMatchObject({ retryable: true, retryAfterMs: 7000 });
    expect(describeTelegramError(grammyError(403, "Forbidden: bot was blocked by the user"))).toMatchObject({ blocked: true, retryable: false });
  });
  it("respecte retry_after puis réussit", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const r = await withTelegramRetry(
      async () => {
        if (n++ < 2) throw grammyError(429, "Too Many Requests", { retry_after: 3 });
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toBe("ok");
    expect(sleeps).toEqual([3000, 3000]);
  });
  it("réessaie 3 fois sur erreur réseau puis abandonne", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await expect(withTelegramRetry(async () => { n++; throw new HttpError("réseau", new Error("ECONNRESET")); }, { sleep: async (ms) => void sleeps.push(ms) })).rejects.toBeInstanceOf(HttpError);
    expect(n).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });
  it("ne réessaie pas une erreur 400", async () => {
    let n = 0;
    await expect(withTelegramRetry(async () => { n++; throw grammyError(400, "Bad Request: message is too long"); }, { sleep: async () => undefined })).rejects.toBeInstanceOf(GrammyError);
    expect(n).toBe(1);
  });
});
