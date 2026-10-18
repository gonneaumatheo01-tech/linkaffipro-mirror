/**
 * Validation automatique des demandes en attente des canaux obligatoires (phase 14, décision E3), sans attendre
 * « ✅ J'ai rejoint » : constat du 15 octobre, des personnes avaient rejoint les deux canaux obligatoires sans jamais
 * appuyer sur le bouton et restaient bloquées pour toujours.
 *
 * - Déclencheurs du bot : une personne fait une demande dans un canal, ou y entre (par n'importe quel lien) ; toutes
 *   ses demandes « en attente des canaux » dont les canaux à rejoindre effectifs contiennent ce canal sont revérifiées
 *   (`recheckPendingGates`).
 * - Filet du worker toutes les 2 minutes (`sweepPendingGates`) : demandes en attente de moins de 7 jours, nos données
 *   d'abord, `getChatMember` seulement si besoin, avec une limite d'appels par passage et par bot (et 429 respecté).
 * - Rattrapage unique (`pnpm db:phase14`, ou tâche du worker) : même vérification sur toutes les demandes en attente.
 *
 * Même règle que « ✅ J'ai rejoint » (`checkGateMembership`) : un canal obligatoire est rejoint si la personne en est
 * membre, ou si elle y a une demande à nous en cours, programmée ou acceptée ; jamais le canal d'où elle vient, aucun
 * canal si l'accueil n'en demandait pas (phase 11). Tous rejoints : acceptation programmée (`approveAtAfterGate`),
 * événement `membership.gate_satisfied` avec `auto: true`, et message « Canaux rejoints » seulement si le bot peut
 * encore écrire à la personne (`reachability`), sinon événement `dm.skipped_unreachable`.
 */
import type { MembershipStatus } from "@linkaffipro/db";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, JoinFlowDeps, MembershipInfo } from "./deps";
import {
  checkGateMembership,
  gateCheckProblemsOf,
  gateProblemsOf,
  NO_TELEGRAM_CALLS,
  perBotBudget,
  type FirstBot,
  type GateCheckBudget,
  type GateCheckResult,
  type GateLinkApi,
} from "./gate-links";
import { reachability, inJoinWindow, type Reachability } from "./reachability";
import { approveAtAfterGate, formatDelay, hasGate, type RuleData } from "./rules";
import { baseLang, defaultText, pickText, renderHtmlText } from "./texts";

/** Ce qui a déclenché la validation automatique (journal `membership.gate_satisfied`). */
export type AutoGateTrigger = "join_request" | "joined" | "sweep" | "backfill";

/** Canaux à rejoindre d'une règle (sans le canal source), dans l'ordre de la règle. */
export async function gateChannelsOf(
  deps: Pick<JoinFlowDeps, "getChannels">,
  rule: RuleData,
  sourceChannelId: string,
): Promise<ChannelInfo[]> {
  if (!hasGate(rule)) return [];
  return deps.getChannels(rule.gateChannelIds.filter((id) => id !== sourceChannelId));
}

/** Source d'une demande dont les canaux sont rejoints : les marques « lien manquant » et « vérification impossible » ne servent plus. */
export function sourceAfterGateSatisfied(source: Record<string, unknown>): Record<string, unknown> {
  const clearLinks = gateProblemsOf(source).length > 0;
  const clearCheck = gateCheckProblemsOf(source).length > 0;
  if (!clearLinks && !clearCheck) return source;
  return {
    ...source,
    ...(clearLinks ? { gateLinksMissing: [] } : {}),
    ...(clearCheck ? { gateCheckFailed: [] } : {}),
  };
}

/**
 * Bot qui a traité la demande (celui qui écrit à la personne) s'il est encore actif et normal, sinon celui qui agit
 * pour le canal : jamais un bot devenu assistant de conversation (phase 17), qui n'a plus le flux d'adhésion.
 */
export async function botOfMembership(
  deps: Pick<JoinFlowDeps, "actingBotIdFor" | "getBotIdentity">,
  m: Pick<MembershipInfo, "source" | "channelId">,
): Promise<string | null> {
  const sourceBotId = typeof m.source.botId === "string" && m.source.botId ? m.source.botId : null;
  if (sourceBotId && (await deps.getBotIdentity(sourceBotId))) return sourceBotId;
  return (await deps.actingBotIdFor(m.channelId))?.botId ?? null;
}

/** Le bot peut-il encore écrire à ce membre pour cette demande ? (décision E2, `reachability`). */
export async function reachableFor(
  deps: Pick<JoinFlowDeps, "botState" | "canWriteTo">,
  memberId: string,
  botId: string,
  request: { userChatId: bigint | null; requestedAt: Date } | null,
  now: Date,
): Promise<Reachability> {
  if (deps.botState) return reachability(await deps.botState(memberId, botId), request, now);
  if (await deps.canWriteTo(memberId, botId)) return { reachable: true, via: "started" };
  if (inJoinWindow(request, now)) return { reachable: true, via: "join_window" };
  return { reachable: false, reason: "never_started" };
}

/** Message « Canaux rejoints » : en file (identifiant du message, s'il est connu) ou non envoyé (raison). */
export type GateSatisfiedMessage =
  | { queued: true; outboundMessageId: string | null }
  | { queued: false; reason: "blocked" | "never_started" | "unreachable" | "no_member" };

/**
 * Message « Canaux rejoints » (texte de « Ce que dit le bot », sinon texte intégré « C'est bon {prenom}, tu seras accepté
 * dans {canal} {delai}. ») par la file, seulement si le bot peut encore écrire à la personne ; sinon rien n'est envoyé
 * (raison rendue : l'appelant journalise `dm.skipped_unreachable`, sans erreur).
 */
export async function sendGateSatisfiedIfReachable(
  deps: JoinFlowDeps,
  input: {
    m: MembershipInfo;
    rule: RuleData;
    channel: ChannelInfo;
    botId: string;
    approveAt: Date;
    gateTitles: string[];
    now: Date;
  },
): Promise<GateSatisfiedMessage> {
  const { m, channel, botId, now } = input;
  const reach = await reachableFor(
    deps,
    m.memberId,
    botId,
    { userChatId: m.userChatId, requestedAt: m.requestedAt },
    now,
  );
  if (!reach.reachable) return { queued: false, reason: reach.reason };
  const [member, identity] = await Promise.all([
    deps.getMember(m.memberId),
    deps.getBotIdentity(botId),
  ]);
  if (!member) return { queued: false, reason: "no_member" };
  const seq = await deps.getSequenceText(channel.id, botId, "GATE_SATISFIED");
  const lang = baseLang(member.languageCode ?? channel.language);
  const template =
    pickText(seq?.texts, member.languageCode, channel.language) ??
    defaultText("gateSatisfied", lang);
  const text = renderHtmlText(template, {
    prenom: member.firstName ?? "",
    canal: channel.title,
    liste_canaux: input.gateTitles.join(", "),
    delai: formatDelay(
      Math.max(0, Math.round((input.approveAt.getTime() - now.getTime()) / 1000)),
      lang,
    ),
    bot: identity ? `@${identity.username}` : "",
  });
  // Pas de type de message « canaux rejoints » en base : il est rangé avec les messages « rejoins les canaux » ; son
  // identifiant part dans l'événement `membership.gate_satisfied` (`outboundMessageId`) pour l'afficher sous son nom.
  const queued = await deps.enqueueDm({
    botId,
    memberId: m.memberId,
    chatId: m.userChatId,
    kind: "GATE_REMINDER",
    text,
    buttons: [],
    mediaAssetId: seq?.mediaAssetId ?? null,
  });
  return { queued: true, outboundMessageId: queued ? queued.outboundMessageId : null };
}

/**
 * Canaux obligatoires tous rejoints : la demande « en attente des canaux » passe en acceptation programmée
 * (`approveAtAfterGate(règle, maintenant)`), une seule fois (mise à jour conditionnelle : plusieurs bots ou le worker
 * peuvent vérifier en même temps). Message « Canaux rejoints » si la personne est joignable, puis événement
 * `membership.gate_satisfied` avec `auto: true` et l'identifiant du message (`outboundMessageId`, null si rien n'est
 * parti), puis `dm.skipped_unreachable` si la personne ne peut plus être jointe. Renvoie l'heure d'acceptation, ou null
 * si la demande avait déjà changé.
 */
export async function autoSatisfyGate(
  deps: JoinFlowDeps,
  input: {
    m: MembershipInfo;
    rule: RuleData;
    channel: ChannelInfo;
    required: ChannelInfo[];
    check: GateCheckResult;
    trigger: AutoGateTrigger;
    now: Date;
  },
): Promise<{ approveAt: Date } | null> {
  const { m, rule, channel, now } = input;
  const approveAt = approveAtAfterGate(rule, now);
  const source = sourceAfterGateSatisfied(m.source);
  const data = {
    status: "SCHEDULED" as MembershipStatus,
    gateSatisfiedAt: now,
    approveAt,
    ...(source !== m.source ? { source } : {}),
  };
  if (deps.updateMembershipIfStatus) {
    if (!(await deps.updateMembershipIfStatus(m.id, "PENDING_GATE", data))) return null;
  } else await deps.updateMembership(m.id, data);
  const botId = await botOfMembership(deps, m);
  const message: GateSatisfiedMessage | null = botId
    ? await sendGateSatisfiedIfReachable(deps, {
        m,
        rule,
        channel,
        botId,
        approveAt,
        gateTitles: input.required.map((c) => c.title),
        now,
      }).catch((err: unknown) => {
        (deps.warn ?? ((msg, d) => console.warn(`[join-flow] ${msg}`, d)))(
          "message « canaux rejoints » non mis en file",
          { membershipId: m.id, error: err instanceof Error ? err.message : String(err) },
        );
        return null;
      })
    : null;
  await deps.recordEvent({
    type: "membership.gate_satisfied",
    memberId: m.memberId,
    channelId: channel.id,
    botId,
    payload: {
      membershipId: m.id,
      approveAt: approveAt.toISOString(),
      auto: true,
      trigger: input.trigger,
      // Canaux satisfaits par une demande à nous (sans appel à Telegram).
      requested: input.check.requested ?? [],
      // Message « Canaux rejoints » mis en file (rangé avec les rappels en base), ou null.
      outboundMessageId: message?.queued ? message.outboundMessageId : null,
    },
  });
  if (message && !message.queued && message.reason !== "no_member")
    await deps.recordEvent({
      type: "dm.skipped_unreachable",
      memberId: m.memberId,
      channelId: channel.id,
      botId,
      payload: { membershipId: m.id, kind: "GATE_SATISFIED", reason: message.reason },
    });
  return { approveAt };
}

export type MembershipGateEvaluation = {
  channel: ChannelInfo | null;
  required: ChannelInfo[];
  check: GateCheckResult;
  /** Tous les canaux obligatoires effectifs sont rejoints (et le canal de la demande existe encore, actif). */
  satisfied: boolean;
};

/**
 * Canaux à rejoindre d'une demande vérifiés maintenant (même règle que « ✅ J'ai rejoint ») : nos données d'abord, puis
 * `getChatMember` par nos bots administrateurs (dans la limite de `budget`). Aucune écriture.
 */
export async function evaluateMembershipGates(
  deps: JoinFlowDeps,
  m: MembershipInfo,
  rule: RuleData,
  telegramUserId: number,
  opts: {
    first?: FirstBot | null;
    alsoSatisfied?: readonly string[];
    budget?: GateCheckBudget;
  } = {},
): Promise<MembershipGateEvaluation> {
  const [channel] = await deps.getChannels([m.channelId]);
  const required = await gateChannelsOf(deps, rule, m.channelId);
  const check = await checkGateMembership(deps, required, telegramUserId, opts.first ?? null, {
    memberId: m.memberId,
    ...(opts.alsoSatisfied ? { alsoSatisfied: opts.alsoSatisfied } : {}),
    ...(opts.budget ? { budget: opts.budget } : {}),
  });
  return {
    channel: channel ?? null,
    required,
    check,
    satisfied: !!channel && channel.isActive && check.missing.length === 0,
  };
}

/**
 * Une personne vient de faire une demande dans le canal `channelId`, ou d'y entrer (par n'importe quel lien) : ses
 * demandes « en attente des canaux » qui demandent ce canal sont revérifiées ; celles dont tous les canaux sont
 * rejoints passent en acceptation programmée. Ne lève jamais d'erreur (la demande en cours est déjà enregistrée).
 * Renvoie les demandes validées.
 */
export async function recheckPendingGates(
  api: GateLinkApi | null,
  identity: Pick<BotIdentity, "id" | "username">,
  deps: JoinFlowDeps,
  input: {
    memberId: string;
    telegramUserId: number;
    channelId: string;
    trigger: "join_request" | "joined";
    now?: Date;
  },
): Promise<string[]> {
  if (!deps.findPendingGateMemberships) return [];
  const warn = deps.warn ?? ((msg, d) => console.warn(`[join-flow] ${msg}`, d));
  const now = input.now ?? new Date();
  const first: FirstBot | null = api
    ? { botId: identity.id, username: identity.username, api }
    : null;
  const done: string[] = [];
  let pending: MembershipInfo[] = [];
  try {
    pending = await deps.findPendingGateMemberships(input.memberId);
  } catch (err) {
    warn("demandes en attente des canaux illisibles", {
      memberId: input.memberId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  for (const m of pending) {
    if (m.status !== "PENDING_GATE" || m.channelId === input.channelId) continue;
    try {
      const rule = await deps.getRuleForMembership(m);
      if (!hasGate(rule) || !rule.gateChannelIds.includes(input.channelId)) continue;
      const ev = await evaluateMembershipGates(deps, m, rule, input.telegramUserId, {
        first,
        alsoSatisfied: [input.channelId],
      });
      if (!ev.satisfied || !ev.channel) continue;
      const r = await autoSatisfyGate(deps, {
        m,
        rule,
        channel: ev.channel,
        required: ev.required,
        check: ev.check,
        trigger: input.trigger,
        now,
      });
      if (r) done.push(m.id);
    } catch (err) {
      warn("validation automatique impossible pour cette demande", {
        membershipId: m.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return done;
}

/** Demande en attente des canaux telle que relue par le filet du worker (avec l'identifiant Telegram du membre). */
export type PendingGateRow = MembershipInfo & { telegramUserId: bigint };

/** Lecture des demandes en attente des canaux (filet du worker, rattrapage), les plus récentes d'abord. */
export type GateSweepDeps = JoinFlowDeps & {
  listPendingGates(input: { since: Date | null; limit: number }): Promise<PendingGateRow[]>;
};

/**
 * Intervalle entre deux vérifications par Telegram d'une même demande selon son âge : à chaque passage (2 minutes)
 * pendant la première heure, puis toutes les 10 minutes jusqu'à 24 h, puis toutes les heures. Nos données (demandes,
 * entrées) sont relues à chaque passage, sans appel.
 */
export function apiCheckIntervalMs(ageMs: number): number {
  if (ageMs < 3600_000) return 0;
  if (ageMs < 24 * 3600_000) return 10 * 60_000;
  return 60 * 60_000;
}

export type GateSweepOptions = {
  now?: Date;
  /** Âge maximal des demandes (7 jours pour le filet ; null : toutes, rattrapage). */
  maxAgeMs?: number | null;
  limit?: number;
  /** Appels `getChatMember` au plus par bot et par passage. */
  budgetPerBot?: number;
  trigger?: "sweep" | "backfill";
  /** Dernière vérification par Telegram de chaque demande (mémoire du worker, `apiCheckIntervalMs`). */
  lastApiCheck?: Map<string, number>;
  /**
   * Heure de reprise des appels de chaque bot après un 429 (mémoire du worker, gardée d'un passage à l'autre) : avant
   * cette heure, ce bot ne fait aucun appel `getChatMember` (attente `retry_after` de Telegram respectée).
   */
  botPauses?: Map<string, number>;
};

export type GateSweepReport = {
  /** Demandes en attente des canaux relues. */
  checked: number;
  /** Demandes passées en acceptation programmée. */
  satisfied: string[];
  /** Demandes pas entièrement vérifiées à ce passage (limite d'appels, 429). */
  deferred: number;
  /** Demandes dont la règle n'a plus de canaux à rejoindre (laissées telles quelles : « Leur appliquer la nouvelle règle »). */
  withoutGates: number;
  /** Appels `getChatMember` faits. */
  apiCalls: number;
  errors: number;
};

/** Demande dont nos données ne suffisent pas, à vérifier par Telegram (deuxième temps du filet). */
type TelegramCheck = {
  m: PendingGateRow;
  rule: RuleData;
  ev: MembershipGateEvaluation & { channel: ChannelInfo };
  /** Dernière vérification par Telegram (undefined : jamais). */
  last: number | undefined;
};

/** Jamais vérifiées d'abord (dans l'ordre reçu : les plus récentes en tête), puis les moins récemment vérifiées. */
function byLastTelegramCheck(a: TelegramCheck, b: TelegramCheck): number {
  if (a.last === b.last) return 0;
  if (a.last === undefined) return -1;
  if (b.last === undefined) return 1;
  return a.last - b.last;
}

/**
 * Filet du worker toutes les 2 minutes (7 jours) et rattrapage (toutes les demandes) : voir l'en-tête du fichier.
 *
 * Deux temps (phase 14) :
 * 1. nos données pour TOUTES les demandes, les plus récentes d'abord (aucun appel à Telegram) ;
 * 2. `getChatMember` pour les canaux que nos données ne couvrent pas, dans la limite d'appels par bot : d'abord les
 *    demandes jamais vérifiées par Telegram, puis les moins récemment vérifiées. Lors d'un pic de demandes, les plus
 *    récentes ne prennent donc pas toute la limite à chaque passage : chacune finit par être vérifiée (une personne
 *    déjà membre des canaux avant sa demande n'est trouvée que par ce filet). Une demande pas entièrement vérifiée
 *    (limite atteinte, 429) garde sa place en tête au passage suivant.
 */
export async function sweepPendingGates(
  deps: GateSweepDeps,
  opts: GateSweepOptions = {},
): Promise<GateSweepReport> {
  const now = opts.now ?? new Date();
  const warn = deps.warn ?? ((msg, d) => console.warn(`[join-flow] ${msg}`, d));
  const since =
    opts.maxAgeMs === null || opts.maxAgeMs === undefined
      ? null
      : new Date(now.getTime() - opts.maxAgeMs);
  const rows = await deps.listPendingGates({ since, limit: opts.limit ?? 500 });
  const budget = perBotBudget(opts.budgetPerBot ?? 30, {
    now,
    ...(opts.botPauses ? { pausedUntil: opts.botPauses } : {}),
  });
  const memory = opts.lastApiCheck;
  const report: GateSweepReport = {
    checked: 0,
    satisfied: [],
    deferred: 0,
    withoutGates: 0,
    apiCalls: 0,
    errors: 0,
  };
  const failed = (m: PendingGateRow, err: unknown) => {
    report.errors++;
    warn("vérification automatique des canaux impossible", {
      membershipId: m.id,
      error: err instanceof Error ? err.message : String(err),
    });
  };
  const satisfy = async (
    m: PendingGateRow,
    rule: RuleData,
    ev: MembershipGateEvaluation & { channel: ChannelInfo },
    check: GateCheckResult,
  ) => {
    const r = await autoSatisfyGate(deps, {
      m,
      rule,
      channel: ev.channel,
      required: ev.required,
      check,
      trigger: opts.trigger ?? "sweep",
      now,
    });
    if (r) report.satisfied.push(m.id);
    memory?.delete(m.id);
  };

  // 1. Nos données (demandes et entrées enregistrées) pour toutes les demandes : aucun appel à Telegram.
  const seen = new Set<string>();
  const toTelegram: TelegramCheck[] = [];
  for (const m of rows) {
    seen.add(m.id);
    report.checked++;
    try {
      const rule = await deps.getRuleForMembership(m);
      if (!hasGate(rule)) {
        report.withoutGates++;
        continue;
      }
      const ev = await evaluateMembershipGates(deps, m, rule, Number(m.telegramUserId), {
        budget: NO_TELEGRAM_CALLS,
      });
      const channel = ev.channel;
      if (!channel || !channel.isActive) continue;
      const withChannel = { ...ev, channel };
      if (ev.satisfied) {
        await satisfy(m, rule, withChannel, ev.check);
        continue;
      }
      const last = memory?.get(m.id);
      const age = now.getTime() - m.requestedAt.getTime();
      if (last === undefined || now.getTime() - last >= apiCheckIntervalMs(age))
        toTelegram.push({ m, rule, ev: withChannel, last });
    } catch (err) {
      failed(m, err);
    }
  }

  // 2. Telegram pour les canaux restants : jamais vérifiées d'abord, puis les moins récemment vérifiées.
  toTelegram.sort(byLastTelegramCheck);
  for (const t of toTelegram) {
    try {
      const check = await checkGateMembership(
        deps,
        t.ev.check.missing,
        Number(t.m.telegramUserId),
        null,
        { budget },
      );
      const calls = check.apiCalls ?? 0;
      report.apiCalls += calls;
      const deferred = check.deferred?.length ?? 0;
      if (check.missing.length === 0) {
        await satisfy(t.m, t.rule, t.ev, {
          missing: [],
          unverified: [],
          ...(t.ev.check.requested ? { requested: t.ev.check.requested } : {}),
          apiCalls: calls,
        });
        continue;
      }
      if (deferred > 0) report.deferred++;
      // Entièrement vérifiée : place en fin de file aux passages suivants. Reportée (même en partie) : garde sa place.
      else if (calls > 0) memory?.set(t.m.id, now.getTime());
    } catch (err) {
      failed(t.m, err);
    }
  }
  // Mémoire bornée : les demandes qui ne sont plus en attente sont oubliées.
  if (memory) for (const id of [...memory.keys()]) if (!seen.has(id)) memory.delete(id);
  return report;
}
