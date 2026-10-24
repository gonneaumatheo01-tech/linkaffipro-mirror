/**
 * Message texte privé de l'admin au bot du dialogue admin. Ordre : réponse à une demande (`reply_to_message`) →
 * correction en attente (« ✏️ ») → commande connue → réponse à la demande en cours. Rien de cela : `handled: false`
 * (le message reste pour `pnpm tg:inbox` et les autres handlers).
 */
import { TEAM_LABELS, type AgentsDeps } from "../types";
import { decideValidation } from "../validation/requests";
import { askHuman, currentHumanRequest, sendNextHumanRequest } from "../human/requests";
import { respondToRequest, skipRequest, type HumanRequestRow } from "../human/respond";
import { bookmakerPasswordSecretKey, bookmakerSecretKey, saveSecret, secretLabel, verifySecret } from "../human/secrets";
import { interpretAnswer, normalizeText } from "../human/answer";
import { isSecretCommandText, parseAdminCommand, type AdminCommand } from "./commands";
import { esc, nowOf, telegramActorUserId } from "./journal";
import { setTeamBudget } from "./budget";
import { setTeamPaused, type ActorRef } from "./team";
import { agentsOverview, overviewLines } from "../orchestrator/overview-contract";
import { dailyReportText } from "./report-command";
import { levelQuestion, liveQuestion, teamPlanSummary } from "./confirm-summary";

export type AdminTextInput = {
  text: string;
  messageId: number;
  replyToMessageId?: number | null;
  /** « voice » : texte transcrit d'un vocal (phase 20) ; jamais pris pour une clé, tout niveau confirmé par OUI. */
  source?: "text" | "voice";
};

/** Réponse quand une clé arriverait par un vocal : rien n'est enregistré. */
export const VOICE_SECRET_REFUSAL =
  "🔒 Une clé doit arriver par écrit : je n'enregistre jamais une clé dictée. Colle-la en réponse au message de la question.";

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
  voice = false,
): Promise<AdminTextResult> {
  if (voice && request.kind === "SECRET") return { handled: true, reply: VOICE_SECRET_REFUSAL };
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
  const where = { status: { in: ["QUEUED", "PENDING"] as ("QUEUED" | "PENDING")[] } };
  const [open, total] = await Promise.all([
    // La question en cours d'abord, puis la file dans son ordre d'envoi.
    deps.prisma.humanRequest.findMany({ where, orderBy: [{ askedAt: "asc" }, { createdAt: "asc" }], take: 5 }),
    deps.prisma.humanRequest.count({ where }),
  ]);
  if (open.length === 0) return "Aucune demande ouverte 👍";
  open.sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1));
  const lines = open.map((r, i) => {
    const first = r.question.split("\n")[0]!;
    const q = first.length > 70 ? `${first.slice(0, 69)}…` : first;
    return `${i + 1}. ${r.status === "PENDING" ? "[en cours] " : ""}${esc(q)}`;
  });
  return [`Demandes ouvertes (${total}) :`, ...lines, ...(total > open.length ? [`… et ${total - open.length} autre${total - open.length > 1 ? "s" : ""} (Agents → Validations → Demandes).`] : [])].join("\n");
}

async function runCommand(
  deps: AgentsDeps,
  cmd: AdminCommand,
  actor: ActorRef,
  voice = false,
): Promise<AdminTextResult> {
  if (voice && (cmd.type === "secret" || cmd.type === "bookmaker")) return { handled: true, reply: VOICE_SECRET_REFUSAL };
  switch (cmd.type) {
    case "status": {
      const lines = overviewLines(await agentsOverview(deps.prisma, { now: nowOf(deps) }));
      return { handled: true, reply: lines.map(esc).join("\n") };
    }
    case "report":
      return { handled: true, reply: await dailyReportText(deps) };
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
      // Deux clés séparées (comme le site et les questions du bot) ; le mot de passe déclenche le test de connexion.
      await saveSecret(deps, bookmakerSecretKey(cmd.name), cmd.login, actor);
      return storeSecretCommand(deps, bookmakerPasswordSecretKey(cmd.name), cmd.password, actor);
    case "budget": {
      // Les vidéos IA sont produites par l'équipe Dating (plan des phases 20 à 25).
      await setTeamBudget(deps, "dating", "video", cmd.euros * 100, actor);
      return { handled: true, reply: `Plafond vidéo de l'équipe Dating : ${cmd.euros.toLocaleString("fr-FR")} € par mois ✅` };
    }
    case "live": {
      // Le bot résume d'abord ce qui va se passer (canaux, quota, niveau, plafonds), puis attend OUI.
      const summary = await teamPlanSummary(deps, cmd.team);
      if (!summary.simulation) return { handled: true, reply: `L'équipe ${TEAM_LABELS[cmd.team]} est déjà en vrai.` };
      const r = await askHuman(deps, {
        teamKey: cmd.team,
        kind: "CONFIRM",
        key: `agents.team.${cmd.team}.live`,
        question: liveQuestion(cmd.team, summary),
        onAnswer: { action: "set-simulation", teamKey: cmd.team, simulation: false },
      });
      return { handled: true, reply: r.sent ? undefined : "Noté : je te pose la question juste après celle en cours." };
    }
    case "level": {
      // Tout changement de niveau est résumé puis confirmé par OUI (par écrit comme par vocal).
      const summary = await teamPlanSummary(deps, cmd.team);
      if (summary.level === cmd.level) return { handled: true, reply: `L'équipe ${TEAM_LABELS[cmd.team]} est déjà au niveau ${cmd.level}.` };
      const r = await askHuman(deps, {
        teamKey: cmd.team,
        kind: "CONFIRM",
        key: `agents.team.${cmd.team}.level${cmd.level}`,
        question: levelQuestion(cmd.team, cmd.level, summary),
        onAnswer: { action: "set-autonomy", teamKey: cmd.team, level: cmd.level },
      });
      return { handled: true, reply: r.sent ? undefined : "Noté : je te pose la question juste après celle en cours." };
    }
  }
}

export async function handleAdminText(deps: AgentsDeps, input: AdminTextInput): Promise<AdminTextResult> {
  const text = input.text.trim();
  if (!text) return { handled: false };
  const actor: ActorRef = { userId: await telegramActorUserId(deps), via: "TELEGRAM" };
  const voice = input.source === "voice";

  // 1. Réponse Telegram au message d'une question.
  if (input.replyToMessageId) {
    const request = (await deps.prisma.humanRequest.findFirst({
      where: { telegramMessageId: input.replyToMessageId, status: { in: ["QUEUED", "PENDING"] } },
    })) as HumanRequestRow | null;
    if (request) return answerRequest(deps, request, text, actor, voice);
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
  if (cmd) return runCommand(deps, cmd, actor, voice);

  // 4. Réponse à la question en cours. Sans « répondre » au message de la question, un texte qui n'est pas une réponse
  // valable à une question fermée (choix, oui / non, médias) continue son chemin : « fait », des emojis animés à
  // ranger… ne doivent pas recevoir « Réponds oui ou non ».
  const current = (await currentHumanRequest(deps)) as HumanRequestRow | null;
  if (current) {
    if (current.kind === "MEDIA") return { handled: false };
    if (current.kind === "CHOICE" || current.kind === "CONFIRM") {
      const options = Array.isArray(current.options) ? (current.options as unknown[]).map(String) : [];
      // Un chiffre hors liste reste une tentative de réponse (on la signale) ; le reste continue son chemin.
      const attempt = /^\s*\d{1,4}\s*[).€]?\s*$/.test(text);
      if (!attempt && interpretAnswer({ kind: current.kind, key: current.key, options }, text).type === "invalid")
        return { handled: false };
    }
    return answerRequest(deps, current, text, actor, voice);
  }
  return { handled: false };
}
