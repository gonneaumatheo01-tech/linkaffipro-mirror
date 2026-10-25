/**
 * Réponse à une demande (Telegram ou site) : interprétation, rangement (secret chiffré), suite à donner (`onAnswer`),
 * reprise des missions en attente, puis envoi de la question suivante. Jamais de secret dans le journal ni la réponse.
 */
import * as lifecycle from "../missions/lifecycle";
import { isTeamKey, type AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";
import { setAutonomyLevel, setSimulation } from "../admin/team";
import { agentAudit, agentEvent, nowOf, writeSetting } from "../admin/journal";
import { interpretAnswer, isSkipText, isStrictYes, type HumanRequestKindName } from "./answer";
import { expectedOf, onAnswerOf, optionsOf, sendNextHumanRequest } from "./requests";
import { saveSecret, secretSavedHead, verifySecret } from "./secrets";

export type HumanRequestRow = {
  id: string;
  kind: string;
  key: string;
  status: string;
  question: string;
  options: unknown;
  expected: unknown;
  onAnswer: unknown;
  missionId: string | null;
  teamKey: string | null;
};

export type RespondResult = {
  ok: boolean;
  message: string;
  /** La demande est close (répondue ou passée). */
  closed: boolean;
  /** Le texte reçu était (ou devait être) un secret. */
  secret: boolean;
  /** Un secret a vraiment été enregistré (même refusé ensuite par la vérification) : supprimer le message. */
  secretSaved?: boolean;
};

/**
 * `deferNext` : l'appelant enverra lui-même la question suivante (`sendNextHumanRequest`) APRÈS sa confirmation, pour
 * que la conversation Telegram reste dans l'ordre.
 */
export type RespondOptions = {
  deferNext?: boolean;
  /**
   * Texte tel que reçu, pour la confirmation stricte (« vrai <équipe> », niveau) : un vocal « Oui, vas-y » est remis à
   * « oui » par `voiceToAdminText`, mais seul un « oui » exact confirme.
   */
  confirmText?: string;
};

/** Actions qui exigent exactement « oui » (ni « ok », ni « o », ni emoji, ni « d'accord »), par écrit comme par vocal. */
export const STRICT_CONFIRM_ACTIONS = new Set(["set-simulation", "set-autonomy"]);
export const STRICT_CONFIRM_MESSAGE = "Pour confirmer, réponds exactement « oui » (ou « non », ou « plus tard »).";

/** Suite propre à une action `onAnswer` (enregistrée par les phases suivantes : choix de fournisseur, banc d'essai…). */
export type AnswerAction = (
  deps: AgentsDeps,
  ctx: { request: HumanRequestRow; value: string; actor: ActorRef; onAnswer: Record<string, unknown> },
) => Promise<string | void>;

const actions = new Map<string, AnswerAction>();

export function registerAnswerAction(name: string, fn: AnswerAction): void {
  actions.set(name, fn);
}

/** Actions de base de la phase 19. Rend une phrase de confirmation (ou rien). */
async function builtinAction(
  deps: AgentsDeps,
  name: string,
  onAnswer: Record<string, unknown>,
  kind: HumanRequestKindName,
  value: string,
  actor: ActorRef,
): Promise<string | undefined> {
  if (name === "setting" && typeof onAnswer.settingKey === "string") {
    await writeSetting(deps, onAnswer.settingKey, kind === "CONFIRM" ? value === "oui" : value);
    return undefined;
  }
  if (name === "set-simulation" && isTeamKey(onAnswer.teamKey)) {
    if (value !== "oui") return "D'accord, rien ne change : l'équipe reste pour de faux, sur le canal Test.";
    return (await setSimulation(deps, onAnswer.teamKey, onAnswer.simulation === true, actor)).message;
  }
  if (name === "set-autonomy" && isTeamKey(onAnswer.teamKey)) {
    const level = onAnswer.level;
    if (value !== "oui" || (level !== 0 && level !== 1 && level !== 2)) return "D'accord, le niveau ne change pas.";
    return (await setAutonomyLevel(deps, onAnswer.teamKey, level, actor)).message;
  }
  return undefined;
}

/** Missions qui attendent cette demande (la sienne et celles qui ont posé la même question). */
function waitingMissions(request: HumanRequestRow): string[] {
  const onAnswer = onAnswerOf(request.onAnswer);
  const extra = Array.isArray(onAnswer.waitingMissionIds) ? (onAnswer.waitingMissionIds as string[]) : [];
  return [...new Set([request.missionId, ...extra].filter((x): x is string => typeof x === "string"))];
}

/** Reprend les missions en WAITING_HUMAN (réponse rangée dans `payload.humanAnswers`, jamais un secret). */
export async function resumeWaitingMissions(
  deps: AgentsDeps,
  request: HumanRequestRow,
  outcome: { answered: boolean; summary: string | null },
): Promise<void> {
  const onAnswer = onAnswerOf(request.onAnswer);
  if (onAnswer.resume === false) return;
  for (const missionId of waitingMissions(request)) {
    const mission = await deps.prisma.agentMission.findUnique({ where: { id: missionId } });
    if (!mission || mission.status !== "WAITING_HUMAN") continue;
    const payload = (mission.payload && typeof mission.payload === "object" ? mission.payload : {}) as Record<string, unknown>;
    const answers = (payload.humanAnswers && typeof payload.humanAnswers === "object" ? payload.humanAnswers : {}) as Record<string, unknown>;
    answers[request.key] = outcome.answered ? (request.kind === "SECRET" ? "saved" : outcome.summary) : null;
    await deps.prisma.agentMission.update({
      where: { id: missionId },
      data: { payload: JSON.parse(JSON.stringify({ ...payload, humanAnswers: answers })) },
    });
    try {
      await lifecycle.continueMission(deps, missionId, {
        reason: outcome.answered ? "réponse du client" : "demande passée ou expirée",
      });
    } catch (err) {
      deps.logger?.error({ err: (err as Error).message, missionId }, "[agents] reprise de la mission impossible");
    }
  }
}

async function close(
  deps: AgentsDeps,
  request: HumanRequestRow,
  status: "ANSWERED" | "SKIPPED",
  summary: string | null,
  actor: ActorRef,
): Promise<boolean> {
  const done = await deps.prisma.humanRequest.updateMany({
    where: { id: request.id, status: { in: ["QUEUED", "PENDING"] } },
    data: { status, answerSummary: summary, answeredAt: nowOf(deps) },
  });
  if (done.count === 0) return false;
  await journalClose(deps, request, status, summary, actor);
  return true;
}

/** `AuditLog` + `Event` d'une demande close (jamais un secret : le résumé d'une clé est « enregistrée »). */
async function journalClose(
  deps: AgentsDeps,
  request: HumanRequestRow,
  status: "ANSWERED" | "SKIPPED",
  summary: string | null,
  actor: ActorRef,
): Promise<void> {
  const action = status === "ANSWERED" ? "agents.request.answered" : "agents.request.skipped";
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action,
    entityType: "HumanRequest",
    entityId: request.id,
    metadata: { key: request.key, kind: request.kind, via: actor.via, summary },
  });
  await agentEvent(deps, action, { requestId: request.id, key: request.key, kind: request.kind, via: actor.via });
}

/** « Plus tard » : la demande est passée, les missions qui l'attendaient reprennent sans réponse, la suivante part. */
export async function skipRequest(
  deps: AgentsDeps,
  request: HumanRequestRow,
  actor: ActorRef,
  opts: RespondOptions = {},
): Promise<RespondResult> {
  // Valeur par défaut d'un « plus tard » (`onAnswer.skipAnswer`, ex. plafond vidéo à 100 €) : vaut réponse.
  const skipAnswer = onAnswerOf(request.onAnswer).skipAnswer;
  if (typeof skipAnswer === "string" && skipAnswer.trim() && !isSkipText(skipAnswer) && request.kind !== "SECRET")
    return respondToRequest(deps, request, skipAnswer, actor, opts);
  const closed = await close(deps, request, "SKIPPED", null, actor);
  if (!closed) return { ok: false, message: "Cette demande est déjà close.", closed: false, secret: false };
  await resumeWaitingMissions(deps, request, { answered: false, summary: null });
  if (!opts.deferNext) await sendNextHumanRequest(deps);
  return { ok: true, message: "D'accord, je te le redemanderai plus tard. 👍", closed: true, secret: false };
}

/** Répond à une demande ouverte avec le texte reçu. */
export async function respondToRequest(
  deps: AgentsDeps,
  request: HumanRequestRow,
  text: string,
  actor: ActorRef,
  opts: RespondOptions = {},
): Promise<RespondResult> {
  const kind = request.kind as HumanRequestKindName;
  const secret = kind === "SECRET";
  if (request.status !== "QUEUED" && request.status !== "PENDING")
    return { ok: false, message: "Cette demande est déjà close.", closed: false, secret };
  const interpreted = interpretAnswer(
    { kind, key: request.key, options: optionsOf(request.options), expected: expectedOf(request.expected) },
    text,
  );
  if (interpreted.type === "skip") return { ...(await skipRequest(deps, request, actor, opts)), secret: false };
  if (interpreted.type === "invalid") return { ok: false, message: interpreted.message, closed: false, secret };

  const onAnswer = onAnswerOf(request.onAnswer);
  const name = typeof onAnswer.action === "string" ? onAnswer.action : null;
  if (name && STRICT_CONFIRM_ACTIONS.has(name) && interpreted.value === "oui" && !isStrictYes(opts.confirmText ?? text))
    return { ok: false, message: STRICT_CONFIRM_MESSAGE, closed: false, secret };

  // Réservation d'abord (QUEUED / PENDING → ANSWERED, conditionnelle) : deux appuis simultanés, ou une réponse qui
  // croise l'expiration, n'exécutent jamais l'action deux fois.
  const reserved = await deps.prisma.humanRequest.updateMany({
    where: { id: request.id, status: { in: ["QUEUED", "PENDING"] } },
    data: { status: "ANSWERED", answerSummary: interpreted.summary, answeredAt: nowOf(deps) },
  });
  if (reserved.count === 0) return { ok: false, message: "Cette demande est déjà traitée.", closed: false, secret };
  const previousStatus = request.status as "QUEUED" | "PENDING";
  const reopen = () =>
    deps.prisma.humanRequest.updateMany({
      where: { id: request.id, status: "ANSWERED" },
      data: { status: previousStatus, answerSummary: null, answeredAt: null },
    });

  const notes: string[] = [];
  let secretSaved = false;
  try {
    if (secret) {
      const { last4 } = await saveSecret(deps, request.key, interpreted.value, actor);
      secretSaved = true;
      const check = await verifySecret(deps, request.key);
      if (check && !check.ok) {
        // Clé refusée par le fournisseur : la demande est rouverte, il suffit de répondre avec une autre clé.
        await reopen();
        return {
          ok: false,
          message: `${secretSavedHead(request.key, last4, "reçu")}. Vérification : KO : ${check.message}. Réessaie en répondant avec une autre clé.`,
          closed: false,
          secret,
          secretSaved,
        };
      }
      notes.push(`${secretSavedHead(request.key, last4)}${check ? ". Vérification : OK ✅" : " ✅"}`);
    }

    if (name) {
      const custom = actions.get(name);
      const note = custom
        ? await custom(deps, { request, value: interpreted.value, actor, onAnswer })
        : await builtinAction(deps, name, onAnswer, kind, interpreted.value, actor);
      if (note) notes.push(note);
    }
  } catch (err) {
    // Action impossible : la demande redevient ouverte (aucune réponse perdue).
    await reopen().catch(() => undefined);
    throw err;
  }

  await journalClose(deps, request, "ANSWERED", interpreted.summary, actor);
  await resumeWaitingMissions(deps, request, { answered: true, summary: interpreted.summary });
  if (!opts.deferNext) await sendNextHumanRequest(deps);
  return { ok: true, message: notes.length ? notes.join("\n") : "Réponse notée ✅", closed: true, secret, secretSaved };
}

