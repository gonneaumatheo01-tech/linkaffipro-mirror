import { describe, expect, it } from "vitest";
import { isDevOnlyNoise, summarizeErrors } from "./console-errors";

const EVAL =
  "eval() is not supported in this environment. If this page was served with a `Content-Security-Policy` header, make sure that `unsafe-eval` is included. React requires eval() in development mode…";
const BASE_UI =
  "Base UI: A component that acts as a button expected a native <button> because the `nativeButton` prop is true.\n    at Button";

describe("erreurs JavaScript des pages", () => {
  it("ignore le message de React propre au mode développement (CSP sans unsafe-eval)", () => {
    expect(isDevOnlyNoise(EVAL)).toBe(true);
    expect(isDevOnlyNoise(BASE_UI)).toBe(false);
  });
  it("compte les vraies erreurs et garde 3 exemples distincts (première ligne, 200 caractères au plus)", () => {
    const s = summarizeErrors([
      EVAL,
      BASE_UI,
      BASE_UI,
      "TypeError: x is undefined",
      "a",
      "b".repeat(300),
    ]);
    expect(s.count).toBe(5);
    expect(s.samples).toEqual([
      "Base UI: A component that acts as a button expected a native <button> because the `nativeButton` prop is true.",
      "TypeError: x is undefined",
      "a",
    ]);
    expect(summarizeErrors(["c".repeat(300)]).samples[0]).toHaveLength(200);
    expect(summarizeErrors([EVAL])).toEqual({ count: 0, samples: [] });
  });
});
