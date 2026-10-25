import { describe, expect, it } from "vitest";
import { signSiteOpsBody, siteOpsKeyFrom, verifySiteOpsSignature } from "./signing";

const KEY = siteOpsKeyFrom(Buffer.alloc(32, 7).toString("base64"));

describe("signature de l'entrée interne du site", () => {
  it("clé dérivée (HKDF) : stable, différente de la clé de chiffrement, refusée si absente", () => {
    expect(siteOpsKeyFrom(Buffer.alloc(32, 7).toString("base64")).equals(KEY)).toBe(true);
    expect(KEY.equals(Buffer.alloc(32, 7))).toBe(false);
    expect(KEY.length).toBe(32);
    expect(() => siteOpsKeyFrom("")).toThrow();
  });

  it("signature juste dans la fenêtre ; corps, horodatage ou clé changés : refusée", () => {
    const now = 1_761_400_000_000;
    const body = JSON.stringify({ op: "reglages.etiquette_creer", input: { nom: "VIP" } });
    const sig = signSiteOpsBody(KEY, now, body);
    expect(verifySiteOpsSignature({ key: KEY, timestamp: String(now), signature: sig, body, now: now + 1000 })).toEqual({ ok: true });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: String(now), signature: sig, body: `${body} `, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: String(now + 1), signature: sig, body, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySiteOpsSignature({ key: siteOpsKeyFrom("autre"), timestamp: String(now), signature: sig, body, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: String(now), signature: sig, body, now: now + 61_000 })).toEqual({ ok: false, reason: "expired" });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: String(now), signature: sig, body, now: now - 61_000 })).toEqual({ ok: false, reason: "expired" });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: null, signature: sig, body, now })).toEqual({ ok: false, reason: "missing" });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: "abc", signature: sig, body, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySiteOpsSignature({ key: KEY, timestamp: String(now), signature: "zz", body, now })).toEqual({ ok: false, reason: "malformed" });
  });
});
