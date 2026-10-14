"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, Info } from "lucide-react";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  entryFormFields,
  entryProblem,
  gateChannelChoices,
  initialEntryState,
  ruleFromState,
  type EntryFormState,
  type GateChannelChoice,
} from "@/lib/channels/entry-rule";
import {
  duplicateMessage,
  exceptionMessageNote,
  exceptionSentence,
  findDuplicate,
  isFromOurChannels,
  newExceptionState,
  provenanceHelp,
  provenanceKey,
  targetOfKey,
  type ExceptionItem,
  type NameMaps,
  type ProvenanceGroup,
} from "@/lib/channels/exceptions";
import { EntryRuleFields } from "./entry-rule-form";

/** Retour de « Enregistrer l'exception » quand l'enregistrement est refusé (même type que l'action serveur). */
export type ExceptionFormResult = { error: string } | null;

/** Canal connu (actif ou non), pour relire les canaux à rejoindre d'une exception. */
export type KnownChannel = Omit<GateChannelChoice, "unavailable"> & { isActive: boolean };

/**
 * Volet « Nouvelle exception » / « Modifier l'exception » : « Si la personne vient… » (menu de provenance), puis les
 * mêmes choix que la règle par défaut (`EntryRuleFields` : canaux à rejoindre, « puis accepter », Avancé), une phrase de
 * résumé en direct et « Enregistrer l'exception » (`saveExceptionAction`). Un refus revient dans le volet ; un succès
 * revient sur l'onglet avec la confirmation. Nouvelle exception : réglages copiés de la règle par défaut, sans canaux à
 * rejoindre pour une personne venue d'un de nos canaux (`newExceptionState`) tant que l'équipe n'a rien changé.
 */
export function ExceptionPanel({
  open,
  onOpenChange,
  channelId,
  item,
  menu,
  suggested,
  baseState,
  others,
  names,
  activeChannels,
  knownChannels,
  action,
  gateStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  /** Exception à modifier (null : nouvelle exception). */
  item: ExceptionItem | null;
  menu: ProvenanceGroup[];
  /** Provenance proposée pour une nouvelle exception. */
  suggested: string | null;
  /** Réglages de la règle par défaut (copiés dans une nouvelle exception). */
  baseState: EntryFormState;
  /** Les autres exceptions du canal (pas deux exceptions pour la même provenance). */
  others: readonly ExceptionItem[];
  names: NameMaps;
  /** Nos autres canaux actifs (canaux à rejoindre). */
  activeChannels: ReadonlyArray<Omit<GateChannelChoice, "unavailable">>;
  knownChannels: readonly KnownChannel[];
  action: (prev: ExceptionFormResult, formData: FormData) => Promise<ExceptionFormResult>;
  /** État des liens des canaux à rejoindre de l'exception enregistrée (`GateLinksStatus`). */
  gateStatus?: React.ReactNode;
}) {
  const id = useId();
  const formId = `${id}-form`;
  const initialKey = item ? provenanceKey(item) : suggested;
  const initialEntry = useMemo(
    () =>
      item
        ? initialEntryState(item.rule)
        : newExceptionState(baseState, initialKey ? targetOfKey(initialKey) : null),
    [item, baseState, initialKey],
  );
  const [provenance, setProvenance] = useState(initialKey ?? "");
  const [entry, setEntryState] = useState<EntryFormState>(initialEntry);
  // Canaux choisis à l'ouverture du volet : affichés en tête de liste, sans bouger pendant la saisie.
  const [pinnedGateIds] = useState<string[]>(() => [...initialEntry.gateIds]);
  const [touched, setTouched] = useState(false);
  const [showProblem, setShowProblem] = useState(false);
  const [result, dispatch, pending] = useActionState(action, null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (result?.error) errorRef.current?.focus();
  }, [result]);

  const target = provenance ? targetOfKey(provenance) : null;
  const sourceId = target?.scope === "SOURCE_CHANNEL" ? target.sourceChannelId : null;
  const setEntry = (update: (s: EntryFormState) => EntryFormState) => {
    setTouched(true);
    setEntryState(update);
  };
  function chooseProvenance(key: string) {
    setProvenance(key);
    const next = targetOfKey(key);
    if (!item && !touched) {
      setEntryState(newExceptionState(baseState, next));
      return;
    }
    // Le canal d'où vient la personne compte comme déjà rejoint : jamais dans ses canaux à rejoindre.
    if (next?.scope === "SOURCE_CHANNEL")
      setEntryState((s) => ({
        ...s,
        gateIds: s.gateIds.filter((g) => g !== next.sourceChannelId),
      }));
  }

  const channels = gateChannelChoices(
    activeChannels.filter((c) => c.id !== sourceId),
    entry.gateIds,
    knownChannels,
    pinnedGateIds,
  );
  const duplicate = target ? findDuplicate(others, target, item?.id) : null;
  const duplicateText = duplicate && target ? duplicateMessage(target, names) : null;
  const problem =
    (target ? null : "Choisissez d'où vient la personne.") ?? duplicateText ?? entryProblem(entry);
  const preview = target ? { ...target, rule: { ...ruleFromState(entry), isActive: true } } : null;
  const sentence = preview
    ? exceptionSentence(preview, names)
    : "Choisissez d'où vient la personne.";
  const messageNote = preview ? exceptionMessageNote(preview) : null;
  const fromOurChannels = target ? isFromOurChannels(target) : false;

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={item ? "Modifier l'exception" : "Nouvelle exception"}
      description="Une règle à part pour les personnes venues d'un endroit précis."
      footer={
        <>
          <SidePanelClose>Annuler</SidePanelClose>
          <Button type="submit" form={formId} className="max-md:h-10" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer l'exception"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        action={dispatch}
        className="space-y-8"
        onSubmit={(e) => {
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          if (submitter?.hasAttribute("data-verify-links")) return;
          if (problem) {
            e.preventDefault();
            setShowProblem(true);
            requestAnimationFrame(() => problemRef.current?.focus());
          }
        }}
      >
        <input type="hidden" name="channelId" value={channelId} />
        {item ? <input type="hidden" name="ruleId" value={item.id} /> : null}
        <input type="hidden" name="provenance" value={provenance} />
        {entryFormFields(entry).map(([name, value], i) => (
          <input key={`${name}-${i}`} type="hidden" name={name} value={value} />
        ))}

        <div className="space-y-2">
          <Label htmlFor={`${id}-provenance`}>Si la personne vient…</Label>
          <NativeSelect
            id={`${id}-provenance`}
            value={provenance}
            onChange={(e) => chooseProvenance(e.target.value)}
            wrapperClassName="w-full"
            aria-invalid={duplicateText ? true : undefined}
            aria-describedby={`${id}-provenance-help`}
          >
            {provenance ? null : <option value="">Choisissez…</option>}
            {menu.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.used && o.key !== initialKey ? `${o.label} (déjà réglée)` : o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          <p
            id={`${id}-provenance-help`}
            className={duplicateText ? "text-note text-danger" : "text-note text-muted-foreground"}
          >
            {duplicateText ?? provenanceHelp(target, names)}
          </p>
        </div>

        <div
          aria-live="polite"
          className="flex gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-ink" />
          <div className="min-w-0">
            <p className="text-body font-semibold text-foreground">{sentence}</p>
            {messageNote ? (
              <p className="mt-1 text-body text-muted-foreground">{messageNote}</p>
            ) : null}
          </div>
        </div>

        <EntryRuleFields
          state={entry}
          setState={setEntry}
          channels={channels}
          initial={item ? initialEntry : null}
          variant="exception"
          gateStatus={item ? gateStatus : null}
          gateNote={
            sourceId
              ? `« ${names.titles[sourceId] ?? "Ce canal"} » compte comme déjà rejoint : la personne en vient, il ne lui est pas demandé.`
              : null
          }
          welcomeHelp={
            fromOurChannels
              ? "Venue par le bouton « canal à rejoindre », elle reçoit seulement un court message (sa demande est bien reçue), jamais un deuxième accueil complet."
              : undefined
          }
        />

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
        {result?.error ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 text-body text-danger outline-none"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {result.error}
          </p>
        ) : null}
        <p className="text-note text-muted-foreground">S&apos;applique aux prochaines demandes.</p>
      </form>
    </SidePanel>
  );
}
