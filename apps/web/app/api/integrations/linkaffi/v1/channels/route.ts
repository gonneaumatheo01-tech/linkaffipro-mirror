import { listProposableChannels } from "@/lib/integrations/linkaffi/channels";
import {
  linkaffiMethodNotAllowed,
  withLinkaffiIntegration,
} from "@/lib/integrations/linkaffi/handler";

export const dynamic = "force-dynamic";

/**
 * `GET /api/integrations/linkaffi/v1/channels` (contrat `docs/LINKAFFI-PARTENAIRES.md` § 1) : canaux proposables pour
 * une campagne Telegram d'affilié, `[{ id, title, username, vertical, isActive }]`.
 */
export const GET = withLinkaffiIntegration<RouteContext<"/api/integrations/linkaffi/v1/channels">>(
  "get_channels",
  async () => {
    const channels = await listProposableChannels();
    return { body: channels, metadata: { count: channels.length } };
  },
);

/** Autres méthodes : 405 en JSON avec l'en-tête Allow (jamais une réponse vide). */
const notAllowed = linkaffiMethodNotAllowed(["GET"]);
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
