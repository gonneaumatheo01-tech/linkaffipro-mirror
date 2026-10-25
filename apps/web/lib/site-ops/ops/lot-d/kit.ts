/**
 * Phase 34, lot D (agents, univers, Réglages → IA et assistant) — outils communs des cœurs. Module SANS « use server »
 * (jamais appelable par le navigateur) et sans `next/*` : les cœurs restent testables et appelables par Kevin.
 *
 * Forme d'un cœur : `run(fd, actor, opts)` où `fd` est le FormData du formulaire du site. Le site passe son
 * formulaire tel quel ; Kevin passe ses paramètres JSON, convertis par `formOf` (après résolution des noms : « la
 * persona Léa » → identifiant). Une seule lecture du formulaire, donc mêmes validations et mêmes textes d'erreur.
 * Les modules importés ici (`@linkaffipro/agents`, `@linkaffipro/db`…) sont simulés par les tests du site : seules les
 * fonctions qu'appelait déjà l'action serveur sont touchées sur le chemin du site.
 */
import type { SiteOpActor, SiteOpPreview, SiteOpResult, SiteOpRunOptions } from "@linkaffipro/agents";

export type { SiteOpActor, SiteOpResult, SiteOpRunOptions };
export type Fail = Extract<SiteOpResult, { ok: false }>;
export type Ok = Extract<SiteOpResult, { ok: true }>;

/** Acteur d'une action du site (utilisateur connecté). Même forme que `webActor` du socle. */
export function siteActor(user: { id: string; role: string }): SiteOpActor {
  return { userId: user.id, role: user.role === "ADMIN" ? "ADMIN" : "MANAGER", via: "WEB" };
}

/** Acteur des fonctions de `@linkaffipro/agents` (`ActorRef` : « SITE » ou « TELEGRAM »). */
export function engineActor(actor: SiteOpActor): { userId: string | null; via: "SITE" | "TELEGRAM" } {
  return { userId: actor.userId, via: actor.via === "TELEGRAM" ? "TELEGRAM" : "SITE" };
}

/** Utilisateur écrit dans les colonnes `updatedById` / `AuditLog.userId` (null quand Kevin agit sans compte lié). */
export function uid(actor: SiteOpActor): string {
  return actor.userId as string;
}

export function ok(message: string, data?: Record<string, unknown>): Ok {
  return data ? { ok: true, message, data } : { ok: true, message };
}

export function fail(error: string, code: Fail["code"] = "invalid", field?: string | null): Fail {
  return field ? { ok: false, error, code, field } : { ok: false, error, code };
}

export const forbidden = (error: string): Fail => fail(error, "forbidden");

/** Essai à blanc : tout est validé, rien n'est écrit. */
export function preview(summary: string, extra: Omit<SiteOpPreview, "summary"> = {}, data?: Record<string, unknown>): Ok {
  return { ok: true, message: summary, preview: { summary, ...extra }, ...(data ? { data } : {}) };
}

/** Texte de `requireAdmin` (`ForbiddenError`) : celui que voit un responsable sur une page réservée. */
export const ADMIN_ONLY = "Action réservée aux administrateurs";

export function adminOnly(actor: SiteOpActor, message = ADMIN_ONLY): Fail | null {
  return actor.role === "ADMIN" ? null : forbidden(message);
}

/** Message d'une erreur levée par un service (même repli que `errorText` des actions de la rubrique Agents). */
export function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : "";
  return m || "erreur inattendue";
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Lecture tolérante d'un booléen donné par Kevin. */
export function truthy(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = str(v).trim().toLowerCase();
  if (["1", "on", "true", "oui", "yes", "vrai"].includes(s)) return true;
  if (["0", "off", "false", "non", "no", "faux"].includes(s)) return false;
  return null;
}

/**
 * Paramètres JSON de Kevin → formulaire du site : tableau = plusieurs valeurs du même champ, booléen vrai = case
 * cochée (« on »), faux / null / absent = case décochée, nombre = texte (point décimal, accepté par les lecteurs).
 */
export function formOf(input: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === false) continue;
    if (Array.isArray(v)) {
      for (const x of v) if (x !== undefined && x !== null) fd.append(k, typeof x === "object" ? JSON.stringify(x) : String(x));
      continue;
    }
    if (v === true) fd.set(k, "on");
    else fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return fd;
}

/** Liste donnée par Kevin (tableau ou texte « a, b ») → texte d'un champ « une valeur par ligne ». */
export function listText(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(str).join("\n");
  return str(v);
}

export type CoreRun = (fd: FormData, actor: SiteOpActor, opts?: SiteOpRunOptions) => Promise<SiteOpResult>;

/** Euros lisibles (« 80 € », « 12,50 € »). */
export function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}
