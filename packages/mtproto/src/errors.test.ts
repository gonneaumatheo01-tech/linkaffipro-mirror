import { describe, expect, it } from "vitest";
import {
  classifyError,
  describeRpcCode,
  floodWaitSecondsOf,
  MtprotoAuthError,
  MtprotoFloodWait,
  MtprotoPasswordNeeded,
  MtprotoRpcError,
  rpcCodeOf,
} from "./errors";

/** Imitation d'une RPCError GramJS (sans importer GramJS). */
function rpc(errorMessage: string, extra: Record<string, unknown> = {}) {
  const e = new Error(`400: ${errorMessage} (caused by x)`);
  return Object.assign(e, { errorMessage, code: 400, ...extra });
}

describe("classifyError", () => {
  it("FLOOD_WAIT avec seconds → MtprotoFloodWait", () => {
    const e = classifyError(rpc("FLOOD", { seconds: 17 }));
    expect(e).toBeInstanceOf(MtprotoFloodWait);
    expect((e as MtprotoFloodWait).seconds).toBe(17);
  });
  it("FLOOD_WAIT_X dans le message sans seconds", () => {
    const e = classifyError(rpc("FLOOD_WAIT_42"));
    expect(e).toBeInstanceOf(MtprotoFloodWait);
    expect((e as MtprotoFloodWait).seconds).toBe(42);
  });
  it("« A wait of N seconds is required » (message GramJS)", () => {
    const e = classifyError(new Error("A wait of 5 seconds is required (caused by x)"));
    expect(e).toBeInstanceOf(MtprotoFloodWait);
    expect((e as MtprotoFloodWait).seconds).toBe(5);
  });
  it("AUTH_KEY_UNREGISTERED / SESSION_REVOKED → MtprotoAuthError", () => {
    for (const code of ["AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "USER_DEACTIVATED"]) {
      const e = classifyError(rpc(code, { code: 401 }));
      expect(e).toBeInstanceOf(MtprotoAuthError);
      expect((e as MtprotoAuthError).code).toBe(code);
    }
  });
  it("AUTH_KEY_DUPLICATED (session utilisée en même temps à deux endroits) → MtprotoAuthError, compte à reconnecter", () => {
    const e = classifyError(rpc("AUTH_KEY_DUPLICATED", { code: 406 }));
    expect(e).toBeInstanceOf(MtprotoAuthError);
    expect((e as MtprotoAuthError).code).toBe("AUTH_KEY_DUPLICATED");
    expect(
      classifyError(new Error("406: AUTH_KEY_DUPLICATED (caused by messages.GetHistory)")),
    ).toBeInstanceOf(MtprotoAuthError);
  });
  it("SESSION_PASSWORD_NEEDED → MtprotoPasswordNeeded", () => {
    expect(classifyError(rpc("SESSION_PASSWORD_NEEDED"))).toBeInstanceOf(MtprotoPasswordNeeded);
  });
  it("autre code Telegram → MtprotoRpcError avec message français", () => {
    const e = classifyError(rpc("PHONE_CODE_INVALID"));
    expect(e).toBeInstanceOf(MtprotoRpcError);
    expect((e as MtprotoRpcError).code).toBe("PHONE_CODE_INVALID");
    expect(e.message).toMatch(/Code incorrect/);
  });
  it("code inconnu → message générique avec le code", () => {
    expect(describeRpcCode("WEIRD_THING")).toBe("Erreur Telegram : WEIRD_THING");
  });
  it("erreur ordinaire → inchangée ; valeur non-Error → Error", () => {
    const plain = new Error("réseau coupé");
    expect(classifyError(plain)).toBe(plain);
    expect(classifyError("boom")).toBeInstanceOf(Error);
    expect(classifyError(null).message).toMatch(/inconnue/);
  });
  it("une erreur déjà typée est renvoyée telle quelle", () => {
    const e = new MtprotoAuthError("SESSION_REVOKED");
    expect(classifyError(e)).toBe(e);
  });
});

describe("rpcCodeOf / floodWaitSecondsOf", () => {
  it("lit errorMessage en priorité, sinon le message", () => {
    expect(rpcCodeOf(rpc("PEER_ID_INVALID"))).toBe("PEER_ID_INVALID");
    expect(rpcCodeOf(new Error("401: AUTH_KEY_UNREGISTERED (caused by x)"))).toBe(
      "AUTH_KEY_UNREGISTERED",
    );
    expect(rpcCodeOf(new Error("rien"))).toBeNull();
    expect(rpcCodeOf(null)).toBeNull();
  });
  it("ne prend pas `seconds` pour une erreur qui n'est pas un flood", () => {
    expect(floodWaitSecondsOf(rpc("PEER_ID_INVALID", { seconds: 3 }))).toBeNull();
  });
});

describe("attentes imposées par Telegram (publication par le compte, phase 12)", () => {
  it("SLOWMODE_WAIT_X et FLOOD_PREMIUM_WAIT_X → MtprotoFloodWait", () => {
    const slow = classifyError(rpc("SLOWMODE_WAIT_12"));
    expect(slow).toBeInstanceOf(MtprotoFloodWait);
    expect((slow as MtprotoFloodWait).seconds).toBe(12);
    const premium = classifyError(rpc("FLOOD_PREMIUM_WAIT_7"));
    expect((premium as MtprotoFloodWait).seconds).toBe(7);
  });
  it("droits et Premium : messages en français, sans code", () => {
    for (const code of [
      "CHAT_WRITE_FORBIDDEN",
      "PREMIUM_ACCOUNT_REQUIRED",
      "USER_NOT_PARTICIPANT",
      "DOCUMENT_INVALID",
      "RANDOM_ID_DUPLICATE",
    ]) {
      const msg = describeRpcCode(code);
      expect(msg, code).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(msg, code).toMatch(/[éèàç]|compte|Telegram/);
    }
  });
});
