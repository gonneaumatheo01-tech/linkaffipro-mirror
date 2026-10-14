import { SPEND_LEVEL_LABELS, type SpendLevel } from "@linkaffipro/core";
import { UniverseDot } from "@/components/admin/universe-dot";
import { cn } from "@/components/ui/cn";
import { fmtDate, fmtDateShort, fmtMoney, fmtRelative } from "@/lib/format";
import { initials, originSourceLabel, plural } from "@/lib/members/profile";
import type { MemberOrigin } from "@/lib/members/query";
import { colorOf, tagColorClass, type TagDef } from "@/lib/members/tags";

/** Rond aux initiales du membre (décoratif : le nom est écrit à côté). */
export function MemberAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-note font-semibold text-muted-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Étiquettes d'un membre (couleur du registre, gris si inconnue) ; `max` au plus, puis « +N ». */
export function MemberTags({
  tags,
  registry,
  max,
  className,
}: {
  tags: string[];
  registry: TagDef[];
  max?: number;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const more = tags.length - shown.length;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((t) => (
        <span
          key={t}
          className={cn(
            "inline-flex h-5 items-center rounded-full border px-2 text-note font-medium whitespace-nowrap",
            tagColorClass(colorOf(t, registry)),
          )}
        >
          {t}
        </span>
      ))}
      {more > 0 ? (
        <span className="inline-flex h-5 items-center text-note text-muted-foreground">
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/**
 * D'où vient le membre, en deux lignes : la campagne (ou le canal) avec la couleur de son univers, puis la pub (ou
 * l'affilié Link Affi) et le canal d'arrivée. Sans demande d'adhésion : « Pas encore venu par un canal ».
 */
export function MemberOriginCell({ origin }: { origin: MemberOrigin | null }) {
  if (!origin) {
    return <span className="text-note text-muted-foreground">Pas encore venu par un canal</span>;
  }
  const universe = origin.campaignVertical ?? origin.channelVertical;
  // « Pub … » pour un lien de pub, « Affilié … » pour le lien d'une campagne d'affilié Link Affi.
  const source = originSourceLabel(origin);
  const main = origin.campaignName ?? origin.channelTitle;
  // Deuxième ligne : la source (et le canal si la campagne est en titre), sinon la date d'arrivée.
  const sub = origin.campaignName
    ? [source, origin.channelTitle].filter(Boolean).join(" · ")
    : (source ?? `Arrivé le ${fmtDateShort(origin.at)}`);
  return (
    <span className="flex min-w-0 items-start gap-2">
      <UniverseDot universe={universe} className="mt-1.5" />
      <span className="min-w-0 break-words">
        <span className="block md:truncate">{main}</span>
        <span className="block text-note text-muted-foreground md:truncate">{sub}</span>
      </span>
    </span>
  );
}

/** Dépôts : montant puis « 3 dépôts · Régulier » ; « Inscrit, sans dépôt » ; « — » sans compte joueur. */
export function DepositsCell({
  depositCount,
  depositTotal,
  level,
}: {
  depositCount: number;
  depositTotal: number;
  level: SpendLevel;
}) {
  if (depositCount <= 0 && depositTotal <= 0) {
    return (
      <span className="flex flex-col items-end">
        <span>—</span>
        {level === "INSCRIT" ? (
          <span className="text-note text-muted-foreground">Inscrit, sans dépôt</span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className="font-medium tabular-nums">
        {fmtMoney(Math.round(depositTotal), "EUR", { digits: 0 })}
      </span>
      <span className="text-note text-muted-foreground">
        {plural(depositCount, "dépôt")} · {SPEND_LEVEL_LABELS[level]}
      </span>
    </span>
  );
}

/** Dernière activité en clair (« il y a 3 jours »), date exacte au survol. */
export function LastActivity({ at, now }: { at: Date | null; now?: Date }) {
  if (!at) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={at.toISOString()} title={fmtDate(at)} className="text-muted-foreground">
      {fmtRelative(at, now)}
    </time>
  );
}
