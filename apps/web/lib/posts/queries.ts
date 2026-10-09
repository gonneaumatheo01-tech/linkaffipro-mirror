import { prisma, type Prisma, type PostStatus } from "@linkaffipro/db";
import { addDays, fromParisLocal } from "./time";
import { statusLabels, statusVariant, type BadgeVariant } from "@/lib/status-badges";

export const POSTS_PAGE_SIZE = 50;

export type PostListFilters = {
  channelId: string;
  status: string;
  categoryId: string;
  from: string;
  to: string;
};

/** Clause Prisma de la liste des messages (vue « Liste ») à partir des filtres de l'URL (fonction pure). */
export function postListWhere(f: PostListFilters): Prisma.PostWhereInput {
  const statuses = Object.keys(POST_STATUS_LABELS) as PostStatus[];
  return {
    isTemplate: false,
    ...(f.channelId ? { channelId: f.channelId } : {}),
    ...(f.status && statuses.includes(f.status as PostStatus)
      ? { status: f.status as PostStatus }
      : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.from || f.to
      ? {
          scheduledAt: {
            ...(f.from ? { gte: fromParisLocal(`${f.from}T00:00`) ?? undefined } : {}),
            ...(f.to ? { lt: addDays(fromParisLocal(`${f.to}T00:00`) ?? new Date(), 1) } : {}),
          },
        }
      : {}),
  };
}

const postListInclude = {
  channel: { select: { title: true } },
  category: { select: { name: true, color: true } },
} satisfies Prisma.PostInclude;
export type PostListRow = Prisma.PostGetPayload<{ include: typeof postListInclude }>;

/** Messages (vue « Liste ») ou modèles, paginés par 50. */
export async function listPosts(opts: {
  view: "list" | "templates";
  filters: PostListFilters;
  page: number;
}): Promise<{ rows: PostListRow[]; total: number; pages: number }> {
  const where: Prisma.PostWhereInput =
    opts.view === "templates" ? { isTemplate: true } : postListWhere(opts.filters);
  const orderBy: Prisma.PostOrderByWithRelationInput[] =
    opts.view === "templates"
      ? [{ updatedAt: "desc" }]
      : [{ scheduledAt: "desc" }, { updatedAt: "desc" }];
  const page = Math.max(1, opts.page);
  const [total, rows] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy,
      skip: (page - 1) * POSTS_PAGE_SIZE,
      take: POSTS_PAGE_SIZE,
      include: postListInclude,
    }),
  ]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / POSTS_PAGE_SIZE)) };
}

/** Libellés et couleurs des statuts de message : source unique dans `lib/status-badges.tsx`. */
export const POST_STATUS_LABELS: Record<PostStatus, string> = statusLabels("post");

export const POST_STATUS_VARIANT: Record<PostStatus, BadgeVariant> = Object.fromEntries(
  (Object.keys(POST_STATUS_LABELS) as PostStatus[]).map((s) => [s, statusVariant("post", s)]),
) as Record<PostStatus, BadgeVariant>;

/** Bot qui publie dans un canal : bot principal, sinon premier bot administrateur actif. */
export async function publishingBotFor(
  channelId: string,
): Promise<{ id: string; username: string } | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      primaryBot: true,
      botAdmins: { where: { revokedAt: null }, include: { bot: true } },
    },
  });
  if (!channel) return null;
  if (channel.primaryBot?.isActive)
    return { id: channel.primaryBot.id, username: channel.primaryBot.username };
  const admin = channel.botAdmins.find((a) => a.bot.isActive);
  return admin ? { id: admin.bot.id, username: admin.bot.username } : null;
}
