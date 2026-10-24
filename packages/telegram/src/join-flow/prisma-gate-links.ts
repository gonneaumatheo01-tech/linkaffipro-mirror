/**
 * Accès base des liens des canaux à rejoindre (gate-links.ts), partagés par le webhook, le site (vérification d'une
 * règle, renvoi de l'accueil, point « À faire ») et le worker (rappels, alerte).
 */
import { ACTIVE_CHANNEL_BOT_WHERE, CHANNEL_BOT_WHERE, prisma, type MembershipStatus } from "@linkaffipro/db";
import type { GateBot, GateLinkApi, GateLinkDeps, GateLinkProblem } from "./gate-links";
import { gateCheckProblemsOf, gateProblemsOf } from "./gate-links";

/** Droit d'inviter par lien d'après les droits enregistrés (`ChannelBotAdmin.rights`) : propriétaire = oui. */
export function canInviteFromRights(rights: unknown): boolean | null {
  if (!rights || typeof rights !== "object") return null;
  const r = rights as Record<string, unknown>;
  if (r.status === "creator") return true;
  if (typeof r.can_invite_users === "boolean") return r.can_invite_users;
  return null;
}

/**
 * API d'un de nos bots dans le site et le webhook : l'instance grammY mise en cache (la même que celle des webhooks),
 * ce qui permet aux tests d'intercepter les appels comme pour le webhook. Import différé (pas de cycle avec factory).
 */
export async function webBotApi(botId: string): Promise<GateLinkApi | null> {
  const bot = await prisma.bot.findFirst({
    where: { id: botId, isActive: true, ...CHANNEL_BOT_WHERE },
    // Mode et persona : l'instance en cache reste celle du webhook (handlers du bon mode, phase 17).
    select: {
      id: true,
      name: true,
      username: true,
      telegramBotId: true,
      vertical: true,
      tokenEncrypted: true,
      mode: true,
      personaId: true,
    },
  });
  if (!bot) return null;
  const [{ getOrCreateBot }, { prismaTelegramDeps }] = await Promise.all([
    import("../factory"),
    import("../prisma-deps"),
  ]);
  return getOrCreateBot(bot, prismaTelegramDeps).api;
}

/**
 * Statuts d'une demande qui satisfont un canal obligatoire (« ✅ J'ai rejoint ») : en cours ou acceptée. Telegram
 * répond « left » pour une demande en attente.
 */
export const GATE_SATISFYING_STATUSES: readonly MembershipStatus[] = [
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "APPROVED",
];

/**
 * Dépendances Prisma des liens GATE. `apiFor` : API d'un bot (site / webhook : `webBotApi` ; worker : son propre
 * cache d'API) ; `warn` : journal des échecs (console par défaut).
 */
export function createPrismaGateLinkDeps(
  opts: {
    apiFor?: (botId: string) => Promise<GateLinkApi | null>;
    warn?: GateLinkDeps["warn"];
  } = {},
): GateLinkDeps {
  return {
    async findGateLink(sourceChannelId, gateChannelId, opts = {}) {
      // Lien valide : actif, du bon type (avec demande d'adhésion depuis la phase 11, sauf canal à rejoindre
      // désactivé), créé par un bot actif qui n'a pas perdu ses droits sur le canal à rejoindre ; `botId` : créé par
      // ce bot (celui qui traite les demandes du canal à rejoindre).
      const link = await prisma.inviteLink.findFirst({
        where: {
          channelId: gateChannelId,
          kind: "GATE",
          sourceChannelId,
          isActive: true,
          createsJoinRequest: opts.createsJoinRequest ?? true,
          ...(opts.botId ? { botId: opts.botId } : {}),
          // Phase 17 : jamais un lien d'un bot assistant de conversation (il ne traite pas les demandes).
          bot: {
            ...ACTIVE_CHANNEL_BOT_WHERE,
            channelAdmins: { none: { channelId: gateChannelId, revokedAt: { not: null } } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { telegramInviteLink: true },
      });
      return link?.telegramInviteLink ?? null;
    },
    async saveGateLink({ sourceChannelId, gate, botId, url, createsJoinRequest }) {
      await prisma.inviteLink
        .create({
          data: {
            channelId: gate.id,
            botId,
            telegramInviteLink: url,
            name: `gate:${sourceChannelId}`,
            kind: "GATE",
            createsJoinRequest,
            sourceChannelId,
            language: gate.language,
          },
        })
        .catch((err: unknown) =>
          console.warn("[join-flow] lien GATE non enregistré", {
            gateChannelId: gate.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    },
    async adminBots(channelId) {
      // Phase 17 : un bot assistant de conversation ne crée jamais de lien de canal à rejoindre.
      const rows = await prisma.channelBotAdmin.findMany({
        where: { channelId, revokedAt: null, bot: ACTIVE_CHANNEL_BOT_WHERE },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { botId: true, rights: true, bot: { select: { username: true } } },
      });
      return rows.map((r): GateBot => ({
        botId: r.botId,
        username: r.bot.username,
        canInvite: canInviteFromRights(r.rights),
      }));
    },
    async requestedChannelIds(memberId, channelIds) {
      if (channelIds.length === 0) return [];
      // Dernière demande du membre dans chaque canal (un membre qui revient crée une nouvelle demande).
      const rows = await prisma.membership.findMany({
        where: { memberId, channelId: { in: channelIds } },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: { channelId: true, status: true },
      });
      const latest = new Map<string, MembershipStatus>();
      for (const r of rows) if (!latest.has(r.channelId)) latest.set(r.channelId, r.status);
      return channelIds.filter((id) => {
        const st = latest.get(id);
        return st !== undefined && GATE_SATISFYING_STATUSES.includes(st);
      });
    },
    apiFor: opts.apiFor ?? webBotApi,
    ...(opts.warn ? { warn: opts.warn } : {}),
  };
}

/** Demande encore en attente bloquée par des canaux à rejoindre (liens manquants ou vérification impossible). */
export type GateLinksMissingRow = {
  membershipId: string;
  channelId: string;
  channelTitle: string;
  status: string;
  requestedAt: Date;
  /** Canaux concernés : sans lien (`reason` « no_link » ou absente) ou impossibles à vérifier (« cannot_verify »). */
  missing: GateLinkProblem[];
};

/** Explication d'un canal absent de l'accueil d'une demande enregistrée avant la correction du 11 octobre. */
export const LEGACY_GATE_ERROR =
  "accueil envoyé sans le lien de ce canal (avant la correction du 11 octobre)";

/** Canaux de la règle absents des boutons d'une demande au format d'avant la correction (`gateLinksMissing` absent). */
function legacyProblems(raw: unknown, sourceBot: string | null): GateLinkProblem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (g): g is { channelId: string; title: string } =>
        !!g &&
        typeof g === "object" &&
        typeof (g as { channelId?: unknown }).channelId === "string" &&
        typeof (g as { title?: unknown }).title === "string",
    )
    .map((g) => ({
      channelId: g.channelId,
      title: g.title,
      error: LEGACY_GATE_ERROR,
      tried: [],
      suggestedBot: sourceBot,
      reason: "no_link" as const,
    }));
}

/** Un canal n'apparaît qu'une fois : le lien manquant passe avant la vérification impossible. */
function mergeProblems(...lists: GateLinkProblem[][]): GateLinkProblem[] {
  const out: GateLinkProblem[] = [];
  for (const p of lists.flat()) if (!out.some((o) => o.channelId === p.channelId)) out.push(p);
  return out;
}

/**
 * Demandes en attente (canal actif) bloquées par des canaux à rejoindre, les plus anciennes d'abord. Lu par le point
 * « À faire » de l'accueil, le bouton « Renvoyer l'accueil avec les liens » et l'alerte du worker :
 * - accueil parti sans tous les liens (`source.gateLinksMissing` non vide) ;
 * - canal obligatoire qu'aucun de nos bots ne peut vérifier au « ✅ J'ai rejoint » (`source.gateCheckFailed` non vide) ;
 * - demande enregistrée avant la correction du 11 octobre (aucune trace `gateLinksMissing`), en attente des canaux
 *   obligatoires de sa règle, dont l'accueil n'avait pas le bouton de certains canaux (`source.gates` incomplet) :
 *   jamais marquée par l'ancien code, elle restait bloquée sans rien signaler.
 */
export async function listGateLinksMissing(
  opts: { channelId?: string; limit?: number } = {},
): Promise<GateLinksMissingRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const channelId = opts.channelId ?? null;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      channelId: string;
      title: string;
      status: string;
      requestedAt: Date;
      missing: unknown;
      checkFailed: unknown;
      legacyMissing: unknown;
      sourceBot: string | null;
    }>
  >`
    SELECT m.id, m."channelId", c.title, m.status::text AS status, m."requestedAt",
           m.source->'gateLinksMissing' AS missing,
           m.source->'gateCheckFailed' AS "checkFailed",
           legacy.missing AS "legacyMissing",
           b.username AS "sourceBot"
    FROM "Membership" m
    JOIN "Channel" c ON c.id = m."channelId" AND c."isActive"
    LEFT JOIN "Bot" b ON b.id = m.source->>'botId'
    LEFT JOIN "ApprovalRule" r ON r.id = m."approvalRuleId"
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('channelId', g.id, 'title', g.title) ORDER BY e.ord) AS missing
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(r."gateChannelIds") = 'array' THEN r."gateChannelIds" ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS e(id, ord)
      JOIN "Channel" g ON g.id = e.id
      WHERE m.status = 'PENDING_GATE'
        AND m.source->'gateLinksMissing' IS NULL
        AND r."gateMode" = 'REQUIRED'
        AND e.id <> m."channelId"
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(m.source->'gates') = 'array' THEN m.source->'gates' ELSE '[]'::jsonb END
               ) AS sg
          WHERE sg->>'channelId' = e.id
        )
    ) legacy ON true
    WHERE m.status IN ('REQUESTED', 'PENDING_GATE', 'SCHEDULED')
      AND (
        (jsonb_typeof(m.source->'gateLinksMissing') = 'array'
          AND jsonb_array_length(m.source->'gateLinksMissing') > 0)
        OR (jsonb_typeof(m.source->'gateCheckFailed') = 'array'
          AND jsonb_array_length(m.source->'gateCheckFailed') > 0)
        OR legacy.missing IS NOT NULL
      )
      AND (${channelId}::text IS NULL OR m."channelId" = ${channelId}::text)
    ORDER BY m."requestedAt" ASC, m.id ASC
    LIMIT ${limit}`;
  return rows
    .map((r) => ({
      membershipId: r.id,
      channelId: r.channelId,
      channelTitle: r.title,
      status: r.status,
      requestedAt: r.requestedAt,
      missing: mergeProblems(
        gateProblemsOf({ gateLinksMissing: r.missing }),
        legacyProblems(r.legacyMissing, r.sourceBot),
        gateCheckProblemsOf({ gateCheckFailed: r.checkFailed }),
      ),
    }))
    .filter((r) => r.missing.length > 0);
}
