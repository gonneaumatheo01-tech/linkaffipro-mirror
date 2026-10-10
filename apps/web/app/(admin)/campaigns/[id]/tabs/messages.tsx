import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination, pageHref, pageOf } from "@/components/admin/pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { listPosts } from "@/lib/posts/queries";
import { StatusBadge } from "@/lib/status-badges";
import type { TabProps } from "./shared";

/** Onglet Messages : messages des canaux de la campagne, ou portant un bouton Offre vers une de ses offres. */
export async function MessagesTab({ id, sp }: TabProps) {
  const page = pageOf(sp);
  const { rows, total, pages } = await listPosts({ view: "list", filters: { channelId: "", status: "", categoryId: "", from: "", to: "", campaignId: id }, page });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Messages ({total})</CardTitle>
          <CardDescription>Messages publiés ou programmés dans les canaux de la campagne, et ceux qui portent un bouton Offre vers une de ses offres Link Affi.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="max-md:h-10" render={<Link href={`/messages?view=list&campaign=${id}`} />}>
            Voir dans Messages
          </Button>
          <Button size="sm" className="max-md:h-10" render={<Link href="/messages/new" />}>
            Nouveau message
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="Aucun message pour cette campagne." description="Cochez ses canaux (onglet Canaux) ou publiez un message avec un bouton Offre choisi dans cette campagne." action={{ href: "/messages/new", label: "Nouveau message" }} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quand</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead className="hidden md:table-cell">Catégorie</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(p.scheduledAt)}</TableCell>
                    <TableCell>{p.channel.title}</TableCell>
                    <TableCell className="hidden md:table-cell">{p.category?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-md">
                      <Link href={`/messages/${p.id}`} className="line-clamp-2 hover:underline">
                        {p.text.replace(/<[^>]+>/g, "").trim() || `(message ${p.code})`}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="post" value={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} pages={pages} total={total} noun="message" hrefFor={(n) => pageHref(`/campaigns/${id}`, { ...sp, ok: undefined, error: undefined }, n)} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
