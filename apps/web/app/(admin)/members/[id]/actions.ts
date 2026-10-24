"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, audit, recordEvent, type Prisma } from "@linkaffipro/db";
import { ForbiddenError, requireAdmin, requireUser } from "@/lib/session";
import { getTagRegistry, memberTags } from "@/lib/members/tags";
import { scrubLinkaffiEventsOps } from "@/lib/affiliates/anonymize";
import { changeMemberAffiliate, removeMemberAffiliate } from "@/lib/affiliates/attribution-server";

export async function addNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const text = z.string().trim().min(1).max(2000).safeParse(formData.get("text"));
  if (!text.success)
    redirect(
      `/members/${memberId}?error=${encodeURIComponent("La note est vide ou dépasse 2 000 caractères.")}`,
    );
  await prisma.memberNote.create({ data: { memberId, authorId: user.id, text: text.data } });
  await audit({
    userId: user.id,
    action: "member.note_added",
    entityType: "Member",
    entityId: memberId,
  });
  revalidatePath(`/members/${memberId}`);
  redirect(`/members/${memberId}?ok=${encodeURIComponent("Note ajoutée.")}`);
}

/** Modifier une note : son auteur, ou un administrateur. */
export async function editNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const noteId = z.string().min(1).parse(formData.get("noteId"));
  const note = await prisma.memberNote.findUnique({ where: { id: noteId } });
  if (!note) redirect("/members");
  if (user.role !== "ADMIN" && note.authorId !== user.id)
    redirect(
      `/members/${note.memberId}?error=${encodeURIComponent("Vous ne pouvez modifier que vos propres notes.")}`,
    );
  const text = z.string().trim().min(1).max(2000).safeParse(formData.get("text"));
  if (!text.success)
    redirect(
      `/members/${note.memberId}?error=${encodeURIComponent("La note est vide ou dépasse 2 000 caractères.")}`,
    );
  await prisma.memberNote.update({ where: { id: noteId }, data: { text: text.data } });
  await audit({
    userId: user.id,
    action: "member.note_edited",
    entityType: "Member",
    entityId: note.memberId,
    metadata: { noteId },
  });
  revalidatePath(`/members/${note.memberId}`);
  redirect(`/members/${note.memberId}?ok=${encodeURIComponent("Note modifiée.")}`);
}

/**
 * Étiquettes d'un membre : les cases cochées parmi le registre (Réglages → Étiquettes) remplacent
 * celles du registre ; les étiquettes hors registre (posées par une automatisation) sont conservées.
 */
export async function setMemberTagsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { tags: true, anonymizedAt: true },
  });
  if (!member) redirect("/members");
  if (member.anonymizedAt)
    redirect(
      `/members/${memberId}?error=${encodeURIComponent("Un membre anonymisé ne porte pas d'étiquette.")}`,
    );
  const registry = await getTagRegistry();
  const known = new Set(registry.map((t) => t.name));
  const wanted = formData
    .getAll("tags")
    .map(String)
    .filter((t) => known.has(t));
  const before = memberTags(member.tags);
  const kept = before.filter((t) => !known.has(t));
  const next = [...new Set([...kept, ...wanted])];
  await prisma.member.update({
    where: { id: memberId },
    data: { tags: next as Prisma.InputJsonValue },
  });
  await recordEvent({
    type: "member.tags_changed",
    memberId,
    payload: { from: before, to: next, by: user.id },
  });
  await audit({
    userId: user.id,
    action: "member.tags_changed",
    entityType: "Member",
    entityId: memberId,
    metadata: { from: before, to: next },
  });
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/members");
  redirect(`/members/${memberId}?ok=${encodeURIComponent("Étiquettes enregistrées.")}`);
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const noteId = z.string().min(1).parse(formData.get("noteId"));
  const note = await prisma.memberNote.findUnique({ where: { id: noteId } });
  if (!note) redirect("/members");
  if (user.role !== "ADMIN" && note.authorId !== user.id)
    redirect(
      `/members/${note.memberId}?error=${encodeURIComponent("Vous ne pouvez supprimer que vos propres notes.")}`,
    );
  await prisma.memberNote.delete({ where: { id: noteId } });
  await audit({
    userId: user.id,
    action: "member.note_deleted",
    entityType: "Member",
    entityId: note.memberId,
  });
  revalidatePath(`/members/${note.memberId}`);
  redirect(`/members/${note.memberId}?ok=${encodeURIComponent("Note supprimée.")}`);
}

/**
 * Suppression d'un membre sur demande (RGPD) = anonymisation : identité effacée, notes et conversations avec
 * l'assistant supprimées (texte des messages envoyés par l'assistant vidé), événements et statistiques conservés sans
 * donnée personnelle. Le telegramUserId est remplacé par un
 * entier négatif aléatoire (jamais attribué par Telegram) pour préserver l'unicité et les relations.
 * Événements destinés à Link Affi (phase 13) : en attente supprimés, les autres sans l'identité du membre.
 * DM des comptes réels (phase 18) : en attente annulés, texte et identifiant Telegram effacés. Événements `telegram.*`
 * (prénom, pseudo, identifiant, textes reçus) : contenu remplacé par `{ redacted: true }`.
 */
export async function anonymizeMemberAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "SUPPRIMER")
    redirect(
      `/members/${memberId}?error=${encodeURIComponent("Pour confirmer, tapez SUPPRIMER en majuscules dans le champ.")}`,
    );
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) redirect("/members");
  if (member.anonymizedAt)
    redirect(`/members/${memberId}?ok=${encodeURIComponent("Ce membre est déjà anonymisé.")}`);
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
  await recordEvent({ type: "member.anonymized", memberId, payload: { by: admin.id } });
  await audit({
    userId: admin.id,
    action: "member.anonymized",
    entityType: "Member",
    entityId: memberId,
  });
  revalidatePath(`/members/${memberId}`);
  redirect(
    `/members/${memberId}?ok=${encodeURIComponent("Membre supprimé : identité effacée, historique conservé sans donnée personnelle.")}`,
  );
}

/** Retour d'une correction d'affilié (fiche membre) : confirmation ou erreur, sans quitter la fiche. */
function backToMember(
  memberId: string,
  r: { ok: true; message: string } | { ok: false; error: string },
): never {
  revalidatePath(`/members/${memberId}`);
  redirect(
    `/members/${memberId}?${new URLSearchParams(r.ok ? { ok: r.message } : { error: r.error }).toString()}`,
  );
}

/** Administrateur, sinon retour sur la fiche avec un message (un responsable lit l'affilié sans le changer). */
async function adminOrBack(memberId: string) {
  try {
    return await requireAdmin();
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
    backToMember(memberId, { ok: false, error: "Réservé aux administrateurs." });
  }
}

/**
 * « Changer d'affilié » (phase 13, ADMIN) : rattache le membre à une campagne Telegram d'affilié existante, avec un
 * motif (journal `member.affiliate_changed`).
 */
export async function changeMemberAffiliateAction(formData: FormData): Promise<void> {
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const admin = await adminOrBack(memberId);
  backToMember(
    memberId,
    await changeMemberAffiliate({
      memberId,
      inviteLinkId: String(formData.get("inviteLinkId") ?? ""),
      reason: formData.get("reason"),
      userId: admin.id,
    }),
  );
}

/** « Retirer l'affilié » (phase 13, ADMIN) : plus aucun affilié, avec un motif (journal `member.affiliate_removed`). */
export async function removeMemberAffiliateAction(formData: FormData): Promise<void> {
  const memberId = z.string().min(1).parse(formData.get("memberId"));
  const admin = await adminOrBack(memberId);
  backToMember(
    memberId,
    await removeMemberAffiliate({ memberId, reason: formData.get("reason"), userId: admin.id }),
  );
}
