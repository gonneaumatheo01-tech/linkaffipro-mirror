/**
 * Phase 34, lot C : cœurs des conversations de l'assistante (`app/(admin)/conversations/[id]/actions.ts`), des
 * personas (`conversations/personas/actions.ts`) et de leurs médias (`personas/[id]/media-actions.ts`). Toute la
 * règle est déjà dans `lib/conversations/operations.ts`, `lib/personas/save.ts` et `lib/personas/media-save.ts` : les
 * cœurs ajoutent la résolution par nom (Kevin), l'essai à blanc et la provenance du journal.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@linkaffipro/db";
import type { SiteOpActor } from "@linkaffipro/agents";
import {
  blockConversation,
  clearNeedsHuman,
  closeConversation,
  previewTeamAction,
  releaseConversation,
  sendTeamMessage,
  takeOverConversation,
  type OperationResult,
  type TeamActionKind,
  type TeamUser,
} from "@/lib/conversations/operations";
import { deletePersona, savePersona } from "@/lib/personas/save";
import { validatePersonaMediaForm } from "@/lib/personas/media";
import type { PersonaFormErrors } from "@/lib/personas/form";
import { savePersonaMedia } from "@/lib/personas/media-save";
import {
  done,
  fail,
  failTo,
  isPartial,
  preview,
  str,
  toFormData,
  viaArg,
  type Core,
  type CoreResult,
} from "./common";
import { personaCandidates, resolveInto, resolveMember } from "./resolve";

/** Acteur du site avec le nom affiché dans le fil (« Marie a pris la main »). */
export type TeamActor = SiteOpActor & { name?: string };

const ID_RE = /^[a-z0-9]{8,40}$/;

async function teamUserOf(actor: TeamActor): Promise<TeamUser> {
  let name = actor.name;
  if (!name && actor.userId)
    name =
      (await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ??
      undefined;
  return { id: actor.userId, name: name ?? "Kevin", ...viaArg(actor) };
}

function backOf(id: string | null, r: OperationResult): CoreResult {
  const path = id ? `/conversations/${id}` : "/conversations";
  return r.ok
    ? done(r.message, { path, params: { ok: r.message } })
    : fail(r.error, { path, params: { error: r.error } });
}

/**
 * Conversation : identifiant, ou la dernière conversation du membre nommé (Kevin : « reprends la main avec Paul »).
 */
async function conversationIdOf(input: Record<string, unknown>): Promise<string | CoreResult | null> {
  const id = str(input.id || input.conversationId);
  if (id) return ID_RE.test(id) ? id : null;
  if (!str(input.member)) return null;
  const m = await resolveMember(str(input.member));
  if (!m.ok) return fail(m.error, null, { code: m.code });
  const c = await prisma.conversation.findFirst({
    where: { memberId: m.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return c?.id ?? fail(`Aucune conversation avec ${m.label}.`, null, { code: "not_found" });
}

function teamOp(
  kind: Exclude<TeamActionKind, "send">,
  op: (id: string, user: TeamUser) => Promise<OperationResult>,
): Core {
  return async (input, actor, opts = {}) => {
    const id = await conversationIdOf(input);
    if (id && typeof id !== "string") return id;
    if (!id) return backOf(null, { ok: false, error: "Conversation introuvable." });
    if (opts.dryRun) {
      const p = await previewTeamAction(id, kind);
      return p.ok ? preview(p.message) : backOf(id, p);
    }
    const result = await op(id, await teamUserOf(actor));
    revalidatePath(`/conversations/${id}`);
    revalidatePath("/conversations");
    return backOf(id, result);
  };
}

/** « Prendre la main » : l'assistante se tait pour cette conversation. */
export const takeOver = teamOp("takeOver", (id, u) => takeOverConversation(id, u));
/** « Rendre à l'assistante » : elle répond de nouveau (pas aux messages reçus pendant la reprise). */
export const release = teamOp("release", (id, u) => releaseConversation(id, u));
/** « Fermer » : conversation terminée, ni réponse ni relance (rouvrable par l'équipe). */
export const close = teamOp("close", (id, u) => closeConversation(id, u));
/** « Bloquer » : plus aucun message ne part vers cette personne. */
export const block = teamOp("block", (id, u) => blockConversation(id, u));
/** « Marquer comme traitée » : la conversation n'est plus « à traiter » (rien d'autre ne change). */
export const markHandled = teamOp("clearNeedsHuman", (id, u) => clearNeedsHuman(id, u));

/**
 * « Envoyer » : message écrit par l'équipe (prend la main si l'assistante l'avait). Essai à blanc : le texte exact
 * (échappé comme à l'envoi) et un seul destinataire, la personne de la conversation.
 */
export const sendTeam: Core = async (input, actor, opts = {}) => {
  const id = await conversationIdOf(input);
  if (id && typeof id !== "string") return id;
  if (!id) return fail("Conversation introuvable.", null, { code: "not_found" });
  if (opts.dryRun) {
    const p = await previewTeamAction(id, "send", input.text);
    if (!p.ok) return fail(p.error);
    const { escapeHtml } = await import("@linkaffipro/core");
    return preview(p.message, { exactText: escapeHtml(p.text ?? ""), recipients: 1 });
  }
  const result = await sendTeamMessage(id, await teamUserOf(actor), input.text ?? null);
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  if (!result.ok) return fail(result.error, null);
  return done(result.message, null, { tookOver: Boolean(result.tookOver), conversationId: id });
};

// ---------------------------------------------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------------------------------------------

const LIST = "/conversations/personas";

/** Refus d'enregistrement d'une persona, avec les erreurs par champ du formulaire. */
export type PersonaCoreError = Extract<CoreResult, { ok: false }> & { errors?: PersonaFormErrors };

function withParams(path: string, params: Record<string, string | null>): { path: string; params: Record<string, string> } {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v) q[k] = v;
  return { path, params: q };
}

/** Champs du formulaire dont Kevin peut donner une valeur (texte ou nombre). */
const STRING_FIELDS = [
  "name",
  "age",
  "personality",
  "tone",
  "styleExamples",
  "interests",
  "minExchangesBeforeOffer",
  "maxOfferSends",
  "followUpAfterHours",
  "followUpsMax",
  "affiliateCampaignId",
  "campaignId",
  "offerPitch",
  "offerButtonText",
  "offerMediaAssetId",
  "botDescription",
  "botShortDescription",
  "model",
  "temperature",
  "extraPrompt",
] as const;

/**
 * Kevin : « crée la persona Inès, 24 ans, Lyon, étudiante » → brouillon du formulaire : formulaire vide (création) ou
 * formulaire de la persona (modification), avec seulement les champs dits ; textes du profil du bot proposés comme sur
 * le site.
 */
async function personaDraft(input: Record<string, unknown>): Promise<unknown | CoreResult> {
  const r = await resolveInto(input, "personaId", "persona", "la persona", personaCandidates);
  if (!r.ok) return fail(r.error, null, { code: r.code });
  const [{ emptyPersonaForm, personaToForm, withProfileTexts }, { loadPersona, profileTemplates }] =
    await Promise.all([import("@/lib/personas/form"), import("@/lib/personas/queries")]);
  const templates = profileTemplates();
  const id = str(input.personaId);
  let before;
  if (id) {
    const p = await loadPersona(id);
    if (!p)
      return fail("Cette persona n'existe plus (supprimée entre-temps) : revenez à la liste des personas.", null, {
        code: "not_found",
      });
    before = personaToForm(p, templates);
  } else before = emptyPersonaForm(templates);
  const after: Record<string, unknown> = { ...before };
  for (const k of STRING_FIELDS)
    if (input[k] !== undefined && input[k] !== null)
      after[k] = Array.isArray(input[k]) ? (input[k] as unknown[]).join(", ") : String(input[k]);
  for (const k of ["gender", "identityKind", "universe"] as const)
    if (typeof input[k] === "string") after[k] = input[k];
  if (Array.isArray(input.languages)) after.languages = input.languages.map(String);
  else if (typeof input.languages === "string") after.languages = input.languages.split(/[,\s]+/).filter(Boolean);
  for (const k of ["requireInterest", "isActive"] as const)
    if (typeof input[k] === "boolean") after[k] = input[k];
  if (Array.isArray(input.faq)) after.faq = input.faq;
  // Bookmakers partenaires (Paris sportifs) : la liste dite remplace la liste entière, dans l'ordre de proposition.
  if (Array.isArray(input.bookmakers))
    after.bookmakers = input.bookmakers.map((b) => {
      const row = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      return {
        bookmakerKey: str(row.bookmakerKey),
        label: str(row.label),
        affiliateCampaignId: str(row.affiliateCampaignId),
        inviteLinkId: str(row.inviteLinkId),
      };
    });
  return withProfileTexts(before, after as typeof before, templates);
}

/** Enregistre une persona (création ou modification) : brouillon du formulaire (site) ou champs dits (Kevin). */
export const savePersonaCore: Core = async (input, actor, opts = {}) => {
  let raw: unknown;
  if (isPartial(actor) && input.payload === undefined) {
    const d = await personaDraft({ ...input });
    if (d && typeof d === "object" && "ok" in d && (d as CoreResult).ok === false) return d as CoreResult;
    raw = d;
  } else if (typeof input.payload === "string") {
    try {
      raw = JSON.parse(input.payload);
    } catch {
      return fail("Le formulaire n'a pas pu être lu : rechargez la page, puis recommencez.");
    }
  } else raw = input.payload ?? null;
  const user = { id: actor.userId, role: actor.role, ...viaArg(actor) };
  const r = opts.dryRun ? await savePersona(raw, user, { dryRun: true }) : await savePersona(raw, user);
  if (!r.ok) {
    // Erreurs par champ : rendues au formulaire du site (et à Kevin, pour dire quoi corriger).
    const out: PersonaCoreError = {
      ok: false,
      error: r.error,
      code: "invalid",
      field: r.errors ? (Object.keys(r.errors)[0] ?? null) : null,
    };
    if (r.errors) out.errors = r.errors;
    return out;
  }
  if (opts.dryRun) return preview(r.message);
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${r.id}`);
  revalidatePath("/settings/bots");
  return done(r.problem ? `${r.message} ${r.problem}` : r.message, withParams(`${LIST}/${r.id}`, { ok: r.message, error: r.problem }), {
    personaId: r.id,
    created: r.created,
  });
};

/** « Supprimer la persona » (administrateurs, après confirmation ; refusé si un bot l'utilise). */
export const deletePersonaCore: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const r0 = await resolveInto(input, "personaId", "persona", "la persona", personaCandidates);
  if (!r0.ok) return fail(r0.error, null, { code: r0.code });
  const id = str(input.personaId);
  if (!id) return fail("Persona introuvable.", { path: LIST }, { code: "not_found" });
  const user = { id: actor.userId, role: actor.role, ...viaArg(actor) };
  const r = opts.dryRun ? await deletePersona(id, user, { dryRun: true }) : await deletePersona(id, user);
  if (!r.ok)
    return fail(r.error, withParams(`${LIST}/${id}`, { error: r.error }), {
      code: actor.role !== "ADMIN" ? "forbidden" : "invalid",
    });
  if (opts.dryRun)
    return preview(r.message, { impact: "La persona disparaît ; ses conversations et leurs statistiques restent." });
  revalidatePath(LIST);
  revalidatePath("/settings/bots");
  return done(r.message, withParams(LIST, { ok: r.message }));
};

/**
 * « Enregistrer les médias » de la fiche persona (ADMIN et MANAGER). Kevin : images envoyées (déjà rangées dans la
 * médiathèque, `media` = identifiants) ajoutées aux images de référence ; les autres réglages gardent leur valeur.
 */
export const savePersonaMediaCore: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const r0 = await resolveInto(input, "personaId", "persona", "la persona", personaCandidates);
  if (!r0.ok) return fail(r0.error, null, { code: r0.code });
  const id = str(input.personaId);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail("Persona introuvable.", { path: LIST }, { code: "not_found" });
  const path = `/conversations/personas/${id}`;
  if (isPartial(actor)) {
    const { loadPersonaMedia } = await import("@/lib/personas/media-save");
    const cur = await loadPersonaMedia(id);
    if (!cur) return fail("Persona introuvable : rechargez la page.", null, { code: "not_found" });
    // Photos transférées à Kevin : rangées par son déroulé dans la médiathèque (`mediaAssetIds`), ou citées (`media`).
    const given = input.media ?? input.mediaAssetIds ?? input.mediaAssetId;
    const added = (Array.isArray(given) ? given : given ? [given] : [])
      .map((m) => (typeof m === "string" ? m : str((m as { mediaAssetId?: unknown })?.mediaAssetId)))
      .filter(Boolean);
    const refs =
      input.referenceImageIds !== undefined
        ? (Array.isArray(input.referenceImageIds) ? input.referenceImageIds.map(String) : str(input.referenceImageIds).split(","))
        : [...new Set([...cur.referenceImageIds, ...added])];
    input.referenceImageIds = refs.join(",");
    if (input.loraUrl === undefined) input.loraUrl = cur.loraUrl ?? "";
    if (input.loraTrigger === undefined) input.loraTrigger = cur.loraTrigger ?? "";
    if (input.loraScale === undefined) input.loraScale = String(cur.loraScale);
    if (input.mediaNotes === undefined) input.mediaNotes = cur.mediaNotes ?? "";
  }
  const parsed = validatePersonaMediaForm(toFormData(input));
  if (!parsed.ok) {
    const e = `${parsed.error} ${Object.values(parsed.errors).join(" ")}`.trim();
    return failTo(path, e, {}, { field: Object.keys(parsed.errors)[0] ?? null }, "#medias");
  }
  const r = await savePersonaMedia(id, parsed.data, actor.userId, {
    ...(opts.dryRun ? { dryRun: true } : {}),
    ...viaArg(actor),
  });
  if (!r.ok) return failTo(path, r.error, {}, {}, "#medias");
  if (opts.dryRun) return preview(r.message);
  revalidatePath(path);
  revalidatePath("/agents/dating");
  return done(r.message, { path, params: { ok: r.message }, hash: "#medias" });
};
