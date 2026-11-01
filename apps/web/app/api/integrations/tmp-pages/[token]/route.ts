/**
 * Endpoint temporaire : lecture des campagnes / canaux / pages, puis ajout de pubs et création de pages par les cœurs
 * du site (mêmes fonctions que les boutons). Deux opérations seulement. À supprimer après usage.
 */
import { createHash } from "node:crypto";
import { prisma } from "@linkaffipro/db";
import { siteOpImpl } from "@/lib/site-ops/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TOKEN_HASH = "16ac0e182f90a4398780d493b3e1e880488f3ef8104d881859561c26db072879";
const ALLOWED = new Set(["campagnes.pub_ajouter", "pages.creer"]);

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (createHash("sha256").update(token).digest("hex") !== TOKEN_HASH)
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    action: "inspect" | "run";
    ops?: Array<{ op: string; input: Record<string, unknown>; dryRun?: boolean }>;
  };
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) return Response.json({ error: "Aucun admin actif" }, { status: 500 });

  if (body.action === "inspect") {
    const [campaigns, channels, pages] = await Promise.all([
      prisma.campaign.findMany({
        select: {
          id: true,
          name: true,
          vertical: true,
          channelIds: true,
          adSets: {
            select: {
              id: true,
              name: true,
              ads: { select: { id: true, name: true, inviteLinkId: true, trackingLinkId: true } },
            },
          },
        },
      }),
      prisma.channel.findMany({ select: { id: true, title: true, username: true, vertical: true, isTest: true } }),
      prisma.landingPage.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          channelId: true,
          headline: true,
          buttonText: true,
          tiktokPixelId: true,
          showPhoto: true,
          sources: { select: { key: true, adId: true } },
        },
      }),
    ]);
    return Response.json({ campaigns, channels, pages });
  }

  const actor = { userId: admin.id, role: "ADMIN" as const, via: "WEB" as const };
  const results: unknown[] = [];
  for (const o of body.ops ?? []) {
    if (!ALLOWED.has(o.op)) return Response.json({ error: `Opération refusée : ${o.op}` }, { status: 400 });
    const impl = siteOpImpl(o.op);
    if (!impl) return Response.json({ error: `Opération inconnue : ${o.op}` }, { status: 400 });
    const r = await impl.run(o.input, actor, { dryRun: o.dryRun === true });
    results.push({ op: o.op, result: r });
    if (!(r as { ok?: boolean }).ok) break;
  }
  return Response.json({ results });
}
