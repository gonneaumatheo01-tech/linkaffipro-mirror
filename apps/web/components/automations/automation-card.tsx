import Link from "next/link";
import {
  Crown,
  HeartHandshake,
  Hourglass,
  MousePointerClick,
  PartyPopper,
  Send,
  UserCheck,
} from "lucide-react";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  CARD_DEFS,
  cardTitle,
  channelsText,
  delaySummary,
  type CardKey,
  type CardSettings,
} from "@/lib/automations/cards";
import { counterSentence, type RuleCounter } from "@/lib/automations/counter";
import { EMPTY_RESULTS, type RuleResults } from "@/lib/automations/results";
import { fillMessageExamples } from "@/lib/automations/node-form";
import { CardSettingsPanel, type CardPanelOptions } from "./card-settings-panel";
import { RuleResultsSummary } from "./rule-results-line";
import { RuleSwitch, TestOnMeButton } from "./rule-switch";

const ICONS: Record<CardKey, React.ReactNode> = {
  welcome: <PartyPopper />,
  offer_no_signup: <MousePointerClick />,
  signup_no_deposit: <UserCheck />,
  inactive_7d: <Hourglass />,
  first_deposit_thanks: <HeartHandshake />,
  vip: <Crown />,
};

export type CardRuleSummary = { id: string; name: string; isActive: boolean };

/**
 * Carte d'une relance prête à l'emploi : titre en français (avec le délai réglé), une phrase, l'interrupteur, l'aperçu
 * du message, le réglage principal et les canaux, le compteur de la semaine et les résultats depuis le début
 * (envoyés ; clics, inscriptions, premiers dépôts et gains si la relance a un bouton Offre ; « Pas encore de résultat »
 * tant que rien n'est venu), puis « Modifier », « Tester sur moi » et le journal. Les
 * autres relances de la même forme sont listées en lien sous la carte.
 */
export function AutomationCard({
  cardKey,
  rule,
  settings,
  others,
  counter,
  results,
  attribution = true,
  resultsLabel = "Depuis le début",
  channelNames,
  options,
  actions,
}: {
  cardKey: CardKey;
  rule: CardRuleSummary | null;
  settings: CardSettings;
  others: CardRuleSummary[];
  counter: RuleCounter | undefined;
  /** Résultats depuis le début (relance enregistrée seulement). */
  results?: RuleResults;
  /** Faux si la relance n'a pas de bouton Offre (et aucun résultat venu d'un bouton) : les envoyés seulement. */
  attribution?: boolean;
  /** « Depuis le début » ou « Depuis le 11 oct. » (`resultsSinceLabel`). */
  resultsLabel?: string;
  channelNames: Record<string, string>;
  options: CardPanelOptions;
  actions: {
    save: (fd: FormData) => Promise<{ ok: false; error: string }>;
    toggle: (fd: FormData) => Promise<void>;
    test: (fd: FormData) => Promise<void>;
  };
}) {
  const def = CARD_DEFS[cardKey];
  const title = cardTitle(cardKey, settings);
  const summary = delaySummary(cardKey, settings);
  const headingId = `carte-${cardKey}-titre`;
  return (
    <article
      id={`carte-${cardKey}`}
      aria-labelledby={headingId}
      data-slot="automation-card"
      className={cn(
        "flex min-w-0 scroll-mt-24 flex-col gap-4 rounded-xl border bg-card p-4",
        rule?.isActive ? "border-brand/60" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink [&>svg]:size-5"
        >
          {ICONS[cardKey]}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={headingId} className="text-body font-semibold text-foreground">
            {title}
          </h3>
          <p className="text-note text-muted-foreground">{def.description}</p>
          {rule && rule.name !== def.ruleName ? (
            <p className="text-note text-muted-foreground">
              Relance « <span className="font-medium text-foreground">{rule.name}</span> »
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1">
        <RuleSwitch
          ruleId={rule?.id ?? null}
          active={rule?.isActive ?? false}
          title={rule?.name ?? def.ruleName}
          action={actions.toggle}
          back="list"
        />
        <p className="px-1 text-note text-muted-foreground">
          {rule ? (
            <span className="inline-flex items-center gap-1.5">
              <Send aria-hidden className="size-3.5 shrink-0" />
              {counterSentence(counter)}
            </span>
          ) : (
            "Pas encore enregistrée : réglez-la pour la créer."
          )}
        </p>
      </div>

      {rule ? (
        <RuleResultsSummary
          results={results ?? EMPTY_RESULTS}
          attribution={attribution}
          label={resultsLabel}
        />
      ) : null}

      <TelegramPreview
        compact
        html={fillMessageExamples(settings.message.text)}
        buttons={settings.message.buttons ?? []}
        mediaCount={settings.message.mediaAssetId ? 1 : 0}
      />

      <dl className="grid gap-x-4 gap-y-1 text-note sm:grid-cols-2">
        {summary ? (
          <div className="min-w-0">
            <dt className="sr-only">Réglage</dt>
            <dd className="truncate text-foreground">{summary}</dd>
          </div>
        ) : null}
        <div className="min-w-0">
          <dt className="sr-only">Canaux</dt>
          <dd className="truncate text-muted-foreground">
            {channelsText(settings.channelIds, channelNames)}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <CardSettingsPanel
          cardKey={cardKey}
          ruleId={rule?.id ?? null}
          settings={settings}
          options={options}
          action={actions.save}
          triggerLabel={rule ? "Modifier" : "Régler et enregistrer"}
          advancedHref={
            rule
              ? `/members/automations/${rule.id}/edit`
              : `/members/automations/new?template=${cardKey}`
          }
        />
        <TestOnMeButton ruleId={rule?.id ?? null} action={actions.test} back="list" />
        {rule ? (
          <Link
            href={`/members/automations/${rule.id}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "max-md:h-10")}
          >
            Journal<span className="sr-only"> : {rule.name}</span>
          </Link>
        ) : null}
      </div>

      {others.length ? (
        <div className="text-note text-muted-foreground">
          <p>Aussi de ce type :</p>
          <ul className="mt-1 space-y-1">
            {others.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/members/automations/${o.id}`}
                  className="font-medium text-brand-ink underline-offset-2 hover:underline"
                >
                  {o.name}
                </Link>{" "}
                · {o.isActive ? "activée" : "désactivée"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
