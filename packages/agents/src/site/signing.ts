/**
 * Phase 34, chantier A — signature de l'entrée interne `POST /api/internal/site-ops` (pur, `node:crypto` seulement).
 * Une seule implémentation pour le client du worker (`apps/worker/src/agents/site-ops-client.ts`) et pour la route du
 * site (`apps/web/lib/site-ops/endpoint-auth.ts`) : la signature produite d'un côté est exactement celle vérifiée de
 * l'autre. Clé = HKDF-SHA256(`APP_ENCRYPTION_KEY`, sel vide, `SITE_OPS_KEY_CONTEXT`, 32 octets) : aucune nouvelle
 * variable à poser, et la clé de chiffrement elle-même ne signe jamais rien.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { SITE_OPS_KEY_CONTEXT, SITE_OPS_MAX_SKEW_MS } from "./contract";

/** Clé de signature dérivée de `APP_ENCRYPTION_KEY` (lève si la clé manque). */
export function siteOpsKeyFrom(appEncryptionKey: string | undefined | null): Buffer {
  const raw = (appEncryptionKey ?? "").trim();
  if (!raw) throw new Error("APP_ENCRYPTION_KEY manquante : entrée interne du site impossible à signer");
  return Buffer.from(hkdfSync("sha256", Buffer.from(raw, "utf8"), Buffer.alloc(0), Buffer.from(SITE_OPS_KEY_CONTEXT, "utf8"), 32));
}

/** Signature HMAC-SHA256 (hex) de `${timestamp}.${corps}`. */
export function signSiteOpsBody(key: Buffer, timestamp: string | number, body: string): string {
  return createHmac("sha256", key).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export type SiteOpsSignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "bad_signature" };

/**
 * Vérifie une requête signée : horodatage en millisecondes dans la fenêtre `SITE_OPS_MAX_SKEW_MS` (passé comme
 * futur), signature hex de 64 caractères comparée à temps constant. L'anti-rejeu est à la charge de l'appelant.
 */
export function verifySiteOpsSignature(input: {
  key: Buffer;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: string;
  now?: number;
  maxSkewMs?: number;
}): SiteOpsSignatureCheck {
  const ts = (input.timestamp ?? "").trim();
  const sig = (input.signature ?? "").trim().toLowerCase();
  if (!ts || !sig) return { ok: false, reason: "missing" };
  if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: "malformed" };
  const now = input.now ?? Date.now();
  if (Math.abs(now - Number(ts)) > (input.maxSkewMs ?? SITE_OPS_MAX_SKEW_MS)) return { ok: false, reason: "expired" };
  const expected = Buffer.from(signSiteOpsBody(input.key, ts, input.body), "hex");
  const given = Buffer.from(sig, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
