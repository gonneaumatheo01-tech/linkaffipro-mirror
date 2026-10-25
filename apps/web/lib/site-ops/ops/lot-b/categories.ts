/**
 * Phase 34, lot B — cœurs des catégories de messages : création rapide depuis le formulaire de message (tout le monde)
 * et Réglages → Catégories (administrateurs : créer, modifier, supprimer avec fusion). Appelés par les actions du site
 * et par Kevin : mêmes validations, mêmes textes, même journal (+ `via`).
 */
import { z } from "zod";
import { isVertical } from "@linkaffipro/core";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { slugify, uniqueSlug } from "@/lib/posts/category-stats";
import { remapBroadcastSegment, remapRuleConditions } from "@/app/(admin)/settings/categories/remap";
import { adminOnly, fail, ok, preview, resolveNamed, str, viaMeta, type CoreRun, type SiteOpResult } from "./common";

/** Couleurs proposées par défaut (même palette que le sélecteur du formulaire de message). */
const COLORS = ["#16a34a", "#ca8a04", "#9333ea", "#2563eb", "#64748b", "#dc2626", "#0891b2", "#db2777"];

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nameSchema = z.string().trim().min(2).max(40);
const NAME_ERROR = "Le nom doit faire entre 2 et 40 caractères.";
const COLOR_ERROR = "La couleur n'est pas valide : choisissez-la avec le sélecteur.";

/** Univers donné par Kevin en clair (« paris sportifs ») ou par sa clé (« SPORTS »). */
function verticalOf(raw: unknown): string {
  const s = str(raw).trim();
  const n = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/sport|pari/.test(n)) return "SPORTS";
  if (/casino/.test(n)) return "CASINO";
  if (/dating|rencontre/.test(n)) return "DATING";
  return s;
}

/** Catégorie par `id` (site) ou par son nom (`category`, Kevin). */
async function categoryId(input: Record<string, unknown>, idKey = "id", nameKey = "category"): Promise<{ ok: true; id: string } | { ok: false; result: Extract<SiteOpResult, { ok: false }> } | null> {
  const id = str(input[idKey]).trim();
  if (id) return { ok: true, id };
  const raw = str(input[nameKey]).trim();
  if (!raw) return null;
  const rows = await prisma.messageCategory.findMany({ select: { id: true, name: true, slug: true } });
  const r = await resolveNamed({ plural: "catégories", one: "la catégorie" }, raw, rows.map((c) => ({ id: c.id, name: c.name, extra: [c.slug] })));
  return r.ok ? { ok: true, id: r.id } : r;
}

/**
 * Création d'une catégorie depuis le formulaire de message (phase 8), sans quitter la page : nom + couleur.
 * Même nom (ou même identifiant court) qu'une catégorie existante : on la réutilise. Si elle est désactivée, seul un
 * ADMIN la réactive ici ; un MANAGER reçoit un message d'aide. Position : après la dernière (max + 1).
 */
export const categoryCreateInline: CoreRun = async (input, actor, opts = {}) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(40),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .safeParse({ name: input.name, ...(input.color !== undefined ? { color: input.color } : {}) });
  if (!parsed.success)
    return fail("Donnez un nom (40 caractères maximum) et choisissez une couleur valide.");
  const name = parsed.data.name;
  const slugBase =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "categorie";
  const existing = await prisma.messageCategory.findFirst({
    where: { OR: [{ slug: slugBase }, { name: { equals: name, mode: "insensitive" } }] },
    select: { id: true, name: true, color: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive) {
      if (actor.role !== "ADMIN")
        return fail(
          `La catégorie « ${existing.name} » existe mais est désactivée : un administrateur peut la réactiver dans Réglages → Catégories.`,
          "forbidden",
        );
      if (opts.dryRun) return preview({ summary: `La catégorie « ${existing.name} » existe déjà : elle sera réactivée.` });
      await prisma.messageCategory.update({ where: { id: existing.id }, data: { isActive: true } });
      await audit({
        userId: actor.userId,
        action: "category.updated",
        entityType: "MessageCategory",
        entityId: existing.id,
        metadata: { name: existing.name, isActive: true, inline: true, ...viaMeta(actor) },
      });
    } else {
      if (opts.dryRun) return preview({ summary: `La catégorie « ${existing.name} » existe déjà : elle sera réutilisée.` });
      // Trace de réutilisation : la catégorie appartient désormais au client (garde-fou de `pnpm db:phase8`).
      await audit({
        userId: actor.userId,
        action: "category.updated",
        entityType: "MessageCategory",
        entityId: existing.id,
        metadata: { name: existing.name, reused: true, inline: true, ...viaMeta(actor) },
      });
    }
    return ok(`Catégorie « ${existing.name} » prête.`, { id: existing.id, name: existing.name, color: existing.color });
  }
  if (opts.dryRun) return preview({ summary: `Nouvelle catégorie de messages « ${name} ».` });
  const [count, max] = await Promise.all([
    prisma.messageCategory.count(),
    prisma.messageCategory.aggregate({ _max: { sortOrder: true } }),
  ]);
  const color = parsed.data.color ?? COLORS[count % COLORS.length]!;
  const cat = await prisma.messageCategory.create({
    data: { name, slug: slugBase, color, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    select: { id: true, name: true, color: true },
  });
  await audit({
    userId: actor.userId,
    action: "category.created",
    entityType: "MessageCategory",
    entityId: cat.id,
    metadata: { name, color, inline: true, ...viaMeta(actor) },
  });
  return ok(`Catégorie « ${cat.name} » créée.`, { id: cat.id, name: cat.name, color: cat.color });
};

/** Réglages → Catégories : « Créer » (administrateurs). */
export const categoryCreate: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const name = nameSchema.safeParse(input.name);
  const color = colorSchema.safeParse(str(input.color ?? "#64748b"));
  const verticalRaw = verticalOf(input.vertical);
  if (!name.success) return fail(NAME_ERROR, "invalid", "name");
  if (!color.success) return fail(COLOR_ERROR, "invalid", "color");
  const vertical = isVertical(verticalRaw) ? verticalRaw : null;
  const taken = new Set((await prisma.messageCategory.findMany({ select: { slug: true } })).map((c) => c.slug));
  const slug = uniqueSlug(slugify(name.data), taken);
  if (opts.dryRun) return preview({ summary: `Nouvelle catégorie « ${name.data} »${vertical ? ` (univers ${vertical})` : ""}.` });
  const max = await prisma.messageCategory.aggregate({ _max: { sortOrder: true } });
  const cat = await prisma.messageCategory.create({
    data: { name: name.data, slug, color: color.data, vertical, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  await audit({
    userId: actor.userId,
    action: "category.created",
    entityType: "MessageCategory",
    entityId: cat.id,
    metadata: { name: cat.name, slug, ...viaMeta(actor) },
  });
  return ok(`Catégorie « ${cat.name} » créée.`, { id: cat.id });
};

/**
 * Réglages → Catégories : « Enregistrer » (administrateurs). Le site envoie tous les champs ; Kevin peut n'en donner
 * qu'une partie (« renomme la catégorie Bonus en Bonus VIP ») : les autres valeurs actuelles sont gardées.
 */
export const categoryUpdate: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const ref = await categoryId(input);
  if (!ref) return fail("Catégorie introuvable : elle a peut-être déjà été supprimée.", "not_found");
  if (!ref.ok) return ref.result;
  const id = ref.id;
  const current = await prisma.messageCategory.findUnique({ where: { id } });
  const pick = (key: string, fallback: unknown) => (input[key] === undefined ? fallback : input[key]);
  const name = nameSchema.safeParse(pick("name", current?.name));
  const color = colorSchema.safeParse(str(pick("color", current?.color ?? "")));
  const sortOrder = z.coerce.number().int().min(0).max(999).safeParse(pick("sortOrder", current?.sortOrder));
  const verticalRaw = verticalOf(pick("vertical", current?.vertical ?? ""));
  if (!name.success) return fail(NAME_ERROR, "invalid", "name");
  if (!color.success) return fail(COLOR_ERROR, "invalid", "color");
  if (!sortOrder.success) return fail("L'ordre doit être un nombre entre 0 et 999.", "invalid", "sortOrder");
  if (!current) return fail("Catégorie introuvable : elle a peut-être déjà été supprimée.", "not_found");
  const isActive = input.isActive === undefined ? current.isActive : input.isActive === true || input.isActive === "on";
  const data = {
    name: name.data,
    color: color.data,
    sortOrder: sortOrder.data,
    vertical: isVertical(verticalRaw) ? verticalRaw : null,
    isActive,
  };
  if (opts.dryRun)
    return preview({
      summary: `Catégorie « ${current.name} » : ${data.name !== current.name ? `renommée « ${data.name} », ` : ""}${isActive ? "active" : "désactivée"}, ordre ${data.sortOrder}.`,
    });
  const cat = await prisma.messageCategory.update({ where: { id }, data });
  await audit({
    userId: actor.userId,
    action: "category.updated",
    entityType: "MessageCategory",
    entityId: id,
    metadata: { name: cat.name, isActive: cat.isActive, sortOrder: cat.sortOrder, ...viaMeta(actor) },
  });
  return ok(`Catégorie « ${cat.name} » enregistrée.`, { id });
};

/**
 * Suppression (ADMIN), avec fusion facultative dans une catégorie de remplacement. En une seule transaction :
 * les messages passent dans la catégorie choisie (ou sans catégorie), les automatisations et les envois groupés
 * pas encore partis qui la citent sont mis à jour, puis la catégorie est supprimée. Sans remplacement, une
 * automatisation qui ne visait que cette catégorie est désactivée et un envoi programmé qui ne visait qu'elle repasse
 * en brouillon. Un brouillon ou une automatisation déjà en pause qui ne visait qu'elle perd son filtre : cité.
 */
export const categoryDelete: CoreRun = async (input, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const ref = await categoryId(input);
  if (!ref) return fail("Catégorie introuvable : elle a peut-être déjà été supprimée.", "not_found");
  if (!ref.ok) return ref.result;
  const id = ref.id;
  const repRef = await categoryId(input, "replacementId", "replacement");
  if (repRef && !repRef.ok) return repRef.result;
  const replacement = repRef?.id || null;
  if (replacement === id) return fail("La catégorie de remplacement doit être différente.", "invalid", "replacementId");
  const cat = await prisma.messageCategory.findUnique({ where: { id } });
  if (!cat) return fail("Catégorie introuvable : elle a peut-être déjà été supprimée.", "not_found");
  let target: { name: string } | null = null;
  if (replacement) {
    target = await prisma.messageCategory.findUnique({ where: { id: replacement } });
    if (!target) return fail("Catégorie de remplacement introuvable.", "not_found", "replacementId");
  }
  if (opts.dryRun) {
    const posts = await prisma.post.count({ where: { categoryId: id } });
    return preview({
      summary: `Supprimer la catégorie « ${cat.name} »${target ? ` (fusion dans « ${target.name} »)` : ""}.`,
      impact: target
        ? `${posts} message${posts > 1 ? "s" : ""} passe${posts > 1 ? "nt" : ""} dans « ${target.name} ».`
        : `${posts} message${posts > 1 ? "s" : ""} perd${posts > 1 ? "ent" : ""} sa catégorie ; une relance ou un envoi programmé qui ne visait qu'elle est mis en pause.`,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const moved = await tx.post.updateMany({ where: { categoryId: id }, data: { categoryId: replacement } });
    const rulesChanged: string[] = [];
    const rulesDeactivated: string[] = [];
    const rulesFilterRemoved: string[] = [];
    for (const r of await tx.automationRule.findMany({
      select: { id: true, name: true, isActive: true, conditions: true },
    })) {
      const m = remapRuleConditions(r.conditions, id, replacement);
      if (!m.changed) continue;
      const deactivate = m.deactivate && r.isActive;
      await tx.automationRule.update({
        where: { id: r.id },
        data: { conditions: toJsonValue(m.conditions), ...(deactivate ? { isActive: false } : {}) },
      });
      rulesChanged.push(r.id);
      if (deactivate) rulesDeactivated.push(r.name);
      else if (m.deactivate) rulesFilterRemoved.push(r.name);
    }
    const broadcastsChanged: string[] = [];
    const broadcastsToDraft: string[] = [];
    const broadcastsFilterRemoved: string[] = [];
    for (const b of await tx.broadcast.findMany({
      where: { status: { in: ["DRAFT", "SCHEDULED"] } },
      select: { id: true, name: true, status: true, segment: true },
    })) {
      const m = remapBroadcastSegment(b.segment, id, replacement);
      if (!m.changed) continue;
      const toDraft = m.backToDraft && b.status === "SCHEDULED";
      await tx.broadcast.update({
        where: { id: b.id },
        data: { segment: toJsonValue(m.segment), ...(toDraft ? { status: "DRAFT" as const } : {}) },
      });
      broadcastsChanged.push(b.id);
      if (toDraft) broadcastsToDraft.push(b.name);
      else if (m.backToDraft) broadcastsFilterRemoved.push(b.name);
    }
    await tx.messageCategory.delete({ where: { id } });
    return {
      moved: moved.count,
      rulesChanged,
      rulesDeactivated,
      rulesFilterRemoved,
      broadcastsChanged,
      broadcastsToDraft,
      broadcastsFilterRemoved,
    };
  });

  if (result.moved > 0 || result.rulesChanged.length > 0 || result.broadcastsChanged.length > 0)
    await audit({
      userId: actor.userId,
      action: "category.merged",
      entityType: "MessageCategory",
      entityId: id,
      metadata: {
        name: cat.name,
        into: replacement,
        posts: result.moved,
        rules: result.rulesChanged,
        rulesDeactivated: result.rulesDeactivated,
        rulesFilterRemoved: result.rulesFilterRemoved,
        broadcasts: result.broadcastsChanged,
        broadcastsBackToDraft: result.broadcastsToDraft,
        broadcastsFilterRemoved: result.broadcastsFilterRemoved,
        ...viaMeta(actor),
      },
    });
  await audit({
    userId: actor.userId,
    action: "category.deleted",
    entityType: "MessageCategory",
    entityId: id,
    metadata: { name: cat.name, ...viaMeta(actor) },
  });
  const names = (list: string[]) => list.map((n) => `« ${n} »`).join(", ");
  const notes = [
    result.rulesDeactivated.length
      ? `Relance automatique désactivée (elle ne visait que cette catégorie) : ${names(result.rulesDeactivated)}.`
      : "",
    result.broadcastsToDraft.length
      ? `Message à un groupe repassé en brouillon (il ne visait que cette catégorie) : ${names(result.broadcastsToDraft)}.`
      : "",
    result.rulesFilterRemoved.length
      ? `Filtre de catégorie retiré, vérifiez la cible avant de réactiver la relance automatique : ${names(result.rulesFilterRemoved)}.`
      : "",
    result.broadcastsFilterRemoved.length
      ? `Filtre de catégorie retiré, vérifiez la cible avant d'envoyer : ${names(result.broadcastsFilterRemoved)}.`
      : "",
  ].filter(Boolean);
  return ok([`Catégorie « ${cat.name} » supprimée.`, ...notes].join(" "), { id });
};
