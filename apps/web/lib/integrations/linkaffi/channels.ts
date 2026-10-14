import { prisma } from "@linkaffipro/db";
import { canInviteFromRights } from "@linkaffipro/telegram";

/**
 * `GET /channels` : canaux proposables à Link Affi pour une campagne Telegram d'affilié. Canal actif (hors bibliothèque
 * de médias) où au moins un de nos bots actifs est administrateur sans refus connu du droit d'inviter (droit accordé,
 * ou pas encore relu : la création essaie alors nos bots un par un, comme les liens de partage).
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

export async function listProposableChannels(): Promise<ProposableChannel[]> {
  const rows = await prisma.channel.findMany({
    where: {
      isActive: true,
      isMediaLibrary: false,
      botAdmins: { some: { revokedAt: null, bot: { isActive: true } } },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      username: true,
      vertical: true,
      isActive: true,
      botAdmins: {
        where: { revokedAt: null, bot: { isActive: true } },
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
