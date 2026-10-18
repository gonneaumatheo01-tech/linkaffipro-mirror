import { apiUser } from "@/lib/ai/api-user";
import { loadThreadUpdate } from "@/lib/conversations/detail";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Fil en direct d'une conversation de l'assistant (fiche `/conversations/[id]`, rafraîchie toutes les 4 s tant que
 * l'onglet est visible) : GET /api/conversations/<id>/messages?after=<date ISO du dernier message affiché> → les
 * messages depuis ce moment (une minute de marge, dédupliqués par le fil), l'état des liens de l'offre envoyés et le
 * repère d'état de la conversation (un changement fait recharger la fiche : boutons, en-tête). Sans `after` lisible :
 * les 200 derniers messages. Même contrôle que les pages (`apiUser`) : 401 sans session valide ; 404 si la
 * conversation n'existe plus. Jamais mis en cache.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  if (!(await apiUser()))
    return Response.json({ error: "Non connecté." }, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const after = new URL(req.url).searchParams.get("after");
  const update = await loadThreadUpdate(id, after);
  if (!update)
    return Response.json(
      { error: "Cette conversation n'existe plus." },
      { status: 404, headers: NO_STORE },
    );
  return Response.json(update, { headers: NO_STORE });
}
