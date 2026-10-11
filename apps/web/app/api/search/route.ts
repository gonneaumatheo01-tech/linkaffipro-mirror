import { prisma, type Prisma } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";
import { displayName } from "@/lib/members/query";
import {
  parseSearchQuery,
  SEARCH_GROUP_LABELS,
  snippet,
  type SearchGroup,
  type SearchHit,
  type SearchResponse,
} from "@/lib/search/query";

export const dynamic = "force-dynamic";

const LIMIT = 10;

/**
 * Recherche globale (⌘K) : GET /api/search?q=…
 * Même contrôle que les pages (`apiUser` : compte actif, session à jour ; 401 sinon). Au plus 10 résultats par groupe :
 * membres (nom, @pseudo, identifiant Telegram), messages (modèle ou texte), canaux, campagnes (les nôtres),
 * règles d'automatisation.
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user)
    return Response.json(
      { error: "Non connecté." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const q = parseSearchQuery(new URL(req.url).searchParams.get("q"));
  const empty: SearchResponse = { q: q.raw, groups: [] };
  if (q.empty) return Response.json(empty);

  const ci = (field: string) => ({ [field]: { contains: q.raw, mode: "insensitive" as const } });
  const allTerms = (field: string) =>
    q.terms.map((t) => ({ [field]: { contains: t, mode: "insensitive" as const } }));

  const memberWhere: Prisma.MemberWhereInput = {
    anonymizedAt: null,
    OR: [
      ...(q.telegramUserId !== null ? [{ telegramUserId: q.telegramUserId }] : []),
      ...(q.username ? [{ username: { contains: q.username, mode: "insensitive" as const } }] : []),
      ci("firstName"),
      ci("lastName"),
      ci("username"),
      // « Jean Dupont » : chaque mot dans prénom ou nom.
      ...(q.terms.length > 1
        ? [
            {
              AND: q.terms.map((t) => ({
                OR: [
                  { firstName: { contains: t, mode: "insensitive" as const } },
                  { lastName: { contains: t, mode: "insensitive" as const } },
                ],
              })),
            },
          ]
        : []),
    ],
  };

  const [members, posts, channels, campaigns, rules] = await Promise.all([
    prisma.member.findMany({
      where: memberWhere,
      orderBy: { lastSeenAt: "desc" },
      take: LIMIT,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        telegramUserId: true,
        anonymizedAt: true,
      },
    }),
    prisma.post.findMany({
      where: {
        AND: [
          { OR: [ci("templateName"), { AND: allTerms("text") }] },
          // Messages conteneurs des envois groupés exclus ; un NOT seul écarterait aussi les templateName NULL
          // (tous les messages de canal), d'où le OR explicite.
          { OR: [{ templateName: null }, { NOT: { templateName: { startsWith: "broadcast:" } } }] },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
      select: {
        id: true,
        templateName: true,
        text: true,
        status: true,
        channel: { select: { title: true } },
      },
    }),
    prisma.channel.findMany({
      where: { OR: [ci("title"), ci("username")] },
      orderBy: { title: "asc" },
      take: LIMIT,
      select: { id: true, title: true, username: true, isActive: true },
    }),
    prisma.campaign.findMany({
      where: { OR: [ci("name"), ci("notes")] },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
      select: { id: true, name: true, status: true, adPlatform: true },
    }),
    prisma.automationRule.findMany({
      where: ci("name"),
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
      select: { id: true, name: true, isActive: true, trigger: true },
    }),
  ]);

  const groups: SearchResponse["groups"] = [];
  const push = (key: SearchGroup, hits: SearchHit[]) => {
    if (hits.length) groups.push({ key, label: SEARCH_GROUP_LABELS[key], hits });
  };
  push(
    "members",
    members.map((m) => ({
      id: m.id,
      title: displayName(m),
      subtitle: [m.username ? `@${m.username}` : null, `identifiant ${m.telegramUserId.toString()}`]
        .filter(Boolean)
        .join(" · "),
      href: `/members/${m.id}`,
    })),
  );
  push(
    "posts",
    posts.map((p) => ({
      id: p.id,
      title: p.templateName || snippet(p.text, q.terms, 60) || "Message sans texte",
      subtitle: `${p.channel.title} · ${POST_STATUS[p.status] ?? p.status}`,
      href: `/messages/${p.id}`,
    })),
  );
  push(
    "channels",
    channels.map((c) => ({
      id: c.id,
      title: c.title,
      subtitle:
        [c.username ? `@${c.username}` : null, c.isActive ? null : "inactif"]
          .filter(Boolean)
          .join(" · ") || undefined,
      href: `/channels/${c.id}`,
    })),
  );
  push(
    "campaigns",
    campaigns.map((c) => ({
      id: c.id,
      title: c.name,
      subtitle: [
        c.adPlatform ? (PLATFORM[c.adPlatform] ?? c.adPlatform) : null,
        CAMPAIGN_STATUS[c.status] ?? c.status,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/campaigns/${c.id}`,
    })),
  );
  push(
    "automations",
    rules.map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: r.isActive ? "relance activée" : "relance désactivée",
      href: `/members/automations/${r.id}`,
    })),
  );
  return Response.json({ q: q.raw, groups } satisfies SearchResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}

const POST_STATUS: Record<string, string> = {
  DRAFT: "brouillon",
  SCHEDULED: "programmé",
  SENDING: "en cours d'envoi",
  SENT: "envoyé",
  FAILED: "échec",
  CANCELLED: "annulé",
  DELETED: "supprimé",
};
const CAMPAIGN_STATUS: Record<string, string> = {
  DRAFT: "brouillon",
  ACTIVE: "active",
  PAUSED: "en pause",
  ENDED: "terminée",
};
const PLATFORM: Record<string, string> = {
  TIKTOK: "TikTok",
  META: "Meta",
  OTHER: "autre plateforme",
};
