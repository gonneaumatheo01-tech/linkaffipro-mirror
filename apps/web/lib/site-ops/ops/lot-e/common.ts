/**
 * Phase 34, lot E — outils communs des cœurs (réglages, connecteurs, équipe, compte). Module SANS « use server » :
 * jamais appelable par le navigateur. Aucun import de `next/*` ici (les cœurs restent testables et appelables par Kevin).
 */
import type { SiteOpActor, SiteOpPreview, SiteOpResult, SiteOpRunOptions } from "@linkaffipro/agents";

export type { SiteOpActor, SiteOpResult, SiteOpRunOptions };

export type Fail = Extract<SiteOpResult, { ok: false }>;
export type CoreRun = (input: Record<string, unknown>, actor: SiteOpActor, opts?: SiteOpRunOptions) => Promise<SiteOpResult>;

/** Acteur d'une action du site (utilisateur connecté). Même forme que le `webActor` du socle. */
export function webActor(user: { id: string; role: string }): SiteOpActor {
  return { userId: user.id, role: user.role === "ADMIN" ? "ADMIN" : "MANAGER", via: "WEB" };
}

/** Métadonnée `via` ajoutée à chaque `AuditLog` écrit par un cœur. */
export function viaMeta(actor: SiteOpActor): { via: "WEB" | "TELEGRAM" } {
  return { via: actor.via };
}

export function ok(message: string, data?: Record<string, unknown>): SiteOpResult {
  return data ? { ok: true, message, data } : { ok: true, message };
}

export function fail(
  error: string,
  code: "invalid" | "forbidden" | "not_found" | "conflict" | "unavailable" = "invalid",
  field?: string | null,
): Fail {
  return field ? { ok: false, error, code, field } : { ok: false, error, code };
}

/** Essai à blanc : rien n'a été écrit ni envoyé, voici ce qui serait fait. */
export function preview(p: SiteOpPreview, data?: Record<string, unknown>): SiteOpResult {
  return { ok: true, message: p.summary, preview: p, ...(data ? { data } : {}) };
}

/** Texte de refus du site pour une action réservée (`requireAdmin` → `ForbiddenError`). */
export const ADMIN_ONLY = "Action réservée aux administrateurs";

/** Contrôle du rôle dans le cœur (réglages, utilisateurs, jetons, suppressions = ADMIN). */
export function adminOnly(actor: SiteOpActor, message = ADMIN_ONLY): Fail | null {
  return actor.role === "ADMIN" ? null : fail(message, "forbidden");
}

/** Un compte du site est nécessaire (auteur d'un réglage, connexion en attente liée à un utilisateur…). */
export function needUser(actor: SiteOpActor): Fail | null {
  return actor.userId
    ? null
    : fail("Aucun compte du site n'est lié à ce compte Telegram : cette action a besoin d'un compte.", "forbidden");
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Lecture tolérante d'un booléen venu de Kevin (true, "on", "oui", "1"…) ; `undefined` si absent. */
export function optBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["1", "on", "true", "oui", "yes"].includes(s)) return true;
  if (["0", "off", "false", "non", "no"].includes(s)) return false;
  return undefined;
}

export function bool(v: unknown, fallback = false): boolean {
  return optBool(v) ?? fallback;
}

/** Message d'une erreur levée (même repli que le site). */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Redirection Next.js (à relancer telle quelle). */
export function isNextRedirect(err: unknown): boolean {
  const d = (err as { digest?: unknown })?.digest;
  return typeof d === "string" && d.startsWith("NEXT_REDIRECT");
}

/** Paramètres d'adresse d'un retour de page (`?ok=` ou `?error=`), pour les actions du site. */
export function backParams(r: SiteOpResult, extra: Record<string, string> = {}): Record<string, string> {
  return r.ok ? { ok: r.message, ...extra } : { error: r.error, ...extra };
}

type Named = { id: string; name: string; extra?: string[] };
export type Ref = { ok: true; id: string; name: string } | { ok: false; result: Fail };

/**
 * Une ligne désignée par son identifiant exact (cas du site), sinon par un nom (phrase de Kevin : insensible à la
 * casse et aux accents, `matchNames`). Plusieurs correspondances : jamais de devinette, la liste revient à Kevin.
 */
export async function resolveNamed(what: { plural: string; one: string }, raw: string, rows: readonly Named[]): Promise<Ref> {
  const exact = rows.find((r) => r.id === raw);
  if (exact) return { ok: true, id: exact.id, name: exact.name };
  const { matchNames } = await import("@linkaffipro/agents");
  const found = matchNames(raw, rows);
  if (found.length === 1) return { ok: true, id: found[0]!.id, name: found[0]!.name };
  if (found.length > 1)
    return {
      ok: false,
      result: fail(
        `Il y a plusieurs ${what.plural} qui correspondent à « ${raw} » : ${found
          .slice(0, 10)
          .map((i) => `« ${i.name} »`)
          .join(", ")}. Lequel ?`,
      ),
    };
  return { ok: false, result: fail(`Je ne trouve pas ${what.one} « ${raw} ».`, "not_found") };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n > 1 ? many : one;
}
