import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, Trash2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { LandingPageForm } from "@/components/landing/landing-page-form";
import { LandingStats } from "@/components/landing/landing-stats";
import { PagePreviewDialog } from "@/components/landing/page-preview-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { env } from "@/lib/env";
import { formFromPage, savedPagePreviewInput } from "@/lib/landing/form";
import {
  channelsMissingLandingException,
  loadLandingAdChoices,
  loadLandingChannelChoices,
  loadLandingPage,
  otherPageNames,
} from "@/lib/landing/queries";
import { loadDirectAdLinks, loadLandingTables } from "@/lib/landing/stats";
import { parseCompare, previousPeriod, resolvePeriod } from "@/lib/periods";
import { requireUser } from "@/lib/session";
import {
  deleteLandingPageAction,
  retryLandingLinksAction,
  saveLandingPageAction,
} from "../actions";

export async function generateMetadata({ params }: PageProps<"/pages/[id]">): Promise<Metadata> {
  const { id } = await params;
  const page = await loadLandingPage(id);
  return { title: page ? page.name : "Page introuvable" };
}

/**
 * Fiche d'une page d'atterrissage (phase 15) : le formulaire unique et l'aperçu téléphone en direct (sources avec
 * « Copier le lien », refus de Telegram et « Réessayer »), puis les chiffres sur la période choisie (par source,
 * ouverture de Telegram par système, comparaison avec les liens directs des pubs du canal). « Voir la page » : la page
 * enregistrée en grand, en aperçu (rien n'est compté, aucun pixel), jamais la vraie page publique. Suppression :
 * administrateurs, après confirmation. ADMIN et MANAGER modifient.
 */
export default async function LandingPageDetail({
  params,
  searchParams,
}: PageProps<"/pages/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const page = await loadLandingPage(id);
  if (!page) notFound();
  const period = resolvePeriod(sp);
  const compare = parseCompare(sp.compare);
  const [channels, adGroups, takenNames, tables, previous, direct, exceptionChannels] =
    await Promise.all([
      loadLandingChannelChoices(page.channelId),
      loadLandingAdChoices(),
      otherPageNames(page.id),
      loadLandingTables([page.id], period),
      compare ? loadLandingTables([page.id], previousPeriod(period)) : Promise.resolve(null),
      loadDirectAdLinks(page.channelId, period),
      channelsMissingLandingException([page.channelId], page.id),
    ]);
  const adNames = Object.fromEntries(adGroups.flatMap((g) => g.ads.map((a) => [a.id, a.label])));
  const readyKeys = page.links.filter((l) => l.status === "ready").map((l) => l.key);
  // « Voir la page » montre l'aperçu, jamais la vraie page publique (l'équipe y serait comptée, les pixels aussi).
  const preview = savedPagePreviewInput(page, page.channel);

  return (
    <>
      <PageHeader
        title={page.name}
        backHref="/pages"
        backLabel="Pages"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <UniverseDot universe={page.channel.vertical} />
            Canal « {page.channel.title} »
          </span>
        }
        meta={
          page.isActive ? (
            <StatusPill tone="success">En ligne</StatusPill>
          ) : (
            <StatusPill tone="muted">En pause</StatusPill>
          )
        }
        secondaryActions={
          <>
            <Link
              href="#chiffres"
              className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
            >
              <ArrowDown aria-hidden />
              Voir les chiffres
            </Link>
            <PagePreviewDialog input={preview} isActive={page.isActive} />
          </>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="space-y-12">
        <LandingPageForm
          key={`${page.id}-${page.updatedAt.getTime()}`}
          initial={formFromPage(page)}
          saved={{ name: page.name, slug: page.slug }}
          channels={channels}
          adGroups={adGroups}
          links={page.links}
          trackingBase={env.trackingBaseUrl}
          takenNames={takenNames}
          landingExceptionChannels={exceptionChannels}
          action={saveLandingPageAction}
          retryAction={retryLandingLinksAction}
        />

        <LandingStats
          pageId={page.id}
          table={tables.get(page.id) ?? null}
          previous={previous?.get(page.id) ?? null}
          period={period}
          compare={compare}
          direct={direct}
          slug={page.slug}
          trackingBase={env.trackingBaseUrl}
          adNames={adNames}
          readyKeys={readyKeys}
        />

        {me.role === "ADMIN" ? (
          <section
            aria-labelledby="landing-delete-title"
            className="space-y-3 border-t border-border pt-6"
          >
            <h2 id="landing-delete-title" className="text-body font-semibold text-foreground">
              Supprimer la page
            </h2>
            <p className="text-note text-muted-foreground">
              Ses liens ne marcheront plus (dans vos pubs comme dans Telegram) et ses visites et
              clics sont effacés. Les membres déjà arrivés restent. Pour arrêter quelque temps,
              mettez-la plutôt en pause (Avancé → Page en ligne).
            </p>
            <form action={deleteLandingPageAction}>
              <input type="hidden" name="pageId" value={page.id} />
              <ConfirmSubmit
                variant="destructive"
                className="max-md:h-10"
                confirmTitle={`Supprimer la page « ${page.name} » ?`}
                confirmLabel="Supprimer la page"
                destructive
                message="Ses liens d'invitation sont retirés dans Telegram : les pubs qui y mènent ne marcheront plus. Ses visites et clics sont effacés."
              >
                <Trash2 aria-hidden />
                Supprimer la page
              </ConfirmSubmit>
            </form>
          </section>
        ) : null}
      </div>
    </>
  );
}
