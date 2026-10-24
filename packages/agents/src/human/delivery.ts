/**
 * Phase 26, section 4 — où et à qui part une demande au client. Chaque demande reçoit un responsable
 * (`assigneeTelegramId`) : le membre disponible qui couvre l'équipe et la nature (SECRET → clés, MEDIA → médias, le
 * reste → choix), sinon l'admin (null). Quand un groupe de l'équipe existe (et que `boss.group.requests` ≠ « private »),
 * la question part DANS LE GROUPE en mentionnant la personne ; une clé ne s'y demande JAMAIS : seulement « envoie-la
 * moi en privé » avec le lien vers Kevin (la question complète part aussi en privé chez le membre s'il a fait /start).
 * Sans groupe : envoi privé à l'admin, exactement comme avant. Rappels et relances : même conversation que la question.
 */
import type { AdminButton, AgentsDeps } from "../types";
import { esc } from "../admin/journal";
import { groupForRequests, bossUsername, privateLink } from "../boss/team/group";
import {
  adminFirstName,
  adminMention,
  findTeamMember,
  kindForRequest,
  mentionHtml,
  parisDateLabel,
  pickResponsible,
  type TeamMemberRow,
} from "../boss/team/members";
import { secretLabel } from "./secrets";
import { adminOnlyRequest } from "./access";

type RequestLike = {
  id: string;
  kind: string;
  key: string;
  teamKey?: string | null;
  telegramMessageId?: number | null;
  onAnswer?: unknown;
  chatId?: bigint | null;
  assigneeTelegramId?: bigint | null;
};

export type RequestDelivery = {
  messageId: number;
  /** Conversation de la question : null = privé de l'admin ; sinon le groupe. */
  chatId: bigint | null;
  assigneeTelegramId: bigint | null;
};

/**
 * Suites réservées à l'admin : niveau, passage en vrai, réglages, plafonds, seuils, catégories de paris, offre d'un
 * canal (tout ce qui change le comportement ou la dépense). Ces questions ne vont jamais à un membre.
 */
export const ADMIN_ONLY_ANSWER_ACTIONS = new Set([
  "set-autonomy",
  "set-simulation",
  "setting",
  "algo-level",
  "algo-max-posts",
  "dating-video-budget",
  // Phase 27 : garder ou annuler les réglages d'une inspiration.
  "inspiration-keep",
  "ads-cpr",
  "ads-roas",
  "sports-categories",
  "casino-channel-campaign",
]);

/** La demande doit-elle rester à l'admin (pur) ? Toute question sans équipe aussi. */
export function teamAdminOnlyRequest(req: { kind: string; teamKey?: string | null; onAnswer?: unknown }): boolean {
  const action = req.onAnswer && typeof req.onAnswer === "object" ? (req.onAnswer as Record<string, unknown>).action : undefined;
  if (typeof action === "string" && ADMIN_ONLY_ANSWER_ACTIONS.has(action)) return true;
  // Mêmes réservations que sur le site (banc d'essai, seuils pubs…), sauf les clés : un membre peut s'en occuper.
  if (req.kind !== "SECRET" && adminOnlyRequest(req)) return true;
  return !req.teamKey;
}

/** « Léa est absente jusqu'au lundi 26 octobre : » (pur). */
export function awayNote(unavailable: readonly TeamMemberRow[], now: Date): string | null {
  if (!unavailable.length) return null;
  const who = unavailable.slice(0, 2).map((m) => {
    if (m.awayUntil && m.awayUntil.getTime() > now.getTime()) return `${esc(m.firstName)} est absent·e jusqu'au ${parisDateLabel(m.awayUntil)}`;
    return `${esc(m.firstName)} n'est pas disponible`;
  });
  return who.join(", ");
}

/** Une clé ne se demande jamais en groupe : la phrase envoyée à la place (pur). */
export function groupSecretAsk(mention: string, key: string, bossUser: string | null): string {
  return `🔒 ${mention}, envoie-moi la ${esc(secretLabel(key))} en privé 👉 ${privateLink(bossUser)} (jamais ici : je l'effacerais).`;
}

/**
 * Envoie la question (première fois). `html` : la question mise en forme (`formatQuestion`). Rend le message posé,
 * la conversation et le responsable, ou null si rien n'a pu partir (la demande reste en file).
 */
export async function deliverHumanRequest(
  deps: AgentsDeps,
  req: RequestLike,
  html: string,
  opts: { buttons?: AdminButton[][] } = {},
): Promise<RequestDelivery | null> {
  const now = deps.now ? deps.now() : new Date();
  const group = await groupForRequests(deps).catch(() => null);
  if (!group || !deps.admin?.sendTo) {
    // Pas de groupe (ou tout en privé) : comme avant, la question part chez l'admin, qui en est le responsable.
    const sent = await deps.admin!.send(html, { buttons: opts.buttons });
    return sent ? { messageId: sent.messageId, chatId: null, assigneeTelegramId: null } : null;
  }
  const pick = teamAdminOnlyRequest(req)
    ? { assignee: null, unavailable: [] }
    : await pickResponsible(deps, { teamKey: req.teamKey ?? null, kind: kindForRequest(req.kind) });
  const assignee = pick.assignee;
  const note = awayNote(pick.unavailable, now);
  if (req.kind === "SECRET" && !assignee) {
    // Clé pour l'admin : en privé seulement, comme avant (rien dans le groupe).
    const sent = await deps.admin.send(note ? `${note} : je te la demande à toi.\n${html}` : html, { buttons: opts.buttons });
    return sent ? { messageId: sent.messageId, chatId: null, assigneeTelegramId: null } : null;
  }
  const mention = assignee ? mentionHtml(assignee) : await adminMention(deps);
  const head = note ? `${note} : je ${assignee ? `passe par ${esc(assignee.firstName)}` : `te le demande à toi`}.\n` : "";
  const text = req.kind === "SECRET" ? `${head}${groupSecretAsk(mention, req.key, await bossUsername(deps))}` : `${head}${mention} ${html}`;
  let sent: { messageId: number } | null = null;
  try {
    sent = await deps.admin.sendTo(group, text, { buttons: req.kind === "SECRET" ? undefined : opts.buttons });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, requestId: req.id }, "[agents] question non envoyée dans le groupe");
  }
  if (!sent) {
    // Groupe injoignable (Kevin retiré, droits) : la question part chez l'admin, comme avant.
    const priv = await deps.admin.send(html, { buttons: opts.buttons });
    return priv ? { messageId: priv.messageId, chatId: null, assigneeTelegramId: null } : null;
  }
  // Clé pour un membre qui a fait /start : la question complète part aussi en privé chez lui.
  if (req.kind === "SECRET" && assignee?.startedPrivateAt) {
    await deps.admin.sendTo(assignee.telegramUserId, html).catch((err: unknown) => {
      deps.logger?.warn({ err: (err as Error).message, requestId: req.id }, "[agents] question privée non envoyée au membre");
    });
  }
  return { messageId: sent.messageId, chatId: group, assigneeTelegramId: assignee?.telegramUserId ?? null };
}

/**
 * Rappel ou relance d'une demande déjà posée : dans la conversation de la question (groupe : avec la mention du
 * responsable ; une clé : seulement « en privé »), sinon chez l'admin. Rend le message envoyé.
 */
export async function sendRequestFollowUp(
  deps: AgentsDeps,
  req: RequestLike,
  html: string,
  opts: { buttons?: AdminButton[][]; replyToMessageId?: number } = {},
): Promise<{ messageId: number } | null> {
  if (!deps.admin) return null;
  if (req.chatId != null && deps.admin.sendTo) {
    const member = req.assigneeTelegramId ? await findTeamMember(deps, req.assigneeTelegramId) : null;
    const mention = member ? mentionHtml(member) : await adminMention(deps);
    const text = req.kind === "SECRET" ? `⏰ ${groupSecretAsk(mention, req.key, await bossUsername(deps))}` : `${mention} ${html}`;
    try {
      const sent = await deps.admin.sendTo(req.chatId, text, {
        buttons: req.kind === "SECRET" ? undefined : opts.buttons,
        replyToMessageId: opts.replyToMessageId,
      });
      if (sent) return sent;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, requestId: req.id }, "[agents] rappel non envoyé dans le groupe");
    }
    // Groupe injoignable : chez l'admin (sans « Répondre » à un message du groupe).
    return deps.admin.send(html, { buttons: opts.buttons });
  }
  return deps.admin.send(html, { buttons: opts.buttons, replyToMessageId: opts.replyToMessageId });
}

/** Prénom du responsable (« Léa ») ou de l'admin, pour les phrases. */
export async function assigneeName(deps: AgentsDeps, assignee: bigint | null | undefined): Promise<string> {
  const m = assignee ? await findTeamMember(deps, assignee) : null;
  return m ? m.firstName : adminFirstName(deps);
}
