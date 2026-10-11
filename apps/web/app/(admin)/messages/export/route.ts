import { prisma } from "@linkaffipro/db";
import { stripHtml } from "@linkaffipro/core";
import { requireUser } from "@/lib/session";
import { toCsv } from "@/lib/members/csv";
import { fmtDate } from "@/lib/format";
import { parsePostListFilters, postListWhere, scopeForFilters } from "@/lib/posts/queries";
import { statusLabel } from "@/lib/status-badges";

export const dynamic = "force-dynamic";

/** Nombre maximal de lignes exportées (garde-fou). */
const MAX_ROWS = 5000;

/** Export CSV (Excel français : « ; », BOM, dates Europe/Paris) des messages avec leurs statistiques, mêmes filtres que la liste (campagne comprise). */
export async function GET(req: Request) {
  await requireUser();
  // Mêmes filtres que la liste, dont la campagne (`campaignId`, ancien nom `campaign` accepté).
  const f = parsePostListFilters(new URL(req.url).searchParams);
  const posts = await prisma.post.findMany({
    where: postListWhere(f, await scopeForFilters(f)),
    orderBy: [{ scheduledAt: "desc" }, { updatedAt: "desc" }],
    take: MAX_ROWS,
    include: {
      channel: { select: { title: true } },
      category: { select: { name: true } },
      stats: true,
      bot: { select: { username: true } },
    },
  });
  const csv = toCsv(
    [
      "Code",
      "Canal",
      "Catégorie",
      "Statut",
      "Programmé le",
      "Envoyé le",
      "Bot",
      "Vues",
      "Transferts",
      "Réactions",
      "Clics",
      "Clics uniques",
      "Clics offres",
      "Inscriptions",
      "Premiers dépôts (FTD)",
      "Dépôts (nb)",
      "Dépôts (EUR)",
      "Début du texte",
    ],
    posts.map((p) => [
      p.code,
      p.channel.title,
      p.category?.name ?? "",
      statusLabel("post", p.status),
      p.scheduledAt ? fmtDate(p.scheduledAt) : "",
      p.sentAt ? fmtDate(p.sentAt) : "",
      `@${p.bot.username}`,
      p.stats?.views ?? "",
      p.stats?.forwards ?? "",
      p.stats?.reactionsTotal ?? 0,
      p.stats?.clicks ?? 0,
      p.stats?.uniqueClickers ?? 0,
      p.stats?.offerClicks ?? 0,
      p.stats?.registrations ?? 0,
      p.stats?.ftds ?? 0,
      p.stats?.deposits ?? 0,
      Number(p.stats?.depositAmount ?? 0).toFixed(2),
      stripHtml(p.text).replace(/\s+/g, " ").trim().slice(0, 120),
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="messages-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
