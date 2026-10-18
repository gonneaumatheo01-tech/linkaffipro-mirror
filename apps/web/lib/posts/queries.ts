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
 * (comme sur Envois, Membres et le tableau de bord) ; l'ancien nom `campaign` reste accepté. Le canal s'appelle
 * `channel` dans la liste et `channelId` dans le calendrier (adresse de l'ancien onglet « Meilleurs horaires »
 * d'un canal, redirigée vers `/messages?channelId=…`) : les deux sont lus.
 */
export function parsePostListFilters(sp: SearchParamsLike): PostListFilters {
  return {
    channelId: param(sp, "channel") || param(sp, "channelId"),
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
  channel: { select: { title: true, vertical: true } },
  category: { select: { name: true, color: true } },
  stats: { select: { clicks: true } },
} satisfies Prisma.PostInclude;
export type PostListRow = Prisma.PostGetPayload<{ include: typeof postListInclude }>;

/** Messages (vue « Liste ») ou modèles, paginés par 50. */
export async function listPosts(opts: {
  view: "list" | "templates";
  filters: PostListFilters;
  page: number;
}): Promise<{ rows: PostListRow[]; total: number; pages: number }> {
  const scope = opts.view === "list" ? await scopeForFilters(opts.filters) : null;
  // Modèles : univers et thème (bibliothèque), plus la catégorie quand le modèle en a une (galerie).
  const where: Prisma.PostWhereInput =
    opts.view === "templates"
      ? {
          ...templateListWhere(opts.filters),
          ...(opts.filters.categoryId ? { categoryId: opts.filters.categoryId } : {}),
        }
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

const calendarInclude = {
  channel: { select: { id: true, title: true, vertical: true } },
  category: { select: { id: true, name: true, color: true } },
} satisfies Prisma.PostInclude;
export type CalendarPostRow = Prisma.PostGetPayload<{ include: typeof calendarInclude }>;

/** Univers reconnu (CASINO, SPORTS, DATING), sinon null. */
function knownVertical(v: string | undefined): Vertical | null {
  return v && VERTICALS.includes(v) ? (v as Vertical) : null;
}

/**
 * Messages d'une semaine (vue « Calendrier »), avec les mêmes filtres que la liste : campagne (`campaignScope` +
 * `campaignPostWhere`), canal, catégorie, et l'univers du canal.
 */
export async function listCalendarPosts(opts: {
  weekStart: Date;
  weekEnd: Date;
  campaignId?: string;
  channelId?: string;
  categoryId?: string;
  vertical?: string;
}): Promise<CalendarPostRow[]> {
  const f: PostListFilters = {
    channelId: opts.channelId ?? "",
    status: "",
    categoryId: opts.categoryId ?? "",
    from: "",
    to: "",
    campaignId: opts.campaignId,
  };
  const vertical = knownVertical(opts.vertical);
  const where: Prisma.PostWhereInput = {
    ...postListWhere(f, await scopeForFilters(f)),
    ...(vertical ? { channel: { vertical } } : {}),
    scheduledAt: { gte: opts.weekStart, lt: opts.weekEnd },
  };
  return prisma.post.findMany({
    where,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    include: calendarInclude,
  });
}

/** Catégories portées par au moins un modèle (filtre « Catégorie » de la galerie de modèles). */
export async function listTemplateCategories(): Promise<
  Array<{ id: string; name: string; color: string }>
> {
  return prisma.messageCategory.findMany({
    where: { posts: { some: { isTemplate: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, color: true },
  });
}

/** Libellés et couleurs des statuts de message : source unique dans `lib/status-badges.tsx`. */
export const POST_STATUS_LABELS: Record<PostStatus, string> = statusLabels("post");

export const POST_STATUS_VARIANT: Record<PostStatus, BadgeVariant> = Object.fromEntries(
  (Object.keys(POST_STATUS_LABELS) as PostStatus[]).map((s) => [s, statusVariant("post", s)]),
) as Record<PostStatus, BadgeVariant>;

/** Champs d'un bot lus pour choisir celui qui publie (jamais le jeton). */
const publishingBotSelect = { id: true, username: true, isActive: true, mode: true } as const;

/** Un bot peut-il publier dans un canal ? Actif et normal : jamais un assistant de conversation (phase 17). */
function canPublish(bot: { isActive: boolean; mode: string } | null | undefined): boolean {
  return Boolean(bot?.isActive && bot.mode === "STANDARD");
}

/**
 * Bot qui publie dans un canal : bot principal, sinon le plus ancien bot administrateur actif. Jamais un bot en mode
 * assistant de conversation (phase 17 : il ne s'occupe que de ses conversations privées).
 * `keep` (modification d'un message) : le bot actuel du message est gardé s'il peut encore publier dans ce canal (bot
 * principal ou administrateur, actif et normal) ; sinon (désactivé, devenu assistant, plus administrateur) le choix
 * ci-dessus le remplace.
 */
export async function publishingBotFor(
  channelId: string,
  opts: { keep?: string | null } = {},
): Promise<{ id: string; username: string } | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      primaryBot: { select: publishingBotSelect },
      botAdmins: {
        where: { revokedAt: null, bot: { isActive: true, mode: "STANDARD" } },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { bot: { select: publishingBotSelect } },
      },
    },
  });
  if (!channel) return null;
  const candidates = [channel.primaryBot, ...channel.botAdmins.map((a) => a.bot)].filter(
    (b): b is NonNullable<typeof b> => canPublish(b),
  );
  const chosen = (opts.keep && candidates.find((b) => b.id === opts.keep)) || candidates[0];
  return chosen ? { id: chosen.id, username: chosen.username } : null;
}
