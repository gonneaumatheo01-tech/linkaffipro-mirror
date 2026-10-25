/**
 * Phase 34, lot C : cœurs de la fiche membre (`app/(admin)/members/[id]/actions.ts`) : notes, étiquettes,
 * suppression sur demande (anonymisation, ADMIN, mot SUPPRIMER), correction de l'affilié (ADMIN).
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, recordEvent, type Prisma } from "@linkaffipro/db";
import { getTagRegistry, memberTags } from "@/lib/members/tags";
import { scrubLinkaffiEventsOps } from "@/lib/affiliates/anonymize";
import { changeMemberAffiliate, removeMemberAffiliate } from "@/lib/affiliates/attribution-server";
import {
  ADMIN_ONLY,
  doneTo,
  fail,
  failTo,
  forbidden,
  isPartial,
  list,
  preview,
  str,
  viaArg,
  withVia,
  type Core,
  type CoreResult,
} from "./common";
import { memberLabel, pickCandidate, resolveMember } from "./resolve";

const PAGE = (id: string) => `/members/${id}`;
const NOTE_ERROR = "La note est vide ou dépasse 2 000 caractères.";

/** Membre donné par son nom, son @pseudo ou son identifiant Telegram (Kevin) → `memberId`. */
async function withMember(input: Record<string, unknown>): Promise<CoreResult | null> {
  if (str(input.memberId) || !str(input.member)) return null;
  const r = await resolveMember(str(input.member));
  if (!r.ok) return fail(r.error, null, { code: r.code });
  input.memberId = r.id;
  return null;
}

function memberIdOf(input: Record<string, unknown>): string | null {
  return str(input.memberId).trim() || null;
}

const noMember = () => fail("Membre introuvable.", { path: "/members" }, { code: "not_found" });

export const addNote: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const m = await withMember(input);
  if (m) return m;
  const memberId = memberIdOf(input);
  if (!memberId) return noMember();
  const text = z.string().trim().min(1).max(2000).safeParse(input.text);
  if (!text.success) return failTo(PAGE(memberId), NOTE_ERROR, {}, { field: "text" });
  if (opts.dryRun) return preview(`Note ajoutée à la fiche du membre : « ${text.data.slice(0, 120)} ».`);
  await prisma.memberNote.create({ data: { memberId, authorId: actor.userId, text: text.data } });
  await audit({
    userId: actor.userId,
    action: "member.note_added",
    entityType: "Member",
    entityId: memberId,
    metadata: withVia(actor),
  });
  revalidatePath(PAGE(memberId));
  return doneTo(PAGE(memberId), "Note ajoutée.");
};

/** Note donnée par son identifiant, ou la dernière note du membre (Kevin : « modifie ma dernière note sur X »). */
async function noteOf(input: Record<string, unknown>) {
  const noteId = str(input.noteId).trim();
  if (noteId) return prisma.memberNote.findUnique({ where: { id: noteId } });
  const m = await withMember(input);
  if (m || !memberIdOf(input)) return null;
  return prisma.memberNote.findFirst({
    where: { memberId: memberIdOf(input)! },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Auteur d'une note : un compte du site précis. Un responsable sans compte lié (membre de l'équipe Telegram,
 * `userId` null) n'est l'auteur d'aucune note, pas même de celles sans auteur (compte supprimé, note de Kevin).
 */
function isAuthor(authorId: string | null, userId: string | null): boolean {
  return !!userId && authorId === userId;
}

/** Modifier une note : son auteur, ou un administrateur. */
export const editNote: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const note = await noteOf(input);
  if (!note) return fail("Note introuvable.", { path: "/members" }, { code: "not_found" });
  if (actor.role !== "ADMIN" && !isAuthor(note.authorId, actor.userId))
    return forbidden("Vous ne pouvez modifier que vos propres notes.", {
      path: PAGE(note.memberId),
      params: { error: "Vous ne pouvez modifier que vos propres notes." },
    });
  const text = z.string().trim().min(1).max(2000).safeParse(input.text);
  if (!text.success) return failTo(PAGE(note.memberId), NOTE_ERROR, {}, { field: "text" });
  if (opts.dryRun) return preview(`La note devient : « ${text.data.slice(0, 120)} ».`);
  await prisma.memberNote.update({ where: { id: note.id }, data: { text: text.data } });
  await audit({
    userId: actor.userId,
    action: "member.note_edited",
    entityType: "Member",
    entityId: note.memberId,
    metadata: withVia(actor, { noteId: note.id }),
  });
  revalidatePath(PAGE(note.memberId));
  return doneTo(PAGE(note.memberId), "Note modifiée.");
};

export const deleteNote: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const note = await noteOf(input);
  if (!note) return fail("Note introuvable.", { path: "/members" }, { code: "not_found" });
  if (actor.role !== "ADMIN" && !isAuthor(note.authorId, actor.userId))
    return forbidden("Vous ne pouvez supprimer que vos propres notes.", {
      path: PAGE(note.memberId),
      params: { error: "Vous ne pouvez supprimer que vos propres notes." },
    });
  if (opts.dryRun)
    return preview(`Suppression de la note « ${note.text.slice(0, 120)} ».`, {
      impact: "La note disparaît de la fiche du membre.",
    });
  await prisma.memberNote.delete({ where: { id: note.id } });
  await audit({
    userId: actor.userId,
    action: "member.note_deleted",
    entityType: "Member",
    entityId: note.memberId,
    metadata: withVia(actor),
  });
  revalidatePath(PAGE(note.memberId));
  return doneTo(PAGE(note.memberId), "Note supprimée.");
};

/**
 * Étiquettes d'un membre : les cases cochées parmi le registre (Réglages → Étiquettes) remplacent
 * celles du registre ; les étiquettes hors registre (posées par une automatisation) sont conservées.
 * Kevin : `add` / `remove` (noms d'étiquettes du registre) modifient les étiquettes actuelles.
 */
export const setMemberTags: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const m = await withMember(input);
  if (m) return m;
  const memberId = memberIdOf(input);
  if (!memberId) return noMember();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { tags: true, anonymizedAt: true },
  });
  if (!member) return noMember();
  if (member.anonymizedAt)
    return failTo(PAGE(memberId), "Un membre anonymisé ne porte pas d'étiquette.");
  const registry = await getTagRegistry();
  const known = new Set(registry.map((t) => t.name));
  const before = memberTags(member.tags);
  let asked = list(input.tags);
  if (isPartial(actor) && input.tags === undefined && input.add === undefined && input.remove === undefined)
    return fail("Indiquez les étiquettes à poser ou à retirer.", null, { field: "tags" });
  if (isPartial(actor) && (input.add !== undefined || input.remove !== undefined)) {
    const add = list(input.add);
    const remove = new Set(list(input.remove));
    const unknown = [...add, ...remove].filter((t) => !known.has(t));
    if (unknown.length)
      return fail(
        `Étiquette inconnue : ${unknown.map((t) => `« ${t} »`).join(", ")}. Créez-la d'abord dans Réglages → Étiquettes.`,
        null,
        { field: "tags" },
      );
    asked = [...new Set([...before.filter((t) => known.has(t) && !remove.has(t)), ...add])];
  }
  const wanted = asked.filter((t) => known.has(t));
  const kept = before.filter((t) => !known.has(t));
  const next = [...new Set([...kept, ...wanted])];
  if (opts.dryRun)
    return preview(`Étiquettes du membre : ${next.length ? next.join(", ") : "aucune"}.`);
  await prisma.member.update({
    where: { id: memberId },
    data: { tags: next as Prisma.InputJsonValue },
  });
  await recordEvent({
    type: "member.tags_changed",
    memberId,
    payload: { from: before, to: next, by: actor.userId },
  });
  await audit({
    userId: actor.userId,
    action: "member.tags_changed",
    entityType: "Member",
    entityId: memberId,
    metadata: withVia(actor, { from: before, to: next }),
  });
  revalidatePath(PAGE(memberId));
  revalidatePath("/members");
  return doneTo(PAGE(memberId), "Étiquettes enregistrées.");
};

export const ANONYMIZE_CONFIRM_ERROR = "Pour confirmer, tapez SUPPRIMER en majuscules dans le champ.";

/**
 * Suppression d'un membre sur demande (RGPD) = anonymisation : identité effacée, notes et conversations avec
 * l'assistant supprimées (texte des messages envoyés par l'assistant vidé), événements et statistiques conservés sans
 * donnée personnelle. Le telegramUserId est remplacé par un
 * entier négatif aléatoire (jamais attribué par Telegram) pour préserver l'unicité et les relations.
 * Événements destinés à Link Affi (phase 13) : en attente supprimés, les autres sans l'identité du membre.
 * DM des comptes réels (phase 18) : en attente annulés, texte et identifiant Telegram effacés. Événements `telegram.*`
 * (prénom, pseudo, identifiant, textes reçus) : contenu remplacé par `{ redacted: true }`.
 * Site : le champ « SUPPRIMER » du formulaire ; Kevin : le mot SUPPRIMER écrit par l'admin (confirmation `delete`).
 */
export const anonymizeMember: Core = async (raw, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY);
  const input = { ...raw };
  const mm = await withMember(input);
  if (mm) return mm;
  const memberId = memberIdOf(input);
  if (!memberId) return noMember();
  // Le site exige le mot dans le formulaire ; Kevin l'a déjà fait écrire avant d'exécuter (jamais en essai à blanc).
  if (!opts.dryRun && actor.via === "WEB" && str(input.confirm) !== "SUPPRIMER")
    return failTo(PAGE(memberId), ANONYMIZE_CONFIRM_ERROR, {}, { field: "confirm" });
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return noMember();
  if (member.anonymizedAt) return doneTo(PAGE(memberId), "Ce membre est déjà anonymisé.");
  if (opts.dryRun) {
    const [notes, conversations] = await Promise.all([
      prisma.memberNote.count({ where: { memberId } }),
      prisma.conversation.count({ where: { memberId } }),
    ]);
    return preview(`Suppression sur demande du membre ${memberLabel(member)} (anonymisation).`, {
      impact: `Identité effacée (prénom, nom, pseudo, identifiant Telegram), ${notes} note(s) et ${conversations} conversation(s) avec l'assistante supprimées ; statistiques et historique gardés sans donnée personnelle. Irréversible.`,
    });
  }
  const fake = -BigInt(`0x${randomBytes(6).toString("hex")}`);
  const memberships = await prisma.membership.findMany({ where: { memberId }, select: { id: true } });
  // DM des comptes réels (phase 18, `AccountDm`) : rattachés par l'identifiant Telegram ou par l'adhésion.
  const accountDmsOfMember = {
    OR: [{ telegramUserId: member.telegramUserId }, { membershipId: { in: memberships.map((m) => m.id) } }],
  };
  await prisma.$transaction([
    prisma.memberNote.deleteMany({ where: { memberId } }),
    // DM de bienvenue encore à envoyer : annulés ; tous perdent leur texte et l'identifiant Telegram.
    prisma.accountDm.updateMany({
      where: { ...accountDmsOfMember, status: "PENDING" },
      data: { status: "CANCELLED", text: "", lastError: "Non envoyé : membre supprimé à sa demande." },
    }),
    prisma.accountDm.updateMany({ where: accountDmsOfMember, data: { text: "", telegramUserId: fake } }),
    // Événements Telegram (`telegram.*`) : prénom, pseudo, identifiant et textes retirés ; type, date et liens gardés.
    prisma.event.updateMany({
      where: { memberId, type: { startsWith: "telegram." } },
      data: { payload: { redacted: true } },
    }),
    // Conversations avec l'assistant (phase 17) : supprimées avec leurs messages et leurs événements (cascade) ; les
    // liens d'offre envoyés et les clics restent, sans conversation.
    prisma.conversation.deleteMany({ where: { memberId } }),
    // Texte des messages envoyés par l'assistant (ou par l'équipe dans une conversation) : il reprend souvent ce que la
    // personne a dit (prénom, ville, goûts). Vidé ; les lignes restent pour les statistiques d'envoi.
    prisma.outboundMessage.updateMany({
      where: { memberId, kind: "ASSISTANT" },
      data: { text: "", buttons: [] },
    }),
    prisma.memberBotState.updateMany({
      where: { memberId },
      data: { canDm: false, blockedAt: new Date() },
    }),
    prisma.member.update({
      where: { id: memberId },
      data: {
        firstName: null,
        lastName: null,
        username: null,
        languageCode: null,
        isPremium: false,
        telegramUserId: fake,
        anonymizedAt: new Date(),
      },
    }),
    ...scrubLinkaffiEventsOps(memberId),
  ]);
  await recordEvent({ type: "member.anonymized", memberId, payload: { by: actor.userId } });
  await audit({
    userId: actor.userId,
    action: "member.anonymized",
    entityType: "Member",
    entityId: memberId,
    metadata: withVia(actor),
  });
  revalidatePath(PAGE(memberId));
  return doneTo(
    PAGE(memberId),
    "Membre supprimé : identité effacée, historique conservé sans donnée personnelle.",
  );
};

/** Lien d'affilié donné par son nom de campagne ou sa clé (Kevin) → `inviteLinkId`. */
async function withAffiliateLink(input: Record<string, unknown>): Promise<CoreResult | null> {
  if (str(input.inviteLinkId) || !str(input.affiliate)) return null;
  const links = await prisma.inviteLink.findMany({
    where: { kind: "LINKAFFI", linkaffiCampaignKey: { not: null } },
    select: {
      id: true,
      linkaffiCampaignKey: true,
      linkaffiCampaignName: true,
      linkaffiAffiliateName: true,
    },
    take: 2000,
  });
  const r = pickCandidate(
    str(input.affiliate),
    links.map((l) => ({
      id: l.id,
      label: [l.linkaffiAffiliateName, l.linkaffiCampaignName ?? l.linkaffiCampaignKey].filter(Boolean).join(" — "),
      names: [l.linkaffiCampaignName ?? "", l.linkaffiCampaignKey ?? "", l.linkaffiAffiliateName ?? ""],
    })),
    "la campagne d'affilié",
  );
  if (!r.ok) return fail(r.error, null, { code: r.code });
  input.inviteLinkId = r.id;
  return null;
}

function attributionBack(memberId: string, r: { ok: true; message: string } | { ok: false; error: string }, dryRun: boolean): CoreResult {
  if (dryRun) return r.ok ? preview(r.message) : failTo(PAGE(memberId), r.error);
  revalidatePath(PAGE(memberId));
  return r.ok ? doneTo(PAGE(memberId), r.message) : failTo(PAGE(memberId), r.error);
}

/**
 * « Changer d'affilié » (phase 13, ADMIN) : rattache le membre à une campagne Telegram d'affilié existante, avec un
 * motif (journal `member.affiliate_changed`).
 */
export const changeAffiliate: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const mm = await withMember(input);
  if (mm) return mm;
  const memberId = memberIdOf(input);
  if (!memberId) return noMember();
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY, { path: PAGE(memberId), params: { error: ADMIN_ONLY } });
  const al = await withAffiliateLink(input);
  if (al) return al;
  return attributionBack(
    memberId,
    await changeMemberAffiliate({
      memberId,
      inviteLinkId: str(input.inviteLinkId),
      reason: input.reason ?? null,
      userId: actor.userId,
      ...(opts.dryRun ? { dryRun: true } : {}),
      ...viaArg(actor),
    }),
    !!opts.dryRun,
  );
};

/** « Retirer l'affilié » (phase 13, ADMIN) : plus aucun affilié, avec un motif (journal `member.affiliate_removed`). */
export const removeAffiliate: Core = async (raw, actor, opts = {}) => {
  const input = { ...raw };
  const mm = await withMember(input);
  if (mm) return mm;
  const memberId = memberIdOf(input);
  if (!memberId) return noMember();
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY, { path: PAGE(memberId), params: { error: ADMIN_ONLY } });
  return attributionBack(
    memberId,
    await removeMemberAffiliate({
      memberId,
      reason: input.reason ?? null,
      userId: actor.userId,
      ...(opts.dryRun ? { dryRun: true } : {}),
      ...viaArg(actor),
    }),
    !!opts.dryRun,
  );
};

