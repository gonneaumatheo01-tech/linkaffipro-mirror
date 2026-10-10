import { NextResponse } from "next/server";
import { audit } from "@linkaffipro/db";
import { metaProvider } from "@linkaffipro/connectors";
import { apiUser } from "@/lib/ai/api-user";
import { createOAuthState, loadAppCredentials, redirectUriFor } from "@/lib/connectors/common";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const SETTINGS_URL = "/settings/connectors/meta";

/**
 * GET /api/connectors/meta/start : démarre la connexion d'un compte Meta.
 * ADMIN seulement (403 sinon). Crée l'état signé anti-CSRF (10 min) puis redirige vers le dialogue Facebook Login.
 */
export async function GET(_req: Request) {
  const user = await apiUser();
  if (!user)
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(SETTINGS_URL)}`, env.appBaseUrl),
    );
  if (user.role !== "ADMIN")
    return NextResponse.json({ error: "Action réservée aux administrateurs." }, { status: 403 });

  const app = await loadAppCredentials("META");
  if (!app) {
    const back = new URL(SETTINGS_URL, env.appBaseUrl);
    back.searchParams.set(
      "error",
      "Enregistrez d'abord l'App ID et l'App Secret de votre application Meta (bloc « Application Meta »).",
    );
    return NextResponse.redirect(back);
  }

  const state = createOAuthState("META", user.id);
  const url = metaProvider.authorizeUrl(app, redirectUriFor("META"), state);
  await audit({
    userId: user.id,
    action: "connector.oauth_started",
    entityType: "ConnectorApp",
    entityId: "META",
  });
  return NextResponse.redirect(url);
}
