import {
  createShareLinkAction,
  disableShareLinkAction,
} from "@/app/(admin)/channels/[id]/share-links-actions";
import { SHARE_NAME_MAX, loadShareLinks } from "@/lib/channels/share-links";
import { ShareLinksManager } from "./share-links-client";

/**
 * Section « Liens de partage » de la fiche canal (phase 11), à placer sous « Qui peut entrer et quand » : lit les liens
 * de partage du canal (chiffres, règle appliquée), nos canaux pour « À poster dans » et le bot qui créera les liens,
 * puis affiche la liste et le volet de création (composants client de `share-links-client.tsx`).
 */
export async function ShareLinksSection({ channelId }: { channelId: string }) {
  const data = await loadShareLinks(channelId);
  return (
    <ShareLinksManager
      channelId={channelId}
      data={data}
      nameMax={SHARE_NAME_MAX}
      createAction={createShareLinkAction}
      disableAction={disableShareLinkAction}
    />
  );
}
