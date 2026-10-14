import {
  linkaffiMethodNotAllowed,
  withLinkaffiIntegration,
} from "@/lib/integrations/linkaffi/handler";
import { createLinkaffiInviteLink } from "@/lib/integrations/linkaffi/invite-links";
import {
  createInviteLinkSchema,
  parseOrThrow,
  readJsonBody,
} from "@/lib/integrations/linkaffi/schemas";

export const dynamic = "force-dynamic";

/**
 * `POST /api/integrations/linkaffi/v1/invite-links` (contrat § 1) : `{ campaignKey, campaignName, affiliateId,
 * affiliateName, channelId, attributionDays? }` → `{ inviteLinkId, url }` (+ `isActive`, `channelId`, `campaignKey`).
 * 201 : lien créé chez Telegram avec demande d'adhésion ; 200 : même clé + même canal, le lien existant.
 */
export const POST = withLinkaffiIntegration<
  RouteContext<"/api/integrations/linkaffi/v1/invite-links">
>("post_invite_links", async (req) => {
  const input = parseOrThrow(createInviteLinkSchema, await readJsonBody(req), "invalid_body");
  const r = await createLinkaffiInviteLink(input);
  return {
    status: r.status,
    body: r.link,
    entityType: "InviteLink",
    entityId: r.link.inviteLinkId,
    metadata: {
      campaignKey: input.campaignKey,
      channelId: input.channelId,
      affiliateId: input.affiliateId,
      created: r.status === 201,
      updated: r.updated,
      botId: r.botId,
    },
  };
});

/** Autres méthodes : 405 en JSON avec l'en-tête Allow (jamais une réponse vide). */
const notAllowed = linkaffiMethodNotAllowed(["POST"]);
export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
