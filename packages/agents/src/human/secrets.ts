/**
 * Clés des fournisseurs (CONTRAT, propriétaire : chantier B). Rangées chiffrées dans `Setting`
 * (`packages/core/src/crypto.ts`), jamais renvoyées au navigateur, jamais dans `Event`, `AuditLog`, un log ou un message.
 * Rangement : `Setting` `agents.secret.<clé>` = `{ enc, last4, updatedAt }` (`enc` = `encrypt()` de core).
 */
import { decrypt, encrypt } from "@linkaffipro/core";
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";
import { agentAudit, agentEvent, nowOf } from "../admin/journal";
import { last4 } from "./answer";

/** Clés connues dans cette phase (les phases suivantes en ajoutent : fal, cotes, bookmaker…). */
export const SECRET_KEYS = [
  "providers.fal.apiKey",
  "providers.magichour.apiKey",
  "providers.odds.apiKey",
  // Phase 23 : compte bookmaker (identifiant puis mot de passe) et adresse IP résidentielle des captures.
  "providers.bookmakers.sportaza.login",
  "providers.bookmakers.sportaza.password",
  "providers.screenshotProxy",
] as const;

export type SecretSummary = { set: boolean; last4: string | null; updatedAt: Date | null };

export const SECRET_SETTING_PREFIX = "agents.secret.";

export function secretSettingKey(key: string): string {
  return `${SECRET_SETTING_PREFIX}${key}`;
}

/**
 * Clés d'identifiants d'un bookmaker (phase 23) : deux clés séparées, `.login` (identifiant) et `.password`
 * (mot de passe, vérifié par un test de connexion). `bookmakerSecretKey` = clé de l'identifiant.
 */
export function bookmakerSecretKey(name: string): string {
  return `providers.bookmakers.${name.toLowerCase().replace(/[^a-z0-9_-]/g, "")}.login`;
}
export function bookmakerPasswordSecretKey(name: string): string {
  return `providers.bookmakers.${name.toLowerCase().replace(/[^a-z0-9_-]/g, "")}.password`;
}

/** Libellé affiché (« clé fal.ai »), jamais la valeur. */
export function secretLabel(key: string): string {
  if (key === "providers.fal.apiKey") return "clé fal.ai";
  if (key === "providers.magichour.apiKey") return "clé Magic Hour";
  if (key === "providers.odds.apiKey") return "clé des cotes";
  const bk = /^providers\.bookmakers\.([^.]+)\.login$/.exec(key);
  if (bk) return `identifiant ${bk[1]}`;
  const pw = /^providers\.bookmakers\.([^.]+)\.password$/.exec(key);
  if (pw) return `mot de passe ${pw[1]}`;
  if (key === "providers.screenshotProxy") return "adresse IP résidentielle";
  return `clé ${key}`;
}

type StoredSecret = { enc: string; last4: string; updatedAt: string };

function asStored(v: unknown): StoredSecret | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.enc !== "string" || typeof o.last4 !== "string") return null;
  return { enc: o.enc, last4: o.last4, updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "" };
}

/** Vérificateur d'une clé (appel au fournisseur) ; enregistrés par les phases suivantes (fal, cotes, bookmaker). */
export type SecretVerifier = (value: string) => Promise<{ ok: boolean; message: string }>;

const verifiers = new Map<string, SecretVerifier>();

/** Enregistre un vérificateur pour une clé exacte, ou un préfixe terminé par « * » (`providers.bookmakers.*`). */
export function registerSecretVerifier(keyOrPrefix: string, verifier: SecretVerifier): void {
  verifiers.set(keyOrPrefix, verifier);
}

/** Retire tous les vérificateurs (tests). */
export function clearSecretVerifiers(): void {
  verifiers.clear();
}

/** Un vérificateur est-il prévu pour cette clé (phase 23 : test de connexion du bookmaker) ? */
export function hasSecretVerifier(key: string): boolean {
  return verifierFor(key) !== null;
}

function verifierFor(key: string): SecretVerifier | null {
  const exact = verifiers.get(key);
  if (exact) return exact;
  for (const [k, v] of verifiers) if (k.endsWith("*") && key.startsWith(k.slice(0, -1))) return v;
  return null;
}

/** Enregistre (chiffrée) une clé ; renvoie seulement les 4 derniers caractères. */
export async function saveSecret(
  deps: AgentsDeps,
  key: string,
  value: string,
  actor: ActorRef,
): Promise<{ last4: string }> {
  const clean = value.trim();
  if (!clean) throw new Error("Clé vide");
  // Pour des identifiants (JSON), les 4 derniers caractères affichés sont ceux du mot de passe.
  let tail = last4(clean);
  try {
    const parsed = JSON.parse(clean) as { password?: unknown };
    if (parsed && typeof parsed.password === "string") tail = last4(parsed.password);
  } catch {
    /* clé simple */
  }
  const stored: StoredSecret = { enc: encrypt(clean), last4: tail, updatedAt: nowOf(deps).toISOString() };
  const settingKey = secretSettingKey(key);
  await deps.prisma.setting.upsert({
    where: { key: settingKey },
    create: { key: settingKey, value: stored },
    update: { value: stored },
  });
  // Jamais la valeur ni ses derniers caractères dans le journal.
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.secret.saved",
    entityType: "Setting",
    entityId: settingKey,
    metadata: { key, via: actor.via, label: `${secretLabel(key)} enregistrée` },
  });
  await agentEvent(deps, "agents.secret.saved", { key, via: actor.via });
  return { last4: tail };
}

/** Résumé affichable (jamais la valeur). */
export async function secretSummary(prisma: PrismaClient, key: string): Promise<SecretSummary> {
  const s = await prisma.setting.findUnique({ where: { key: secretSettingKey(key) } });
  const stored = asStored(s?.value);
  if (!stored) return { set: false, last4: null, updatedAt: null };
  return { set: true, last4: stored.last4, updatedAt: stored.updatedAt ? new Date(stored.updatedAt) : null };
}

/** Valeur en clair, côté serveur seulement (fournisseurs). */
export async function readSecret(prisma: PrismaClient, key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key: secretSettingKey(key) } });
  const stored = asStored(s?.value);
  if (!stored) return null;
  try {
    return decrypt(stored.enc);
  } catch {
    return null;
  }
}

/** Vérification d'une clé quand un vérificateur existe ; `null` si aucun n'est prévu pour cette clé. */
export async function verifySecret(
  deps: AgentsDeps,
  key: string,
): Promise<{ ok: boolean; message: string } | null> {
  const verifier = verifierFor(key);
  if (!verifier) return null;
  const value = await readSecret(deps.prisma, key);
  if (!value) return { ok: false, message: "aucune clé enregistrée" };
  let result: { ok: boolean; message: string };
  try {
    result = await verifier(value);
  } catch (err) {
    result = { ok: false, message: (err as Error).message.slice(0, 200) };
  }
  await agentEvent(deps, "agents.secret.verified", { key, ok: result.ok });
  return result;
}

export async function deleteSecret(deps: AgentsDeps, key: string, actor: ActorRef): Promise<void> {
  const settingKey = secretSettingKey(key);
  await deps.prisma.setting.deleteMany({ where: { key: settingKey } });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.secret.deleted",
    entityType: "Setting",
    entityId: settingKey,
    metadata: { key, via: actor.via, label: `${secretLabel(key)} supprimée` },
  });
}
