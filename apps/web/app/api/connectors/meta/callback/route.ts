import { NextResponse } from "next/server";
import { audit } from "@linkaffipro/db";
import { describeConnectorError, metaProvider } from "@linkaffipro/connectors";
import { auth } from "@/auth";
import {
  loadAppCredentials,
  redirectUriFor,
  savePending,
  verifyOAuthState,
} from "@/lib/connectors/common";

export const dynamic = "force-dynamic";

const SETTINGS_URL = "/settings/connectors/meta";
const CHOOSE_URL = "/settings/connectors/meta/choose";

function backWithError(req: Request, message: string): NextResponse {
  const url = new URL(SETTINGS_URL, req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

/**
 * GET /api/connectors/meta/callback : retour de Facebook Login (`?code=…&state=…` ou `?error=access_denied`).
 * Vérifie l'état signé (et que c'est bien le même utilisateur), échange le code contre un jeton longue durée,
 * liste les comptes publicitaires visibles, met le tout en attente (chiffré, 15 min) et envoie vers le choix des comptes.
 * Le jeton ne passe jamais dans une URL, un journal ni un message.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(SETTINGS_URL)}`, req.url),
    );
  if (session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Action réservée aux administrateurs." }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const state = verifyOAuthState(params.get("state"));
  if (!state || state.platform !== "META" || state.userId !== session.user.id) {
    return backWithError(
      req,
      "Connexion Meta interrompue (lien expiré ou invalide). Cliquez de nouveau sur « Connecter un compte Meta ».",
    );
  }

  const error = params.get("error");
  if (error) {
    const reason = params.get("error_reason") ?? params.get("error_description") ?? error;
    await audit({
      userId: session.user.id,
      action: "connector.oauth_denied",
      entityType: "ConnectorApp",
      entityId: "META",
      metadata: { reason },
    });
    return backWithError(
      req,
      reason === "user_denied" || error === "access_denied"
        ? "Connexion annulée chez Meta : aucune permission n'a été accordée. Recommencez et acceptez l'accès aux comptes publicitaires."
        : `Meta a refusé la connexion (${reason}).`,
    );
  }

  const code = params.get("code");
  if (!code) return backWithError(req, "Meta n'a pas renvoyé de code de connexion. Réessayez.");

  const app = await loadAppCredentials("META");
  if (!app)
    return backWithError(
      req,
      "Identifiants de l'application Meta absents : enregistrez-les d'abord.",
    );

  try {
    const tokens = await metaProvider.exchangeCode(app, code, redirectUriFor("META"));
    const accounts = await metaProvider.listAccounts(app, tokens);
    await savePending("META", session.user.id, { tokens, accounts });
    await audit({
      userId: session.user.id,
      action: "connector.oauth_completed",
      entityType: "ConnectorApp",
      entityId: "META",
      metadata: { accounts: accounts.length, expiresAt: tokens.expiresAt?.toISOString() ?? null },
    });
    if (accounts.length === 0) {
      return backWithError(
        req,
        "Connexion réussie, mais ce profil Facebook ne voit aucun compte publicitaire. Vérifiez qu'il a un rôle sur le compte (Business Manager → Personnes) et que la permission ads_read a été acceptée.",
      );
    }
    return NextResponse.redirect(new URL(CHOOSE_URL, req.url));
  } catch (err) {
    const message = describeConnectorError(err);
    await audit({
      userId: session.user.id,
      action: "connector.oauth_failed",
      entityType: "ConnectorApp",
      entityId: "META",
      metadata: { message },
    });
    return backWithError(req, `Connexion Meta impossible : ${message}`);
  }
}
