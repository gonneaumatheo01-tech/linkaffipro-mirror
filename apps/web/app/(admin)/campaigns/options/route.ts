import { auth } from "@/auth";
import { listCampaignOptions } from "@/lib/campaigns/queries";

export const dynamic = "force-dynamic";

/** Nos campagnes avec leurs offres Link Affi (JSON), pour le choix « Campagne » du bouton Offre dans les formulaires. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "non connecté" }, { status: 401 });
  const campaigns = await listCampaignOptions();
  return Response.json({ campaigns }, { headers: { "Cache-Control": "private, max-age=30" } });
}
