import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  INSPIRATION_EXAMPLE,
  recCountsText,
  referenceHref,
  referenceName,
  referenceState,
  referenceSubtitle,
  universeName,
} from "@/lib/agents/inspiration";
import { loadInspirationList } from "@/lib/agents/inspiration-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Inspiration" };
export const dynamic = "force-dynamic";

/**
 * Agents → Inspiration (phase 27) : les canaux exemples que Kevin lit pour s'inspirer de leur méthode (rythme, heures,
 * forme, façon de pousser l'offre), jamais de leur contenu. Liste des références ; le détail (profil de style,
 * « eux / nous », propositions, historique, Retirer) est sur la fiche de chacune. Tout le monde lit.
 */
export default async function AgentsInspirationPage({ searchParams }: PageProps<"/agents/inspiration">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const [refs, pending] = await Promise.all([loadInspirationList(), loadPendingCounts()]);
  const toDecide = refs.reduce((s, r) => s + r.recs.proposed, 0);

  return (
    <>
      <AgentsNav current="inspiration" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Inspiration"
        description="Les canaux qui marchent que Kevin a lus pour vous : il mesure leur méthode (rythme, heures, longueur, médias, façon de pousser l'offre), la compare à vos canaux et vous propose des réglages. Il ne copie jamais un texte ni une image."
        help={`Pour en ajouter un : ${INSPIRATION_EXAMPLE.replace(/^Écrivez/, "écrivez")}. Canal privé : transférez-lui 20 à 30 posts.`}
        secondaryActions={
          <>
            <Link href="/agents/algo" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
              Ce qui marche
            </Link>
            <Link href="/agents/boss" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
              Parler à Kevin
            </Link>
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <FormSection
        title="Canaux d'inspiration"
        description={
          refs.length
            ? `${fmtNum(refs.length)} canal${refs.length > 1 ? "aux" : ""} lu${refs.length > 1 ? "s" : ""}${toDecide ? ` · ${fmtNum(toDecide)} proposition${toDecide > 1 ? "s" : ""} à décider` : ""}. Cliquez sur une ligne pour le détail.`
            : undefined
        }
      >
        {refs.length === 0 ? (
          <EmptyState
            icon={<Lightbulb />}
            title="Aucun canal d'inspiration pour l'instant"
            description={`${INSPIRATION_EXAMPLE}. Il lit le canal, vous résume sa méthode en quelques lignes et vous propose des réglages par numéros. Canal privé : un compte réel déjà membre peut le lire, ou transférez-lui 20 à 30 posts.`}
            action={{ href: "/agents/boss", label: "Parler à Kevin", variant: "outline" }}
          />
        ) : (
          <DataTable
            label="Canaux d'inspiration"
            columns={[
              { key: "name", header: "Canal" },
              { key: "state", header: "État", className: "whitespace-normal" },
              { key: "targets", header: "Pour vos canaux", className: "whitespace-normal" },
              { key: "posts", header: "Posts lus", align: "right" },
              { key: "lastRead", header: "Dernière lecture", hideOnMobile: true },
            ]}
            rows={refs.map((r) => {
              const state = referenceState(r.status, r.unavailableReason);
              const sub = referenceSubtitle(r);
              return {
                id: r.id,
                href: referenceHref(r.id),
                cells: {
                  name: (
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="font-medium">{referenceName(r)}</span>
                      <span className="text-note text-muted-foreground">
                        {[sub, universeName(r.universe)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  ),
                  state: (
                    <span className="flex flex-col items-start gap-1">
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge kind="referenceStatus" value={r.status} />
                        <StatusBadge kind="referenceVia" value={r.via} />
                      </span>
                      {state.detail ? <span className="text-note text-danger">{state.detail}</span> : null}
                      <span className="text-note text-muted-foreground">Propositions : {recCountsText(r.recs)}</span>
                    </span>
                  ),
                  targets: r.targets.length ? r.targets.map((t) => t.title).join(", ") : "aucun canal choisi",
                  posts: fmtNum(r.postCount),
                  lastRead: fmtDate(r.lastReadAt),
                },
                sortValues: {
                  name: referenceName(r),
                  posts: r.postCount,
                  lastRead: r.lastReadAt?.getTime() ?? 0,
                  state: r.status,
                },
              };
            })}
          />
        )}
      </FormSection>
    </>
  );
}
