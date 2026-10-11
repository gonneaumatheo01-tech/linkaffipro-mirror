import { describe, expect, it } from "vitest";
import { telegramErrorKind, telegramErrorText } from "./telegram-error";

/** Espaces insécables des guillemets ramenées à des espaces simples pour comparer. */
const sp = (s: string | undefined) => (s ?? "").replace(/\u00a0/g, " ");

describe("erreurs Telegram en français simple", () => {
  it("jeton refusé (401) : pastille et phrase claires, texte brut gardé pour le détail", () => {
    const raw = "Call to 'getWebhookInfo' failed! (401: Unauthorized)";
    const v = telegramErrorText(raw);
    expect(v).toMatchObject({ kind: "token", label: "Jeton refusé", raw });
    expect(v?.sentence).toContain("Telegram refuse le jeton de ce bot");
    expect(sp(v?.sentence)).toContain("« Ajouter un bot »");
    expect(telegramErrorKind("Unauthorized", "check")).toBe("token");
    expect(telegramErrorKind("Call to 'getMe' failed! (404: Not Found)", "check")).toBe("token");
  });

  it("réseau ou délai dépassé : Telegram injoignable, réessayer plus tard", () => {
    for (const raw of [
      "Network request for 'getWebhookInfo' failed!",
      "fetch failed",
      "timeout",
      "connect ETIMEDOUT 149.154.167.220:443",
      "getaddrinfo ENOTFOUND api.telegram.org",
      "The operation was aborted",
    ]) {
      const v = telegramErrorText(raw);
      expect(v?.kind, raw).toBe("network");
      expect(v?.label).toBe("Telegram injoignable");
      expect(v?.sentence).toBe("Telegram ne répond pas, réessayez dans quelques minutes.");
    }
  });

  it("trop de demandes (429) : patienter, le bot reprend seul", () => {
    expect(
      telegramErrorText("Call to 'sendMessage' failed! (429: Too Many Requests: retry after 5)")
        ?.kind,
    ).toBe("rate");
  });

  it("erreur de transmission signalée par Telegram : le site n'est pas joint", () => {
    const v = telegramErrorText(
      "Wrong response from the webhook: 503 Service Unavailable",
      "delivery",
    );
    expect(v?.kind).toBe("delivery");
    expect(v?.label).toBe("Messages non transmis");
    expect(sp(v?.sentence)).toContain("« Reposer la connexion »");
    // « Connection timed out » côté transmission : c'est le site que Telegram n'atteint pas.
    expect(telegramErrorKind("Connection timed out", "delivery")).toBe("delivery");
    expect(telegramErrorKind("Connection timed out", "check")).toBe("network");
  });

  it("autre erreur : phrase générale ; erreur du bot : phrase propre au bot", () => {
    expect(telegramErrorText("Bad Request: chat not found")).toMatchObject({
      kind: "other",
      label: "Erreur Telegram",
    });
    expect(telegramErrorText("TypeError: x is undefined", "bot")).toMatchObject({
      kind: "other",
      label: "Erreur du bot",
    });
    // Un jeton refusé reste un jeton refusé, quelle que soit la source.
    expect(telegramErrorText("Unauthorized", "bot")?.kind).toBe("token");
  });

  it("aucune erreur : rien à afficher", () => {
    expect(telegramErrorText(null)).toBeNull();
    expect(telegramErrorText(undefined)).toBeNull();
    expect(telegramErrorText("  ")).toBeNull();
  });

  it("aucune phrase ne laisse passer de jargon ni d'anglais", () => {
    const raws: Array<[string, "check" | "delivery" | "bot"]> = [
      ["Unauthorized", "check"],
      ["fetch failed", "check"],
      ["429 Too Many Requests", "check"],
      ["Wrong response from the webhook", "delivery"],
      ["Bad Request", "check"],
      ["boom", "bot"],
    ];
    for (const [raw, source] of raws) {
      const v = telegramErrorText(raw, source)!;
      expect(`${v.label} ${v.sentence}`).not.toMatch(
        /webhook|unauthori|failed|request|getwebhookinfo/i,
      );
    }
  });
});
