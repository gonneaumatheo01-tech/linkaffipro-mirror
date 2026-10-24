/**
 * « Tester la connexion » d'un bookmaker (phase 23, chantier B) : connexion avec les identifiants du client et
 * capture de la page d'accueil. Dans le worker (ou le Mac), le navigateur local fait le test ; sur le site, qui n'a pas
 * de navigateur, le test passe par la file en base et le worker y répond (attente bornée). Résultat sans secret.
 * Le vérificateur du mot de passe (bot Telegram) lance le test sans l'attendre : le résultat arrive par message.
 */
import { prisma as sharedPrisma } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import type { CaptureResult } from "../providers/screenshot";
import { registerSecretVerifier } from "../human/secrets";
import { captureBlocked, captureResultText } from "../providers/screenshot/errors";
import { localScreenshotProvider } from "../providers/screenshot/registry";
import { createCaptureRequest, waitCaptureRequest, type StoredCaptureRequest } from "../providers/screenshot/requests";
import { loadCaptureSettings } from "../providers/screenshot/settings";
import { storeCapturePng } from "../providers/screenshot/store";
import { bookmakerKey, supportedBookmakers } from "../providers/screenshot/adapters";
import { bookmakerPasswordKey, credentialsFrom, readBookmakerCredentials } from "../providers/screenshot/session";

export const CONNECTION_TEST_WAIT_MS = 100_000;

export type ConnectionTestOutcome = { result: CaptureResult; assetId: string | null; message: string };

/** Pur : phrase affichée au client après un test. */
export function connectionMessage(bookmaker: string, result: CaptureResult): string {
  if (result.ok) return `connexion à ${bookmaker} réussie ✅`;
  const base = `connexion à ${bookmaker} impossible : ${captureResultText(result)}`;
  return captureBlocked(result) ? `${base}. Le site bloque le serveur : il faudra une adresse IP résidentielle ou la capture depuis le Mac.` : base;
}

function fromStored(bookmaker: string, s: StoredCaptureRequest | null): ConnectionTestOutcome {
  if (!s || !s.result) {
    const result: CaptureResult = { ok: false, kind: "timeout", message: "le worker n'a pas encore répondu : réessayez dans une minute" };
    return { result, assetId: null, message: connectionMessage(bookmaker, result) };
  }
  if (s.result.ok) {
    // Les octets restent en base (MediaAsset) : le résultat rendu porte une image vide.
    const result: CaptureResult = { ok: true, png: new Uint8Array(), readOdds: 0, pageUrl: s.result.pageUrl };
    return { result, assetId: s.result.assetId || null, message: connectionMessage(bookmaker, result) };
  }
  const result: CaptureResult = { ok: false, kind: s.result.kind, message: s.result.message };
  return { result, assetId: null, message: connectionMessage(bookmaker, result) };
}

export async function testBookmakerConnection(deps: AgentsDeps, bookmaker: string): Promise<ConnectionTestOutcome> {
  const key = bookmakerKey(bookmaker);
  if (!supportedBookmakers().includes(key)) {
    const result: CaptureResult = { ok: false, kind: "not_found", message: `bookmaker « ${bookmaker} » sans adaptateur de capture` };
    return { result, assetId: null, message: connectionMessage(bookmaker, result) };
  }
  const settings = await loadCaptureSettings(deps.prisma);
  const local = settings.mode === "mac" ? null : localScreenshotProvider();
  if (local) {
    const result = await local.testConnection(key);
    let assetId: string | null = null;
    if (result.ok && result.png.byteLength > 0) assetId = (await storeCapturePng(deps.prisma, { png: result.png, bookmaker: key, salt: `test:${Date.now()}`, tags: ["test-connexion"] })).id;
    return { result, assetId, message: connectionMessage(key, result) };
  }
  const req = await createCaptureRequest(deps.prisma, { kind: "test", target: settings.mode, bookmaker: key });
  const done = await waitCaptureRequest(deps.prisma, req.id, { timeoutMs: settings.mode === "mac" ? 30_000 : CONNECTION_TEST_WAIT_MS });
  return fromStored(key, done);
}

/**
 * Vérificateur du mot de passe (`providers.bookmakers.<nom>.password`) : enfile le test
 * de connexion (le worker répond à l'admin par Telegram) et rend la main tout de suite (webhook du bot : pas d'attente).
 */
export function registerBookmakerVerifiers(prismaClient: AgentsDeps["prisma"] = sharedPrisma as never): void {
  for (const name of supportedBookmakers())
    registerSecretVerifier(bookmakerPasswordKey(name), async () => {
      if (!(await readBookmakerCredentials(prismaClient, name))) return { ok: false, message: "il manque l'identifiant du compte : envoie-le d'abord" };
      const settings = await loadCaptureSettings(prismaClient);
      await createCaptureRequest(prismaClient, { kind: "test", target: settings.mode, bookmaker: name, notifyAdmin: true });
      return { ok: true, message: `test de connexion à ${name} lancé : résultat par message dans une minute` };
    });
}

/** Identifiants complets ? (pur, sur les deux valeurs rangées) */
export const bookmakerCredentialsComplete = (login: string | null, password: string | null): boolean => credentialsFrom(login, password) !== null;
