import Link from "next/link";
import {
  Activity,
  BellRing,
  Bot,
  ChevronRight,
  MessagesSquare,
  Plug,
  ScrollText,
  Sparkles,
  Tags,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { StatusPill } from "@/components/admin/status-pill";
import { Term } from "@/components/admin/help-tip";
import { cn } from "@/components/ui/cn";
import type { SettingsCard, SettingsCardKey } from "@/app/(admin)/settings/nav";
import type { CardState, SettingsStates } from "@/lib/status/settings-cards";

/** Une icône simple par carte (lucide). */
const ICONS: Record<SettingsCardKey, LucideIcon> = {
  connections: Plug,
  bots: Bot,
  team: Users,
  alerts: BellRing,
  ai: Sparkles,
  assistant: MessagesSquare,
  content: Tags,
  journal: ScrollText,
  status: Activity,
  advanced: Wrench,
};

function Pill({ state }: { state: CardState }) {
  return (
    <StatusPill tone={state.tone} title={state.title}>
      {state.label}
    </StatusPill>
  );
}

/**
 * Une carte de Réglages : icône, titre (`<h2>`, lien vers la page principale qui couvre toute la carte), une phrase,
 * la pastille d'état facultative et, pour une carte qui regroupe plusieurs pages, la liste de ses liens (chacun avec
 * sa pastille, au-dessus du lien de la carte). Composant serveur.
 */
function SettingsCardItem({ card, states }: { card: SettingsCard; states: SettingsStates }) {
  const Icon = ICONS[card.key];
  const titleId = `reglages-${card.key}`;
  const state = card.state ? states[card.state] : undefined;
  return (
    <section
      aria-labelledby={titleId}
      data-card={card.key}
      className="group/sc relative flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/60"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-body font-semibold text-foreground">
            <Link
              href={card.href}
              className="rounded-xl outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
            >
              {card.title}
            </Link>
          </h2>
          <p className="mt-0.5 text-body text-muted-foreground">{card.description}</p>
        </div>
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover/sc:translate-x-0.5"
        />
      </div>
      {state ? (
        <div className="pl-12">
          <Pill state={state} />
        </div>
      ) : null}
      {card.links ? (
        <ul className="relative z-10 mt-auto -mx-2 -mb-2 border-t border-border pt-1">
          {card.links.map((l) => {
            const s = l.state ? states[l.state] : undefined;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-body text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                >
                  <span className="min-w-0 flex-1 font-medium">
                    <Term term={l.term}>{l.label}</Term>
                  </span>
                  {s ? <Pill state={s} /> : null}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** Grille des cartes de Réglages : une colonne sur téléphone, deux puis trois sur ordinateur. */
export function SettingsCardGrid({
  cards,
  states,
  className,
}: {
  cards: readonly SettingsCard[];
  states: SettingsStates;
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {cards.map((c) => (
        <li key={c.key} className="min-w-0">
          <SettingsCardItem card={c} states={states} />
        </li>
      ))}
    </ul>
  );
}
