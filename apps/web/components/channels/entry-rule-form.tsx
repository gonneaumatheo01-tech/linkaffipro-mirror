"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Check, CircleAlert, Clock, Info, ListChecks, Plus, Zap } from "lucide-react";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DELAY_PRESETS,
  DELAY_UNITS,
  ENTRY_CHOICES,
  NO_RULE_SENTENCE,
  REMINDER_UNITS,
  advancedModifiedCount,
  chooseEntry,
  customReminderMinutes,
  entryFormFields,
  entryProblem,
  entrySentence,
  expirationSentence,
  parseReminders,
  reminderChips,
  remindersSentence,
  ruleFromState,
  toggleReminder,
  type DelayPresetKey,
  type DelayUnit,
  type EntryChoice,
  type EntryFormState,
  type GateChannelChoice,
} from "@/lib/channels/entry-rule";

/** Canal à cocher (canaux actifs, et ceux de la règle devenus inactifs ou supprimés : `gateChannelChoices`). */
export type GateChannelOption = GateChannelChoice;

const CHOICE_ICONS: Record<EntryChoice, React.ComponentType<{ className?: string }>> = {
  now: Zap,
  delay: Clock,
  gate: ListChecks,
};

/** Classes d'une option choisie (carte ou pastille) : bordure orange, fond orange pâle, focus visible. */
const OPTION_CLASS =
  "cursor-pointer border border-border bg-surface transition-colors hover:bg-muted/40 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";

function numberValue(v: string): number {
  return v.trim() === "" ? Number.NaN : Number(v);
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="max-md:h-10" disabled={pending}>
      {pending ? "Enregistrement…" : "Enregistrer la règle"}
    </Button>
  );
}

/** Délais proposés en pastilles (boutons radio), plus « Autre durée » avec un nombre et une unité. */
function DelayPicker({
  legend,
  name,
  state,
  withImmediate,
  onChange,
}: {
  legend: string;
  name: string;
  state: EntryFormState;
  withImmediate: boolean;
  onChange: (patch: Partial<EntryFormState>) => void;
}) {
  const id = useId();
  const presets = DELAY_PRESETS.filter((p) => withImmediate || p.key !== "immediate");
  const options: Array<{ key: DelayPresetKey; label: string }> = [
    ...presets,
    { key: "custom", label: "Autre durée" },
  ];
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-body font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = state.delayPreset === o.key;
          return (
            <label
              key={o.key}
              className={cn(
                OPTION_CLASS,
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-body max-md:h-10",
                checked && "font-medium text-brand-ink",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.key}
                checked={checked}
                onChange={() => onChange({ delayPreset: o.key })}
                className="sr-only"
              />
              {checked ? <Check aria-hidden className="size-4" /> : null}
              {o.label}
            </label>
          );
        })}
      </div>
      {state.delayPreset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-amount`}>Durée</Label>
            <Input
              id={`${id}-amount`}
              type="number"
              min={0}
              inputMode="numeric"
              value={Number.isFinite(state.customAmount) ? state.customAmount : ""}
              onChange={(e) => onChange({ customAmount: numberValue(e.target.value) })}
              className="w-28"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-unit`}>Unité</Label>
            <NativeSelect
              id={`${id}-unit`}
              value={state.customUnit}
              onChange={(e) => onChange({ customUnit: e.target.value as DelayUnit })}
              className="w-36"
            >
              {DELAY_UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Rappels en pastilles à cocher (30 minutes, 1 heure, 6 heures, 1 jour, 2 jours, plus les autres rappels déjà
 * enregistrés) et « Autre délai » (un nombre et une unité). Remplit le champ `reminders` (« 60, 1440 ») envoyé tel
 * quel à l'action serveur.
 */
function RemindersPicker({
  value,
  onChange,
  describedBy,
}: {
  value: string;
  onChange: (reminders: string) => void;
  describedBy: string;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState(Number.NaN);
  const [unit, setUnit] = useState<(typeof REMINDER_UNITS)[number]["key"]>("hours");
  const [customError, setCustomError] = useState<string | null>(null);
  function addCustom() {
    const m = customReminderMinutes(amount, unit);
    if (m === null) {
      setCustomError("Indiquez une durée entre 1 minute et 30 jours.");
      return;
    }
    onChange(toggleReminder(value, m, true));
    setCustomError(null);
    setAmount(Number.NaN);
    setCustom(false);
  }
  return (
    <fieldset className="space-y-3" aria-describedby={describedBy}>
      <legend className="mb-3 text-body font-medium text-foreground">
        Rappels, après la demande
      </legend>
      <div className="flex flex-wrap gap-2">
        {reminderChips(value).map((c) => (
          <label
            key={c.minutes}
            className={cn(
              OPTION_CLASS,
              "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-body max-md:h-10",
              c.checked && "font-medium text-brand-ink",
            )}
          >
            <input
              type="checkbox"
              checked={c.checked}
              onChange={(e) => onChange(toggleReminder(value, c.minutes, e.target.checked))}
              className="sr-only"
            />
            {c.checked ? <Check aria-hidden className="size-4" /> : null}
            {c.label}
          </label>
        ))}
        <button
          type="button"
          aria-expanded={custom}
          aria-controls={`${id}-custom`}
          onClick={() => setCustom((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/60 px-3.5 text-body text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:h-10"
        >
          <Plus aria-hidden className="size-4" />
          Autre délai
        </button>
      </div>
      {custom ? (
        <div id={`${id}-custom`} className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-amount`}>Durée</Label>
              <Input
                id={`${id}-amount`}
                type="number"
                min={1}
                inputMode="numeric"
                value={Number.isFinite(amount) ? amount : ""}
                onChange={(e) => setAmount(numberValue(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                aria-invalid={customError ? true : undefined}
                aria-describedby={customError ? `${id}-error` : undefined}
                className="w-28"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-unit`}>Unité</Label>
              <NativeSelect
                id={`${id}-unit`}
                value={unit}
                onChange={(e) => setUnit(e.target.value as typeof unit)}
                className="w-36"
              >
                {REMINDER_UNITS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="button" variant="outline" className="max-md:h-10" onClick={addCustom}>
              Ajouter ce rappel
            </Button>
          </div>
          {customError ? (
            <p id={`${id}-error`} className="text-note text-danger">
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * « Qui peut entrer et quand » : phrase de résumé, trois grands choix (tout de suite / après un délai / après avoir
 * rejoint ces canaux), les détails du choix, puis « Avancé » (validation à la main, rappels, expiration, message
 * « accepté »). Envoie à `saveRuleAction` exactement les champs de l'ancien formulaire (`entryFormFields`).
 * Canal sans règle : un encadré « Aucune règle » et le bouton « Choisir une règle » ouvrent le formulaire.
 */
export function EntryRuleForm({
  channelId,
  hasRule,
  initial,
  channels,
  action,
  requestsHref,
  gateStatus,
}: {
  channelId: string;
  /** Une règle est enregistrée et active pour ce canal. */
  hasRule: boolean;
  initial: EntryFormState;
  /** Autres canaux actifs (canaux à rejoindre). */
  channels: GateChannelOption[];
  action: (formData: FormData) => Promise<void>;
  requestsHref: string;
  /**
   * État des liens des canaux à rejoindre de la règle enregistrée (`GateLinksStatus`, rendu par le serveur), montré
   * dans « Les canaux à rejoindre ». Son bouton « Vérifier les liens » envoie ce formulaire vers une autre action.
   */
  gateStatus?: React.ReactNode;
}) {
  const id = useId();
  const [state, setState] = useState<EntryFormState>(initial);
  const [started, setStarted] = useState(hasRule);
  const [showProblem, setShowProblem] = useState(false);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const patch = (p: Partial<EntryFormState>) => setState((s) => ({ ...s, ...p }));

  const titles = useMemo(
    () => Object.fromEntries(channels.map((c) => [c.id, c.title])),
    [channels],
  );
  const fields = entryFormFields(state);
  const dirty = !hasRule || JSON.stringify(fields) !== JSON.stringify(entryFormFields(initial));
  const problem = entryProblem(state);
  const sentence = entrySentence({ ...ruleFromState(state), isActive: true }, titles);
  const expiration = expirationSentence(ruleFromState(state));
  const modified = advancedModifiedCount(state);
  const unavailableChecked = channels.some((c) => c.unavailable && state.gateIds.includes(c.id));
  // Canaux cochés différents de la règle enregistrée : la vérification des liens porte sur la règle enregistrée.
  const gateChanged =
    [...state.gateIds].sort().join() !== [...initial.gateIds].sort().join() ||
    state.gateMode !== initial.gateMode ||
    initial.choice !== "gate";

  if (!started) {
    return (
      <div className="max-w-3xl space-y-4">
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-warning/25 bg-warning-soft p-4"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-body font-semibold text-foreground">{NO_RULE_SENTENCE}</p>
              <p className="mt-1 text-body text-foreground">
                Le bot n&apos;écrit à personne de lui-même tant qu&apos;aucune règle n&apos;est
                choisie.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="max-md:h-10" onClick={() => setStarted(true)}>
                Choisir une règle
              </Button>
              <Link
                href={requestsHref}
                className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
              >
                Voir les demandes
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="max-w-3xl space-y-8"
      onSubmit={(e) => {
        // « Vérifier les liens » n'enregistre pas la règle : pas de contrôle des champs.
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        if (submitter?.hasAttribute("data-verify-links")) return;
        if (problem) {
          e.preventDefault();
          setShowProblem(true);
          // Le message n'est affiché qu'au rendu suivant : le focus y va une fois qu'il existe.
          requestAnimationFrame(() => problemRef.current?.focus());
        }
      }}
    >
      <input type="hidden" name="channelId" value={channelId} />
      {fields.map(([name, value], i) => (
        <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
      ))}

      <div aria-live="polite" className="flex gap-3 rounded-xl border border-border bg-surface p-4">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-ink" />
        <div className="min-w-0">
          <p className="text-body font-semibold text-foreground">{sentence}</p>
          {expiration ? <p className="mt-1 text-body text-muted-foreground">{expiration}</p> : null}
          {dirty ? (
            <p className="mt-1 text-note text-muted-foreground">
              {hasRule
                ? "Modifications pas encore enregistrées."
                : "Règle pas encore enregistrée : les demandes attendent toujours votre validation."}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-3 text-body font-semibold text-foreground">
          Quand une personne demande à entrer, elle est acceptée…
        </legend>
        <div className="grid gap-3 md:grid-cols-3">
          {ENTRY_CHOICES.map((c) => {
            const Icon = CHOICE_ICONS[c.key];
            const checked = state.choice === c.key;
            return (
              <label
                key={c.key}
                className={cn(
                  OPTION_CLASS,
                  "relative flex min-h-24 gap-3 rounded-xl p-4 md:flex-col",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-choice`}
                  value={c.key}
                  checked={checked}
                  onChange={() => setState((s) => chooseEntry(s, c.key))}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    checked ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 pr-6">
                  <span className="block text-body font-semibold text-foreground">{c.title}</span>
                  <span className="mt-0.5 block text-note text-muted-foreground">{c.help}</span>
                </span>
                {checked ? (
                  <Check aria-hidden className="absolute top-3 right-3 size-5 text-brand-ink" />
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      {state.choice === "now" ? (
        <p className="text-body text-muted-foreground">
          Le bot envoie son message d&apos;accueil, puis accepte la personne aussitôt.
        </p>
      ) : null}

      {state.choice === "delay" ? (
        <FormSection
          title="Le délai"
          description="Le temps de lire le message d'accueil du bot avant d'entrer."
        >
          <DelayPicker
            legend="Accepter la demande après :"
            name={`${id}-delay`}
            state={state}
            withImmediate={false}
            onChange={patch}
          />
        </FormSection>
      ) : null}

      {state.choice === "gate" ? (
        <FormSection
          title="Les canaux à rejoindre"
          description="Le bot envoie un bouton par canal et un bouton « ✅ J'ai rejoint »."
        >
          {channels.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Aucun autre canal actif : ajoutez d&apos;abord le canal à faire rejoindre.
            </p>
          ) : (
            <fieldset aria-describedby={unavailableChecked ? `${id}-unavailable` : undefined}>
              <legend className="mb-2 text-body font-medium text-foreground">
                Cochez les canaux ({state.gateIds.length} choisi
                {state.gateIds.length > 1 ? "s" : ""})
              </legend>
              <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-surface">
                {channels.map((c) => {
                  const checked = state.gateIds.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-muted/40">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(on) =>
                            setState((s) => ({
                              ...s,
                              gateIds: on
                                ? [...s.gateIds.filter((x) => x !== c.id), c.id]
                                : s.gateIds.filter((x) => x !== c.id),
                            }))
                          }
                        />
                        <UniverseDot universe={c.vertical} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-body",
                            c.unavailable === "deleted" && "text-muted-foreground italic",
                          )}
                        >
                          {c.title}
                        </span>
                        {c.unavailable === "inactive" ? (
                          <span className="shrink-0 text-note font-medium text-warning">
                            Canal inactif
                          </span>
                        ) : c.isMediaLibrary ? (
                          <span className="text-note text-muted-foreground">Médiathèque</span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {unavailableChecked ? (
                <p
                  id={`${id}-unavailable`}
                  className="mt-2 flex items-start gap-2 text-note text-warning"
                >
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  Un canal coché est inactif ou supprimé : le bot continue de le demander tant
                  qu&apos;il reste coché. Décochez-le puis enregistrez.
                </p>
              ) : null}
            </fieldset>
          )}
          {gateStatus && hasRule ? (
            <div className="space-y-2">
              {gateChanged ? (
                <p className="flex items-start gap-2 text-note text-muted-foreground">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                  Enregistrez la règle : les liens des canaux que vous venez de choisir seront créés
                  et vérifiés tout de suite.
                </p>
              ) : null}
              {gateStatus}
            </div>
          ) : null}
          <fieldset>
            <legend className="mb-2 text-body font-medium text-foreground">Ces canaux sont…</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    key: "REQUIRED",
                    title: "Obligatoires",
                    help: "Acceptée seulement après « ✅ J'ai rejoint » : le bot vérifie.",
                  },
                  {
                    key: "SOFT",
                    title: "Proposés",
                    help: "Le bot les propose, mais accepte la personne dans tous les cas.",
                  },
                ] as const
              ).map((g) => {
                const checked = state.gateMode === g.key;
                return (
                  <label
                    key={g.key}
                    className={cn(OPTION_CLASS, "relative flex flex-col rounded-xl p-3 pr-9")}
                  >
                    <input
                      type="radio"
                      name={`${id}-gate-mode`}
                      value={g.key}
                      checked={checked}
                      onChange={() => patch({ gateMode: g.key })}
                      className="sr-only"
                    />
                    <span className="text-body font-semibold text-foreground">{g.title}</span>
                    <span className="text-note text-muted-foreground">{g.help}</span>
                    {checked ? (
                      <Check aria-hidden className="absolute top-3 right-3 size-4 text-brand-ink" />
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <DelayPicker
            legend={
              state.gateMode === "REQUIRED"
                ? "Une fois les canaux rejoints, accepter :"
                : "Accepter la demande :"
            }
            name={`${id}-gate-delay`}
            state={state}
            withImmediate
            onChange={patch}
          />
        </FormSection>
      ) : null}

      <AdvancedSection
        description="Validation à la main, rappels, expiration, message « Accepté »."
        modifiedCount={modified}
        defaultOpen={initial.manual}
      >
        <label className="flex min-h-10 cursor-pointer items-start gap-3">
          <Checkbox
            checked={state.manual}
            onCheckedChange={(on) => patch({ manual: Boolean(on) })}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-body font-medium text-foreground">
              Je valide moi-même chaque demande
            </span>
            <span className="block text-note text-muted-foreground">
              Personne n&apos;est accepté tout seul : vous acceptez ou refusez dans l&apos;onglet
              Demandes. Le bot envoie quand même son message d&apos;accueil.
            </span>
          </span>
        </label>

        <div className="space-y-4">
          <RemindersPicker
            value={state.reminders}
            onChange={(reminders) => patch({ reminders })}
            describedBy={`${id}-reminders-help`}
          />
          <div className="space-y-2">
            <Label htmlFor={`${id}-max`}>Nombre de rappels au plus</Label>
            <Input
              id={`${id}-max`}
              type="number"
              min={0}
              max={10}
              inputMode="numeric"
              value={Number.isFinite(state.maxReminders) ? state.maxReminders : ""}
              onChange={(e) => patch({ maxReminders: numberValue(e.target.value) })}
              className="w-28"
            />
          </div>
          <p id={`${id}-reminders-help`} className="text-note text-muted-foreground">
            {state.manual
              ? "Aucun rappel ne part tant que vous validez vous-même chaque demande."
              : `${remindersSentence(parseReminders(state.reminders), state.maxReminders)} Seulement pour les personnes qui n'ont pas encore rejoint les canaux obligatoires, et si elles ont accepté les messages du bot.`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="space-y-2">
            <Label htmlFor={`${id}-expire`}>Expiration (heures)</Label>
            <Input
              id={`${id}-expire`}
              type="number"
              min={0}
              max={1440}
              inputMode="numeric"
              value={Number.isFinite(state.expireAfterHours) ? state.expireAfterHours : ""}
              onChange={(e) => patch({ expireAfterHours: numberValue(e.target.value) })}
              aria-describedby={`${id}-expire-help`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-expire-action`}>Ensuite</Label>
            <NativeSelect
              id={`${id}-expire-action`}
              value={state.expireAction}
              onChange={(e) =>
                patch({ expireAction: e.target.value as EntryFormState["expireAction"] })
              }
              wrapperClassName="w-full"
            >
              <option value="KEEP">Laisser la demande en attente</option>
              <option value="APPROVE">L&apos;accepter quand même</option>
              <option value="DECLINE">La refuser</option>
            </NativeSelect>
          </div>
          <p id={`${id}-expire-help`} className="text-note text-muted-foreground sm:col-span-2">
            {expiration ?? "0 = la demande n'expire jamais."}
          </p>
        </div>

        <label className="flex min-h-10 cursor-pointer items-start gap-3">
          <Checkbox
            checked={state.sendAcceptedMessage}
            onCheckedChange={(on) => patch({ sendAcceptedMessage: Boolean(on) })}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-body font-medium text-foreground">
              Envoyer le message « Accepté » au membre
            </span>
            <span className="block text-note text-muted-foreground">
              Son texte se modifie dans l&apos;onglet « Ce que dit le bot ».
            </span>
          </span>
        </label>
      </AdvancedSection>

      <div className="space-y-3">
        {showProblem && problem ? (
          <p
            ref={problemRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 text-body text-danger outline-none"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton />
          <p className="text-note text-muted-foreground">
            S&apos;applique aux prochaines demandes.
          </p>
        </div>
      </div>
    </form>
  );
}
