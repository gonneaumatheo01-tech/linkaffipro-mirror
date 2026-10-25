import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { OrderProgress } from "@/components/agents/orders/order-progress";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ORDER_EXAMPLE,
  ORDER_STATUSES,
  ORDER_TEAMS,
  orderHref,
  orderTeamName,
  orderTitle,
  parseOrderFilters,
  periodText,
} from "@/lib/agents/orders";
import { ORDERS_SHOWN, loadOrdersList } from "@/lib/agents/orders-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge, statusLabel } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Ordres" };
export const dynamic = "force-dynamic";

/**
 * Agents → Ordres (phase 33) : ce que vous avez demandé aux équipes par Kevin (« programme 3 jours de paris sur le
 * canal Test »), devenu un ordre récapitulé, confirmé quand il le faut, exécuté et suivi. Liste filtrable par équipe
 * et par statut ; un clic ouvre la fiche (plan, missions, réglage temporaire du canal, chronologie, Arrêter /
 * Prolonger pour les administrateurs). Tout le monde lit ; rien ici n'appelle une IA.
 */
export default async function AgentsOrdersPage({ searchParams }: PageProps<"/agents/orders">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const filters = parseOrderFilters(sp);
  const filtered = Boolean(filters.team || filters.status);
  const [{ rows, total }, pending] = await Promise.all([loadOrdersList(filters), loadPendingCounts()]);
  const running = rows.filter((r) => r.status === "RUNNING").length;
  const waiting = rows.filter((r) => r.status === "WAITING_CONFIRM").length;

  return (
    <>
      <AgentsNav current="orders" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Ordres"
        description="Ce que vous avez demandé aux équipes par Kevin : il le récapitule, demande votre OUI quand il le faut, le fait faire par l'équipe dans ses limites et vous en rend compte chaque jour."
        help="Écrivez à Kevin « mes ordres » pour la liste, « où en est l'ordre sur Test ? », « passe à 3 par jour », « prolonge de 2 jours » ou « arrête »."
        secondaryActions={
          <Link href="/agents/boss" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Parler à Kevin
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <form
        method="get"
        aria-label="Filtrer les ordres"
        className="mb-6 grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3 sm:items-end md:p-4"
      >
        <div className="min-w-0 space-y-1">
          <Label htmlFor="orders-team" className="text-note font-medium text-muted-foreground">
            Équipe
          </Label>
          <NativeSelect id="orders-team" name="team" defaultValue={filters.team} wrapperClassName="w-full">
            <option value="">Toutes les équipes</option>
            {ORDER_TEAMS.map((t) => (
              <option key={t} value={t}>
                {orderTeamName(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="orders-status" className="text-note font-medium text-muted-foreground">
            Statut
          </Label>
          <NativeSelect id="orders-status" name="status" defaultValue={filters.status} wrapperClassName="w-full">
            <option value="">Tous les statuts</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel("teamOrder", s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="max-md:h-10">
          Filtrer
        </Button>
      </form>

      <FormSection
        title="Ordres"
        description={
          total
            ? `${fmtNum(total)} ordre${total > 1 ? "s" : ""}${running ? ` · ${fmtNum(running)} en cours` : ""}${waiting ? ` · ${fmtNum(waiting)} attend${waiting > 1 ? "ent" : ""} votre OUI` : ""}${total > rows.length ? ` · les ${fmtNum(rows.length)} plus récents` : ""}. Cliquez sur une ligne pour la fiche.`
            : undefined
        }
      >
        {rows.length === 0 && !filtered ? (
          <EmptyState
            icon={<ClipboardList />}
            title="Aucun ordre pour l'instant"
            description={`${ORDER_EXAMPLE}. Il récapitule en 3 lignes, lance tout de suite ce qui reste pour de faux sur le canal Test, et demande votre OUI pour un vrai canal, une dépense ou plus de 7 jours.`}
            action={{ href: "/agents/boss", label: "Parler à Kevin", variant: "outline" }}
          />
        ) : (
          <DataTable
            label="Ordres"
            columns={[
              { key: "order", header: "Ordre", className: "whitespace-normal" },
              { key: "status", header: "Statut" },
              { key: "team", header: "Équipe", hideOnMobile: true },
              { key: "channel", header: "Canal", className: "whitespace-normal" },
              { key: "period", header: "Période", className: "whitespace-normal", hideOnMobile: true },
              { key: "progress", header: "Progression" },
              { key: "cost", header: "Coût", align: "right", hideOnMobile: true },
            ]}
            rows={rows.map((r) => ({
              id: r.id,
              href: orderHref(r.id),
              cells: {
                order: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="font-medium">{orderTitle(r.number)}</span>
                    <span className="line-clamp-2 text-note text-muted-foreground">« {r.requestText} »</span>
                    <span className="text-note text-muted-foreground">{fmtDate(r.createdAt)}</span>
                  </span>
                ),
                status: (
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge kind="teamOrder" value={r.status} />
                    <StatusBadge kind="teamOrderKind" value={r.kind} />
                  </span>
                ),
                team: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{orderTeamName(r.teamKey)}</span>
                    {r.asIfTeamKey ? <span className="text-note text-muted-foreground">comme si : {orderTeamName(r.asIfTeamKey)}</span> : null}
                  </span>
                ),
                channel: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span>{r.channels.length ? r.channels.join(", ") : r.test ? "Canal Test" : "Toute l'équipe"}</span>
                    <span className="text-note text-muted-foreground">{r.mode === "real" ? "En vrai" : "Pour de faux"}</span>
                  </span>
                ),
                period: periodText(r.period),
                progress: <OrderProgress figures={r.figures} status={r.status} />,
                cost: fmtMoney(r.costCents / 100),
              },
              sortValues: {
                order: r.number,
                status: r.status,
                team: orderTeamName(r.teamKey),
                channel: r.channels.join(", "),
                period: r.period.from ?? "",
                progress: r.figures.done,
                cost: r.costCents,
              },
            }))}
            empty={{
              title: "Aucun ordre ne correspond à ces filtres",
              description: "Changez l'équipe ou le statut, ou choisissez « Toutes les équipes » et « Tous les statuts ».",
            }}
          />
        )}
        {total > ORDERS_SHOWN ? (
          <p className="text-note text-muted-foreground">Seuls les {fmtNum(ORDERS_SHOWN)} plus récents sont affichés : filtrez par équipe ou par statut.</p>
        ) : null}
      </FormSection>
    </>
  );
}
