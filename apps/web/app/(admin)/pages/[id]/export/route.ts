import { prisma } from "@linkaffipro/db";
import { env } from "@/lib/env";
import { landingCsv } from "@/lib/landing/csv";
import { loadLandingTables } from "@/lib/landing/stats";
import { periodLabel, resolvePeriod } from "@/lib/periods";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export CSV des chiffres d'une page d'atterrissage (phase 15), même période que la fiche : une ligne par source et
 * une ligne pour toute la page. ADMIN et MANAGER (comme la fiche).
 */
export async function GET(req: Request, ctx: RouteContext<"/pages/[id]/export">) {
  await requireUser();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const period = resolvePeriod(Object.fromEntries(url.searchParams.entries()));
  const page = await prisma.landingPage.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      sources: { select: { key: true, ad: { select: { name: true } } } },
    },
  });
  if (!page) return new Response("Page introuvable", { status: 404 });
  const table = (await loadLandingTables([page.id], period)).get(page.id) ?? null;
  const csv = landingCsv({
    page,
    table,
    periodText: periodLabel(period),
    trackingBase: env.trackingBaseUrl,
  });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="page-${page.slug}-${period.from}-${period.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
