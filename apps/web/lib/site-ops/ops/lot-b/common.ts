/**
 * Phase 34, lot B — outils communs des cœurs (canaux, messages, pages, étiquettes, catégories). Module SANS
 * « use server » : jamais appelable par le navigateur. Aucun import de `next/*` ici (les cœurs restent testables).
 */
import type { SiteOpActor, SiteOpPreview, SiteOpResult, SiteOpRunOptions } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";

export type { SiteOpActor, SiteOpResult, SiteOpRunOptions };

/** Acteur d'une action du site (utilisateur connecté). Le socle (chantier A) a son `webActor` ; même forme. */
export function webActorOf(user: { id: string; role: string }): SiteOpActor {
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
): Extract<SiteOpResult, { ok: false }> {
  return field ? { ok: false, error, code, field } : { ok: false, error, code };
}

/** Essai à blanc : rien n'a été écrit, voici ce qui serait fait. */
export function preview(p: SiteOpPreview, data?: Record<string, unknown>): SiteOpResult {
  return { ok: true, message: p.summary, preview: p, ...(data ? { data } : {}) };
}

/** Texte de refus du site pour une action réservée (`requireAdmin` : `ForbiddenError`). */
export const ADMIN_ONLY_DEFAULT = "Action réservée aux administrateurs";

/** Contrôle du rôle dans le cœur (MANAGER = tout sauf réglages, utilisateurs, jetons, suppressions). */
export function adminOnly(actor: SiteOpActor, message = ADMIN_ONLY_DEFAULT): Extract<SiteOpResult, { ok: false }> | null {
  return actor.role === "ADMIN" ? null : fail(message, "forbidden");
}

/** Un utilisateur du site est nécessaire (créateur d'un lien, d'un message…). */
export function needUser(actor: SiteOpActor): Extract<SiteOpResult, { ok: false }> | null {
  return actor.userId ? null : fail("Aucun compte du site n'est lié à ce compte Telegram : cette action a besoin d'un compte.", "forbidden");
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Lecture tolérante d'un booléen venu de Kevin (true, "on", "oui", "1"…). */
export function bool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (v == null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "on", "true", "oui", "yes"].includes(s)) return true;
  if (["0", "off", "false", "non", "no"].includes(s)) return false;
  return fallback;
}

type Named = { id: string; name: string; extra?: string[] };

/** Rapprochement par nom (insensible à la casse, aux accents et aux lettres stylisées) : `matchNames` de Kevin. */
async function match<T extends Named>(raw: string, items: readonly T[]): Promise<T[]> {
  const { matchNames } = await import("@linkaffipro/agents");
  return matchNames(raw, items);
}

export type Ref = { ok: true; id: string; name: string } | { ok: false; result: Extract<SiteOpResult, { ok: false }> };

/** Plusieurs correspondances : jamais de devinette, la liste revient à Kevin (qui propose des boutons). */
function ambiguous(what: string, raw: string, items: readonly Named[]): Ref {
  return {
    ok: false,
    result: {
      ok: false,
      code: "invalid",
      error: `Il y a plusieurs ${what} qui correspondent à « ${raw} » : ${items
        .slice(0, 10)
        .map((i) => `« ${i.name} »`)
        .join(", ")}. Lequel ?`,
    },
  };
}

/** Nom public d'un canal tiré d'un lien (`t.me/nom`, `t.me/s/nom`, `@nom`), sinon null. */
export function usernameOfLink(raw: string): string | null {
  let s = raw.trim().replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, "");
  s = s.split(/[?#]/)[0] ?? "";
  s = s.replace(/^s\//i, "").split("/")[0] ?? "";
  if (s.startsWith("@")) s = s.slice(1);
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s) && (raw.includes("/") || raw.trim().startsWith("@")) ? s : null;
}

/**
 * Canal désigné par son identifiant (`channelId`, tel quel : c'est le cas du site) ou par une phrase (`channel` :
 * titre, « t.me/nom », « @nom », identifiant). Plusieurs canaux → refus avec la liste.
 */
export async function resolveChannelRef(
  input: Record<string, unknown>,
  keys: { id?: string; name?: string } = {},
): Promise<Ref | null> {
  const idKey = keys.id ?? "channelId";
  const nameKey = keys.name ?? "channel";
  const id = str(input[idKey]).trim();
  if (id) return { ok: true, id, name: id };
  const raw = str(input[nameKey]).trim();
  if (!raw) return null;
  const rows = await prisma.channel.findMany({ select: { id: true, title: true, username: true } });
  const exact = rows.find((r) => r.id === raw);
  if (exact) return { ok: true, id: exact.id, name: exact.title };
  const username = usernameOfLink(raw);
  if (username) {
    const byName = rows.filter((r) => r.username?.toLowerCase() === username.toLowerCase());
    if (byName.length === 1) return { ok: true, id: byName[0]!.id, name: byName[0]!.title };
    return { ok: false, result: fail(`Je ne trouve aucun de nos canaux à l'adresse @${username}.`, "not_found") };
  }
  const items = rows.map((r) => ({ id: r.id, name: r.title, extra: r.username ? [r.username] : [] }));
  const found = await match(raw, items);
  if (found.length === 1) return { ok: true, id: found[0]!.id, name: found[0]!.name };
  if (found.length > 1) return ambiguous("canaux", raw, found);
  return { ok: false, result: fail(`Je ne trouve pas le canal « ${raw} ».`, "not_found") };
}

/** Plusieurs canaux (`channelIds`, sinon `channels` : liste de noms). */
export async function resolveChannelRefs(
  input: Record<string, unknown>,
  keys: { ids?: string; names?: string } = {},
): Promise<{ ok: true; ids: string[] } | { ok: false; result: Extract<SiteOpResult, { ok: false }> }> {
  const idsKey = keys.ids ?? "channelIds";
  const namesKey = keys.names ?? "channels";
  const ids = input[idsKey];
  if (Array.isArray(ids) && ids.length > 0) return { ok: true, ids: ids.map(str) };
  const names = Array.isArray(input[namesKey]) ? (input[namesKey] as unknown[]).map(str) : input[namesKey] ? [str(input[namesKey])] : [];
  const out: string[] = [];
  for (const n of names) {
    const r = await resolveChannelRef({ channel: n });
    if (!r) continue;
    if (!r.ok) return r;
    out.push(r.id);
  }
  return { ok: true, ids: [...new Set(out)] };
}

/** Une ligne nommée quelconque : id exact, sinon rapprochement par nom. */
export async function resolveNamed(
  what: { plural: string; one: string },
  raw: string,
  rows: readonly Named[],
): Promise<Ref> {
  const exact = rows.find((r) => r.id === raw);
  if (exact) return { ok: true, id: exact.id, name: exact.name };
  const found = await match(raw, rows);
  if (found.length === 1) return { ok: true, id: found[0]!.id, name: found[0]!.name };
  if (found.length > 1) return ambiguous(what.plural, raw, found);
  return { ok: false, result: fail(`Je ne trouve pas ${what.one} « ${raw} ».`, "not_found") };
}

/** Message d'une erreur levée (même repli que le site). */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Redirection Next.js (à relancer telle quelle). */
export function isNextRedirect(err: unknown): boolean {
  return typeof (err as { digest?: string })?.digest === "string" && (err as { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

export type CoreRun = (input: Record<string, unknown>, actor: SiteOpActor, opts?: SiteOpRunOptions) => Promise<SiteOpResult>;
