import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, Film } from "lucide-react";
import { AgentsNav } from "@/components/agents/agents-nav";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { Flash } from "@/components/admin/flash";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  MONTAGE_PATH,
  clipCounts,
  clipCountsText,
  fmtDuration,
  fmtResolution,
  fmtSize,
  instructionTheme,
  libraryHref,
  montageHref,
  parseLibraryKind,
  parseThemeFilter,
  sourceInfo,
  telegramMessageLink,
} from "@/lib/agents/montage";
import { loadLibraryChannelUsername, loadMontageLibrary, loadMontageList } from "@/lib/agents/montage-queries";
import { loadPendingCounts } from "@/lib/agents/queries";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/lib/status-badges";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agents · Montage" };
export const dynamic = "force-dynamic";

const SEND_HINT =
  "Envoyez une vidéo à Kevin en privé, depuis votre compte Telegram (2 Go au plus), avec une phrase comme « découpe ça en shorts de 15 secondes, cam en haut à droite, thème roulette ».";

function Thumb({ id, label }: { id: string | null; label: string }) {
  if (id)
    return (
      // Notre propre route protégée : pas d'optimisation next/image nécessaire.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/agents/media/${id}`} alt={label} loading="lazy" className="h-12 w-20 shrink-0 rounded-md border border-border object-cover" />
    );
  return (
    <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <Film aria-hidden="true" className="size-5" />
    </span>
  );
}

/**
 * Agents → Montage (phase 28) : les vidéos longues envoyées à Kevin et les shorts que l'équipe Montage en tire.
 * Vue « Travaux » (par défaut) : un travail par vidéo (miniature, statut, shorts validés sur le total, date) ; le
 * détail est sur la fiche du travail. Vue « Médiathèque » : vidéos longues et shorts, filtrés par type et par thème.
 * Tout le monde lit ; les gestes (valider, modifier, refuser, annuler) sont sur la fiche, pour les administrateurs.
 */
export default async function AgentsMontagePage({ searchParams }: PageProps<"/agents/montage">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const library = sp.vue === "mediatheque";
  const kind = parseLibraryKind(sp.type);
  const theme = parseThemeFilter(sp.theme);
  const [pending, jobs, lib, libraryUsername] = await Promise.all([
    loadPendingCounts(),
    library ? Promise.resolve([]) : loadMontageList(),
    library ? loadMontageLibrary(kind, theme) : Promise.resolve(null),
    library ? loadLibraryChannelUsername() : Promise.resolve(null),
  ]);
  const toReview = jobs.reduce((s, j) => s + clipCounts(j.clipStatuses).toReview, 0);

  return (
    <>
      <AgentsNav current="montage" isAdmin={isAdmin} pending={pending.validations + pending.requests} />
      <PageHeader
        title="Montage"
        description="Vos vidéos longues découpées en shorts par l'équipe Montage : plan de coupe, sous-titres, contrôle qualité, puis un aperçu de chaque short envoyé par Kevin. Rien n'est publié sans votre ✅."
        help={SEND_HINT}
        secondaryActions={
          <Link href="/agents/boss" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-10")}>
            Parler à Kevin
          </Link>
        }
      />
      <Flash ok={sp.ok} error={sp.error} />

      <FilterChips
        label="Vue"
        className="mb-6"
        chips={[
          { key: "jobs", label: "Travaux", href: MONTAGE_PATH, selected: !library },
          { key: "library", label: "Médiathèque", href: libraryHref("ALL", null), selected: library },
        ]}
      />

      {!library ? (
        <FormSection
          title="Travaux"
          description={
            jobs.length
              ? `${fmtNum(jobs.length)} vidéo${jobs.length > 1 ? "s" : ""}${toReview ? ` · ${fmtNum(toReview)} short${toReview > 1 ? "s" : ""} à valider` : ""}. Cliquez sur une ligne pour le plan de coupe et les shorts.`
              : undefined
          }
        >
          {jobs.length === 0 ? (
            <EmptyState
              icon={<Clapperboard />}
              title="Aucun montage pour l'instant"
              description={`${SEND_HINT} Kevin vous répond avec un plan de coupe, puis vous envoie chaque short à valider.`}
              action={{ href: "/agents/boss", label: "Parler à Kevin", variant: "outline" }}
            />
          ) : (
            <DataTable
              label="Travaux de montage"
              columns={[
                { key: "source", header: "Vidéo", className: "whitespace-normal" },
                { key: "status", header: "État" },
                { key: "shorts", header: "Shorts", align: "right" },
                { key: "date", header: "Reçue le", hideOnMobile: true },
              ]}
              rows={jobs.map((j) => {
                const info = sourceInfo(j.sourceMeta, j.source);
                const counts = clipCounts(j.clipStatuses);
                const t = instructionTheme(j.instructions);
                return {
                  id: j.id,
                  href: montageHref(j.id),
                  cells: {
                    source: (
                      <span className="flex items-center gap-3">
                        <Thumb id={j.thumbId} label={`Miniature de ${j.source.filename}`} />
                        <span className="flex min-w-0 flex-col items-start gap-0.5">
                          <span className="font-medium">{j.source.filename}</span>
                          <span className="text-note text-muted-foreground">
                            {[fmtDuration(info.durationMs), fmtResolution(info.width, info.height), t ? `thème ${t}` : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </span>
                    ),
                    status: (
                      <span className="flex flex-col items-start gap-1">
                        <StatusBadge kind="montageJob" value={j.status} />
                        {counts.toReview ? <span className="text-note text-muted-foreground">{counts.toReview} à valider</span> : null}
                      </span>
                    ),
                    shorts: clipCountsText(counts),
                    date: fmtDate(j.createdAt),
                  },
                  sortValues: { source: j.source.filename, status: j.status, shorts: counts.approved, date: j.createdAt.getTime() },
                };
              })}
            />
          )}
        </FormSection>
      ) : (
        <FormSection
          title="Médiathèque"
          description="Les vidéos longues reçues et les shorts produits, gardés dans Telegram. Un short validé y est prêt : demandez à Kevin de l'envoyer sur un canal."
        >
          <div className="space-y-3">
            <FilterChips
              label="Type"
              chips={[
                { key: "ALL", label: "Tout", href: libraryHref("ALL", theme), selected: kind === "ALL" },
                { key: "SHORT", label: "Shorts", href: libraryHref("SHORT", theme), selected: kind === "SHORT" },
                { key: "LONG_VIDEO", label: "Vidéos longues", href: libraryHref("LONG_VIDEO", theme), selected: kind === "LONG_VIDEO" },
              ]}
            />
            {lib && lib.themes.length ? (
              <FilterChips
                label="Thème"
                chips={[
                  { key: "_all", label: "Tous", href: libraryHref(kind, null), selected: !theme },
                  ...lib.themes.map((t) => ({ key: t, label: t, href: libraryHref(kind, t), selected: theme === t })),
                ]}
              />
            ) : null}
          </div>
          {!lib || lib.items.length === 0 ? (
            <EmptyState
              icon={<Film />}
              title={theme ? `Rien pour le thème « ${theme} »` : "La médiathèque est vide"}
              description={theme ? "Choisissez un autre thème, ou « Tous »." : SEND_HINT}
            />
          ) : (
            <DataTable
              label="Médiathèque du montage"
              columns={[
                { key: "name", header: "Fichier", className: "whitespace-normal" },
                { key: "kind", header: "Type" },
                { key: "themes", header: "Thème", hideOnMobile: true },
                { key: "size", header: "Poids", align: "right", hideOnMobile: true },
                { key: "date", header: "Ajouté le", hideOnMobile: true },
              ]}
              rows={lib.items.map((a) => {
                const link = telegramMessageLink(a.telegramRef, libraryUsername);
                return {
                  id: a.id,
                  href: a.jobId ? `${montageHref(a.jobId)}${a.clip ? `#short-${a.clip.id}` : ""}` : undefined,
                  cells: {
                    name: (
                      <span className="flex flex-col items-start gap-0.5">
                        <span className="font-medium">{a.clip ? `Short ${a.clip.index}` : a.filename}</span>
                        <span className="text-note text-muted-foreground">
                          {[a.duration ? fmtDuration(a.duration * 1000) : null, fmtResolution(a.width, a.height)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    ),
                    kind: (
                      <span className="flex flex-col items-start gap-1">
                        <span>{a.kind === "SHORT" ? "Short" : "Vidéo longue"}</span>
                        {a.clip ? <StatusBadge kind="shortClip" value={a.clip.status} /> : null}
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="text-note text-info underline">
                            Ouvrir dans Telegram
                          </a>
                        ) : null}
                      </span>
                    ),
                    themes: a.themes.length ? a.themes.join(", ") : "sans thème",
                    size: fmtSize(a.size),
                    date: fmtDate(a.createdAt),
                  },
                  sortValues: { name: a.filename, size: a.size, date: a.createdAt.getTime(), kind: a.kind },
                };
              })}
            />
          )}
        </FormSection>
      )}
    </>
  );
}
