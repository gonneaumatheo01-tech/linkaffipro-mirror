import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { AddEmojisPanel } from "@/components/custom-emoji/add-emojis-panel";
import { EmojiLibrary } from "@/components/custom-emoji/emoji-library";
import { ViewTabs } from "@/components/messages/view-tabs";
import { accountImportState, activeBotUsernames, loadLibrary } from "@/lib/custom-emoji/queries";
import { requireUser } from "@/lib/session";
import {
  hideEmojiAction,
  importPackAction,
  requestAccountImportAction,
  restoreEmojiAction,
  retryPreviewsAction,
} from "./actions";

export const metadata: Metadata = { title: "Emojis animés" };

/**
 * Messages → Emojis animés (phase 12) : la bibliothèque des emojis animés de l'équipe (emojis des packs Premium de
 * Telegram), à insérer dans les messages avec le bouton « Emoji animé » de l'éditeur. Un seul bouton principal :
 * « Ajouter des emojis animés » (volet : transférer un message au bot, coller le lien d'un pack, importer les packs du
 * compte connecté ; `?ajouter=1` l'ouvre). Retirer un emoji, et revoir les emojis retirés : administrateurs.
 */
export default async function CustomEmojiLibraryPage({
  searchParams,
}: PageProps<"/messages/emojis">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const showHidden = isAdmin && sp.vue === "retires";
  const [library, bots, account] = await Promise.all([
    loadLibrary({ hidden: showHidden }),
    activeBotUsernames(),
    accountImportState(),
  ]);

  return (
    <>
      <PageHeader
        title="Emojis animés"
        description="Les emojis animés de l'équipe, à insérer dans vos messages avec le bouton « Emoji animé » de l'éditeur."
        help="Le plus simple : transférez au bot un message qui contient vos emojis animés."
        primaryAction={
          <AddEmojisPanel
            bots={bots}
            account={account}
            importPack={importPackAction}
            importAccount={requestAccountImportAction}
            defaultOpen={sp.ajouter === "1"}
          />
        }
      />
      <div className="mb-6">
        <ViewTabs
          current="emojis"
          hrefs={{
            calendar: "/messages",
            list: "/messages?view=list",
            templates: "/messages?view=templates",
          }}
        />
      </div>
      <EmojiLibrary
        emojis={library.emojis}
        isAdmin={isAdmin}
        showHidden={showHidden}
        hiddenCount={library.hiddenCount}
        missingPreviews={library.missingPreviews}
        hide={hideEmojiAction}
        restore={restoreEmojiAction}
        retryPreviews={retryPreviewsAction}
      />
    </>
  );
}
