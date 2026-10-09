import { parseSegment } from "@linkaffipro/core";
import { auth } from "@/auth";
import { countTargets } from "@/lib/broadcasts/queries";

export const dynamic = "force-dynamic";

/** Compte les destinataires joignables d'un segment (bouton « Compter » du formulaire). */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "non connecté" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { botId?: string; segment?: unknown };
  if (!body.botId) return Response.json({ error: "bot manquant" }, { status: 400 });
  const count = await countTargets(parseSegment(body.segment), body.botId);
  return Response.json({ count });
}
