import { audit, prisma, toJsonValue } from "@linkaffipro/db";
import { authenticateLinkaffi, LINKAFFI_PROVIDER, unauthorizedMessage } from "./auth";
import { IntegrationError, integrationError, integrationJson } from "./http";
import {
  LINKAFFI_RATE_LIMIT,
  LINKAFFI_RATE_WINDOW_MS,
  linkaffiRateStore,
  type RateLimitStore,
} from "./rate-limit";

/**
 * Enveloppe commune des routes de l'API d'intégration Link Affi (`/api/integrations/linkaffi/v1/*`) :
 * 1. clé `Authorization: Bearer` vérifiée par son empreinte (401 sinon) ;
 * 2. 60 requêtes par minute et par clé (par adresse IP pour un appel sans clé valide) : 429 + `Retry-After` ;
 * 3. `IntegrationKey.lastApiCallAt` mis à jour à chaque appel authentifié ;
 * 4. erreurs prévues (`IntegrationError`) en `{ error, message }` français ; imprévues en 500 sans détail interne ;
 * 5. chaque appel journalisé dans `AuditLog` (`userId` null, action `integration.linkaffi.<route>`, statut, durée,
 *    identifiants utiles ; jamais la clé ni les en-têtes). Un refus 429 n'est journalisé qu'une fois par série.
 */

/**
 * Routes de l'API (suffixe de l'action du journal : `integration.linkaffi.<route>`). `unknown_route` : adresse inconnue
 * (404) ou méthode non prévue sur une adresse connue (405).
 */
export type LinkaffiIntegrationRoute =
  "get_channels" | "post_invite_links" | "patch_invite_link" | "get_members" | "unknown_route";

/** Résultat d'une route : corps JSON et éléments du journal. */
export type LinkaffiRouteResult = {
  status?: number;
  body: unknown;
  entityType?: string;
  entityId?: string;
  /** Ajouté aux métadonnées du journal (identifiants, comptes ; jamais de secret). */
  metadata?: Record<string, unknown>;
};

export type LinkaffiHandlerDeps = {
  rateStore?: RateLimitStore;
  now?: () => number;
};

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";
}

function pathOf(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "";
  }
}

async function lookupKey(apiKeyHash: string) {
  return prisma.integrationKey.findUnique({
    where: { apiKeyHash },
    select: { provider: true, apiKeyHash: true },
  });
}

export function withLinkaffiIntegration<C>(
  route: LinkaffiIntegrationRoute,
  handler: (req: Request, ctx: C) => Promise<LinkaffiRouteResult>,
  deps: LinkaffiHandlerDeps = {},
): (req: Request, ctx: C) => Promise<Response> {
  const run = async (req: Request, ctx: C): Promise<Response> => {
    const now = deps.now ?? Date.now;
    const started = now();
    const store = deps.rateStore ?? linkaffiRateStore();
    const action = `integration.linkaffi.${route}`;
    const base = { method: req.method, path: pathOf(req) };
    const journal = (status: number, extra: Record<string, unknown> = {}, entity = {}) =>
      audit({
        userId: null,
        action,
        ...entity,
        metadata: toJsonValue({ ...base, status, durationMs: now() - started, ...extra }),
      });

    const auth = await authenticateLinkaffi(req.headers.get("authorization"), lookupKey);
    const bucket = auth.ok ? `key:${auth.keyHash.slice(0, 24)}` : `ip:${clientIp(req)}`;
    const rate = await store.hit(bucket, now(), LINKAFFI_RATE_LIMIT, LINKAFFI_RATE_WINDOW_MS);
    if (!rate.allowed) {
      if (rate.firstRefusal) await journal(429, { error: "rate_limited", authenticated: auth.ok });
      return integrationError(
        new IntegrationError(
          429,
          "rate_limited",
          `Trop de requêtes : ${LINKAFFI_RATE_LIMIT} par minute au plus. Réessayez dans ${rate.retryAfterSec} seconde${rate.retryAfterSec > 1 ? "s" : ""}.`,
          { "Retry-After": String(rate.retryAfterSec) },
        ),
      );
    }
    if (!auth.ok) {
      await journal(401, { error: "unauthorized", reason: auth.reason });
      return integrationError(
        new IntegrationError(401, "unauthorized", unauthorizedMessage(auth.reason), {
          "WWW-Authenticate": 'Bearer realm="linkaffipro"',
        }),
      );
    }

    await prisma.integrationKey
      .update({ where: { provider: LINKAFFI_PROVIDER }, data: { lastApiCallAt: new Date(now()) } })
      .catch(() => undefined);

    try {
      const r = await handler(req, ctx);
      const status = r.status ?? 200;
      await journal(
        status,
        r.metadata ?? {},
        r.entityType ? { entityType: r.entityType, entityId: r.entityId } : {},
      );
      return integrationJson(r.body, status);
    } catch (err) {
      if (err instanceof IntegrationError) {
        await journal(err.status, {
          error: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        });
        return integrationError(err);
      }
      console.error(`[integration linkaffi] ${route} : erreur imprévue`, err);
      await journal(500, {
        error: "internal_error",
        message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
      });
      return internalError();
    }
  };
  // Base ou Redis en panne avant même la route (clé, limite) : 500 en JSON, jamais une page d'erreur du site.
  return async (req, ctx) => {
    try {
      return await run(req, ctx);
    } catch (err) {
      console.error(`[integration linkaffi] ${route} : panne avant la route`, err);
      return internalError();
    }
  };
}

function internalError(): Response {
  return integrationError(
    new IntegrationError(
      500,
      "internal_error",
      "Erreur interne de la plateforme : réessayez dans une minute. Si elle revient, prévenez l'équipe de la plateforme.",
    ),
  );
}

/**
 * Méthode non prévue sur une adresse de l'API (ex. `GET /invite-links`) : 405 en JSON `{ error, message }` avec
 * l'en-tête `Allow`, au lieu de la réponse vide de Next. Même enveloppe que les routes (clé, limite, journal
 * `integration.linkaffi.unknown_route`). À exporter pour chaque méthode absente d'un fichier de route.
 */
export function linkaffiMethodNotAllowed(
  allow: readonly string[],
  deps: LinkaffiHandlerDeps = {},
): (req: Request, ctx: unknown) => Promise<Response> {
  const list = allow.join(", ");
  return withLinkaffiIntegration<unknown>(
    "unknown_route",
    async (req) => {
      throw new IntegrationError(
        405,
        "method_not_allowed",
        `Méthode ${req.method} non prévue sur cette adresse : utilisez ${allow.join(" ou ")}.`,
        { Allow: list },
      );
    },
    deps,
  );
}

/** Adresse inconnue sous l'API : 404 en JSON (jamais une page du site), avec la liste des adresses ; journalisée. */
export function linkaffiNotFound(
  deps: LinkaffiHandlerDeps = {},
): (req: Request, ctx: unknown) => Promise<Response> {
  return withLinkaffiIntegration<unknown>(
    "unknown_route",
    async () => {
      throw new IntegrationError(
        404,
        "not_found",
        "Adresse inconnue. Adresses disponibles : GET /channels, POST /invite-links, PATCH /invite-links/{inviteLinkId}, GET /members.",
      );
    },
    deps,
  );
}
