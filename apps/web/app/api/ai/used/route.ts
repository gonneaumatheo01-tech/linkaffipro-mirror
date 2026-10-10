import { z } from "zod";
import { prisma, audit } from "@linkaffipro/db";
import { apiUser } from "@/lib/ai/api-user";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1).max(64), index: z.number().int().min(0).max(10) });

/** POST /api/ai/used : { id, index } → marque la version retenue (statistiques d'usage). */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return Response.json({ error: "Non connecté." }, { status: 401 });
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return Response.json({ error: "Demande invalide." }, { status: 400 });
  }
  const updated = await prisma.aiSuggestion.updateMany({ where: { id: body.id, userId: user.id }, data: { usedIndex: body.index } });
  if (updated.count === 0) return Response.json({ error: "Suggestion introuvable." }, { status: 404 });
  await audit({ userId: user.id, action: "ai.suggestion_used", entityType: "AiSuggestion", entityId: body.id, metadata: { index: body.index } });
  return Response.json({ ok: true });
}
