import Link from "next/link";
import { prisma } from "@linkaffipro/db";
import { StatusPill } from "@/components/admin/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  CASINO_DEFAULT_MIX,
  casinoMixText,
  parsePlanThemes,
  planThemesText,
} from "@/lib/agents/casino";
import { loadCasinoSettings } from "@/lib/agents/casino-queries";

function parseMix(v: unknown): { video: number; photo: number; text: number } | null {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const n = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
  const mix = { video: n(o.video), photo: n(o.photo), text: n(o.text) };
  return mix.video + mix.photo + mix.text === 0 ? null : mix;
}

/**
 * Encart « Équipe Casino » de la fiche d'un canal Casino (phase 22) : le plan du canal en résumé (activé ou non,
 * mélange, thèmes avec leur poids, campagne du bouton Offre) et le lien vers la fiche de l'équipe. Lecture seule.
 */
export async function ChannelCasinoCard({ channelId }: { channelId: string }) {
  const [plan, settings] = await Promise.all([
    prisma.channelAgentPlan.findUnique({
      where: { channelId },
      select: {
        teamKey: true,
        enabled: true,
        postsPerDay: true,
        mix: true,
        themes: true,
        campaignId: true,
      },
    }),
    loadCasinoSettings(),
  ]);
  const own = plan && plan.teamKey === "casino" ? plan : null;
  const campaign = own?.campaignId
    ? await prisma.campaign.findUnique({
        where: { id: own.campaignId },
        select: { id: true, name: true },
      })
    : null;
  const mix = (own ? parseMix(own.mix) : null) ?? CASINO_DEFAULT_MIX;
  return (
    <section
      aria-labelledby="equipe-casino"
      className="mb-6 space-y-3 rounded-xl border border-border bg-card px-4 py-3 md:px-6 md:py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="equipe-casino" className="text-body font-semibold text-foreground">
          Équipe Casino
        </h2>
        {own?.enabled ? (
          <StatusPill tone="success">Publie sur ce canal</StatusPill>
        ) : (
          <StatusPill tone="muted">{own ? "Plan désactivé" : "Pas de plan"}</StatusPill>
        )}
        <Link
          href="/agents/casino#plan"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto max-md:h-10")}
        >
          Ouvrir l&apos;équipe Casino
        </Link>
      </div>
      {own ? (
        <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-note text-muted-foreground">Posts par jour</dt>
            <dd className="text-foreground tabular-nums">{own.postsPerDay}</dd>
          </div>
          <div>
            <dt className="text-note text-muted-foreground">Mélange</dt>
            <dd className="text-foreground">{casinoMixText(mix)}</dd>
          </div>
          <div>
            <dt className="text-note text-muted-foreground">Thèmes</dt>
            <dd className="text-foreground">
              {planThemesText(parsePlanThemes(own.themes), settings.themes)}
            </dd>
          </div>
          <div>
            <dt className="text-note text-muted-foreground">Bouton Offre</dt>
            <dd className="text-foreground">{campaign ? campaign.name : "aucune campagne"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-note text-muted-foreground">
          Les agents ne publient pas encore ici : réglez le plan de ce canal (mélange, thèmes,
          campagne) dans la fiche de l&apos;équipe Casino.
        </p>
      )}
    </section>
  );
}
