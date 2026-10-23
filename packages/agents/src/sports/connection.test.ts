/** « Tester la connexion » : navigateur local, sinon file en base traitée par le worker ; vérificateur du mot de passe. */
import { encrypt } from "@linkaffipro/core";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePrisma } from "../testing/fake-prisma";
import { clearSecretVerifiers, secretSettingKey, verifySecret } from "../human/secrets";
import { createFakeScreenshotProvider, TINY_PNG } from "../providers/screenshot/fake";
import { registerScreenshotProvider } from "../providers/screenshot/registry";
import { claimNextCaptureRequest, completeCaptureRequest } from "../providers/screenshot/requests";
import type { AgentsDeps } from "../types";
import { registerBookmakerVerifiers, testBookmakerConnection } from "./connection";

process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const secret = (key: string, v: string) => ({ key: secretSettingKey(key), value: { enc: encrypt(v), last4: v.slice(-4), updatedAt: "" } });

function deps(withCreds = true) {
  const prisma = createFakePrisma({
    setting: withCreds ? [secret("providers.bookmakers.sportaza.login", "moi@x.fr"), secret("providers.bookmakers.sportaza.password", "motdepasse")] : [],
  });
  return { prisma, enqueue: { orchestrator: async () => undefined, step: async () => undefined } } as unknown as AgentsDeps & { prisma: ReturnType<typeof createFakePrisma> };
}

afterEach(() => {
  registerScreenshotProvider(null);
  clearSecretVerifiers();
});

describe("test de connexion d'un bookmaker", () => {
  it("navigateur local : capture de l'accueil rangée, message sans secret", async () => {
    registerScreenshotProvider(createFakeScreenshotProvider());
    const d = deps();
    const r = await testBookmakerConnection(d, "Sportaza");
    expect(r.result.ok).toBe(true);
    expect(r.assetId).toBeTruthy();
    expect(r.message).toMatch(/réussie/);
    expect(r.message).not.toMatch(/motdepasse|moi@x/);
  });

  it("site bloqué : message qui annonce le choix adresse IP résidentielle / Mac", async () => {
    registerScreenshotProvider(createFakeScreenshotProvider({ testError: { kind: "geo_blocked", message: "pays" } }));
    const r = await testBookmakerConnection(deps(), "sportaza");
    expect(r.result).toMatchObject({ ok: false, kind: "geo_blocked" });
    expect(r.message).toMatch(/adresse IP résidentielle ou la capture depuis le Mac/);
  });

  it("sans navigateur (site) : demande en base, réponse du worker relue", async () => {
    const d = deps();
    const pending = testBookmakerConnection(d, "sportaza");
    // Le « worker » prend la demande et y répond.
    let claimed = null;
    for (let i = 0; i < 50 && !claimed; i++) {
      claimed = await claimNextCaptureRequest(d.prisma, "server", "worker");
      if (!claimed) await new Promise((r) => setTimeout(r, 20));
    }
    expect(claimed?.kind).toBe("test");
    await completeCaptureRequest(d.prisma, claimed!.id, { ok: true, png: TINY_PNG, readOdds: 0, pageUrl: "https://sportaza.com/" });
    const r = await pending;
    expect(r.result.ok).toBe(true);
    expect(r.assetId).toBeTruthy();
  }, 10_000);

  it("bookmaker inconnu : refus clair", async () => {
    const r = await testBookmakerConnection(deps(), "inconnu");
    expect(r.result).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("vérificateur du mot de passe : test enfilé pour le worker, réponse immédiate", async () => {
    const d = deps();
    registerBookmakerVerifiers(d.prisma);
    const v = await verifySecret(d, "providers.bookmakers.sportaza.password");
    expect(v).toMatchObject({ ok: true });
    const req = await claimNextCaptureRequest(d.prisma, "server", "worker");
    expect(req).toMatchObject({ kind: "test", bookmaker: "sportaza", notifyAdmin: true });
    // L'identifiant seul n'a pas de vérificateur (la question suivante demande le mot de passe).
    expect(await verifySecret(d, "providers.bookmakers.sportaza.login")).toBeNull();
  });
});
