/**
 * Faux fournisseur de captures (tests, simulation sans navigateur) : renvoie une petite image PNG valide et la cote
 * attendue (ou une cote décalée / une erreur imposée). Aucun réseau.
 */
import type { CaptureErrorKind, CaptureRequest, CaptureResult } from "../screenshot";
import type { BrowserScreenshotProvider } from "./provider";

/** PNG 1 × 1 transparent. */
export const TINY_PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

export type FakeScreenshotOptions = {
  /** Cote lue = attendue × (1 + driftPct / 100). */
  driftPct?: number;
  error?: { kind: CaptureErrorKind; message?: string } | null;
  /** Erreur du test de connexion. */
  testError?: { kind: CaptureErrorKind; message?: string } | null;
};

export function createFakeScreenshotProvider(o: FakeScreenshotOptions = {}): BrowserScreenshotProvider & { calls: CaptureRequest[]; fake: true } {
  const calls: CaptureRequest[] = [];
  return {
    name: "fake",
    fake: true,
    calls,
    async capture(req): Promise<CaptureResult> {
      calls.push(req);
      if (o.error) return { ok: false, kind: o.error.kind, message: o.error.message ?? o.error.kind };
      const readOdds = Math.round(req.expectedOdds * (1 + (o.driftPct ?? 0) / 100) * 100) / 100;
      return { ok: true, png: TINY_PNG, readOdds, pageUrl: `https://${req.bookmaker}.test/match` };
    },
    async testConnection(bookmaker): Promise<CaptureResult> {
      if (o.testError) return { ok: false, kind: o.testError.kind, message: o.testError.message ?? o.testError.kind };
      return { ok: true, png: TINY_PNG, readOdds: 0, pageUrl: `https://${bookmaker}.test/` };
    },
    async renderTemplate() {
      return TINY_PNG;
    },
  };
}
