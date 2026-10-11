import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Plus } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ViewTabs, type MessagesView } from "@/components/messages/view-tabs";
import { listCampaignOptions } from "@/lib/campaigns/queries";
import { newPostHref } from "@/lib/posts/calendar";
import { parsePostListFilters } from "@/lib/posts/queries";
import { CalendarView } from "./_views/calendar-view";
import { ListView } from "./_views/list-view";
import { TemplatesView } from "./_views/templates-view";

export const metadata: Metadata = { title: "Messages" };

const HELP: Record<MessagesView, string> = {
  calendar: "Cliquez un message pour voir son détail, le modifier ou le déplacer.",
  list: "Cliquez un message pour voir son détail. « Exporter » télécharge la liste filtrée avec ses chiffres.",
  templates:
    "Choisissez un modèle puis « Utiliser » : le message est pré-rempli. Remplacez les mots entre accolades, puis programmez-le.",
};

/**
 * Messages : « qu'est-ce qui part, et quand ? ». Vue Calendrier (par défaut, semaine par semaine), Liste et Modèles.
 * Un seul bouton principal, « Programmer un message » ; filtres canal, univers, campagne (`campaignId`) et catégorie.
 */
export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const sp = await searchParams;
  const view: MessagesView =
    sp.view === "list" ? "list" : sp.view === "templates" ? "templates" : "calendar";
  const f = parsePostListFilters(sp);
  const [channels, categories, campaigns] = await Promise.all([
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, vertical: true },
    }),
    prisma.messageCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, color: true },
    }),
    listCampaignOptions(),
  ]);
  const options = { channels, categories, campaigns };

  // Les onglets gardent la campagne choisie (et le canal entre calendrier et liste).
  const keep = new URLSearchParams();
  if (f.campaignId) keep.set("campaignId", f.campaignId);
  const withKeep = (base: Record<string, string>) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of keep) p.set(k, v);
    const qs = p.toString();
    return qs ? `/messages?${qs}` : "/messages";
  };
  const hrefs: Record<MessagesView, string> = {
    calendar: withKeep(f.channelId ? { channelId: f.channelId } : {}),
    list: withKeep({ view: "list", ...(f.channelId ? { channel: f.channelId } : {}) }),
    templates: "/messages?view=templates",
  };

  const tabs = <ViewTabs current={view} hrefs={hrefs} />;

  return (
    <>
      <PageHeader
        title="Messages"
        description="Ce qui part dans vos canaux, et quand."
        help={HELP[view]}
        primaryAction={
          <Link
            href={newPostHref({ channelId: f.channelId || undefined })}
            className={cn(buttonVariants(), "max-md:h-10")}
          >
            <Plus aria-hidden />
            Programmer un message
          </Link>
        }
        secondaryActions={
          <Link
            href="/messages/categories"
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <BarChart3 aria-hidden />
            Comparer par catégorie
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      {/* Vues appelées comme fonctions : l'arbre rendu ne contient pas de composant asynchrone. */}
      {view === "calendar"
        ? await CalendarView({ sp, filters: f, options, tabs })
        : view === "list"
          ? await ListView({ sp, filters: f, options, tabs })
          : await TemplatesView({ sp, filters: f, tabs })}
    </>
  );
}
