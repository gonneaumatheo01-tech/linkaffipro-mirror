/**
 * Phase 34, chantier A — acteur d'une opération du site. Le bouton du site appelle `webActor(user)` (session vérifiée
 * par `requireUser` / `requireAdmin`) ; Kevin passe par l'entrée interne signée, où le rôle est relu en base
 * (`resolveSiteActor`). Les cœurs vérifient leurs droits par `requireRole` (phrase française, code `forbidden`).
 */
import type { SiteOpActor, SiteOpResult, SiteOpRole } from "@linkaffipro/agents";
import type { CurrentUser } from "@/lib/session";

export function webActor(user: Pick<CurrentUser, "id" | "role">): SiteOpActor {
  return { userId: user.id, role: user.role === "ADMIN" ? "ADMIN" : "MANAGER", via: "WEB", telegramUserId: null };
}

const RANK: Record<SiteOpRole, number> = { MANAGER: 1, ADMIN: 2 };

/** Le rôle `a` couvre-t-il `b` (ADMIN ≥ MANAGER) ? */
export function roleCovers(a: SiteOpRole, b: SiteOpRole): boolean {
  return RANK[a] >= RANK[b];
}

/** Refus si l'acteur n'a pas le rôle demandé, sinon null. */
export function requireRole(actor: Pick<SiteOpActor, "role">, role: SiteOpRole): Extract<SiteOpResult, { ok: false }> | null {
  if (roleCovers(actor.role, role)) return null;
  return { ok: false, code: "forbidden", error: role === "ADMIN" ? "Action réservée aux administrateurs." : "Action réservée à l'équipe." };
}
