import { DataTable } from "@/components/admin/data-table";
import { Term } from "@/components/admin/help-tip";
import { StatusPill, type PillTone } from "@/components/admin/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/components/ui/cn";
import { fmtNum, fmtRelative } from "@/lib/format";
import {
  loadTelegramCampaignsView,
  type TelegramCampaignsView,
  type TelegramComparisonStatus,
} from "@/lib/linkaffi/telegram-campaigns";

/**
 * Réglages → Connexions → Link Affi : bloc « Écarts avec Link Affi » (phase 13, D6). Compare, campagne Telegram
 * d'affilié par campagne, nos membres, inscriptions et premiers dépôts avec ceux que Link Affi compte, d'après la
 * lecture faite toutes les 10 minutes par le service d'arrière-plan (`Setting` « linkaffi.telegramCampaigns »).
 * Composant serveur : `<LinkaffiDivergences />` lit le réglage ; `LinkaffiDivergencesView` affiche une vue déjà lue.
 */
export async function LinkaffiDivergences({ now }: { now?: Date } = {}) {
  const at = now ?? new Date();
  return <LinkaffiDivergencesView view={await loadTelegramCampaignsView(at)} now={at} />;
}

const PILL: Record<TelegramComparisonStatus, { tone: PillTone; label: string }> = {
  never: { tone: "muted", label: "Pas encore comparé" },
  unavailable: { tone: "muted", label: "En attente de Link Affi" },
  error: { tone: "warning", label: "Lecture impossible" },
  divergent: { tone: "warning", label: "Écarts à regarder" },
  ok: { tone: "success", label: "Aucun écart" },
};

const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n > 1 ? many : one}`;

function summary(view: TelegramCampaignsView, now: Date): string {
  const when = view.syncedAt ? `relu ${fmtRelative(view.syncedAt, now)}` : null;
  switch (view.status) {
    case "never":
      return "La première comparaison se fera au prochain passage de la synchronisation Link Affi (toutes les 10 minutes).";
    case "unavailable":
      return `Link Affi ne donne pas encore les chiffres de ses campagnes Telegram : la comparaison démarrera toute seule dès qu'il les donnera. Dernière vérification ${fmtRelative(view.checkedAt, now)}.`;
    case "error":
      return view.syncedAt
        ? `Chiffres de la dernière lecture réussie (${when}).`
        : "Aucune lecture réussie pour l'instant.";
    case "divergent":
      return `${plural(view.divergences.length, "écart", "écarts")} sur ${plural(view.comparedCount, "campagne comparée", "campagnes comparées")}, ${when}. Les petits écarts du moment (événements en route) sont déjà mis de côté.`;
    case "ok":
      return view.comparedCount > 0
        ? `Nos chiffres et ceux de Link Affi concordent sur ${plural(view.comparedCount, "campagne", "campagnes")} (${when}).`
        : `Aucune campagne Telegram d'affilié à comparer pour l'instant (${when}).`;
  }
}

export function LinkaffiDivergencesView({
  view,
  now = new Date(),
  className,
}: {
  view: TelegramCampaignsView;
  now?: Date;
  className?: string;
}) {
  const pill = PILL[view.status];
  return (
    <section aria-labelledby="linkaffi-divergences-title" className={cn("space-y-3", className)}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id="linkaffi-divergences-title" className="text-body font-semibold text-foreground">
            Écarts avec Link Affi
          </h3>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </div>
        <p className="text-note text-muted-foreground">
          Pour chaque campagne Telegram d&apos;affilié : membres, inscriptions et{" "}
          <Term term="FTD">premiers dépôts</Term> comptés ici et chez Link Affi.
        </p>
      </div>

      {view.status === "error" && view.error ? (
        <Alert variant="warning">
          <AlertDescription>{view.error}</AlertDescription>
        </Alert>
      ) : null}
      {view.stale ? (
        <Alert variant="warning">
          <AlertDescription>
            Dernière comparaison {fmtRelative(view.checkedAt, now)} : vérifiez que le service
            d&apos;arrière-plan tourne (Réglages → État du système).
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-body text-foreground">{summary(view, now)}</p>

      {view.missing.length > 0 ? (
        <p className="text-note text-muted-foreground">
          Link Affi ne donne pas encore : {view.missing.join(", ")}. Ces chiffres seront comparés
          dès qu&apos;il les donnera.
        </p>
      ) : null}

      {view.divergences.length > 0 ? (
        <>
          <DataTable
            label="Écarts entre nos chiffres et ceux de Link Affi"
            columns={[
              { key: "campaign", header: "Campagne", className: "min-w-40 whitespace-normal" },
              { key: "figure", header: "Chiffre" },
              { key: "ours", header: "Chez nous", align: "right" },
              { key: "theirs", header: "Chez Link Affi", align: "right" },
              { key: "gap", header: "Écart", align: "right", hideOnMobile: true },
            ]}
            rows={view.divergences.map((d) => ({
              id: d.id,
              cells: {
                campaign: (
                  <span>
                    {d.campaignLabel}
                    {d.affiliateName ? (
                      <span className="text-muted-foreground"> · {d.affiliateName}</span>
                    ) : null}
                    {d.unknownHere ? (
                      <span className="block text-note text-muted-foreground">
                        Inconnue ici : aucun lien d&apos;invitation chez nous
                      </span>
                    ) : null}
                  </span>
                ),
                figure: d.term ? <Term term={d.term}>{d.label}</Term> : d.label,
                ours: fmtNum(d.ours),
                theirs: fmtNum(d.theirs),
                gap: (
                  <span className="font-semibold">
                    {d.gap > 0 ? "+" : "−"}
                    {fmtNum(Math.abs(d.gap))}
                  </span>
                ),
              },
              sortValues: {
                campaign: d.campaignLabel,
                figure: d.label,
                ours: d.ours,
                theirs: d.theirs,
                gap: d.gap,
              },
            }))}
          />
          <div className="space-y-1">
            <h4 className="text-note font-semibold text-foreground">
              D&apos;où peut venir un écart ?
            </h4>
            <ul className="list-disc space-y-1 pl-5 text-note text-muted-foreground">
              <li>
                Membres : des événements attendent encore de partir vers Link Affi (voir «
                Événements envoyés à Link Affi »), ou un administrateur a changé ou retiré
                l&apos;affilié d&apos;un membre.
              </li>
              <li>
                Inscriptions et premiers dépôts : Link Affi n&apos;a pas crédité le joueur à
                l&apos;affilié (offre non autorisée pour cette campagne, campagne désactivée), ou le
                joueur s&apos;est inscrit sans passer par un bouton d&apos;offre du bot.
              </li>
              <li>
                Campagne inconnue ici : Link Affi compte une campagne Telegram dont nous
                n&apos;avons pas le lien d&apos;invitation.
              </li>
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
