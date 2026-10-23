/**
 * Message texte privé de l'admin au bot du dialogue admin. Ordre : réponse à une demande (`reply_to_message`) →
 * correction en attente (« ✏️ ») → commande connue → réponse à la demande en cours. Rien de cela : `handled: false`
 * (le message reste pour `pnpm tg:inbox` et les autres handlers).
 */
import { TEAM_LABELS, type AgentsDeps } from "../types";
import { decideValidation } from "../validation/requests";
import { askHuman, currentHumanRequest, sendNextHumanRequest } from "../human/requests";
import { respondToRequest, skipRequest, type HumanRequestRow } from "../human/respond";
import { bookmakerSecretKey, saveSecret, secretLabel, verifySecret } from "../human/secrets";
import { normalizeText } from "../human/answer";
import { isSecretCommandText, parseAdminCommand, type AdminCommand } from "./commands";
import { agentAudit, esc, nowOf, telegramActorUserId } from "./journal";
import { agentsStatusText, setAutonomyLevel, setTeamPaused, type ActorRef } from "./team";

export type AdminTextInput = { text: string; messageId: number; replyToMessageId?: number | null };

export type AdminTextResult = {
  handled: boolean;
  reply?: string;
  /** Supprimer le message de l'admin (il contenait un secret). */
  deleteMessage?: boolean;
  secret?: boolean;
  /** À appeler APRÈS la réponse : envoie la question suivante (ordre de la conversation). */
  followUp?: () => Promise<void>;
};

const EDIT_WINDOW_MS = 24 * 3600_000;

function nextQuestion(deps: AgentsDeps): () => Promise<void> {
  return async () => {
    await sendNextHumanRequest(deps);
  };
}

async function answerRequest(
  deps: AgentsDeps,
  request: HumanRequestRow,
  text: string,
  actor: ActorRef,
): Promise<AdminTextResult> {
  const r = await respondToRequest(deps, request, text, actor, { deferNext: true });
  return {
    handled: true,
    reply: r.message,
    secret: r.secret,
    deleteMessage: r.secret,
    followUp: r.closed ? nextQuestion(deps) : undefined,
  };
}

/** « clé fal … » / « bookmaker … » : la demande ouverte de la même clé est répondue, sinon la clé est rangée seule. */
async function storeSecretCommand(
  deps: AgentsDeps,
  key: string,
  value: string,
  actor: ActorRef,
): Promise<AdminTextResult> {
  const open = (await deps.prisma.humanRequest.findFirst({
    where: { key, kind: "SECRET", status: { in: ["QUEUED", "PENDING"] } },
  })) as HumanRequestRow | null;
  if (open) return { ...(await answerRequest(deps, open, value, actor)), secret: true, deleteMessage: true };
  const { last4 } = await saveSecret(deps, key, value, actor);
  const check = await verifySecret(deps, key);
  const label = secretLabel(key);
  const head = `${label.charAt(0).toUpperCase()}${label.slice(1)} enregistrée (…${last4})`;
  const reply = !check ? `${head} ✅` : check.ok ? `${head}. Vérification : OK ✅` : `${head}. Vérification : KO : ${check.message}. Réessaie avec une autre clé.`;
  return { handled: true, reply, secret: true, deleteMessage: true };
}

async function listRequests(deps: AgentsDeps): Promise<string> {
  const open = await deps.prisma.humanRequest.findMany({
    where: { status: { in: ["QUEUED", "PENDING"] } },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  if (open.length === 0) return "Aucune demande ouverte 👍";
  const lines = open.map((r, i) => {
    const first = r.question.split("\n")[0]!;
    const q = first.length > 70 ? `${first.slice(0, 69)}…` : first;
    return `${i + 1}. ${r.status === "PENDING" ? "[en cours] " : ""}${esc(q)}`;
  });
  return [`Demandes ouvertes (${open.length}) :`, ...lines].join("\n");
}

async function runCommand(deps: AgentsDeps, cmd: AdminCommand, actor: ActorRef): Promise<AdminTextResult> {
  switch (cmd.type) {
    case "status":
      return { handled: true, reply: await agentsStatusText(deps) };
    case "pause":
    case "resume":
      return { handled: true, reply: (await setTeamPaused(deps, cmd.team, cmd.type === "pause", actor)).message };
    case "approve":
      return {
        handled: true,
        reply: (await decideValidation(deps, { number: cmd.number, decision: "approve", via: "TELEGRAM", byUserId: actor.userId })).message,
      };
    case "reject":
      return {
        handled: true,
        reply: (
          await decideValidation(deps, {
            number: cmd.number,
            decision: "reject",
            rejectReason: cmd.reason,
            via: "TELEGRAM",
            byUserId: actor.userId,
          })
        ).message,
      };
    case "requests":
      return { handled: true, reply: await listRequests(deps) };
    case "later": {
      const current = (await currentHumanRequest(deps)) as HumanRequestRow | null;
      if (!current) return { handled: true, reply: "Aucune question en cours." };
      const r = await skipRequest(deps, current, actor, { deferNext: true });
      return { handled: true, reply: r.message, followUp: nextQuestion(deps) };
    }
    case "secret":
      return storeSecretCommand(deps, cmd.key, cmd.value, actor);
    case "bookmaker":
      return storeSecretCommand(
        deps,
        bookmakerSecretKey(cmd.name),
        JSON.stringify({ login: cmd.login, password: cmd.password }),
        actor,
      );
    case "budget": {
      // Les vidéos IA sont produites par l'équipe Dating (plan des phases 20 à 25).
      const cents = Math.round(cmd.euros * 100);
      const cfg = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "dating" } });
      const budgets = { ...((cfg?.monthlyBudgetCents as Record<string, number> | null) ?? {}), video: cents };
      await deps.prisma.agentTeamConfig.upsert({
        where: { teamKey: "dating" },
        create: { teamKey: "dating", monthlyBudgetCents: budgets, updatedById: actor.userId ?? null },
        update: { monthlyBudgetCents: budgets, updatedById: actor.userId ?? null },
      });
      await agentAudit(deps, {
        userId: actor.userId ?? null,
        action: "agents.team.budget",
        entityType: "AgentTeamConfig",
        entityId: "dating",
        metadata: { provider: "video", cents, via: actor.via },
      });
      return { handled: true, reply: `Plafond vidéo de l'équipe Dating : ${cmd.euros.toLocaleString("fr-FR")} € par mois ✅` };
    }
    case "live": {
      const r = await askHuman(deps, {
        teamKey: cmd.team,
        kind: "CONFIRM",
        key: `agents.team.${cmd.team}.live`,
        question: `Passer l'équipe ${TEAM_LABELS[cmd.team]} en vrai ? Ses posts partiront sur les vrais canaux. Réponds OUI pour confirmer, « non » pour annuler.`,
        onAnswer: { action: "set-simulation", teamKey: cmd.team, simulation: false },
      });
      return { handled: true, reply: r.sent ? undefined : "Noté : je te pose la question juste après celle en cours." };
    }
    case "level": {
      if (cmd.level < 2) return { handled: true, reply: (await setAutonomyLevel(deps, cmd.team, cmd.level, actor)).message };
      const r = await askHuman(deps, {
        teamKey: cmd.team,
        kind: "CONFIRM",
        key: `agents.team.${cmd.team}.level2`,
        question: `Passer l'équipe ${TEAM_LABELS[cmd.team]} en autonomie totale ? Elle publiera sans te demander, tu recevras seulement le rapport. Réponds OUI pour confirmer, « non » pour annuler.`,
        onAnswer: { action: "set-autonomy", teamKey: cmd.team, level: 2 },
      });
      return { handled: true, reply: r.sent ? undefined : "Noté : je te pose la question juste après celle en cours." };
    }
  }
}

export async function handleAdminText(deps: AgentsDeps, input: AdminTextInput): Promise<AdminTextResult> {
  const text = input.text.trim();
  if (!text) return { handled: false };
  const actor: ActorRef = { userId: await telegramActorUserId(deps), via: "TELEGRAM" };

  // 1. Réponse Telegram au message d'une question.
  if (input.replyToMessageId) {
    const request = (await deps.prisma.humanRequest.findFirst({
      where: { telegramMessageId: input.replyToMessageId, status: { in: ["QUEUED", "PENDING"] } },
    })) as HumanRequestRow | null;
    if (request) return answerRequest(deps, request, text, actor);
  }

  // 2. Correction demandée par « ✏️ Corriger » : ce message est le nouveau texte du post.
  const editing = await deps.prisma.agentValidation.findFirst({
    where: { status: "PENDING", awaitingEditAt: { not: null } },
    orderBy: { awaitingEditAt: "desc" },
  });
  // Une clé collée pendant une correction n'est jamais prise pour le texte d'un post.
  if (
    editing?.awaitingEditAt &&
    !isSecretCommandText(text) &&
    nowOf(deps).getTime() - editing.awaitingEditAt.getTime() < EDIT_WINDOW_MS
  ) {
    if (["annule", "annuler", "stop"].includes(normalizeText(text))) {
      await deps.prisma.agentValidation.update({ where: { id: editing.id }, data: { awaitingEditAt: null } });
      return { handled: true, reply: `Correction annulée : le post n°${editing.number} attend toujours ta décision.` };
    }
    const r = await decideValidation(deps, {
      validationId: editing.id,
      decision: "edit",
      editedText: input.text,
      via: "TELEGRAM",
      byUserId: actor.userId,
    });
    return { handled: true, reply: r.message };
  }

  // 3. Commande connue.
  const cmd = parseAdminCommand(text);
  if (cmd) return runCommand(deps, cmd, actor);

  // 4. Réponse à la question en cours.
  const current = (await currentHumanRequest(deps)) as HumanRequestRow | null;
  if (current) return answerRequest(deps, current, text, actor);
  return { handled: false };
}
