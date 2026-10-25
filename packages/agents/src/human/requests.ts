/**
 * Demandes au client par Telegram (CONTRAT, propriétaire : chantier B). Une seule question à la fois : la suivante
 * part quand la précédente est répondue ou passée. Les agents appellent `askHuman`.
 */
import type { AdminButton, AgentsDeps, TeamKey } from "../types";
import { agentEvent, esc, nowOf } from "../admin/journal";
import { deliverHumanRequest, type RequestDelivery } from "./delivery";

export type AskHumanInput = {
  teamKey?: TeamKey | null;
  kind: "SECRET" | "TEXT" | "CHOICE" | "MEDIA" | "CONFIRM";
  /** Ce qui est demandé (`providers.fal.apiKey`, `agents.dailyReport`…). */
  key: string;
  /** 5 lignes au plus, français simple, dit exactement quoi répondre et comment passer (« plus tard »). */
  question: string;
  options?: string[];
  /** `channelId` / `channelIds` : canaux concernés par une demande de médias (affichés par le site). */
  expected?: { count?: number; tags?: string[]; channelId?: string; channelIds?: string[] };
  missionId?: string | null;
  /** Suite à donner : `{ action: "resume-mission" }`, `{ action: "verify-key", provider: "fal" }`… */
  onAnswer?: Record<string, unknown>;
};

export const OPEN_REQUEST_STATUSES = ["QUEUED", "PENDING"] as const;

type RequestRow = {
  id: string;
  kind: string;
  key: string;
  question: string;
  options: unknown;
  expected: unknown;
};

export function optionsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function expectedOf(v: unknown): { count?: number; tags?: string[]; received?: number } {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    count: typeof o.count === "number" ? o.count : undefined,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : undefined,
    received: typeof o.received === "number" ? o.received : undefined,
  };
}

export function onAnswerOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/** Texte HTML envoyé : la question, les options numérotées, et comment passer si la question ne le dit pas. */
export function formatQuestion(req: RequestRow, opts: { reminder?: boolean } = {}): string {
  const lines = [opts.reminder ? `⏰ Petit rappel : ${esc(req.question)}` : `❓ ${esc(req.question)}`];
  const options = optionsOf(req.options);
  if (req.kind === "CHOICE" && options.length > 0)
    lines.push(options.map((o, i) => `${i + 1}. ${esc(o)}`).join("\n"));
  // Clé, identifiant, texte libre : seule une RÉPONSE au message de la question est prise à coup sûr (un message
  // ordinaire de l'admin n'est jamais avalé, voir `handleAdminText`).
  if ((req.kind === "SECRET" || req.kind === "TEXT") && !/en réponse|réponds à ce message|répondre à ce message/i.test(req.question))
    lines.push("Réponds à ce message (appui long, puis Répondre).");
  if (!/plus tard/i.test(req.question)) lines.push("Pour passer, réponds « plus tard ».");
  return lines.join("\n");
}

/** Identifiants des messages Telegram déjà envoyés pour une demande (question, rappels), rangés dans `onAnswer`. */
export const ASKED_MESSAGE_IDS_FIELD = "askedMessageIds";

export function askedMessageIdsOf(req: { telegramMessageId?: number | null; onAnswer?: unknown }): number[] {
  const list = onAnswerOf(req.onAnswer)[ASKED_MESSAGE_IDS_FIELD];
  const ids = Array.isArray(list) ? list.filter((x): x is number => typeof x === "number") : [];
  if (typeof req.telegramMessageId === "number" && !ids.includes(req.telegramMessageId)) ids.push(req.telegramMessageId);
  return ids;
}

/** Données à écrire quand un nouveau message (question ou rappel) part pour la demande. */
export function withAskedMessageId(req: { telegramMessageId?: number | null; onAnswer?: unknown }, messageId: number) {
  const onAnswer = onAnswerOf(req.onAnswer);
  const ids = askedMessageIdsOf(req);
  if (!ids.includes(messageId)) ids.push(messageId);
  onAnswer[ASKED_MESSAGE_IDS_FIELD] = ids.slice(-20);
  return { telegramMessageId: messageId, onAnswer: JSON.parse(JSON.stringify(onAnswer)) as object };
}

/**
 * Phase 26, bascule vers un nouveau bot du dialogue admin : les messages déjà envoyés à l'admin en privé par l'ancien
 * bot ne valent plus « réponse » (les numéros de message sont propres à chaque conversation : le n°120 du bot casino
 * n'est pas le n°120 de Kevin). Ils sont rangés dans `onAnswer.retiredMessageIds` : plus jamais utilisés pour
 * retrouver une demande, mais toujours pour MASQUER une clé collée en réponse à une ancienne question SECRET sur
 * l'ancien bot (journal, `readSecretRequestsState`).
 */
export const RETIRED_MESSAGE_IDS_FIELD = "retiredMessageIds";

export function retiredMessageIdsOf(req: { onAnswer?: unknown }): number[] {
  const list = onAnswerOf(req.onAnswer)[RETIRED_MESSAGE_IDS_FIELD];
  return Array.isArray(list) ? list.filter((x): x is number => typeof x === "number") : [];
}

/** Données qui retirent les messages actuels d'une demande (voir `RETIRED_MESSAGE_IDS_FIELD`). */
export function withRetiredMessageIds(req: { telegramMessageId?: number | null; onAnswer?: unknown }) {
  const onAnswer = onAnswerOf(req.onAnswer);
  const retired = [...new Set([...retiredMessageIdsOf(req), ...askedMessageIdsOf(req)])];
  onAnswer[RETIRED_MESSAGE_IDS_FIELD] = retired.slice(-40);
  onAnswer[ASKED_MESSAGE_IDS_FIELD] = [];
  return { telegramMessageId: null, onAnswer: JSON.parse(JSON.stringify(onAnswer)) as object };
}

/**
 * Bascule vers un nouveau bot du dialogue admin : retire les messages de TOUTES les demandes posées à l'admin en
 * privé (`chatId` null ; le groupe de l'équipe n'est pas concerné). À appeler AVANT de reposer la question en cours.
 * Rend le nombre de demandes touchées.
 */
export async function retireAdminChatMessageIds(deps: Pick<AgentsDeps, "prisma">): Promise<number> {
  const rows = await deps.prisma.humanRequest.findMany({ where: { chatId: null }, orderBy: { createdAt: "desc" }, take: 1000 });
  let n = 0;
  for (const r of rows) {
    if (askedMessageIdsOf(r).length === 0) continue;
    await deps.prisma.humanRequest.update({ where: { id: r.id }, data: withRetiredMessageIds(r) });
    n++;
  }
  return n;
}

/**
 * Demande dont un message (question ou rappel) porte cet identifiant Telegram, quel que soit son statut. Les numéros
 * de message sont propres à chaque conversation : `chatId` absent ou null = conversation privée avec l'admin
 * (demandes sans groupe) ; sinon le groupe de l'équipe (phase 26).
 */
export async function humanRequestByMessageId(deps: Pick<AgentsDeps, "prisma">, messageId: number, chatId: bigint | null = null) {
  const direct = await deps.prisma.humanRequest.findFirst({
    where: { telegramMessageId: messageId, chatId },
    orderBy: { createdAt: "desc" },
  });
  if (direct) return direct;
  const recent = await deps.prisma.humanRequest.findMany({
    where: { askedAt: { not: null }, chatId },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const found = recent.find((r) => askedMessageIdsOf(r).includes(messageId));
  if (found) return found;
  // Demande relancée (remise en file : `askedAt` vidé) : ses anciens messages restent les siens.
  const queued = await deps.prisma.humanRequest.findMany({ where: { status: "QUEUED", chatId }, take: 100 });
  return queued.find((r) => askedMessageIdsOf(r).includes(messageId)) ?? null;
}

/** Erreur d'unicité Prisma (P2002) : ici, l'index partiel `HumanRequest_one_pending` (une seule question posée). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/** Préfixe des boutons de réponse à une demande (`agh:<id>:oui|non`, admin seulement). */
export const REQUEST_CALLBACK_PREFIX = "agh:";

/**
 * Boutons d'une question CONFIRM qui en demande (`onAnswer.buttonYes`, ex. « Créer le thème promo ») : oui / non en
 * un clic ; la réponse écrite « oui » reste possible.
 */
export function confirmButtonsOf(req: { id: string; kind: string; onAnswer?: unknown }): AdminButton[][] | undefined {
  const yes = onAnswerOf(req.onAnswer).buttonYes;
  if (req.kind !== "CONFIRM" || typeof yes !== "string" || !yes.trim()) return undefined;
  return [
    [
      { text: yes.slice(0, 60), callbackData: `${REQUEST_CALLBACK_PREFIX}${req.id}:oui` },
      { text: "Non", callbackData: `${REQUEST_CALLBACK_PREFIX}${req.id}:non` },
    ],
  ];
}

/** Une question est-elle déjà posée et sans réponse ? */
export async function currentHumanRequest(deps: Pick<AgentsDeps, "prisma">) {
  return deps.prisma.humanRequest.findFirst({ where: { status: "PENDING" }, orderBy: { askedAt: "asc" } });
}

/**
 * Envoie la plus ancienne demande en file si aucune n'est en cours. Sans messager ou sans admin joignable, la demande
 * reste en file (le balayage réessaie). Renvoie l'identifiant de la demande envoyée.
 */
export async function sendNextHumanRequest(deps: AgentsDeps): Promise<string | null> {
  if (await currentHumanRequest(deps)) return null;
  const next = await deps.prisma.humanRequest.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (!next || !deps.admin) return null;
  // Réservation avant l'envoi : deux appels simultanés n'envoient pas deux fois la même question. Entre le site et
  // le worker, l'index unique partiel `HumanRequest_one_pending` garantit une seule question posée : une seconde
  // réservation lève P2002 et la demande reste en file (QUEUED).
  let claimed: { count: number };
  try {
    claimed = await deps.prisma.humanRequest.updateMany({
      where: { id: next.id, status: "QUEUED" },
      data: { status: "PENDING", askedAt: nowOf(deps) },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  if (claimed.count === 0) return null;
  // Phase 26 : un responsable (membre de l'équipe ou l'admin) ; dans le groupe de l'équipe s'il existe, sinon en privé.
  let sent: RequestDelivery | null = null;
  try {
    sent = await deliverHumanRequest(deps, next, formatQuestion(next), { buttons: confirmButtonsOf(next) });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, requestId: next.id }, "[agents] question non envoyée");
  }
  if (!sent) {
    await deps.prisma.humanRequest.update({ where: { id: next.id }, data: { status: "QUEUED", askedAt: null } });
    return null;
  }
  // Une demande reposée ailleurs (privé ↔ groupe) repart de zéro : les anciens numéros de message étaient d'une autre conversation.
  const sameChat = (next.chatId ?? null) === sent.chatId;
  const base = sameChat ? next : { ...next, telegramMessageId: null, onAnswer: { ...onAnswerOf(next.onAnswer), [ASKED_MESSAGE_IDS_FIELD]: [] } };
  await deps.prisma.humanRequest.update({
    where: { id: next.id },
    data: { ...withAskedMessageId(base, sent.messageId), chatId: sent.chatId, assigneeTelegramId: sent.assigneeTelegramId },
  });
  await agentEvent(deps, "agents.request.sent", {
    requestId: next.id,
    key: next.key,
    kind: next.kind,
    ...(sent.chatId ? { inGroup: true, assigneeTelegramId: sent.assigneeTelegramId?.toString() ?? null } : {}),
  });
  return next.id;
}

/** Range la demande dans la file (QUEUED) et l'envoie tout de suite si aucune autre n'est en cours. Idempotent par `key` ouverte. */
export async function askHuman(
  deps: AgentsDeps,
  input: AskHumanInput,
): Promise<{ requestId: string; sent: boolean }> {
  const open = await deps.prisma.humanRequest.findFirst({
    where: { key: input.key, status: { in: [...OPEN_REQUEST_STATUSES] } },
  });
  let requestId: string;
  if (open) {
    requestId = open.id;
    // Une autre mission attend la même réponse : elle reprendra aussi.
    if (input.missionId && input.missionId !== open.missionId) {
      const onAnswer = onAnswerOf(open.onAnswer);
      const waiting = Array.isArray(onAnswer.waitingMissionIds) ? (onAnswer.waitingMissionIds as string[]) : [];
      if (!waiting.includes(input.missionId)) {
        onAnswer.waitingMissionIds = [...waiting, input.missionId];
        await deps.prisma.humanRequest.update({ where: { id: open.id }, data: { onAnswer: JSON.parse(JSON.stringify(onAnswer)) } });
      }
    }
  } else {
    const created = await deps.prisma.humanRequest.create({
      data: {
        teamKey: input.teamKey ?? null,
        kind: input.kind,
        key: input.key,
        question: input.question,
        options: input.options ?? [],
        expected: input.expected ? { ...input.expected, received: 0 } : {},
        status: "QUEUED",
        missionId: input.missionId ?? null,
        onAnswer: JSON.parse(JSON.stringify(input.onAnswer ?? {})),
      },
    });
    requestId = created.id;
    await agentEvent(deps, "agents.request.created", { requestId, key: input.key, kind: input.kind, missionId: input.missionId ?? null });
  }
  if (input.missionId) {
    await deps.prisma.agentMission.updateMany({
      where: { id: input.missionId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "WAITING_HUMAN", lastActivityAt: nowOf(deps) },
    });
  }
  const sentId = await sendNextHumanRequest(deps);
  const now = await deps.prisma.humanRequest.findUnique({ where: { id: requestId } });
  return { requestId, sent: sentId === requestId || (open?.status === "PENDING" && now?.status === "PENDING") };
}
