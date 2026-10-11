import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { UniverseDot } from "@/components/admin/universe-dot";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { postPreview, whenLabel } from "@/lib/home/lists";
import type { UpcomingPost } from "@/lib/home/queries";
import { HomeSection, sectionLinkClass } from "./home-section";

const NEW_POST_HREF = "/messages/new";

/** « Prochains messages » : les 3 prochains messages programmés (heure de Paris, canal, début du texte). */
export function UpcomingCard({ posts, now }: { posts: readonly UpcomingPost[]; now: Date }) {
  return (
    <HomeSection
      id="prochains-messages"
      title="Prochains messages"
      action={
        <Link href="/messages" className={sectionLinkClass}>
          Voir le calendrier
        </Link>
      }
    >
      {posts.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="Aucun message programmé"
          description="Un message programmé part tout seul dans le canal à l'heure choisie."
          action={{ href: NEW_POST_HREF, label: "Programmer un message", variant: "outline" }}
          className="border-0 py-6"
        />
      ) : (
        <>
          <ol className="-mx-2 divide-y divide-border">
            {posts.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/messages/${p.id}`}
                  className="flex min-h-12 flex-col gap-0.5 rounded-lg px-2 py-2.5 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body">
                    <time
                      dateTime={p.scheduledAt.toISOString()}
                      className="font-semibold text-foreground tabular-nums"
                    >
                      {whenLabel(p.scheduledAt, now)}
                    </time>
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <UniverseDot universe={p.vertical} />
                      <span className="truncate">{p.channelTitle}</span>
                    </span>
                  </span>
                  <span className="line-clamp-2 text-note text-muted-foreground">
                    {postPreview(p.text, p.mediaCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {/* Collé à la liste (pas en bas de la carte quand elle s'étire à la hauteur de « À faire »). */}
          <div className="pt-3">
            <Link
              href={NEW_POST_HREF}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}
            >
              <Plus aria-hidden />
              Programmer un message
            </Link>
          </div>
        </>
      )}
    </HomeSection>
  );
}
