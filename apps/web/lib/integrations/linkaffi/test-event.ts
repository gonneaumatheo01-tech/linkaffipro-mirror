import { randomBytes } from "node:crypto";
import { signLinkaffiBody } from "@linkaffipro/core";

/**
 * « Envoyer un événement de test » (Réglages → Connexions → Campagnes Telegram des affiliés) : un appel signé immédiat
 * depuis le site vers la fonction Link Affi `telegram-events`, avec exactement les mêmes en-têtes que les vrais
 * événements (worker) : `Content-Type`, `apikey` et `Authorization: Bearer` = clé anon de Link Affi, `X-Event-Id`,
 * `X-Signature: sha256=<HMAC-SHA256 du corps brut>`.
 *
 * Corps : la forme du contrat (§ 2) avec `type: "test"` (jamais un vrai membre) :
 * `{ eventId: "lap_test_<horodatage>_<aléa>", type: "test", occurredAt, campaignKey: "test",
 *    channel: { id: "test", title: "Test LinkAffi Pro" },
 *    member: { telegramUserId: "0", username: null, firstName: "Test", languageCode: "fr" },
 *    data: { test: true, message: "…" } }`
 * Link Affi doit vérifier la signature (401 si elle est fausse) puis répondre 2xx sans rien enregistrer.
 *
 * Résultat lisible : reçu (2xx) / signature refusée (401, 403) / refusé (autre 4xx : signature acceptée, corps refusé)
 * / injoignable (réseau, délai, 404, 5xx).
 */

export const LINKAFFI_TEST_EVENT_TYPE = "test";
export const LINKAFFI_TEST_TIMEOUT_MS = 10_000;

export type LinkaffiTestEventBody = {
  eventId: string;
  type: typeof LINKAFFI_TEST_EVENT_TYPE;
  occurredAt: string;
  campaignKey: "test";
  channel: { id: "test"; title: string };
  member: {
    telegramUserId: "0";
    username: null;
    firstName: string;
    languageCode: "fr";
  };
  data: { test: true; message: string };
};

/** Corps de l'événement de test (identifiant unique à chaque envoi). */
export function buildLinkaffiTestEvent(
  now: Date,
  nonce: string = randomBytes(4).toString("hex"),
): LinkaffiTestEventBody {
  return {
    eventId: `lap_test_${now.getTime()}_${nonce}`,
    type: LINKAFFI_TEST_EVENT_TYPE,
    occurredAt: now.toISOString(),
    campaignKey: "test",
    channel: { id: "test", title: "Test LinkAffi Pro" },
    member: { telegramUserId: "0", username: null, firstName: "Test", languageCode: "fr" },
    data: {
      test: true,
      message:
        "Événement de test envoyé depuis LinkAffi Pro : vérifiez la signature, puis ignorez-le.",
    },
  };
}

/** En-têtes d'un envoi à `telegram-events` (mêmes règles pour le test et les vrais événements). */
export function linkaffiEventHeaders(
  rawBody: string,
  eventId: string,
  secret: string,
  anonKey: string,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "X-Event-Id": eventId,
    "X-Signature": signLinkaffiBody(rawBody, secret),
  };
}

export type LinkaffiTestOutcome = "received" | "signature_refused" | "rejected" | "unreachable";

export type LinkaffiTestResult = {
  outcome: LinkaffiTestOutcome;
  /** Code HTTP reçu (null : aucune réponse). */
  status: number | null;
  durationMs: number;
  eventId: string;
  /** Phrase affichée à l'écran, en français simple. */
  message: string;
};

/** Début de la réponse de Link Affi, nettoyé (une ligne, 160 caractères au plus). */
export function responseSnippet(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

/** Résultat lisible d'un envoi de test (règle pure, testée). */
export function describeLinkaffiTestResponse(input: {
  status: number | null;
  durationMs: number;
  error?: string | null;
  snippet?: string | null;
}): { outcome: LinkaffiTestOutcome; message: string } {
  const { status, durationMs } = input;
  const said = input.snippet ? ` Réponse de Link Affi : « ${input.snippet} ».` : "";
  if (status === null)
    return {
      outcome: "unreachable",
      message: `Link Affi est injoignable (${input.error ?? "pas de réponse"}). Vérifiez l'adresse de la fonction, puis réessayez dans quelques minutes.`,
    };
  if (status >= 200 && status < 300)
    return {
      outcome: "received",
      message: `Link Affi a accepté l'événement de test et sa signature (réponse ${status} en ${durationMs} ms) : la connexion est prête.`,
    };
  if (status === 401 || status === 403)
    return {
      outcome: "signature_refused",
      message: `Link Affi refuse la signature (réponse ${status}) : le secret collé dans Link Affi (LINKAFFIPRO_WEBHOOK_SECRET) n'est pas celui d'ici, ou pas encore collé. Collez le secret actuel (ou générez-en un nouveau), puis réessayez.${said}`,
    };
  if (status === 404)
    return {
      outcome: "unreachable",
      message: `Link Affi est injoignable à cette adresse (réponse 404) : la fonction qui reçoit les événements n'existe pas encore, ou l'adresse est fausse.${said}`,
    };
  if (status >= 400 && status < 500)
    return {
      outcome: "rejected",
      message: `Link Affi a reçu l'événement et accepté la signature, mais l'a refusé (réponse ${status}). Les vrais événements devraient passer ; sinon, transmettez cette réponse à Link Affi.${said}`,
    };
  return {
    outcome: "unreachable",
    message: `Link Affi est injoignable pour l'instant (réponse ${status}). Réessayez dans quelques minutes.${said}`,
  };
}

/** Envoie l'événement de test (fetch injectable pour les tests). Ne lève jamais. */
export async function sendLinkaffiTestEvent(opts: {
  url: string;
  secret: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}): Promise<LinkaffiTestResult> {
  const body = buildLinkaffiTestEvent(opts.now ?? new Date());
  const raw = JSON.stringify(body);
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  let status: number | null = null;
  let error: string | null = null;
  let snippet: string | null = null;
  try {
    const res = await doFetch(opts.url, {
      method: "POST",
      headers: linkaffiEventHeaders(raw, body.eventId, opts.secret, opts.anonKey),
      body: raw,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? LINKAFFI_TEST_TIMEOUT_MS),
    });
    status = res.status;
    snippet = responseSnippet(await res.text().catch(() => "")) || null;
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    error =
      e.name === "TimeoutError" || e.name === "AbortError"
        ? `pas de réponse en ${Math.round((opts.timeoutMs ?? LINKAFFI_TEST_TIMEOUT_MS) / 1000)} secondes`
        : (e.cause?.code ?? e.message ?? "erreur réseau");
  }
  const durationMs = Date.now() - started;
  const described = describeLinkaffiTestResponse({ status, durationMs, error, snippet });
  return { ...described, status, durationMs, eventId: body.eventId };
}
