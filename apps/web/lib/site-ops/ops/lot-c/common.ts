/**
 * Phase 34, lot C : outils communs des cœurs (campagnes, liens, imports, membres, envois, relances, conversations,
 * personas, statistiques). Un cœur = `run(input, actor, { dryRun })` → `SiteOpResult`, appelé par l'action serveur du
 * site ET par Kevin (entrée interne signée). Module SANS « use server » : rien ici n'est appelable par le navigateur.
 *
 * `back` : adresse où l'action serveur du site renvoie après l'opération (message `ok` / `error` compris), pour
 * garder exactement le comportement d'avant. Retiré du résultat envoyé à Kevin (`implOf`).
 */
import type {
  SiteOpActor,
  SiteOpImpl,
  SiteOpPreview,
  SiteOpResult,
  SiteOpRunOptions,
} from "@linkaffipro/agents";
import type { Prisma } from "@linkaffipro/db";
import type { CurrentUser } from "@/lib/session";
import { webActor } from "@/lib/site-ops/actor";

export type Back = { path: string; params?: Record<string, string>; hash?: string };
export type CoreResult = SiteOpResult & { back?: Back };
export type Core = (
  input: Record<string, unknown>,
  actor: SiteOpActor,
  opts?: SiteOpRunOptions,
) => Promise<CoreResult>;

/** Enregistre un cœur dans le registre (le retour vers une page du site n'est pas envoyé à Kevin). */
export function implOf(key: string, core: Core): SiteOpImpl {
  return {
    key,
    async run(input, actor, opts) {
      const r = await core(input ?? {}, actor, opts ?? {});
      const { back: _back, ...rest } = r;
      return rest as SiteOpResult;
    },
  };
}

/**
 * Acteur du site : `webActor` du socle, plus le compte Telegram lié à la session (« Envoyer un test à moi », « Tester
 * sur moi » : le test part vers ce compte, comme avant).
 */
export function webActorOf(user: {
  id: string;
  role: CurrentUser["role"];
  telegramUserId?: bigint | null;
}): SiteOpActor {
  return {
    ...webActor(user),
    telegramUserId: user.telegramUserId ? user.telegramUserId.toString() : null,
  };
}

/** Adresse complète d'un retour (`path?params#hash`). */
export function backUrl(b: Back): string {
  const q = new URLSearchParams(b.params ?? {}).toString();
  return `${b.path}${q ? `?${q}` : ""}${b.hash ?? ""}`;
}

export function fail(
  error: string,
  back?: Back | null,
  extra: { code?: "invalid" | "forbidden" | "not_found" | "conflict" | "unavailable"; field?: string | null } = {},
): CoreResult {
  return {
    ok: false,
    error,
    code: extra.code ?? "invalid",
    ...(extra.field ? { field: extra.field } : {}),
    ...(back ? { back } : {}),
  };
}

/** Erreur dont le message est aussi le paramètre `error` du retour vers le site. */
export function failTo(
  path: string,
  error: string,
  params: Record<string, string> = {},
  extra: Parameters<typeof fail>[2] = {},
  hash?: string,
): CoreResult {
  return fail(error, { path, params: { ...params, error }, ...(hash ? { hash } : {}) }, extra);
}

export function done(
  message: string,
  back?: Back | null,
  data?: Record<string, unknown>,
): CoreResult {
  return { ok: true, message, ...(data ? { data } : {}), ...(back ? { back } : {}) };
}

/** Réussite dont le message est aussi le paramètre `ok` du retour vers le site. */
export function doneTo(
  path: string,
  message: string,
  params: Record<string, string> = {},
  data?: Record<string, unknown>,
  hash?: string,
): CoreResult {
  return done(message, { path, params: { ...params, ok: message }, ...(hash ? { hash } : {}) }, data);
}

/** Essai à blanc : tout est validé, rien n'est écrit ni envoyé. */
export function preview(summary: string, extra: Omit<SiteOpPreview, "summary"> = {}): CoreResult {
  return { ok: true, message: summary, preview: { summary, ...extra } };
}

export const ADMIN_ONLY = "Réservé aux administrateurs.";
export const DELETE_ADMIN_ONLY = "Suppression réservée aux administrateurs.";

export function forbidden(error = ADMIN_ONLY, back?: Back | null): CoreResult {
  return fail(error, back, { code: "forbidden" });
}

/** Métadonnées du journal avec la provenance (`via`), comme exigé par la phase 34. */
export function withVia(
  actor: SiteOpActor,
  metadata?: Record<string, unknown> | null,
): Prisma.InputJsonObject {
  // Valeurs JSON (chaînes, nombres, listes) : mêmes métadonnées que les actions d'avant, plus `via`.
  return { ...(metadata ?? {}), via: actor.via } as Prisma.InputJsonObject;
}

/** Lecture d'un `FormData` en objet (clé répétée = liste ; fichier gardé tel quel). */
export function formInput(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    const all = fd.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

/**
 * Objet → `FormData` (même lecture que le formulaire du site, donc mêmes validations) : liste de valeurs simples =
 * clé répétée ; objet ou liste d'objets = JSON ; `true` = « on » (case cochée) ; `false`, `null` et absent = rien.
 */
export function toFormData(input: Record<string, unknown>): FormData {
  const fd = new FormData();
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === false) return;
    if (v === true) fd.append(k, "on");
    else if (typeof v === "string") fd.append(k, v);
    else if (typeof v === "number" || typeof v === "bigint") fd.append(k, String(v));
    else if (typeof Blob !== "undefined" && v instanceof Blob) fd.append(k, v);
    else fd.append(k, JSON.stringify(v));
  };
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v) && v.every((x) => x === null || ["string", "number"].includes(typeof x)))
      for (const x of v) put(k, x);
    else put(k, v);
  }
  return fd;
}

export function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return str(v[0]);
  return typeof v === "string" ? v : String(v);
}

export function list(v: unknown): string[] {
  if (v === undefined || v === null || v === "") return [];
  return (Array.isArray(v) ? v : [v]).map((x) => str(x).trim()).filter(Boolean);
}

/** Kevin parle (TELEGRAM) : les champs absents gardent leur valeur actuelle ; le site envoie toujours tout. */
export function isPartial(actor: SiteOpActor): boolean {
  return actor.via !== "WEB";
}

/** Une ligne d'aperçu par élément, en limitant la longueur. */
export function joinNames(names: string[], max = 6): string {
  const shown = names.slice(0, max).map((n) => `« ${n} »`);
  return names.length > max ? `${shown.join(", ")} et ${names.length - max} autre(s)` : shown.join(", ");
}

/**
 * Provenance passée aux fonctions métier partagées qui journalisent elles-mêmes : seulement pour Kevin (le site garde
 * ses appels inchangés ; absence de `via` = site).
 */
export function viaArg(actor: SiteOpActor): { via?: "TELEGRAM" } {
  return actor.via === "WEB" ? {} : { via: actor.via };
}
