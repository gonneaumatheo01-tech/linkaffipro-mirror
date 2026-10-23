/** Échanges avec le Mac (`capture-runner`) : jeton, prise d'une demande « mac », dépôt du résultat et de la session. */
import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../../testing/fake-prisma";
import { TINY_PNG } from "./fake";
import { createCaptureRequest, readCaptureRequest } from "./requests";
import { checkCaptureRunnerToken, issueCaptureRunnerToken, parseRunnerResult, runnerNext, runnerResult } from "./runner-api";
import { readBookmakerSession } from "./session";

process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

describe("API du capture-runner", () => {
  it("jeton : créé une fois, vérifié en temps constant", async () => {
    const prisma = createFakePrisma();
    const t = await issueCaptureRunnerToken(prisma);
    expect(await issueCaptureRunnerToken(prisma)).toBe(t);
    expect(await checkCaptureRunnerToken(prisma, `Bearer ${t}`)).toBe(true);
    expect(await checkCaptureRunnerToken(prisma, "Bearer faux")).toBe(false);
    expect(await checkCaptureRunnerToken(prisma, null)).toBe(false);
    expect(await issueCaptureRunnerToken(prisma, { rotate: true })).not.toBe(t);
  });

  it("le Mac prend une demande « mac », dépose capture et session", async () => {
    const prisma = createFakePrisma();
    const req = await createCaptureRequest(prisma, { kind: "capture", target: "mac", bookmaker: "sportaza", request: { bookmaker: "sportaza", homeTeam: "A", awayTeam: "B", kickoffAt: new Date(), marketLabel: "Corners", selectionLabel: "Plus de", line: 9.5, expectedOdds: 1.9 } });
    const job = await runnerNext(prisma);
    expect(job?.request.id).toBe(req.id);
    expect(job?.credentials).toBeNull();
    expect(await runnerNext(prisma)).toBeNull();
    const session = { cookies: [{ name: "s", value: "1" }], origins: [] };
    const r = await runnerResult(prisma, { id: req.id, ok: true, pngBase64: Buffer.from(TINY_PNG).toString("base64"), readOdds: 1.92, pageUrl: "https://sportaza.com/m", session });
    expect(r.ok).toBe(true);
    expect((await readCaptureRequest(prisma, req.id))?.result).toMatchObject({ ok: true, readOdds: 1.92 });
    expect(await readBookmakerSession(prisma, "sportaza")).toEqual(session);
  });

  it("corps invalides refusés", () => {
    expect(parseRunnerResult({ ok: true })).toHaveProperty("error");
    expect(parseRunnerResult({ id: "x", ok: true, pngBase64: "aGVsbG8=", readOdds: 2 })).toHaveProperty("error");
    expect(parseRunnerResult({ id: "x", ok: false, kind: "n'importe", message: "m" })).toMatchObject({ result: { ok: false, kind: "unknown" } });
  });
});
