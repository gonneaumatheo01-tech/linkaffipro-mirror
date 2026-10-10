import { NextResponse } from "next/server";
import { tiktokProvider } from "@linkaffipro/connectors";
import { createOAuthState, loadAppCredentials, redirectUriFor } from "@/lib/connectors/common";
import { requireUser } from "@/lib/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Départ de la connexion d'un compte TikTok (ADMIN) : état signé anti-CSRF, puis redirection vers le portail
 * d'autorisation TikTok. Aucun jeton ne transite ici.
 */
export async function GET(_req: Request) {
  const user = await requireUser();
  const back = (error: string) =>
    NextResponse.redirect(
      new URL(`/settings/connectors/tiktok?${new URLSearchParams({ error })}`, env.appBaseUrl),
    );
  if (user.role !== "ADMIN")
    return back("Seuls les administrateurs peuvent connecter un compte TikTok.");
  const app = await loadAppCredentials("TIKTOK");
  if (!app) return back("Enregistrez d'abord l'App ID et le secret de l'application TikTok.");
  if ((app.extra as { sandbox?: boolean } | undefined)?.sandbox) {
    return back(
      "En mode bac à sable, TikTok ne passe pas par la page de connexion : utilisez le formulaire « Connecter un compte bac à sable » avec le jeton généré dans le portail.",
    );
  }
  const state = createOAuthState("TIKTOK", user.id);
  return NextResponse.redirect(tiktokProvider.authorizeUrl(app, redirectUriFor("TIKTOK"), state));
}
