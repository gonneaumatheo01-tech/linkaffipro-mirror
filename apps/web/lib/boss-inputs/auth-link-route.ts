/**
 * Phase 34, chantier F — ouverture d'un lien d'autorisation de Kevin (`/k/<jeton>`, chemin public). Jeton inconnu,
 * expiré ou déjà utilisé → page simple « lien expiré, redemande-le à Kevin » (410). Sinon le lien est marqué utilisé
 * (effacé) PUIS la personne est redirigée selon son type. Aucune session n'est créée par le lien.
 */
import { NextResponse } from "next/server";
import { authLinkTarget, consumeAuthLink, type AuthLinkDeps } from "@linkaffipro/agents";
import { encodeResumeMark, KEVIN_OAUTH_COOKIE, newResumeMark, RESUME_COOKIE_OPTIONS } from "./cookie";

export type AuthLinkRouteDeps = {
  links: AuthLinkDeps;
  /** Session du site (null : pas connecté). */
  user: () => Promise<{ id: string; role: "ADMIN" | "MANAGER" } | null>;
  baseUrl: string;
};

const EXPIRED_HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Lien expiré</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#faf7f2;color:#1c1b2e;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:0;line-height:1.5}</style>
</head><body><main><h1>Ce lien a expiré</h1><p>Il a déjà servi ou il a plus de 15 minutes. Redemande-le à Kevin sur Telegram.</p></main></body></html>`;

export function expiredLinkResponse(): Response {
  return new Response(EXPIRED_HTML, {
    status: 410,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

export async function openAuthLink(token: string, deps: AuthLinkRouteDeps): Promise<Response> {
  const r = await consumeAuthLink(deps.links, token).catch(() => ({ ok: false as const, reason: "unknown" as const }));
  if (!r.ok) return expiredLinkResponse();
  const target = authLinkTarget(r.link);
  const to = (path: string) => {
    const res = NextResponse.redirect(new URL(path, deps.baseUrl), 303);
    res.headers.set("cache-control", "no-store");
    res.headers.set("referrer-policy", "no-referrer");
    return res;
  };
  if (target.kind === "redirect") return to(target.path);
  // Autorisation Meta / TikTok : la route de démarrage existante (session ADMIN exigée) ; sans session, la connexion
  // d'abord, puis retour sur le démarrage. Le cookie de reprise porte la conversation Telegram d'origine.
  const user = await deps.user().catch(() => null);
  const res = to(user ? target.startPath : `/login?callbackUrl=${encodeURIComponent(target.startPath)}`);
  res.cookies.set(KEVIN_OAUTH_COOKIE, encodeResumeMark(newResumeMark(target.platform, target.chatId, target.userId)), RESUME_COOKIE_OPTIONS);
  return res;
}
