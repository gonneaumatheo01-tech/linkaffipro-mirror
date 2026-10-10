import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { Term } from "@/components/admin/help-tip";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fmtDateShort, fmtMoney, fmtNum } from "@/lib/format";
import { plural, quickViewChannels } from "@/lib/members/profile";
import type { MemberRow } from "@/lib/members/query";
import type { TagDef } from "@/lib/members/tags";
import { StatusBadge } from "@/lib/status-badges";
import { LastActivity, MemberOriginCell, MemberTags } from "./member-cells";

function Item({
  label,
  wide,
  children,
}: {
  label: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-note text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Résumé d'un membre dans le volet de la liste : d'où il vient, où il en est, ce qu'il a déposé, ses étiquettes,
 * puis le lien vers la fiche complète (chronologie, notes, comptes joueurs). Chaque canal n'est écrit qu'une fois
 * (`quickViewChannels`).
 */
export function MemberQuickView({
  row,
  registry,
  now,
}: {
  row: MemberRow;
  registry: TagDef[];
  now?: Date;
}) {
  const { statusChannel, others } = quickViewChannels(row);
  return (
    <div className="space-y-6">
      <Link
        href={`/members/${row.id}`}
        className={cn(buttonVariants({ variant: "outline" }), "w-full justify-between max-md:h-10")}
      >
        Ouvrir la fiche complète
        <ArrowRight aria-hidden />
      </Link>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Item label="D'où il vient" wide>
          <MemberOriginCell origin={row.origin} />
          {/* Sans campagne ni pub, la date d'arrivée est déjà sur la deuxième ligne. */}
          {row.origin && (row.origin.campaignName || row.origin.adName || row.origin.linkName) ? (
            <p className="mt-1 pl-4 text-note text-muted-foreground">
              Arrivé le {fmtDateShort(row.origin.at, now)}
            </p>
          ) : null}
        </Item>
        <Item label="Statut">
          {row.status ? (
            <span className="flex flex-col items-start gap-1">
              <StatusBadge kind="membership" value={row.status} />
              {statusChannel ? (
                <span className="text-note text-muted-foreground">{statusChannel}</span>
              ) : null}
            </span>
          ) : (
            "—"
          )}
        </Item>
        <Item label="Dernière activité">
          <LastActivity at={row.lastEventAt} now={now} />
        </Item>
        <Item label="Dépôts">
          {row.depositCount > 0 || row.depositTotal > 0 ? (
            <span className="tabular-nums">
              {fmtMoney(row.depositTotal)}
              <span className="block text-note text-muted-foreground">
                {plural(row.depositCount, "dépôt")} · {SPEND_LEVEL_LABELS[row.level]}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {row.level === "INSCRIT" ? "Inscrit, sans dépôt" : "Aucun"}
            </span>
          )}
        </Item>
        <Item label={<Term term="FTD">Premier dépôt</Term>}>
          {row.ftdAt ? (
            fmtDateShort(row.ftdAt, now)
          ) : (
            <span className="text-muted-foreground">Pas encore</span>
          )}
        </Item>
        <Item label="Clics">
          <span className="tabular-nums">{fmtNum(row.clicks)}</span>
          <span className="block text-note text-muted-foreground">hors robots</span>
        </Item>
        {others.length ? (
          <Item label="Aussi dans" wide>
            {others.join(", ")}
          </Item>
        ) : null}
        <Item label="Étiquettes" wide>
          {row.tags.length ? (
            <MemberTags tags={row.tags} registry={registry} />
          ) : (
            <span className="text-muted-foreground">Aucune</span>
          )}
        </Item>
      </dl>
      {row.anonymized ? null : (
        <p className="text-note text-muted-foreground">Identifiant Telegram {row.telegramUserId}</p>
      )}
    </div>
  );
}
