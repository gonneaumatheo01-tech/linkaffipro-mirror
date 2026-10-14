import {
  linkaffiMethodNotAllowed,
  withLinkaffiIntegration,
} from "@/lib/integrations/linkaffi/handler";
import { IntegrationError } from "@/lib/integrations/linkaffi/http";
import { patchLinkaffiInviteLink } from "@/lib/integrations/linkaffi/invite-links";
import {
  parseOrThrow,
  patchInviteLinkSchema,
  readJsonBody,
} from "@/lib/integrations/linkaffi/schemas";

export const dynamic = "force-dynamic";

/**
 * `PATCH /api/integrations/linkaffi/v1/invite-links/{inviteLinkId}` (contrat § 1) : `{ isActive: false }` désactive le
 * lien et le révoque chez Telegram (par le bot qui l'a créé) ; les membres déjà amenés restent à l'affilié.
 * `{ isActive: true }` sur un lien désactivé : refusé (409), une nouvelle campagne reçoit un nouveau lien.
 */
export const PATCH = withLinkaffiIntegration<
  RouteContext<"/api/integrations/linkaffi/v1/invite-links/[inviteLinkId]">
>("patch_invite_link", async (req, ctx) => {
  const { inviteLinkId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(inviteLinkId))
    throw new IntegrationError(
      404,
      "invite_link_not_found",
      "Lien inconnu : vérifiez l'identifiant renvoyé par POST /invite-links.",
    );
  const input = parseOrThrow(patchInviteLinkSchema, await readJsonBody(req), "invalid_body");
  const r = await patchLinkaffiInviteLink(inviteLinkId, input.isActive);
  return {
    body: { ...r.link, message: r.message },
    entityType: "InviteLink",
    entityId: inviteLinkId,
    metadata: {
      campaignKey: r.link.campaignKey,
      isActive: r.link.isActive,
      changed: r.changed,
      revokedOnTelegram: r.link.revokedOnTelegram,
    },
  };
});

/** Autres méthodes : 405 en JSON avec l'en-tête Allow (jamais une réponse vide). */
const notAllowed = linkaffiMethodNotAllowed(["PATCH"]);
export const GET = notAllowed;
export const POST = notAllowed;
export const PUT = notAllowed;
export const DELETE = notAllowed;
