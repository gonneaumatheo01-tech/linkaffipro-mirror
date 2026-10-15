/**
 * Validation automatique des canaux obligatoires avec la base (phase 14) : filet du worker, rattrapage unique, état des
 * canaux d'une demande et joignabilité, partagés par le worker, le site et `pnpm db:phase14`.
 * La logique est dans auto-gate.ts (testée sans base) ; ici seulement les lectures et écritures Prisma.
 */
import { prisma, toJsonValue } from "@linkaffipro/db";
import {
  evaluateMembershipGates,
  sweepPendingGates,
  type GateSweepOptions,
  type GateSweepReport,
} from "./auto-gate";
import { NO_TELEGRAM_CALLS, perBotBudget, type GateLinkApi, type GateLinkDeps } from "./gate-links";
import { createPrismaJoinFlowDeps } from "./prisma-deps";
import { reachability, type Reachability } from "./reachability";
import {
  rewriteDefaultJoinRequestTexts,
  type Phase14TextsReport,
} from "../sequences/phase14-texts";

/** API des bots et journal : le worker passe les siens, le site et les scripts gardent ceux par défaut. */
export type PrismaAutoGateOptions = {
  apiFor?: (botId: string) => Promise<GateLinkApi | null>;
  warn?: GateLinkDeps["warn"];
};

function depsOf(opts: PrismaAutoGateOptions) {
  return createPrismaJoinFlowDeps({
    ...(opts.apiFor ? { apiFor: opts.apiFor } : {}),
    ...(opts.warn ? { warn: opts.warn } : {}),
  });
}

/** Filet de la validation automatique avec la base (worker, toutes les 2 minutes : demandes de moins de 7 jours). */
export async function runGateSweepWithDb(
  opts: GateSweepOptions & PrismaAutoGateOptions = {},
): Promise<GateSweepReport> {
  return sweepPendingGates(depsOf(opts), opts);
}

/** Marque du rattrapage unique de la phase 14 (`Setting`), écrite à la fin du premier passage réussi. */
export const GATE_BACKFILL_KEY = "phase14.gateBackfill";

export type GateBackfillResult = {
  /**
   * Déjà fait (marque présente) : aucune demande revérifiée, le résultat enregistré est rendu (seules les réparations
   * manquantes à une marque plus ancienne tournent, une fois).
   */
  alreadyDone: boolean;
  doneAt: string;
  /** Qui l'a lancé : le script `pnpm db:phase14` ou la tâche du worker. */
  by: "script" | "worker";
  /** Demandes en attente des canaux relues. */
  checked: number;
  /** Demandes passées en acceptation programmée (canaux obligatoires tous rejoints). */
  satisfied: number;
  satisfiedIds: string[];
  /** Demandes encore en attente des canaux après le passage. */
  stillPending: number;
  /** Demandes pas entièrement vérifiées (limite d'appels, 429) : le filet du worker les reprend s'il le peut. */
  deferred: number;
  /** Demandes dont la règle n'a plus de canaux à rejoindre (laissées au choix de l'équipe). */
  withoutGates: number;
  errors: number;
  /** Demandes validées par canal. */
  byChannel: Array<{ channelId: string; title: string; satisfied: number }>;
  /** États « joignable / a bloqué le bot » hérités d'avant la phase 14, réparés (`repairBotStatesForPhase14`). */
  botStates: BotStateRepair;
  /** Accueils par défaut réécrits sans « ✅ J'ai rejoint » (`rewriteDefaultJoinRequestTexts`). */
  sequenceTexts: Phase14TextsReport;
};

function objectOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** États des membres réparés par le rattrapage de la phase 14. */
export type BotStateRepair = {
  /** « Joignable » sans avoir jamais démarré le bot (accueil parti dans la fenêtre de 5 minutes) : plus joignable. */
  canDmCleared: number;
  /** « A bloqué le bot » posé par un refus qui n'était pas un blocage (« can't initiate conversation »…) : effacé. */
  blockedCleared: number;
  /**
   * « Joignable » sans « Démarrer » mais la personne a écrit au bot en privé (« ok », une photo…) : Telegram laisse le
   * bot lui écrire, elle reste joignable (date de son premier message, comme `memberWrote` depuis la phase 14).
   */
  wroteKept: number;
};

/**
 * Répare les états « joignable / a bloqué le bot » (`MemberBotState`) écrits avant la phase 14 (décisions E1, E2) :
 * - un accueil parti dans la fenêtre de 5 minutes d'une demande créait `canDm = true` sans « Démarrer » (`startedAt`
 *   vide) : la fiche membre affichait « Joignable par le bot » et « Écrire à un groupe » visait ces personnes, puis
 *   Telegram refusait. `canDm` repasse à faux (la personne redevient joignable dès qu'elle démarre le bot ou lui
 *   écrit), sauf si elle a déjà écrit au bot en privé (mise à jour `telegram.message` journalisée de sa conversation
 *   avec ce bot) : elle reste joignable, `startedAt` = son premier message ;
 * - tout refus 403 posait `blockedAt` (« A bloqué le bot »), même « bot can't initiate conversation with a user » : la
 *   date de blocage est effacée (`canDm` reste faux) quand Telegram n'a jamais signalé de vrai blocage pour ce bot,
 *   c'est-à-dire ni événement `member.blocked` (mise à jour `my_chat_member`, reçue depuis la phase 0), ni
 *   `dm.blocked` avec l'erreur « bot was blocked by the user » (depuis la phase 14). Les membres supprimés (anonymisés)
 *   gardent leur marque : plus jamais de message.
 * Relançable sans risque : après la phase 14, plus rien n'écrit ces états-là.
 */
export async function repairBotStatesForPhase14(): Promise<BotStateRepair> {
  // D'abord celles qui ont écrit au bot en privé (message de la personne dans sa conversation avec ce bot) : gardées.
  const wrote = await prisma.$executeRaw`
    UPDATE "MemberBotState" AS s
    SET "startedAt" = (
      SELECT MIN(e."occurredAt") FROM "Event" AS e
      WHERE e."memberId" = s."memberId"
        AND e."botId" = s."botId"
        AND e."type" = 'telegram.message'
        AND e."payload"->'message'->'chat'->>'type' = 'private'
        AND e."payload"->'message'->'chat'->>'id' = e."payload"->'message'->'from'->>'id'
    )
    WHERE s."canDm" = true
      AND s."startedAt" IS NULL
      AND s."blockedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Event" AS e
        WHERE e."memberId" = s."memberId"
          AND e."botId" = s."botId"
          AND e."type" = 'telegram.message'
          AND e."payload"->'message'->'chat'->>'type' = 'private'
          AND e."payload"->'message'->'chat'->>'id' = e."payload"->'message'->'from'->>'id'
      )`;
  const neverStarted = await prisma.memberBotState.updateMany({
    where: { canDm: true, startedAt: null, blockedAt: null },
    data: { canDm: false },
  });
  const notBlocked = await prisma.$executeRaw`
    UPDATE "MemberBotState" AS s
    SET "blockedAt" = NULL, "canDm" = false
    FROM "Member" AS m
    WHERE m."id" = s."memberId"
      AND m."anonymizedAt" IS NULL
      AND s."blockedAt" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Event" AS e
        WHERE e."memberId" = s."memberId"
          AND e."botId" = s."botId"
          AND (
            e."type" = 'member.blocked'
            OR (e."type" = 'dm.blocked' AND e."payload"->>'telegramError' ILIKE '%blocked by the user%')
          )
      )`;
  return {
    canDmCleared: neverStarted.count,
    blockedCleared: Number(notBlocked),
    wroteKept: Number(wrote),
  };
}

function botStatesOf(v: unknown): BotStateRepair | null {
  const o = objectOf(v);
  if (typeof o.canDmCleared !== "number" || typeof o.blockedCleared !== "number") return null;
  return {
    canDmCleared: o.canDmCleared,
    blockedCleared: o.blockedCleared,
    wroteKept: typeof o.wroteKept === "number" ? o.wroteKept : 0,
  };
}

function sequenceTextsOf(v: unknown): Phase14TextsReport | null {
  const o = objectOf(v);
  if (typeof o.updated !== "number") return null;
  return {
    updated: o.updated,
    upToDate: Number(o.upToDate ?? 0),
    keptByTeam: Number(o.keptByTeam ?? 0),
  };
}

/**
 * Rattrapage unique (phase 14, décision E3) : la vérification de la validation automatique appliquée à TOUTES les
 * demandes en attente des canaux, quel que soit leur âge. Avant cela, réparation des états « joignable / a bloqué le
 * bot » hérités (`repairBotStatesForPhase14`) et des accueils par défaut (`rewriteDefaultJoinRequestTexts`).
 * Idempotent : la marque `phase14.gateBackfill` (avec les nombres de chaque partie) est écrite à la fin ; ensuite le
 * résultat enregistré est rendu sans rien toucher (une marque écrite avant les réparations les fait tourner une fois ;
 * `force` : nouveau passage, sans risque). Lancé par `pnpm db:phase14` ou par la tâche `gate-backfill` du worker.
 */
export async function runGateBackfillOnce(
  opts: PrismaAutoGateOptions & {
    force?: boolean;
    now?: Date;
    budgetPerBot?: number;
    by?: "script" | "worker";
    /** Pauses des bots après un 429 (mémoire du worker) : voir `GateSweepOptions.botPauses`. */
    botPauses?: Map<string, number>;
  } = {},
): Promise<GateBackfillResult> {
  const marker = await prisma.setting.findUnique({ where: { key: GATE_BACKFILL_KEY } });
  if (marker && !opts.force) {
    const v = objectOf(marker.value) as Partial<GateBackfillResult>;
    // Rattrapage fait avant la réparation des états et des accueils (même phase) : seules ces deux parties tournent.
    const savedStates = botStatesOf(v.botStates);
    const savedTexts = sequenceTextsOf(v.sequenceTexts);
    const botStates = savedStates ?? (await repairBotStatesForPhase14());
    const sequenceTexts = savedTexts ?? (await rewriteDefaultJoinRequestTexts());
    if (!savedStates || !savedTexts)
      await prisma.setting.update({
        where: { key: GATE_BACKFILL_KEY },
        data: { value: toJsonValue({ ...objectOf(marker.value), botStates, sequenceTexts }) },
      });
    return {
      doneAt: typeof v.doneAt === "string" ? v.doneAt : marker.updatedAt.toISOString(),
      by: v.by === "worker" ? "worker" : "script",
      checked: Number(v.checked ?? 0),
      satisfied: Number(v.satisfied ?? 0),
      satisfiedIds: Array.isArray(v.satisfiedIds) ? v.satisfiedIds.map(String) : [],
      stillPending: Number(v.stillPending ?? 0),
      deferred: Number(v.deferred ?? 0),
      withoutGates: Number(v.withoutGates ?? 0),
      errors: Number(v.errors ?? 0),
      byChannel: Array.isArray(v.byChannel) ? v.byChannel : [],
      botStates,
      sequenceTexts,
      alreadyDone: true,
    };
  }
  const now = opts.now ?? new Date();
  // D'abord les états hérités (joignable / a bloqué le bot) et les accueils par défaut, puis les demandes en attente.
  const botStates = await repairBotStatesForPhase14();
  const sequenceTexts = await rewriteDefaultJoinRequestTexts();
  const report = await sweepPendingGates(depsOf(opts), {
    now,
    maxAgeMs: null,
    limit: 5000,
    budgetPerBot: opts.budgetPerBot ?? 200,
    trigger: "backfill",
    ...(opts.botPauses ? { botPauses: opts.botPauses } : {}),
  });
  const [stillPending, done] = await Promise.all([
    prisma.membership.count({ where: { status: "PENDING_GATE", channel: { isActive: true } } }),
    report.satisfied.length
      ? prisma.membership.findMany({
          where: { id: { in: report.satisfied } },
          select: { channelId: true, channel: { select: { title: true } } },
        })
      : Promise.resolve([]),
  ]);
  const byChannel = new Map<string, { channelId: string; title: string; satisfied: number }>();
  for (const d of done) {
    const row = byChannel.get(d.channelId) ?? {
      channelId: d.channelId,
      title: d.channel.title,
      satisfied: 0,
    };
    row.satisfied++;
    byChannel.set(d.channelId, row);
  }
  const result: GateBackfillResult = {
    alreadyDone: false,
    doneAt: now.toISOString(),
    by: opts.by ?? "script",
    checked: report.checked,
    satisfied: report.satisfied.length,
    satisfiedIds: report.satisfied,
    stillPending,
    deferred: report.deferred,
    withoutGates: report.withoutGates,
    errors: report.errors,
    byChannel: [...byChannel.values()],
    botStates,
    sequenceTexts,
  };
  const { alreadyDone: _skip, ...value } = result;
  void _skip;
  await prisma.setting.upsert({
    where: { key: GATE_BACKFILL_KEY },
    create: { key: GATE_BACKFILL_KEY, value: toJsonValue(value) },
    update: { value: toJsonValue(value) },
  });
  return result;
}

/**
 * Le bot peut-il encore écrire à ce membre ? (décision E2) : a démarré le bot et ne l'a pas bloqué, ou demande
 * d'adhésion de moins de 5 minutes avec `user_chat_id`. `request` : la demande concernée (null : aucune).
 */
export async function memberReachabilityWithDb(
  memberId: string,
  botId: string,
  request: { userChatId: bigint | null; requestedAt: Date } | null,
  now = new Date(),
): Promise<Reachability> {
  const state = await prisma.memberBotState.findUnique({
    where: { memberId_botId: { memberId, botId } },
    select: { canDm: true, startedAt: true, blockedAt: true },
  });
  return reachability(state, request, now);
}

export type MembershipGatesStatus = {
  membershipId: string;
  /** Canaux à rejoindre effectifs de la demande (sans le canal d'où vient la personne), dans l'ordre de la règle. */
  channels: Array<{
    channelId: string;
    title: string;
    /** Rejoint : membre, ou demande à nous en cours, programmée ou acceptée. */
    joined: boolean;
    /** Aucun de nos bots n'a pu vérifier ce canal (avec `telegram`). */
    unverified?: boolean;
  }>;
  joinedCount: number;
  allJoined: boolean;
};

/**
 * Canaux à rejoindre d'une demande et ceux déjà rejoints (site : onglet Demandes, parcours). Par défaut avec nos
 * données seulement (aucun appel à Telegram) ; `telegram` : `getChatMember` par nos bots administrateurs pour les
 * canaux que nos données ne couvrent pas. Aucune écriture. Null si la demande n'existe pas.
 */
export async function membershipGatesStatusWithDb(
  membershipId: string,
  opts: PrismaAutoGateOptions & { telegram?: boolean } = {},
): Promise<MembershipGatesStatus | null> {
  const deps = depsOf(opts);
  const m = await deps.findMembershipById(membershipId);
  if (!m) return null;
  const rule = await deps.getRuleForMembership(m);
  const ev = await evaluateMembershipGates(deps, m, rule, Number(m.telegramUserId ?? 0), {
    budget: opts.telegram && m.telegramUserId ? perBotBudget(10) : NO_TELEGRAM_CALLS,
  });
  const missing = new Set(ev.check.missing.map((c) => c.id));
  const unverified = new Set(ev.check.unverified.map((u) => u.channelId));
  const channels = ev.required.map((c) => ({
    channelId: c.id,
    title: c.title,
    joined: !missing.has(c.id),
    ...(unverified.has(c.id) && opts.telegram ? { unverified: true } : {}),
  }));
  const joinedCount = channels.filter((c) => c.joined).length;
  return {
    membershipId,
    channels,
    joinedCount,
    allJoined: channels.length > 0 && joinedCount === channels.length,
  };
}
