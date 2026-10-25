/**
 * Phase 34, lot B — cœurs de la rubrique « Pages » (pages d'atterrissage, phase 15). Toute la logique reste dans
 * `lib/landing/save.ts` ; ici : droits (supprimer = administrateurs), désignation par nom pour Kevin, champs donnés en
 * phrase fusionnés avec la page enregistrée, essai à blanc.
 */
import { prisma } from "@linkaffipro/db";
import { emptyLandingForm, formFromPage, newSource, type LandingFormErrors, type LandingFormState } from "@/lib/landing/form";
import { deleteLandingPage, retryLandingLinks, saveLandingPage } from "@/lib/landing/save";
import { fail, ok, preview, resolveChannelRef, resolveNamed, str, type CoreRun, type SiteOpResult } from "./common";

export const PAGE_DELETE_ADMIN_ONLY =
  "Seul un administrateur peut supprimer une page. Vous pouvez la mettre en pause (Avancé → Page en ligne).";

/** Page par `pageId` (site) ou par son nom / son adresse (`page`, Kevin). */
async function pageRef(input: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; result: Extract<SiteOpResult, { ok: false }> } | null> {
  const id = str(input.pageId).trim();
  if (id) return { ok: true, id };
  const raw = str(input.page).trim();
  if (!raw) return null;
  const rows = await prisma.landingPage.findMany({ select: { id: true, name: true, slug: true } });
  const slug = /\/j\/([^/?#\s]+)/.exec(raw)?.[1];
  const bySlug = rows.filter((r) => r.slug === (slug ?? raw));
  if (bySlug.length === 1) return { ok: true, id: bySlug[0]!.id };
  const r = await resolveNamed({ plural: "pages", one: "la page" }, raw, rows.map((p) => ({ id: p.id, name: p.name, extra: [p.slug] })));
  return r.ok ? { ok: true, id: r.id } : r;
}

/** Champs qu'on peut donner en phrase (« titre », « texte », « bouton », « langue »…), ajoutés au brouillon. */
const FIELD_KEYS = [
  "name",
  "slug",
  "headline",
  "subtext",
  "buttonText",
  "footnote",
  "language",
  "tiktokPixel",
  "metaPixel",
  "cookieBanner",
  "showPhoto",
  "isActive",
] as const;

function mergeFields(form: LandingFormState, input: Record<string, unknown>): LandingFormState {
  const next: LandingFormState = { ...form, sources: [...form.sources] };
  for (const k of FIELD_KEYS) {
    const v = input[k];
    if (v === undefined || v === null) continue;
    if (k === "cookieBanner" || k === "showPhoto" || k === "isActive") next[k] = v === true || v === "on" || v === "true";
    else (next as Record<string, unknown>)[k] = str(v);
  }
  if (input.slug !== undefined) next.slugTouched = true;
  // Sources nommées à ajouter (« tk01 », « exo1 ») : jamais de doublon, les sources actuelles restent.
  const keys = Array.isArray(input.sources) ? (input.sources as unknown[]).map(str).filter(Boolean) : [];
  for (const key of keys)
    if (!next.sources.some((s) => s.key === key && !s.removed)) next.sources.push({ ...newSource(), key });
  return next;
}

/** Brouillon à enregistrer : celui du site tel quel (`payload`), sinon construit depuis la phrase de Kevin. */
async function draftOf(
  input: Record<string, unknown>,
  mode: "create" | "update" | "any",
): Promise<{ ok: true; raw: unknown } | { ok: false; result: SiteOpResult }> {
  if (input.payload !== undefined) return { ok: true, raw: input.payload };
  const ref = mode === "create" ? null : await pageRef(input);
  if (ref && !ref.ok) return { ok: false, result: ref.result };
  if (ref) {
    const page = await prisma.landingPage.findUnique({
      where: { id: ref.id },
      include: { sources: { select: { id: true, key: true, adId: true, isActive: true } } },
    });
    if (!page) return { ok: false, result: fail("Cette page n'existe plus : revenez à la liste des pages.", "not_found") };
    return { ok: true, raw: mergeFields(formFromPage(page), input) };
  }
  if (mode === "update") return { ok: false, result: fail("Quelle page faut-il modifier ?", "invalid", "page") };
  const ch = await resolveChannelRef(input);
  if (ch && !ch.ok) return { ok: false, result: ch.result };
  return { ok: true, raw: mergeFields(emptyLandingForm(ch?.id ?? ""), input) };
}

/**
 * « Créer la page » / « Enregistrer » (formulaire unique). Administrateurs et responsables. Rend aussi les erreurs par
 * champ (`errors`) que le formulaire du site affiche sous chaque champ.
 */
export async function savePageDetailed(
  input: Record<string, unknown>,
  actor: Parameters<CoreRun>[1],
  opts: Parameters<CoreRun>[2] = {},
  mode: "create" | "update" | "any" = "any",
): Promise<{ result: SiteOpResult; errors?: LandingFormErrors }> {
  const draft = await draftOf(input, mode);
  if (!draft.ok) return { result: draft.result };
  const r = await saveLandingPage(draft.raw, actor.userId, { via: actor.via, dryRun: opts?.dryRun });
  if (!r.ok)
    return {
      result: { ok: false, code: "invalid", error: r.error, field: r.errors ? (Object.keys(r.errors)[0] ?? null) : null },
      errors: r.errors,
    };
  if (r.dryRun) return { result: preview({ summary: r.message }) };
  return { result: ok(r.message, { pageId: r.pageId, created: r.created }) };
}

async function save(input: Record<string, unknown>, actor: Parameters<CoreRun>[1], opts: Parameters<CoreRun>[2], mode: "create" | "update" | "any"): Promise<SiteOpResult> {
  return (await savePageDetailed(input, actor, opts, mode)).result;
}

/** Cœur unique du formulaire du site (création ou modification selon le brouillon). */
export const pageSave: CoreRun = (input, actor, opts = {}) => save(input, actor, opts, "any");
/** Kevin : « crée une page pour Zone Interdite avec le titre … ». */
export const pageCreate: CoreRun = (input, actor, opts = {}) => save(input, actor, opts, "create");
/** Kevin : « change le bouton de la page Zone en … ». */
export const pageUpdate: CoreRun = (input, actor, opts = {}) => save(input, actor, opts, "update");

/** « Réessayer » sur une source dont le lien Telegram n'a pas pu être créé. */
export const pageRetryLinks: CoreRun = async (input, actor, opts = {}) => {
  const ref = await pageRef(input);
  if (!ref) return fail("Cette page n'existe plus.", "not_found");
  if (!ref.ok) return ref.result;
  const r = await retryLandingLinks(ref.id, actor.userId, { via: actor.via, dryRun: opts.dryRun });
  if (opts.dryRun) return r.ok ? preview({ summary: r.message }) : fail(r.message, "not_found");
  return r.ok ? ok(r.message, { pageId: ref.id }) : { ok: false, code: "unavailable", error: r.message };
};

/** « Supprimer la page » (administrateurs, après confirmation SUPPRIMER chez Kevin). */
export const pageDelete: CoreRun = async (input, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return fail(PAGE_DELETE_ADMIN_ONLY, "forbidden");
  const ref = await pageRef(input);
  if (ref && !ref.ok) return ref.result;
  const r = await deleteLandingPage(ref?.id ?? "", actor.userId, { via: actor.via, dryRun: opts.dryRun });
  if (!r.ok) return fail(r.message, "not_found");
  if (opts.dryRun) return preview({ summary: r.message, impact: r.impact ?? null });
  return ok(r.message);
};
