"use client";

import { CircleCheck, Link2, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { MtprotoPublishStatus } from "@linkaffipro/core";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  ACCOUNT_BANNER,
  ACCOUNT_PROTECT_NOTE,
  EMOJI_CHOICES,
  TELEGRAM_ACCOUNT_SETTINGS_HREF,
  hasAccountProblem,
  type AccountProblems,
  type EmojiButtonsChoice,
  type PostEmojiState,
} from "@/lib/posts/publisher";

/** Où en est la vérification du compte Telegram connecté (bouton « Vérifier »). */
export type AccountCheckState =
  { state: "idle" } | { state: "checking" } | { state: "late" } | { state: "error"; error: string };

/** Lien vers Réglages → Connexions → Telegram, dans un nouvel onglet (le message en cours reste à l'écran). */
export function TelegramSettingsLink({ className }: { className?: string }) {
  return (
    <a
      href={TELEGRAM_ACCOUNT_SETTINGS_HREF}
      target="_blank"
      rel="noopener"
      className={cn(
        "inline-flex items-center font-medium text-foreground underline underline-offset-2 max-md:min-h-10",
        className,
      )}
    >
      Ouvrir Réglages → Connexions → Telegram
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

/** Le compte peut-il publier ? Phrase(s), « Vérifier » et lien vers les réglages du compte. */
function AccountLines({
  problems,
  channels,
  status,
  check,
  onCheck,
  canCheck,
}: {
  problems: AccountProblems;
  channels: ReadonlyArray<{ id: string; title: string }>;
  status: MtprotoPublishStatus | null;
  check: AccountCheckState;
  onCheck: () => void;
  canCheck: boolean;
}) {
  const checking = check.state === "checking";
  const bad = hasAccountProblem(problems);
  const who = status?.user
    ? status.user.username
      ? `@${status.user.username}`
      : status.user.firstName
    : null;
  return (
    <div className="space-y-2" aria-live="polite">
      {checking ? (
        <p className="flex items-center gap-2 text-body">
          <LoaderCircle aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" />
          Vérification de votre compte Telegram…
        </p>
      ) : channels.length === 0 ? (
        <p className="text-body">
          Choisissez un canal : les droits de votre compte y seront vérifiés.
        </p>
      ) : !bad ? (
        <p className="flex items-start gap-2 text-body">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            Votre compte Telegram{who ? ` ${who}` : ""} peut publier dans{" "}
            {channels.map((c) => `« ${c.title} »`).join(", ")}.
          </span>
        </p>
      ) : problems.global ? (
        <p className="flex items-start gap-2 text-body font-medium">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{problems.global}</span>
        </p>
      ) : (
        <ul className="space-y-1 text-body">
          {problems.channels.map((c) => (
            <li key={c.channelId} className="flex items-start gap-2 font-medium">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                « {c.title} » : {c.problem}
              </span>
            </li>
          ))}
        </ul>
      )}
      {check.state === "late" ? (
        <p className="text-note text-muted-foreground">
          La vérification n&apos;a pas encore répondu : réessayez dans une minute.
        </p>
      ) : check.state === "error" ? (
        <p className="text-note font-medium text-danger">{check.error}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {canCheck ? (
          <Button type="button" size="sm" variant="outline" disabled={checking} onClick={onCheck}>
            <RefreshCw aria-hidden />
            Vérifier
          </Button>
        ) : null}
        {bad && !checking ? <TelegramSettingsLink className="text-note" /> : null}
      </div>
    </div>
  );
}

/** Ce que deviennent les boutons quand le compte publie (canaux seuls, ou aussi des groupes qui les gardent). */
function accountButtonsSentence(state: PostEmojiState): string {
  if (state.modeA === "account")
    return state.buttonsOffA
      ? "les boutons sont donc désactivés."
      : "dans les canaux, ce message part donc sans boutons (ils restent dans les groupes).";
  return state.buttonsOffB
    ? "les boutons de la version B sont donc désactivés."
    : "dans les canaux, la version B part donc sans boutons (ils restent dans les groupes).";
}

/** « Dans « A » et « B », le bot publie lui-même les emojis animés, avec les boutons. » */
export function groupEmojiSentence(titles: readonly string[]): string {
  const quoted = titles.map((t) => `«\u00a0${t}\u00a0»`);
  const list =
    quoted.length > 1
      ? `${quoted.slice(0, -1).join(", ")} et ${quoted[quoted.length - 1]}`
      : quoted[0];
  return `Dans ${list}, le bot publie lui-même les emojis animés, avec les boutons.`;
}

/**
 * Bloc « emojis animés » sous le texte d'un message de canal (phase 12, D10) :
 * - modèle : simple rappel (le choix se fera quand le modèle deviendra un message) ;
 * - publié par le compte : bandeau, boutons désactivés, « Ajouter l'offre comme lien dans le texte », état du compte
 *   (connecté, Premium, droits dans chaque canal) avec « Vérifier » ;
 * - emojis animés ET boutons : choix imposé « Garder les emojis animés (sans boutons) » / « Garder les boutons (emojis
 *   normaux) » ;
 * - groupes ou supergroupes cochés : le bot y publie lui-même les emojis animés, avec ses boutons (une phrase le dit).
 */
export function EmojiPublishPanel({
  isTemplate,
  state,
  choice,
  onChoice,
  choiceError,
  problems,
  accountChannels,
  status,
  check,
  onCheck,
  canCheck,
  onAddOfferLink,
  offerLinkOpen,
  groupTitles = [],
}: {
  isTemplate: boolean;
  state: PostEmojiState;
  choice: EmojiButtonsChoice | null;
  onChoice: (c: EmojiButtonsChoice) => void;
  /** Montrer la phrase « choisissez » (après un essai d'enregistrement sans choix). */
  choiceError: boolean;
  problems: AccountProblems;
  accountChannels: ReadonlyArray<{ id: string; title: string }>;
  status: MtprotoPublishStatus | null;
  check: AccountCheckState;
  onCheck: () => void;
  canCheck: boolean;
  /** « Ajouter l'offre comme lien dans le texte » (absent : pas de campagne à proposer). */
  onAddOfferLink?: () => void;
  offerLinkOpen: boolean;
  /** Groupes ou supergroupes cochés qui recevront les emojis animés du bot lui-même. */
  groupTitles?: readonly string[];
}) {
  if (!state.hasEmoji) return null;
  if (isTemplate)
    return (
      <Alert variant="info" role="status">
        <Sparkles aria-hidden />
        <AlertTitle>Ce modèle contient des emojis animés</AlertTitle>
        <AlertDescription>
          Dans un canal, un message créé à partir de lui sera publié par votre compte Telegram, sans
          boutons (ou par le bot avec des emojis normaux si vous gardez les boutons) ; dans un
          groupe, par le bot, avec ses emojis animés et ses boutons.
        </AlertDescription>
      </Alert>
    );
  const missing = choiceError && state.choiceMissing;
  return (
    <div className="space-y-3" data-slot="emoji-publish">
      {state.choiceOffered ? (
        <fieldset
          id="emoji-buttons-choice"
          aria-describedby={missing ? "emoji-buttons-choice-error" : "emoji-buttons-choice-help"}
          className={cn(
            "space-y-2 rounded-lg border p-3",
            missing ? "border-danger bg-danger-soft" : "border-border bg-surface",
          )}
        >
          <legend className="px-1 text-body font-semibold">Emojis animés ou boutons ?</legend>
          <p id="emoji-buttons-choice-help" className="text-note text-muted-foreground">
            Dans un canal, Telegram n&apos;accepte pas les deux : seul le bot peut mettre des
            boutons, et seul votre compte Premium peut publier des emojis animés.
          </p>
          {EMOJI_CHOICES.map((c) => (
            <label
              key={c.value}
              className="flex cursor-pointer items-start gap-2 text-body max-md:min-h-10"
            >
              <input
                type="radio"
                name="emojiButtonsChoiceUi"
                value={c.value}
                checked={choice === c.value}
                onChange={() => onChoice(c.value)}
                className="mt-1 size-4 shrink-0 accent-brand"
              />
              <span>
                <span className="block font-medium">{c.label}</span>
                <span className="block text-note text-muted-foreground">{c.hint}</span>
              </span>
            </label>
          ))}
          {missing ? (
            <p id="emoji-buttons-choice-error" className="text-note font-medium text-danger">
              Choisissez une des deux options pour enregistrer le message.
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {state.account ? (
        <Alert variant="info" role="status">
          <Sparkles aria-hidden />
          <AlertTitle>{ACCOUNT_BANNER}</AlertTitle>
          <AlertDescription className="min-w-0 space-y-3">
            <p>
              Dans un canal, seul votre compte Premium peut publier des emojis animés, et seul le
              bot peut mettre des boutons : {accountButtonsSentence(state)}{" "}
              {onAddOfferLink
                ? "Pour mettre une offre, ajoutez-la comme lien dans le texte : ses clics sont comptés."
                : null}
            </p>
            {onAddOfferLink && !offerLinkOpen ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                // Libellé long : il passe à la ligne sur téléphone plutôt que d'élargir le bandeau.
                className="h-auto max-w-full min-h-8 py-1.5 text-left whitespace-normal max-md:min-h-10"
                onClick={onAddOfferLink}
              >
                <Link2 aria-hidden />
                Ajouter l&apos;offre comme lien dans le texte
              </Button>
            ) : null}
            <p className="text-note">{ACCOUNT_PROTECT_NOTE}</p>
            <AccountLines
              problems={problems}
              channels={accountChannels}
              status={status}
              check={check}
              onCheck={onCheck}
              canCheck={canCheck}
            />
          </AlertDescription>
        </Alert>
      ) : null}
      {state.groupEmoji && groupTitles.length > 0 ? (
        <p className="flex items-start gap-2 text-note text-muted-foreground">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-ink" />
          <span>{groupEmojiSentence(groupTitles)}</span>
        </p>
      ) : null}
    </div>
  );
}
