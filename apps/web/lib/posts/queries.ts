import { prisma, type Prisma, type PostStatus, type Vertical } from "@linkaffipro/db";
import { addDays, fromParisLocal } from "./time";
import { statusLabels, statusVariant, type BadgeVariant } from "@/lib/status-badges";
import { campaignPostWhere, type CampaignScope } from "@/lib/campaigns/attribution";
import { campaignScope } from "@/lib/dashboard/campaign-scope";

export const POSTS_PAGE_SIZE = 50;

export type PostListFilters = {
  channelId: string;
  status: string;
  categoryId: string;
  from: string;
  to: string;
  /** Vue « Modèles » seulement : univers (CASINO, SPORTS, DATING). */
  vertical?: string;
  /** Vue « Modèles » seulement : thème de la bibliothèque (`bonus`, `rappel`…), lu dans `Post.code`. */
  theme?: string;
  /** Campagne (la nôtre) : messages de ses canaux ou portant un bouton vers une de ses offres. */
  campaignId?: string;
};

const VERTICALS: readonly string[] = ["CASINO", "SPORTS", "DATING"];

/**
 * Thèmes de la bibliothèque de modèles (indépendants des catégories du client).
 * Même table que `THEME_LABELS` de `packages/db/prisma/seed-templates.ts` : le thème est le 3e segment de
 * `Post.code` = `modele:<univers>:<thème>:<n>`. Égalité des deux tables vérifiée par `queries.test.ts` :
 * un thème ajouté d'un seul côté fait échouer les tests.
 */
export const TEMPLATE_THEMES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "bonus", label: "Bonus" },
  { slug: "preuve-de-gains", label: "Preuve de gains" },
  { slug: "teasing", label: "Teasing" },
  { slug: "rappel", label: "Rappel" },
  { slug: "information", label: "Information" },
  { slug: "evenement", label: "Événement" },
  { slug: "sondage", label: "Sondage" },
];

function knownTheme(slug: string | undefined): string | null {
  return slug && TEMPLATE_THEMES.some((t) => t.slug === slug) ? slug : null;
}

/** Thème d'un modèle de la bibliothèque d'après son code (`modele:casino:bonus:1` → Bonus) ; null sinon. */
export function templateThemeOf(code: string): { slug: string; label: string } | null {
  const m = /^modele:[a-z]+:([a-z-]+):\d+$/.exec(code);
  return (m && TEMPLATE_THEMES.find((t) => t.slug === m[1])) || null;
}

/** Clause Prisma de la vue « Modèles » : filtres par univers et par thème (fonction pure). */
export function templateListWhere(
  f: Pick<PostListFilters, "vertical" | "theme">,
): Prisma.PostWhereInput {
  const vertical = f.vertical && VERTICALS.includes(f.vertical) ? (f.vertical as Vertical) : null;
  const theme = knownTheme(f.theme);
  const prefix = (v: string) => `modele:${v.toLowerCase()}:${theme}:`;
  return {
    isTemplate: true,
    ...(vertical ? { vertical } : {}),
    ...(theme
      ? vertical
        ? { code: { startsWith: prefix(vertical) } }
        : { OR: VERTICALS.map((v) => ({ code: { startsWith: prefix(v) } })) }
      : {}),
  };
}

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function param(sp: SearchParamsLike, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Filtres de la page Messages et de son export CSV, lus dans l'URL. Le filtre campagne s'appelle `campaignId`
 * (comme sur Envois, Membres et le tableau de bord) ; l'ancien nom `campaign` reste accepté.
 */
export function parsePostListFilters(sp: SearchParamsLike): PostListFilters {
  return {
    channelId: param(sp, "channel"),
    campaignId: param(sp, "campaignId") || param(sp, "campaign"),
    status: param(sp, "status"),
    categoryId: param(sp, "category"),
    from: param(sp, "from"),
    to: param(sp, "to"),
    vertical: param(sp, "vertical"),
    theme: param(sp, "theme"),
  };
}

/** Chaîne de requête des filtres de la liste (lien « Exporter CSV ») ; relue à l'identique par `parsePostListFilters`. */
export function postListQuery(f: PostListFilters): string {
  const q = new URLSearchParams();
  if (f.channelId) q.set("channel", f.channelId);
  if (f.campaignId) q.set("campaignId", f.campaignId);
  if (f.status) q.set("status", f.status);
  if (f.categoryId) q.set("category", f.categoryId);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  return q.toString();
}

const EMPTY_SCOPE: CampaignScope = {
  channelIds: [],
  inviteLinkIds: [],
  trackingLinkIds: [],
  affiliateCampaignIds: [],
};

/**
 * Clause Prisma de la liste des messages (vue « Liste ») à partir des filtres de l'URL (fonction pure).
 * `scope` = périmètre de la campagne filtrée (canaux, offres), fourni par `campaignScope` quand `f.campaignId` est posé.
 */
export function postListWhere(
  f: PostListFilters,
  scope?: CampaignScope | null,
): Prisma.PostWhereInput {
  const statuses = Object.keys(POST_STATUS_LABELS) as PostStatus[];
  return {
    isTemplate: false,
    ...(f.campaignId
      ? { AND: [campaignPostWhere(f.campaignId, scope ?? EMPTY_SCOPE) as Prisma.PostWhereInput] }
      : {}),
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

/** Périmètre de la campagne filtrée (null sans filtre campagne). */
export async function scopeForFilters(
  f: Pick<PostListFilters, "campaignId">,
): Promise<CampaignScope | null> {
  return f.campaignId ? campaignScope(f.campaignId) : null;
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
  const scope = opts.view === "list" ? await scopeForFilters(opts.filters) : null;
  const where: Prisma.PostWhereInput =
    opts.view === "templates"
      ? templateListWhere(opts.filters)
      : postListWhere(opts.filters, scope);
  const orderBy: Prisma.PostOrderByWithRelationInput[] =
    opts.view === "templates"
      ? [{ templateName: "asc" }, { createdAt: "asc" }]
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

/**
 * Messages programmés d'une semaine (vue « Calendrier »), avec le même filtre Campagne que la liste
 * (`campaignScope` + `campaignPostWhere`).
 */
export async function listCalendarPosts(opts: {
  weekStart: Date;
  weekEnd: Date;
  campaignId?: string;
}): Promise<PostListRow[]> {
  const f: PostListFilters = {
    channelId: "",
    status: "",
    categoryId: "",
    from: "",
    to: "",
    campaignId: opts.campaignId,
  };
  const where: Prisma.PostWhereInput = {
    ...postListWhere(f, await scopeForFilters(f)),
    scheduledAt: { gte: opts.weekStart, lt: opts.weekEnd },
  };
  return prisma.post.findMany({ where, orderBy: { scheduledAt: "asc" }, include: postListInclude });
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
