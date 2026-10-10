import { NextResponse } from "next/server";
import { audit } from "@linkaffipro/db";
import { describeConnectorError, tiktokProvider } from "@linkaffipro/connectors";
import {
  loadAppCredentials,
  redirectUriFor,
  savePending,
  verifyOAuthState,
} from "@/lib/connectors/common";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Retour de TikTok après autorisation : `?auth_code=…&state=…` (certaines versions nomment le paramètre `code`).
 * Vérifie l'état signé, échange le code contre un jeton, liste les annonceurs accessibles, met le tout en attente
 * (chiffré, 15 minutes) et envoie vers la page de choix des comptes. Le jeton n'apparaît jamais dans une URL ni un journal.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const fail = (error: string) =>
    NextResponse.redirect(
      new URL(`/settings/connectors/tiktok?${new URLSearchParams({ error })}`, req.url),
    );

  const state = verifyOAuthState(url.searchParams.get("state"));
  if (!state || state.platform !== "TIKTOK" || state.userId !== user.id) {
    return fail(
      "La connexion a expiré ou ne correspond pas à votre session : recommencez depuis le bouton « Connecter un compte TikTok ».",
    );
  }
  if (user.role !== "ADMIN")
    return fail("Seuls les administrateurs peuvent connecter un compte TikTok.");

  const platformError = url.searchParams.get("error") ?? url.searchParams.get("error_description");
  const code = url.searchParams.get("auth_code") ?? url.searchParams.get("code");
  if (!code) {
    return fail(
      platformError
        ? `TikTok a refusé la connexion : ${platformError.slice(0, 200)}.`
        : "TikTok n'a pas renvoyé de code d'autorisation : recommencez.",
    );
  }

  const app = await loadAppCredentials("TIKTOK");
  if (!app) return fail("Identifiants de l'application TikTok absents : enregistrez-les d'abord.");

  try {
    const tokens = await tiktokProvider.exchangeCode(app, code, redirectUriFor("TIKTOK"));
    const accounts = await tiktokProvider.listAccounts(app, tokens);
    if (accounts.length === 0) {
      return fail(
        "Connexion réussie mais aucun compte publicitaire TikTok n'est visible avec ce profil : vérifiez que vous avez autorisé au moins un annonceur sur la page TikTok.",
      );
    }
    await savePending("TIKTOK", user.id, { tokens, accounts });
    await audit({
      userId: user.id,
      action: "connector.oauth_completed",
      entityType: "ConnectorApp",
      entityId: "TIKTOK",
      metadata: { platform: "TIKTOK", accounts: accounts.length },
    });
    return NextResponse.redirect(new URL("/settings/connectors/tiktok/choose", req.url));
  } catch (err) {
    return fail(`Connexion TikTok impossible : ${describeConnectorError(err).slice(0, 300)}`);
  }
}
