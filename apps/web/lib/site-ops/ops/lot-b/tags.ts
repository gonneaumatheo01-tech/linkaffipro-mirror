/**
 * Phase 34, lot B — cœurs des étiquettes des membres (Réglages → Étiquettes). Appelés par
 * `app/(admin)/settings/tags/actions.ts` et par Kevin : mêmes validations, mêmes textes, même journal (+ `via`).
 * Administrateurs seulement (réglage).
 */
import { z } from "zod";
import { prisma, audit, type Prisma } from "@linkaffipro/db";
import {
  getTagRegistry,
  isTagColor,
  memberTags,
  normalizeTagName,
  saveTagRegistry,
  TAG_NAME_MAX,
} from "@/lib/members/tags";
import { adminOnly, fail, ok, preview, str, viaMeta, type CoreRun } from "./common";

export const TAG_NAME_ERROR = `Le nom doit faire entre 1 et ${TAG_NAME_MAX} caractères (lettres, chiffres, espaces, tirets).`;
const COLOR_ERROR = "Choisissez une couleur dans la liste.";

/** Étiquette du registre par son nom exact, sinon sans tenir compte de la casse (phrase de Kevin). */
function findTag<T extends { name: string }>(registry: readonly T[], name: string): number {
  const exact = registry.findIndex((t) => t.name === name);
  if (exact >= 0) return exact;
  const lower = registry.filter((t) => t.name.toLowerCase() === name.toLowerCase());
  return lower.length === 1 ? registry.indexOf(lower[0]!) : -1;
}

export const tagCreate: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const name = normalizeTagName(input.name ?? null);
  const color = str(input.color ?? "gray");
  if (!name) return fail(TAG_NAME_ERROR, "invalid", "name");
  if (!isTagColor(color)) return fail(COLOR_ERROR, "invalid", "color");
  const registry = await getTagRegistry();
  if (registry.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    return fail(`L'étiquette « ${name} » existe déjà.`, "conflict", "name");
  if (opts.dryRun) return preview({ summary: `Nouvelle étiquette « ${name} » (couleur ${color}).` });
  await saveTagRegistry([...registry, { name, color }]);
  await audit({
    userId: actor.userId,
    action: "tag.created",
    entityType: "Setting",
    entityId: "members.tags",
    metadata: { name, color, ...viaMeta(actor) },
  });
  return ok(`Étiquette « ${name} » créée.`, { name, color });
};

/**
 * Renommer ou recolorer. Le renommage est propagé à tous les membres qui portent l'étiquette (transaction). Kevin peut
 * ne donner que la nouvelle couleur ou que le nouveau nom : l'autre valeur est gardée.
 */
export const tagUpdate: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const oldParsed = z.string().min(1).safeParse(input.oldName);
  if (!oldParsed.success) return fail("Cette étiquette n'existe plus.", "not_found", "oldName");
  const registry = await getTagRegistry();
  const idx = findTag(registry, oldParsed.data);
  const oldName = idx >= 0 ? registry[idx]!.name : oldParsed.data;
  const name = normalizeTagName(input.name === undefined ? oldName : input.name);
  const color = str(input.color ?? (idx >= 0 ? registry[idx]!.color : "gray"));
  if (!name) return fail(TAG_NAME_ERROR, "invalid", "name");
  if (!isTagColor(color)) return fail(COLOR_ERROR, "invalid", "color");
  if (idx < 0) return fail("Cette étiquette n'existe plus.", "not_found", "oldName");
  if (name !== oldName && registry.some((t, i) => i !== idx && t.name.toLowerCase() === name.toLowerCase()))
    return fail(`L'étiquette « ${name} » existe déjà.`, "conflict", "name");
  const next = registry.map((t, i) => (i === idx ? { name, color } : t));
  const members =
    name !== oldName
      ? await prisma.member.findMany({
          where: { tags: { array_contains: [oldName] } },
          select: { id: true, tags: true },
        })
      : [];
  if (opts.dryRun)
    return preview({
      summary:
        name !== oldName
          ? `Étiquette « ${oldName} » renommée en « ${name} » (${members.length} membre${members.length > 1 ? "s" : ""} concerné${members.length > 1 ? "s" : ""}).`
          : `Étiquette « ${name} » : couleur ${color}.`,
    });
  let propagated = 0;
  if (name !== oldName) {
    await prisma.$transaction(
      members.map((m) =>
        prisma.member.update({
          where: { id: m.id },
          data: {
            tags: [...new Set(memberTags(m.tags).map((t) => (t === oldName ? name : t)))] as Prisma.InputJsonValue,
          },
        }),
      ),
    );
    propagated = members.length;
  }
  await saveTagRegistry(next);
  await audit({
    userId: actor.userId,
    action: "tag.updated",
    entityType: "Setting",
    entityId: "members.tags",
    metadata: { from: oldName, name, color, propagated, ...viaMeta(actor) },
  });
  return ok(
    name !== oldName
      ? `Étiquette renommée en « ${name} » (${propagated} membre${propagated > 1 ? "s" : ""} mis à jour).`
      : `Étiquette « ${name} » enregistrée.`,
    { name, color, propagated },
  );
};

/** Supprimer : l'étiquette est retirée de tous les membres qui la portent. */
export const tagDelete: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = z.string().min(1).safeParse(input.name);
  if (!parsed.success) return fail("Cette étiquette n'existe plus.", "not_found", "name");
  const registry = await getTagRegistry();
  const idx = findTag(registry, parsed.data);
  if (idx < 0) return fail("Cette étiquette n'existe plus.", "not_found", "name");
  const name = registry[idx]!.name;
  const members = await prisma.member.findMany({
    where: { tags: { array_contains: [name] } },
    select: { id: true, tags: true },
  });
  const who = `${members.length} membre${members.length > 1 ? "s" : ""}`;
  if (opts.dryRun)
    return preview({
      summary: `Supprimer l'étiquette « ${name} ».`,
      impact: `Elle sera retirée de ${who}.`,
    });
  await prisma.$transaction(
    members.map((m) =>
      prisma.member.update({
        where: { id: m.id },
        data: { tags: memberTags(m.tags).filter((t) => t !== name) as Prisma.InputJsonValue },
      }),
    ),
  );
  await saveTagRegistry(registry.filter((t) => t.name !== name));
  await audit({
    userId: actor.userId,
    action: "tag.deleted",
    entityType: "Setting",
    entityId: "members.tags",
    metadata: { name, removedFrom: members.length, ...viaMeta(actor) },
  });
  return ok(`Étiquette « ${name} » supprimée et retirée de ${who}.`, { name, removedFrom: members.length });
};
