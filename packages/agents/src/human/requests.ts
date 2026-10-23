/**
 * Demandes au client par Telegram (CONTRAT, propriétaire : chantier B). Une seule question à la fois : la suivante
 * part quand la précédente est répondue ou passée. Les agents appellent `askHuman`.
 */
import type { AdminButton, AgentsDeps, TeamKey } from "../types";
import { agentEvent, esc, nowOf } from "../admin/journal";

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
  const lines = [opts.reminder ? `⏰ <b>Rappel</b> — ${esc(req.question)}` : `❓ ${esc(req.question)}`];
  const options = optionsOf(req.options);
  if (req.kind === "CHOICE" && options.length > 0)
    lines.push(options.map((o, i) => `${i + 1}. ${esc(o)}`).join("\n"));
  if (!/plus tard/i.test(req.question)) lines.push("Pour passer : réponds « plus tard ».");
  return lines.join("\n");
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
  // Réservation avant l'envoi : deux appels simultanés n'envoient pas deux fois la même question.
  const claimed = await deps.prisma.humanRequest.updateMany({
    where: { id: next.id, status: "QUEUED" },
    data: { status: "PENDING", askedAt: nowOf(deps) },
  });
  if (claimed.count === 0) return null;
  let sent: { messageId: number } | null = null;
  try {
    sent = await deps.admin.send(formatQuestion(next), { buttons: confirmButtonsOf(next) });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, requestId: next.id }, "[agents] question non envoyée");
  }
  if (!sent) {
    await deps.prisma.humanRequest.update({ where: { id: next.id }, data: { status: "QUEUED", askedAt: null } });
    return null;
  }
  await deps.prisma.humanRequest.update({ where: { id: next.id }, data: { telegramMessageId: sent.messageId } });
  await agentEvent(deps, "agents.request.sent", { requestId: next.id, key: next.key, kind: next.kind });
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
