import { prisma } from "@linkaffipro/db";
import { ACTIVE_CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { canInviteFromRights } from "@linkaffipro/telegram";

/**
 * `GET /channels` : canaux proposables à Link Affi pour une campagne Telegram d'affilié. Canal actif (hors bibliothèque
 * de médias) où au moins un de nos bots actifs et normaux (jamais un assistant de conversation, phase 17) est
 * administrateur sans refus connu du droit d'inviter (droit accordé, ou pas encore relu : la création essaie alors nos
 * bots un par un, comme les liens de partage).
 */
export type ProposableChannel = {
  id: string;
  title: string;
  username: string | null;
  vertical: "CASINO" | "SPORTS" | "DATING" | null;
  isActive: boolean;
};

/** Un des administrateurs peut-il créer des liens ? (règle pure, testée) */
export function canProposeChannel(admins: ReadonlyArray<{ rights: unknown }>): boolean {
  return admins.some((a) => canInviteFromRights(a.rights) !== false);
}

/**
 * Administrateurs qui peuvent créer les liens : bot actif et normal, jamais un bot en mode assistant de conversation
 * (phase 17 : il ne crée pas de liens d'invitation).
 */
export const PROPOSABLE_ADMIN_WHERE = {
  revokedAt: null,
  bot: ACTIVE_CHANNEL_BOT_WHERE,
} as const;

export async function listProposableChannels(): Promise<ProposableChannel[]> {
  const rows = await prisma.channel.findMany({
    where: {
      isActive: true,
      isMediaLibrary: false,
      botAdmins: { some: PROPOSABLE_ADMIN_WHERE },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      username: true,
      vertical: true,
      isActive: true,
      botAdmins: {
        where: PROPOSABLE_ADMIN_WHERE,
        select: { rights: true },
      },
    },
  });
  return rows
    .filter((c) => canProposeChannel(c.botAdmins))
    .map((c) => ({
      id: c.id,
      title: c.title,
      username: c.username,
      vertical: c.vertical,
      isActive: c.isActive,
    }));
}
