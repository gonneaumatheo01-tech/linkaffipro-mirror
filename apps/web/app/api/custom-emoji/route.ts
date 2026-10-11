import { apiUser } from "@/lib/ai/api-user";
import { listPickerEmojis } from "@/lib/custom-emoji/queries";

export const dynamic = "force-dynamic";

/**
 * Bibliothèque des emojis animés pour le sélecteur de l'éditeur (phase 12) : emojis visibles, sans les fichiers
 * d'aperçu (chargés un par un, à la demande, par `GET /api/custom-emoji/<id>`). Utilisateurs connectés et actifs.
 */
export async function GET() {
  if (!(await apiUser())) return Response.json({ error: "non connecté" }, { status: 401 });
  const items = await listPickerEmojis();
  return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
