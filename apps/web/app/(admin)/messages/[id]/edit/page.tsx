import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { PostForm, type PostFormValues } from "@/components/messages/post-form";
import { parseButtons } from "@/lib/posts/buttons";
import { toParisLocalInput } from "@/lib/posts/time";
import { loadBestSlots } from "@/lib/besthours/queries";
import { updatePostAction } from "../../actions";
import { loadFormOptions, postEmojiActions } from "../../new/page";

export const metadata: Metadata = { title: "Modifier le message" };

export default async function EditMessagePage({
  params,
  searchParams,
}: PageProps<"/messages/[id]/edit">) {
  const { id } = await params;
  const sp = await searchParams;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) notFound();
  const ids = (post.mediaAssetIds as string[]) ?? [];
  const media = await prisma.mediaAsset.findMany({
    where: { id: { in: ids } },
    select: { id: true, filename: true, mimeType: true, size: true },
  });
  const { channels, categories, campaigns, campaignOptions, accountStatus } =
    await loadFormOptions();
  const bestSlots = post.isTemplate ? {} : await loadBestSlots(channels.map((c) => c.id));
  const initial: PostFormValues = {
    postId: post.id,
    channelIds: [post.channelId],
    scheduledAt: post.scheduledAt ? toParisLocalInput(post.scheduledAt) : "",
    categoryId: post.categoryId ?? "",
    language: post.language,
    text: post.text,
    media: media.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    buttons: parseButtons(post.buttons),
    pinAfterSend: post.pinAfterSend,
    unpinPrevious: post.unpinPrevious,
    deleteAfterMinutes: post.deleteAfterMinutes ? String(post.deleteAfterMinutes) : "",
    disableNotification: post.disableNotification,
    protectContent: post.protectContent,
    disableLinkPreview: post.disableLinkPreview,
    isTemplate: post.isTemplate,
    templateName: post.templateName ?? "",
    vertical: post.vertical,
  };
  const editable = ["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"].includes(post.status);
  return (
    <>
      <PageHeader
        title={post.isTemplate ? `Modèle « ${post.templateName} »` : "Modifier le message"}
        description={
          post.isTemplate
            ? "Les messages créés ensuite à partir de ce modèle reprendront ces changements."
            : "Modifiez le texte, les boutons ou la date, puis « Programmer »."
        }
        help={
          editable && !post.isTemplate
            ? "« Enregistrer en brouillon » retire le message des envois prévus (il reste dans le calendrier, en brouillon)."
            : undefined
        }
        backHref={post.isTemplate ? "/messages?view=templates" : `/messages/${post.id}`}
        backLabel={post.isTemplate ? "Modèles" : "Message"}
      />
      <Flash
        ok={sp.ok}
        error={
          editable
            ? sp.error
            : "Ce message a déjà été envoyé : il ne peut plus être modifié. Vous pouvez le dupliquer pour en créer un nouveau."
        }
      />
      {editable ? (
        <PostForm
          action={updatePostAction}
          channels={channels}
          categories={categories}
          campaigns={campaigns}
          campaignOptions={campaignOptions}
          initial={initial}
          singleChannel
          bestSlots={bestSlots}
          accountStatus={accountStatus}
          emojiActions={postEmojiActions}
        />
      ) : null}
    </>
  );
}
