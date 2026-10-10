import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { DataTable } from "@/components/admin/data-table";
import { FormSection } from "@/components/admin/form-section";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { postExcerpt } from "@/lib/campaigns/display";
import { fmtDate, fmtNum } from "@/lib/format";
import { listPosts } from "@/lib/posts/queries";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import type { TabProps } from "./shared";

/** Onglet Messages : messages des canaux de la campagne, ou portant un bouton Offre vers une de ses offres. */
export async function MessagesTab({ id, sp }: TabProps) {
  const page = pageOf(sp);
  const { rows, total, pages } = await listPosts({
    view: "list",
    filters: { channelId: "", status: "", categoryId: "", from: "", to: "", campaignId: id },
    page,
  });
  return (
    <FormSection
      title={`Messages (${fmtNum(total)})`}
      description="Publiés ou programmés dans les canaux de la campagne, ou avec un bouton Offre vers une de ses offres."
      actions={
        // Retour à la ligne sur téléphone : les deux boutons ne débordent jamais de l'écran.
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/messages?view=list&campaignId=${encodeURIComponent(id)}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            Voir dans Messages
          </Link>
          <Link href="/messages/new" className={cn(buttonVariants(), "max-md:h-10")}>
            <CalendarPlus aria-hidden />
            Programmer un message
          </Link>
        </div>
      }
    >
      <DataTable
        label="Messages de la campagne"
        columns={[
          { key: "text", header: "Message", className: "min-w-48 whitespace-normal" },
          { key: "channel", header: "Canal", hideOnMobile: true },
          { key: "when", header: "Quand" },
          // Téléphone : le statut passe sous l'extrait (2 colonnes, aucune cachée hors de l'écran).
          { key: "status", header: "Statut", hideOnMobile: true },
        ]}
        rows={rows.map((p) => ({
          id: p.id,
          href: `/messages/${p.id}`,
          cells: {
            text: (
              <span className="flex flex-col items-start gap-1">
                <span className="line-clamp-2 max-w-md">{postExcerpt(p.text, p.code)}</span>
                <span className="md:hidden">
                  <StatusBadge kind="post" value={p.status} />
                </span>
              </span>
            ),
            channel: p.channel.title,
            when: fmtDate(p.scheduledAt),
            status: <StatusBadge kind="post" value={p.status} />,
          },
          sortValues: {
            text: postExcerpt(p.text, p.code),
            when: p.scheduledAt,
            status: statusLabel("post", p.status),
          },
        }))}
        empty={{
          title: "Aucun message pour cette campagne",
          description:
            "Cochez ses canaux (onglet Canaux) ou programmez un message avec un bouton Offre vers une de ses offres.",
        }}
      />
      {total > 0 ? (
        <Pagination
          page={page}
          pages={pages}
          total={total}
          noun="message"
          hrefFor={(n) =>
            pageHref(`/campaigns/${id}`, { ...sp, ok: undefined, error: undefined }, n)
          }
        />
      ) : null}
    </FormSection>
  );
}
