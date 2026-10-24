/**
 * Phase 26 : diagnostic du dialogue admin (`pnpm tg:diag`), logique PURE : un instantané lu par le script
 * (`packages/telegram/scripts/tg-diag.ts`, lecture seule) → lignes ✅ / ❌ / ℹ️ avec la cause probable. Jamais un jeton ni
 * un secret : l'instantané n'en contient pas (textes de l'admin résumés à leur longueur).
 */
import { isGhostBotUsername, webhookProblems, webhookProblemText, type WebhookInfoLike } from "./webhook-health";

export type DiagBot = {
  id: string;
  username: string;
  role: "CHANNEL" | "ADMIN";
  mode: "STANDARD" | "ASSISTANT";
  isActive: boolean;
  /** Bot fantôme d'un compte réel (aucune connexion Telegram). */
  ghost?: boolean;
  /** `getWebhookInfo` (null : non lu). */
  info?: WebhookInfoLike | null;
  infoError?: string | null;
  /** `getMe().can_read_all_group_messages` (Boss : mode confidentialité). */
  canReadAllGroupMessages?: boolean | null;
};

export type DiagQueue = {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  /** Fin de la dernière tâche terminée (ou échouée). */
  lastActivityAt: Date | null;
  /** Plus ancienne tâche en attente. */
  oldestWaitingAt?: Date | null;
  error?: string | null;
};

export type DiagSnapshot = {
  now: Date;
  adminId: string | null;
  /** Bot du dialogue admin (`adminBot()`). */
  adminBotId: string | null;
  adminBotIsBoss: boolean;
  /** Adresse de base attendue (APP_BASE_URL). */
  baseUrl: string | null;
  bots: DiagBot[];
  /** Dernier message privé de l'admin reçu (`Event` `telegram.message`). */
  lastAdminMessage: { at: Date; botUsername: string | null; textLength: number; isCommand: boolean } | null;
  /** Ce qui a suivi ce message. */
  lastBossTurn: { at: Date; role: string; status: string | null; actionKey: string | null } | null;
  lastAuditAfter: { at: Date; action: string } | null;
  queues: DiagQueue[];
  heartbeatAgeSec: number | null;
  pendingRequest: { key: string; kind: string; askedAt: Date | null; telegramMessageId: number | null } | null;
  /** Le service web a-t-il le dialogue des agents branché (`agentsDeps`, `isAdminDialogPartner`) ? */
  webDialogWired: boolean;
};

export type DiagLine = { status: "ok" | "ko" | "info"; text: string; cause?: string };

const ok = (text: string): DiagLine => ({ status: "ok", text });
const ko = (text: string, cause: string): DiagLine => ({ status: "ko", text, cause });
const info = (text: string): DiagLine => ({ status: "info", text });

function ago(now: Date, at: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (s < 90) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

/** Une tâche du Boss en attente depuis plus de 2 minutes = le worker ne répond plus aux messages. */
export const BOSS_QUEUE_LATE_MS = 2 * 60_000;

export function diagLines(s: DiagSnapshot): DiagLine[] {
  const out: DiagLine[] = [];
  const { now } = s;

  out.push(
    s.adminId
      ? ok(`Identifiant admin présent (${s.adminId})`)
      : ko("Identifiant admin absent", "Setting admin.telegramUserId vide : lancer pnpm tg:send une fois (il le mémorise)"),
  );
  out.push(s.webDialogWired ? ok("Dialogue des agents branché dans le service web") : ko("Dialogue des agents non branché", "agentsDeps ou isAdminDialogPartner absent des dépendances du webhook"));

  const admin = s.bots.find((b) => b.id === s.adminBotId) ?? null;
  if (!admin) out.push(ko("Aucun bot du dialogue admin", "ni Boss actif, ni bot casino de canal actif en mode normal"));
  else {
    const label = `@${admin.username} (${admin.role === "ADMIN" ? "Boss" : "bot casino de repli"}, mode ${admin.mode === "STANDARD" ? "normal" : "assistant"}, ${admin.isActive ? "actif" : "désactivé"})`;
    if (!admin.isActive || admin.mode !== "STANDARD") out.push(ko(`Bot du dialogue admin : ${label}`, "un bot désactivé ou assistant ne doit jamais être choisi"));
    else out.push(ok(`Bot du dialogue admin : ${label}`));
    if (!s.adminBotIsBoss) out.push(info("Pas encore de Boss : le bot casino fait office de Boss (créer le Boss : jeton boss <jeton>)"));
  }

  for (const b of s.bots) {
    if (!b.isActive) continue;
    if (b.ghost || isGhostBotUsername(b.username)) {
      out.push(info(`@${b.username} : bot fantôme d'un compte réel, aucune connexion Telegram à contrôler`));
      continue;
    }
    const role = b.role === "ADMIN" ? "Boss" : b.mode === "ASSISTANT" ? "assistant" : "canal";
    if (!b.info) {
      out.push(ko(`@${b.username} (${role}) : connexion Telegram illisible`, b.infoError ? `Telegram : ${b.infoError}` : "jeton refusé ou réseau"));
      continue;
    }
    const expected = s.baseUrl ? `${s.baseUrl.replace(/\/$/, "")}/api/telegram/${b.id}` : "";
    const problems = webhookProblems(b.info, expected, now);
    const pending = b.info.pending_update_count ?? 0;
    const lastErr = b.info.last_error_message
      ? ` ; dernière erreur ${b.info.last_error_date ? ago(now, new Date(b.info.last_error_date * 1000)) : ""} : ${b.info.last_error_message}`
      : "";
    if (problems.length === 0) out.push(ok(`@${b.username} (${role}) : connexion Telegram correcte, ${pending} en attente${lastErr}`));
    else out.push(ko(`@${b.username} (${role}) : ${pending} en attente${lastErr}`, problems.map(webhookProblemText).join(" ; ")));
    if (pending > 50) out.push(ko(`@${b.username} : ${pending} mises à jour en attente chez Telegram`, "notre site ne les accepte pas (erreur ou lenteur) : voir la dernière erreur"));
    if (b.role === "ADMIN" && b.canReadAllGroupMessages !== undefined && b.canReadAllGroupMessages !== null)
      out.push(
        info(
          b.canReadAllGroupMessages
            ? `@${b.username} : mode confidentialité désactivé (voit tous les messages du groupe)`
            : `@${b.username} : mode confidentialité activé (en groupe, ne voit que les mentions, les réponses et les commandes)`,
        ),
      );
  }

  if (!s.lastAdminMessage) out.push(ko("Aucun message privé de l'admin reçu", "l'admin n'a jamais écrit, ou les messages n'arrivent pas (voir la connexion Telegram ci-dessus)"));
  else {
    const m = s.lastAdminMessage;
    out.push(info(`Dernier message de l'admin : ${ago(now, m.at)} sur @${m.botUsername ?? "?"} (${m.isCommand ? "commande" : `${m.textLength} caractères`})`));
    const after = [s.lastBossTurn && s.lastBossTurn.at >= m.at ? s.lastBossTurn.at : null, s.lastAuditAfter?.at ?? null].filter(
      (d): d is Date => !!d && d >= m.at,
    );
    if (s.lastBossTurn && s.lastBossTurn.at >= m.at)
      out.push(ok(`Suivi : tour du Boss ${ago(now, s.lastBossTurn.at)} (${s.lastBossTurn.role}, ${s.lastBossTurn.status ?? "?"}${s.lastBossTurn.actionKey ? `, ${s.lastBossTurn.actionKey}` : ""})`));
    if (s.lastAuditAfter && s.lastAuditAfter.at >= m.at) out.push(ok(`Suivi : action ${s.lastAuditAfter.action} ${ago(now, s.lastAuditAfter.at)}`));
    if (after.length === 0)
      out.push(
        now.getTime() - m.at.getTime() > BOSS_QUEUE_LATE_MS
          ? ko("Rien n'a suivi ce message", "pas de tour du Boss ni d'action journalisée : réponse peut-être partie sans journal (commande simple), ou message perdu")
          : info("Message trop récent pour juger de la suite"),
      );
  }

  for (const q of s.queues) {
    if (q.error) {
      out.push(ko(`File ${q.name} illisible`, q.error));
      continue;
    }
    const late = q.oldestWaitingAt && now.getTime() - q.oldestWaitingAt.getTime() > BOSS_QUEUE_LATE_MS;
    const line = `File ${q.name} : ${q.waiting} en attente, ${q.active} en cours, ${q.failed} en échec, dernière activité ${q.lastActivityAt ? ago(now, q.lastActivityAt) : "jamais"}`;
    if (late) out.push(ko(line, "des tâches attendent depuis plus de 2 min : service d'arrière-plan arrêté ou bloqué"));
    else out.push(ok(line));
  }

  if (s.heartbeatAgeSec === null) out.push(ko("Battement du service d'arrière-plan absent", "worker arrêté (aucun battement dans Redis)"));
  else if (s.heartbeatAgeSec > 180) out.push(ko(`Dernier battement du service d'arrière-plan il y a ${s.heartbeatAgeSec} s`, "worker arrêté ou bloqué"));
  else out.push(ok(`Service d'arrière-plan en vie (battement il y a ${s.heartbeatAgeSec} s)`));

  if (!s.pendingRequest) out.push(info("Aucune question en cours"));
  else {
    const r = s.pendingRequest;
    out.push(
      r.telegramMessageId
        ? info(`Question en cours : ${r.key} (${r.kind}), posée ${r.askedAt ? ago(now, r.askedAt) : "?"}, message ${r.telegramMessageId}`)
        : ko(`Question en cours : ${r.key} (${r.kind}) sans message Telegram`, "la question n'a pas pu partir : relancer depuis Agents → Demandes"),
    );
  }
  return out;
}

export function formatDiag(lines: DiagLine[]): string {
  return lines
    .map((l) => `${l.status === "ok" ? "✅" : l.status === "ko" ? "❌" : "ℹ️ "} ${l.text}${l.cause ? `\n   → cause probable : ${l.cause}` : ""}`)
    .join("\n");
}
