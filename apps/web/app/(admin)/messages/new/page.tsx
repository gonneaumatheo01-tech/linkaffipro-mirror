import type { Metadata } from "next";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { PostForm, type PostFormValues } from "@/components/messages/post-form";
import { parseButtons } from "@/lib/posts/buttons";
import { toParisLocalInput } from "@/lib/posts/time";
import { createPostAction } from "../actions";

export const metadata: Metadata = { title: "Nouveau message" };

export async function loadFormOptions() {
  const [channels, categories, campaigns] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, language: true },
    }),
    prisma.messageCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.affiliateCampaign.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, program: { select: { name: true } } },
    }),
  ]);
  return {
    channels,
    categories,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, programName: c.program.name })),
  };
}

/** Prochain quart d'heure, dans au moins une heure. */
function defaultScheduleTime(): Date {
  return new Date(Math.ceil((Date.now() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
}

export default async function NewMessagePage({ searchParams }: PageProps<"/messages/new">) {
  const sp = await searchParams;
  const fromId = typeof sp.from === "string" ? sp.from : null;
  const source = fromId ? await prisma.post.findUnique({ where: { id: fromId } }) : null;
  const media = source
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: (source.mediaAssetIds as string[]) ?? [] } },
        select: { id: true, filename: true, mimeType: true, size: true },
      })
    : [];
  const { channels, categories, campaigns } = await loadFormOptions();
  const defaultAt = defaultScheduleTime();
  const initial: PostFormValues = {
    channelIds: source ? [source.channelId] : [],
    scheduledAt: toParisLocalInput(defaultAt),
    categoryId: source?.categoryId ?? "",
    language: source?.language ?? "fr",
    text: source?.text ?? "",
    media: media.sort(
      (a, b) =>
        (source!.mediaAssetIds as string[]).indexOf(a.id) -
        (source!.mediaAssetIds as string[]).indexOf(b.id),
    ),
    buttons: source
      ? parseButtons(source.buttons).map((row) =>
          row.map((b) => ({ ...b, trackingLinkId: undefined, slug: undefined })),
        )
      : [],
    pinAfterSend: source?.pinAfterSend ?? false,
    unpinPrevious: source?.unpinPrevious ?? false,
    deleteAfterMinutes: source?.deleteAfterMinutes ? String(source.deleteAfterMinutes) : "",
    disableNotification: source?.disableNotification ?? false,
    protectContent: source?.protectContent ?? false,
    disableLinkPreview: source?.disableLinkPreview ?? true,
    isTemplate: false,
    templateName: "",
    duplicatedFromId: source?.id,
  };
  return (
    <>
      <PageHeader
        title={
          source
            ? source.isTemplate
              ? `Nouveau message depuis « ${source.templateName} »`
              : "Dupliquer le message"
            : "Nouveau message"
        }
        description="Un message publié par le bot dans un ou plusieurs canaux, à la date et à l'heure que vous choisissez."
        help="Cochez les canaux, écrivez le texte, ajoutez médias et boutons, puis cliquez « Programmer ». L'aperçu à droite montre le rendu dans Telegram."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <PostForm
        action={createPostAction}
        channels={channels}
        categories={categories}
        campaigns={campaigns}
        initial={initial}
      />
    </>
  );
}
