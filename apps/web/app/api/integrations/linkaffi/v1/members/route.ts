import {
  linkaffiMethodNotAllowed,
  withLinkaffiIntegration,
} from "@/lib/integrations/linkaffi/handler";
import { IntegrationError } from "@/lib/integrations/linkaffi/http";
import { loadLinkaffiCampaignMembers } from "@/lib/integrations/linkaffi/members";
import { membersQuerySchema, parseOrThrow } from "@/lib/integrations/linkaffi/schemas";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integrations/linkaffi/v1/members?campaignKey=<clé>&since=<ISO>` (contrat § 1) : membres rattachés à la
 * campagne (statut, dates) et événements envoyés depuis `since`, corps tels qu'envoyés (rattrapage).
 */
export const GET = withLinkaffiIntegration<RouteContext<"/api/integrations/linkaffi/v1/members">>(
  "get_members",
  async (req) => {
    const params = new URL(req.url).searchParams;
    const q = parseOrThrow(
      membersQuerySchema,
      {
        campaignKey: params.get("campaignKey") ?? undefined,
        since: params.get("since") ?? undefined,
      },
      "invalid_query",
    );
    const payload = await loadLinkaffiCampaignMembers(q.campaignKey, q.since ?? null);
    if (!payload)
      throw new IntegrationError(
        404,
        "campaign_not_found",
        `Aucune campagne Telegram n'a la clé « ${q.campaignKey} » chez nous : créez d'abord son lien avec POST /invite-links.`,
      );
    return {
      body: payload,
      metadata: {
        campaignKey: q.campaignKey,
        since: payload.since,
        members: payload.members.length,
        events: payload.events.length,
        hasMoreEvents: payload.hasMoreEvents,
      },
    };
  },
);

/** Autres méthodes : 405 en JSON avec l'en-tête Allow (jamais une réponse vide). */
const notAllowed = linkaffiMethodNotAllowed(["GET"]);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
