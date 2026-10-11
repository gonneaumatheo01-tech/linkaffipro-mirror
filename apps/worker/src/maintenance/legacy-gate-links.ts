/**
 * Révocation des anciens liens des canaux à rejoindre (phase 11, décision D6).
 *
 * Avant la phase 11, le bouton « canal à rejoindre » faisait entrer directement (lien GATE sans demande d'adhésion) :
 * le canal obligatoire ne pouvait pas appliquer sa propre règle. Depuis, les liens GATE passent par une demande
 * d'adhésion et les anciens ne sont plus proposés (ni à l'accueil, ni dans les rappels). Ils restent valables 7 jours
 * pour les messages déjà envoyés, puis cette tâche les révoque chez Telegram (par le bot qui les a créés : seul lui
 * le peut), les marque inactifs et journalise `invite_link.legacy_revoked`.
 *
 * - La date de révocation est mémorisée au premier passage (Setting `phase11.legacyGateRevokeAfter` = premier passage
 *   + 7 jours) : un redémarrage ne la repousse jamais.
 * - Jamais un lien vers un canal désactivé chez nous : ce lien à entrée directe est toujours celui proposé (une demande
 *   d'adhésion n'y serait jamais traitée).
 * - Chaque lien vit au moins 7 jours (créé avant la mise en ligne, ou vers un canal réactivé depuis).
 * - Idempotente ; une erreur passagère (429, réseau, Telegram indisponible) est retentée au passage suivant ; une
 *   erreur définitive (droits retirés, bot désactivé ou illisible, lien inconnu) marque le lien inactif avec l'erreur ;
 *   une erreur sur un lien n'arrête jamais les autres.
 */
import { GrammyError, HttpError } from "grammy";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { telegramErrorText } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { apiForBot } from "../approvals/telegram-actions";

export const LEGACY_GATE_REVOKE_KEY = "phase11.legacyGateRevokeAfter";
/** Délai de grâce des anciens liens (messages déjà envoyés). */
export const LEGACY_GATE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 100;

type RevokeApi = { revokeChatInviteLink(chatId: number, inviteLink: string): Promise<unknown> };

export type LegacyGateRevokeReport = {
  /** Date de révocation (premier passage + 7 jours). */
  revokeAfter: string;
  /** La date est-elle passée ? */
  due: boolean;
  /** Liens révoqués chez Telegram. */
  revoked: number;
  /** Liens marqués inactifs sans révocation possible chez Telegram (erreur définitive, gardée dans le journal). */
  disabledOnly: number;
  /** Liens laissés pour le passage suivant (erreur passagère). */
  retryLater: number;
};

function parseDate(v: unknown): Date | null {
  const raw =
    typeof v === "string" ? v : v && typeof v === "object" ? (v as { at?: unknown }).at : null;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date de révocation : mémorisée au premier passage (premier passage + 7 jours), jamais repoussée ensuite. */
export async function legacyGateRevokeAfter(now: Date): Promise<Date> {
  const existing = parseDate(
    (await prisma.setting.findUnique({ where: { key: LEGACY_GATE_REVOKE_KEY } }))?.value,
  );
  if (existing) return existing;
  const at = new Date(now.getTime() + LEGACY_GATE_GRACE_MS).toISOString();
  // `update: {}` : si un autre passage l'a écrite entre-temps, sa date est gardée.
  const row = await prisma.setting.upsert({
    where: { key: LEGACY_GATE_REVOKE_KEY },
    create: { key: LEGACY_GATE_REVOKE_KEY, value: at },
    update: {},
  });
  return parseDate(row.value) ?? new Date(at);
}

/** Erreur passagère (à retenter) : trop de requêtes, Telegram indisponible, réseau. */
function isTransient(err: unknown): boolean {
  if (err instanceof HttpError) return true;
  if (err instanceof GrammyError) return err.error_code === 429 || err.error_code >= 500;
  return false;
}

/** Révoque les anciens liens GATE à entrée directe une fois la date passée (voir l'en-tête). */
export async function runLegacyGateRevocation(
  opts: { now?: Date; apiFor?: (bot: { id: string; tokenEncrypted: string }) => RevokeApi } = {},
): Promise<LegacyGateRevokeReport> {
  const now = opts.now ?? new Date();
  const revokeAfter = await legacyGateRevokeAfter(now);
  const report: LegacyGateRevokeReport = {
    revokeAfter: revokeAfter.toISOString(),
    due: now >= revokeAfter,
    revoked: 0,
    disabledOnly: 0,
    retryLater: 0,
  };
  if (!report.due) return report;
  const links = await prisma.inviteLink.findMany({
    where: {
      kind: "GATE",
      createsJoinRequest: false,
      isActive: true,
      channel: { isActive: true },
      createdAt: { lte: new Date(now.getTime() - LEGACY_GATE_GRACE_MS) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: {
      id: true,
      channelId: true,
      sourceChannelId: true,
      telegramInviteLink: true,
      botId: true,
      bot: { select: { id: true, isActive: true, tokenEncrypted: true, username: true } },
      channel: { select: { telegramChatId: true, title: true } },
    },
  });
  const apiFor = opts.apiFor ?? apiForBot;
  for (const l of links) {
    try {
      let error: string | null = null;
      if (!l.bot.isActive) error = "bot désactivé : lien impossible à révoquer chez Telegram";
      else {
        try {
          await apiFor(l.bot).revokeChatInviteLink(
            Number(l.channel.telegramChatId),
            l.telegramInviteLink,
          );
        } catch (err) {
          if (isTransient(err)) {
            report.retryLater++;
            logger.warn(
              { inviteLinkId: l.id, bot: l.bot.username, err: telegramErrorText(err) },
              "ancien lien du canal à rejoindre : révocation remise au passage suivant",
            );
            continue;
          }
          error = telegramErrorText(err);
        }
      }
      await prisma.inviteLink.update({ where: { id: l.id }, data: { isActive: false } });
      await recordEvent({
        type: "invite_link.legacy_revoked",
        channelId: l.channelId,
        botId: l.botId,
        payload: toJsonValue({
          inviteLinkId: l.id,
          sourceChannelId: l.sourceChannelId,
          revokedOnTelegram: error === null,
          error,
        }),
      });
      if (error === null) report.revoked++;
      else {
        report.disabledOnly++;
        logger.warn(
          { inviteLinkId: l.id, channel: l.channel.title, bot: l.bot.username, err: error },
          "ancien lien du canal à rejoindre marqué inactif sans révocation chez Telegram",
        );
      }
    } catch (err) {
      report.retryLater++;
      logger.error(
        { inviteLinkId: l.id, err: err instanceof Error ? err.message : String(err) },
        "ancien lien du canal à rejoindre : erreur, passage suivant",
      );
    }
  }
  if (report.revoked + report.disabledOnly > 0)
    logger.info(report, "anciens liens des canaux à rejoindre révoqués");
  return report;
}
