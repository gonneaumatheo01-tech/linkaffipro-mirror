/**
 * Phase 34, chantier F — reprise de la conversation avec Kevin après une autorisation Meta / TikTok ouverte par un de
 * ses liens. Deux morceaux :
 * - `kevinOAuthResume` : crochet appelé par la route de retour (callback) APRÈS la réussite (connexion en attente
 *   enregistrée) ; si l'autorisation venait d'un lien de Kevin (cookie de reprise), Kevin écrit dans la conversation
 *   d'origine avec un bouton par compte. La route garde exactement son comportement (même redirection) ; le cookie est
 *   effacé. Ne lève jamais ;
 * - `installBossAdAccountsPort` : enregistrement des comptes choisis par bouton, par les MÊMES fonctions que la page
 *   « Choisir les comptes » (`loadPending`, `saveConnections`, `clearPending`), `AuditLog` avec `via: TELEGRAM`.
 */
import type { NextResponse } from "next/server";
import { bossAdAccountsPort, setBossAdAccountsPort, startOAuthResume, type AgentsDeps } from "@linkaffipro/agents";
import { clearPending, loadPending, saveConnections, type ConnectorPlatform } from "@/lib/connectors/common";
import { cookieFromRequest, decodeResumeMark, KEVIN_OAUTH_COOKIE, RESUME_COOKIE_OPTIONS } from "./cookie";

type Deps = Pick<AgentsDeps, "prisma" | "now" | "logger" | "admin">;

async function defaultDeps(): Promise<Deps> {
  const { createBotAgentsDeps } = await import("@linkaffipro/telegram");
  return createBotAgentsDeps();
}

export async function kevinOAuthResume(
  req: Request,
  res: NextResponse,
  input: { platform: ConnectorPlatform; userId: string; accounts: Array<{ externalId: string; name: string }> },
  opts: { deps?: () => Promise<Deps>; now?: number } = {},
): Promise<{ resumed: boolean }> {
  try {
    const raw = cookieFromRequest(req, KEVIN_OAUTH_COOKIE);
    if (!raw) return { resumed: false };
    res.cookies.set(KEVIN_OAUTH_COOKIE, "", { ...RESUME_COOKIE_OPTIONS, maxAge: 0 });
    const mark = decodeResumeMark(raw, opts.now);
    if (!mark || mark.platform !== input.platform) return { resumed: false };
    // Le lien de Kevin était pour un compte du site précis : un autre utilisateur connecté ne reprend pas sa conversation.
    if (mark.linkUserId && mark.linkUserId !== input.userId) return { resumed: false };
    const deps = await (opts.deps ?? defaultDeps)();
    const r = await startOAuthResume(deps, { platform: input.platform, userId: input.userId, chatId: mark.chatId, accounts: input.accounts });
    return { resumed: r.sent };
  } catch (err) {
    console.error("[kevin] reprise après connexion", (err as Error).message);
    return { resumed: false };
  }
}

/** Branche l'enregistrement des comptes choisis par bouton (une fois par processus). */
export function installBossAdAccountsPort(): void {
  if (bossAdAccountsPort()) return;
  setBossAdAccountsPort(async ({ platform, userId, externalIds, final, telegramUserId }) => {
    const pending = await loadPending(platform, userId);
    if (!pending) return { ok: false, error: "connexion en attente expirée" };
    const chosen = new Set(externalIds);
    const accounts = pending.accounts.filter((a) => chosen.has(a.externalId));
    if (accounts.length === 0) return { ok: false, error: "compte introuvable" };
    await saveConnections(platform, userId, pending.tokens, accounts, { via: "TELEGRAM", telegramActorId: telegramUserId });
    if (final) await clearPending(platform, userId);
    return { ok: true, connected: accounts.length };
  });
}
