import { apiUser } from "@/lib/ai/api-user";
import { listCampaignOptions } from "@/lib/campaigns/queries";

export const dynamic = "force-dynamic";

/**
 * Nos campagnes avec leurs offres Link Affi (JSON), pour le choix « Campagne » du bouton Offre dans les formulaires.
 * Même contrôle que les pages (compte actif, session à jour : `apiUser`), jamais mis en cache.
 */
export async function GET() {
  const user = await apiUser();
  if (!user)
    return Response.json(
      { error: "non connecté" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const campaigns = await listCampaignOptions();
  return Response.json({ campaigns }, { headers: { "Cache-Control": "no-store" } });
}
