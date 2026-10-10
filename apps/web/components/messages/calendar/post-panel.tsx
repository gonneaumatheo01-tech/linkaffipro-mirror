"use client";

import Link from "next/link";
import { Copy, ExternalLink, Pencil, Split } from "lucide-react";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { UniverseDot } from "@/components/admin/universe-dot";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { MovePostResult } from "@/app/(admin)/messages/move-action";
import { momentLabel } from "@/lib/posts/calendar";
import { StatusBadge } from "@/lib/status-badges";
import { MoveForm } from "../move-form";
import { TelegramPreview } from "../telegram-preview";
import type { CalendarItem } from "./types";

/**
 * Volet de détail d'un message (calendrier et liste : le même volet) : statut, univers, catégorie, aperçu,
 * « Déplacer » au clavier (brouillon ou message programmé), puis Fermer, Dupliquer, Modifier, Ouvrir (principal).
 * `onMoved` (calendrier) : affichage immédiat et « Annuler » ; sans lui (liste), la confirmation s'affiche sous
 * le formulaire et la page est rechargée.
 */
export function PostPanel({
  item,
  open,
  onOpenChange,
  onMoved,
}: {
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: (item: CalendarItem, result: MovePostResult, from: string) => void;
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={item ? `Message pour ${item.channelTitle}` : "Message"}
      description={item ? (item.local ? momentLabel(item.local) : "Sans date") : undefined}
      footer={
        item ? (
          <>
            <SidePanelClose />
            <Link
              href={`/messages/new?from=${item.id}`}
              className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
            >
              <Copy aria-hidden />
              Dupliquer
            </Link>
            {item.editable ? (
              <Link
                href={`/messages/${item.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
              >
                <Pencil aria-hidden />
                Modifier
              </Link>
            ) : null}
            <Link href={`/messages/${item.id}`} className={cn(buttonVariants(), "max-md:h-10")}>
              <ExternalLink aria-hidden />
              Ouvrir
            </Link>
          </>
        ) : null
      }
    >
      {item ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="post" value={item.status} />
            <UniverseDot universe={item.universe} variant="pill" />
            {item.category ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-note font-medium">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: item.category.color }}
                />
                {item.category.name}
              </span>
            ) : null}
            {item.abGroupId ? (
              <Link
                href={`/messages/ab/${item.abGroupId}`}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-border px-2.5 text-note font-medium text-brand-ink hover:bg-muted max-md:h-10"
              >
                <Split aria-hidden className="size-3.5" />
                Test A/B{item.abVariant ? ` · version ${item.abVariant}` : ""}
              </Link>
            ) : null}
          </div>
          <TelegramPreview
            html={item.html}
            buttons={item.buttons}
            mediaCount={item.mediaCount}
            compact
          />
          {item.movable ? (
            <section aria-labelledby="panel-move-title" className="space-y-2">
              <h3 id="panel-move-title" className="text-body font-semibold">
                Déplacer
              </h3>
              <MoveForm
                key={onMoved ? `${item.id}-${item.local}` : item.id}
                postId={item.id}
                local={item.local}
                onDone={onMoved ? (r, from) => onMoved(item, r, from) : undefined}
              />
            </section>
          ) : (
            <p className="text-note text-muted-foreground">
              {item.status === "SENT" || item.status === "SENDING" || item.status === "DELETED"
                ? "Ce message est déjà parti : il ne se déplace plus. « Dupliquer » en crée une copie à reprogrammer."
                : item.editable
                  ? "Ce message n'est pas programmé : « Modifier » permet de le reprogrammer."
                  : "Ce message ne se déplace pas."}
            </p>
          )}
        </div>
      ) : null}
    </SidePanel>
  );
}
