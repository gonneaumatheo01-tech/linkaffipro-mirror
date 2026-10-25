/**
 * Phase 34, chantier A — exécution d'une opération du site demandée par Kevin (entrée interne signée, ou client en
 * processus du webhook). L'acteur vient de la demande, mais son rôle est RELU EN BASE : compte du site actif avec ce
 * rôle, admin lié au compte Telegram (`Setting admin.telegramUserId`), ou membre présenté de l'équipe (`TeamMember`,
 * MEMBER = lecture seulement). Jamais un rôle plus haut que celui en base. Toute exception → `unavailable`, sans pile.
 */
import { siteOp, type SiteOpActor, type SiteOpResult, type SiteOpRole } from "@linkaffipro/agents";
import { roleCovers } from "./actor";
import { siteOpImpl } from "./registry";

/** Lecture minimale de la base (injectée par les tests). */
export type SiteOpsDb = {
  setting: { findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null> };
  user: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; role: string; isActive: boolean; telegramUserId: bigint | null } | null>;
    findFirst(args: { where: { telegramUserId: bigint; isActive: boolean; role?: string } }): Promise<{ id: string; role: string } | null>;
  };
  teamMember: { findUnique(args: { where: { telegramUserId: bigint } }): Promise<{ role: string; removedAt: Date | null } | null> };
};

export type SiteOpRequest = { op: string; input: Record<string, unknown>; actor: SiteOpActor; dryRun?: boolean };

type Level = SiteOpRole | "READ";
const LEVEL_RANK: Record<Level, number> = { READ: 0, MANAGER: 1, ADMIN: 2 };
const minLevel = (a: Level, b: Level): Level => (LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b);
const roleLevel = (r: string): Level | null => (r === "ADMIN" ? "ADMIN" : r === "MANAGER" ? "MANAGER" : r === "MEMBER" ? "READ" : null);

const FORBIDDEN: Extract<SiteOpResult, { ok: false }> = { ok: false, code: "forbidden", error: "Action non autorisée pour ce compte." };

/** Acteur revérifié en base, ou null (inconnu, inactif, rôle remonté). `readOnly` : membre simple de l'équipe. */
export async function resolveSiteActor(db: SiteOpsDb, claimed: SiteOpActor): Promise<{ actor: SiteOpActor; readOnly: boolean } | null> {
  if (!claimed || (claimed.role !== "ADMIN" && claimed.role !== "MANAGER")) return null;
  const tgRaw = typeof claimed.telegramUserId === "string" && /^\d{1,20}$/.test(claimed.telegramUserId) ? claimed.telegramUserId : null;
  const tg = tgRaw ? BigInt(tgRaw) : null;
  let level: Level | null = null;
  let userId: string | null = null;
  if (claimed.userId) {
    const user = await db.user.findUnique({ where: { id: claimed.userId } });
    if (!user || !user.isActive) return null;
    if (tg !== null && user.telegramUserId !== null && user.telegramUserId !== tg) return null;
    level = roleLevel(user.role);
    if (!level) return null;
    userId = user.id;
  }
  if (tg !== null) {
    const admin = await db.setting.findUnique({ where: { key: "admin.telegramUserId" } });
    const adminTg = typeof admin?.value === "string" && /^\d+$/.test(admin.value) ? BigInt(admin.value) : null;
    let tgLevel: Level | null = null;
    if (adminTg !== null && adminTg === tg) {
      tgLevel = "ADMIN";
      if (!userId) userId = (await db.user.findFirst({ where: { telegramUserId: tg, isActive: true, role: "ADMIN" } }))?.id ?? null;
    } else {
      const member = await db.teamMember.findUnique({ where: { telegramUserId: tg } });
      tgLevel = member && !member.removedAt ? roleLevel(member.role) : null;
    }
    if (!tgLevel) return null;
    level = level ? minLevel(level, tgLevel) : tgLevel;
  }
  if (!level) return null;
  // Jamais un rôle plus haut que celui en base.
  if (level === "READ" ? claimed.role !== "MANAGER" : !roleCovers(level, claimed.role)) return null;
  return { actor: { userId, role: claimed.role, via: "TELEGRAM", telegramUserId: tgRaw }, readOnly: level === "READ" };
}

/** Exécute une opération pour Kevin (mêmes cœurs que le site). Ne lève jamais. */
export async function executeSiteOp(db: SiteOpsDb, req: SiteOpRequest, log: (msg: string, meta?: Record<string, unknown>) => void = () => undefined): Promise<SiteOpResult> {
  try {
    const meta = siteOp(req.op);
    const impl = siteOpImpl(req.op);
    if (!meta || !impl) return { ok: false, code: "not_found", error: "Opération inconnue." };
    const resolved = await resolveSiteActor(db, req.actor);
    if (!resolved) return FORBIDDEN;
    if (resolved.readOnly && meta.kind !== "read") return FORBIDDEN;
    if (!roleCovers(resolved.actor.role, meta.role)) return FORBIDDEN;
    const input = req.input && typeof req.input === "object" && !Array.isArray(req.input) ? req.input : {};
    return await impl.run(input, resolved.actor, { dryRun: req.dryRun === true });
  } catch (err) {
    log("[site-ops] opération en échec", { op: String(req?.op ?? "").slice(0, 80), err: (err as Error)?.message?.slice(0, 200) });
    return { ok: false, code: "unavailable", error: "Le site n'a pas pu faire l'opération." };
  }
}
