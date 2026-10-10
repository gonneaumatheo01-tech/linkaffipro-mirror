"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Pencil,
  Send,
  Smartphone,
  Users,
} from "lucide-react";
import type { Segment } from "@linkaffipro/core";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Stepper } from "@/components/admin/stepper";
import { ImproveButton, type ImproveContext } from "@/components/ai/improve-button";
import { toAiVertical } from "@/components/ai/improve-logic";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  activeCriteria,
  countLines,
  countSentence,
  describeGroup,
  openCriteria,
  pendingCriteria,
  pendingSentence,
  reachableSentence,
  segmentFormFields,
  type CriterionKey,
  type GroupNames,
} from "@/lib/broadcasts/group";
import {
  WIZARD_STEPS,
  abSplitSentence,
  confirmSendMessage,
  filledRows,
  firstInvalidStep,
  plainText,
  suggestName,
  validateStep,
  whenSentence,
  type WizardDraft,
  type WizardIntent,
  type WizardWhen,
} from "@/lib/broadcasts/wizard";
import { AB_DEFAULT_SPLIT, AB_MAX_SPLIT, AB_MIN_SPLIT } from "@/lib/broadcasts/ab";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { fmtNum } from "@/lib/format";
import type { PostButtonRow } from "@/lib/posts/buttons";
import { GroupBuilder, type GroupOptions } from "./group-builder";
import {
  MessageExtras,
  MessageTextEditor,
  type AffiliateOption,
  type MediaOption,
} from "./message-editor";
import { SplitSlider } from "./split-slider";

export type WizardOptions = GroupOptions & {
  bots: Array<{ id: string; name: string; username: string; vertical?: string | null }>;
  media: MediaOption[];
  affiliateCampaigns: AffiliateOption[];
  ourCampaigns?: CampaignOptionWithOffers[];
};

type Count = { count: number | null; loading: boolean; failed: boolean };

/**
 * Nombre de membres du groupe joignables par le bot (route existante `/members/broadcasts/count`), recalculé
 * 350 ms après chaque changement du groupe ou du bot.
 */
function useTargetCount(botId: string, segment: Segment): Count {
  const payload = JSON.stringify({ botId, segment });
  const [result, setResult] = useState<{
    key: string;
    count: number | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!botId) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch("/members/broadcasts/count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: ctrl.signal,
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as { count?: unknown };
          const count = typeof data.count === "number" ? data.count : null;
          setResult({ key: payload, count, failed: !res.ok || count === null });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setResult({ key: payload, count: null, failed: true });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [payload, botId]);
  if (!result || result.key !== payload)
    return { count: result?.count ?? null, loading: true, failed: false };
  return { count: result.count, loading: false, failed: result.failed };
}

/** Brouillon gardé le temps d'un aller-retour avec le serveur (erreur à l'enregistrement). */
const STORAGE_KEY = "lap:broadcast-wizard";

type Saved = {
  botId: string;
  segment: Segment;
  text: string;
  mediaAssetId: string;
  rows: PostButtonRow[];
  ab: boolean;
  textB: string;
  mediaAssetIdB: string;
  rowsB: PostButtonRow[];
  split: number;
  when: WizardWhen;
  scheduledAt: string;
  name: string;
  nameTouched: boolean;
};

/** Boutons de fin (étape « Quand ») : désactivés pendant l'enregistrement. */
function FinalActions({
  when,
  testAction,
  count,
  onSend,
}: {
  when: WizardWhen;
  testAction: (formData: FormData) => void | Promise<void>;
  count: Count;
  onSend: () => void;
}) {
  const { pending } = useFormStatus();
  const nobody = !count.loading && count.count === 0;
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <Button
        type="submit"
        name="intent"
        value="draft"
        variant="outline"
        disabled={pending}
        className="max-md:h-10"
      >
        Enregistrer en brouillon
      </Button>
      <Button
        type="submit"
        formAction={testAction}
        variant="outline"
        disabled={pending}
        className="max-md:h-10"
      >
        <Smartphone aria-hidden />
        Envoyer un test à moi
      </Button>
      {when === "now" ? (
        <Button type="button" onClick={onSend} disabled={pending || nobody} className="max-md:h-10">
          <Send aria-hidden />
          {pending ? "Un instant…" : "Envoyer"}
        </Button>
      ) : (
        <Button
          type="submit"
          name="intent"
          value="schedule"
          disabled={pending}
          className="max-md:h-10"
        >
          <CalendarClock aria-hidden />
          {pending ? "Un instant…" : "Programmer"}
        </Button>
      )}
    </div>
  );
}

/** Carte « Recevront ce message » : nombre de membres joignables et groupe en une phrase. */
function GroupSummary({
  count,
  sentence,
  botUsername,
  pending,
  className,
}: {
  count: Count;
  sentence: string;
  botUsername: string | null;
  /** Critères ajoutés mais pas encore réglés (ils ne comptent pas). */
  pending: number;
  className?: string;
}) {
  const pendingText = pendingSentence(pending);
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <p className="flex items-center gap-2 text-note text-muted-foreground">
        <Users aria-hidden className="size-4" />
        Recevront ce message
      </p>
      <p className="mt-1 text-figure text-foreground tabular-nums" aria-live="polite">
        {count.loading && count.count === null ? (
          <span className="text-muted-foreground">…</span>
        ) : count.count === null ? (
          "—"
        ) : (
          <>
            {fmtNum(count.count)}
            <span className="sr-only"> membre{count.count > 1 ? "s" : ""}</span>
          </>
        )}
        {count.loading && count.count !== null ? (
          <span className="ml-2 text-note font-normal text-muted-foreground">mise à jour…</span>
        ) : null}
      </p>
      <p className="mt-2 text-body text-foreground">{sentence}.</p>
      <p className="mt-1 text-note text-muted-foreground">{reachableSentence(botUsername)}</p>
      {pendingText ? (
        <p className="mt-2 flex items-start gap-1.5 text-note text-warning">
          <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {pendingText}
        </p>
      ) : null}
      {!count.loading && count.count === 0 ? (
        <p className="mt-2 text-note text-warning">
          Personne ne correspond pour l&apos;instant : retirez un critère.
        </p>
      ) : null}
      {count.failed ? (
        <p className="mt-2 text-note text-muted-foreground">
          Le nombre n&apos;a pas pu être calculé. Il le sera au moment de l&apos;envoi.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Téléphone et tablette, étape « Qui » : le nombre de membres reste visible en bas de l'écran pendant qu'on coche
 * les critères (la carte détaillée est en fin d'étape), avec « Continuer » à portée de pouce.
 */
function StickyCount({ count, onContinue }: { count: Count; onContinue: () => void }) {
  const lines =
    count.loading && count.count === null
      ? { figure: "…", rest: "recevront ce message" }
      : countLines(count.count);
  return (
    <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom)+0.5rem)] z-30 md:bottom-4 lg:hidden">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-md">
        <p className="min-w-0 leading-tight">
          <span className="block text-body font-semibold text-foreground tabular-nums">
            {lines.figure}
            {count.loading && count.count !== null ? (
              <span className="ml-1.5 text-note font-normal text-muted-foreground">
                mise à jour…
              </span>
            ) : null}
          </span>
          <span className="block text-note text-muted-foreground">{lines.rest}</span>
        </p>
        <Button type="button" onClick={onContinue} className="shrink-0 max-md:h-10">
          Continuer
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Ligne du récapitulatif, avec « Modifier » pour revenir à l'étape concernée. */
function RecapRow({
  label,
  children,
  onEdit,
  editLabel,
}: {
  label: string;
  children: React.ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:gap-4">
      <dt className="text-note font-medium text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-body text-foreground">{children}</dd>
      {onEdit ? (
        <dd className="sm:text-right">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onEdit}
            aria-label={editLabel}
            className="-ml-2 sm:ml-0"
          >
            <Pencil aria-hidden />
            Modifier
          </Button>
        </dd>
      ) : null}
    </div>
  );
}

/**
 * « Écrire à un groupe » en trois étapes (docs/REFONTE-UX.md) :
 * 1. Qui : bot expéditeur et groupe de membres en langage courant, avec le nombre de membres joignables ;
 * 2. Quoi : texte et aperçu Telegram, « + Média », « + Boutons » (Offre par campagne), « Améliorer avec l'IA » ;
 *    test A/B (version B, part) dans « Test A/B » replié ;
 * 3. Quand : maintenant ou date (heure de Paris), récapitulatif « 1 240 membres recevront ce message », nom de
 *    l'envoi ; « Envoyer » (confirmation) ou « Programmer », « Envoyer un test à moi » et « Enregistrer en brouillon »
 *    en secondaire.
 * Les champs envoyés gardent leurs noms d'avant (name, botId, champs du groupe, text, mediaAssetId, buttons, abEnabled,
 * abSplit, textB, mediaAssetIdB, buttonsB, scheduledAt, intent) et l'action serveur reste `createBroadcastAction`.
 */
export function BroadcastWizard({
  action,
  testAction,
  options,
  initialSegment,
  prefill,
  defaultScheduledAt,
  canRestore = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** « Envoyer un test à moi » : enregistre en brouillon puis envoie le test (`createAndTestAction`). */
  testAction: (formData: FormData) => void | Promise<void>;
  options: WizardOptions;
  /** Groupe préparé par la liste des membres (paramètres d'adresse). */
  initialSegment: Segment;
  prefill?: { carried: boolean; dropped: number };
  /** Valeur proposée pour « Plus tard » (heure de Paris). */
  defaultScheduledAt: string;
  /** Retour du serveur avec une erreur : proposer de reprendre le message enregistré dans ce navigateur. */
  canRestore?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const sendNowRef = useRef<HTMLButtonElement>(null);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const errorsRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restorable, setRestorable] = useState(canRestore);

  const [botId, setBotId] = useState(options.bots[0]?.id ?? "");
  const [segment, setSegment] = useState<Segment>(initialSegment);
  // Critères ajoutés à l'étape « Qui » (un bloc vide ne compte pas : il est signalé avant de continuer).
  const [addedCriteria, setAddedCriteria] = useState<CriterionKey[]>(() =>
    activeCriteria(initialSegment),
  );
  const [text, setText] = useState("");
  const [mediaAssetId, setMediaAssetId] = useState("");
  const [rows, setRows] = useState<PostButtonRow[]>([]);
  const [showMedia, setShowMedia] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [ab, setAb] = useState(false);
  const [abOpenKey, setAbOpenKey] = useState(0);
  const [textB, setTextB] = useState("");
  const [mediaAssetIdB, setMediaAssetIdB] = useState("");
  const [rowsB, setRowsB] = useState<PostButtonRow[]>([]);
  const [showMediaB, setShowMediaB] = useState(false);
  const [showButtonsB, setShowButtonsB] = useState(false);
  const [split, setSplit] = useState(AB_DEFAULT_SPLIT);
  const [when, setWhen] = useState<WizardWhen>("now");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  // Fichiers téléversés pendant la saisie : proposés avec les médias déjà envoyés (versions A et B).
  const [uploaded, setUploaded] = useState<MediaOption[]>([]);
  const media = [
    ...uploaded.filter((u) => !options.media.some((m) => m.id === u.id)),
    ...options.media,
  ];
  const addUploaded = (item: MediaOption) =>
    setUploaded((u) => [item, ...u.filter((x) => x.id !== item.id)]);

  // Arrivée sans erreur : le brouillon gardé d'un envoi précédent n'a plus lieu d'être.
  useEffect(() => {
    if (canRestore) return;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Stockage indisponible : rien à effacer.
    }
  }, [canRestore]);

  const count = useTargetCount(botId, segment);
  const bot = options.bots.find((b) => b.id === botId) ?? null;
  const names: GroupNames = {
    channels: Object.fromEntries(options.channels.map((c) => [c.id, c.title])),
    campaigns: Object.fromEntries(options.campaigns.map((c) => [c.id, c.name])),
    inviteLinks: Object.fromEntries(options.inviteLinks.map((l) => [l.id, l.label])),
    categories: Object.fromEntries(options.categories.map((c) => [c.id, c.name])),
  };
  const sentence = describeGroup(segment, names);
  const pending = pendingCriteria(openCriteria(addedCriteria, segment), segment);
  const effectiveName = nameTouched ? name : suggestName(text);
  const last = WIZARD_STEPS.length - 1;

  const draft: WizardDraft = {
    botId,
    pendingCriteria: pending,
    name: effectiveName,
    text,
    buttons: rows,
    hasMedia: Boolean(mediaAssetId),
    ab: { enabled: ab, textB, buttonsB: rowsB },
    when,
    scheduledAt,
  };

  const aiContext: ImproveContext = {
    surface: "broadcast",
    vertical: toAiVertical(bot?.vertical),
    language: segment.languages?.length === 1 ? segment.languages[0]! : null,
    hasMedia: Boolean(mediaAssetId),
  };

  function focusStep(i: number) {
    requestAnimationFrame(() => {
      const el = stepRefs.current[i];
      el?.focus({ preventScroll: true });
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function goTo(i: number) {
    setErrors([]);
    setStep(i);
    focusStep(i);
  }
  function showErrors(list: string[]) {
    setErrors(list);
    requestAnimationFrame(() => errorsRef.current?.focus());
  }
  function next() {
    const list = validateStep(WIZARD_STEPS[step]!.key, draft);
    if (list.length) {
      if (step === 1 && ab && list.some((e) => e.includes("version B"))) setAbOpenKey((k) => k + 1);
      showErrors(list);
      return;
    }
    goTo(Math.min(step + 1, last));
  }

  function saved(): Saved {
    return {
      botId,
      segment,
      text,
      mediaAssetId,
      rows,
      ab,
      textB,
      mediaAssetIdB,
      rowsB,
      split,
      when,
      scheduledAt,
      name,
      nameTouched,
    };
  }
  function restore() {
    setRestorable(false);
    let s: Saved | null = null;
    try {
      s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
    } catch {
      s = null;
    }
    if (!s) return;
    if (options.bots.some((b) => b.id === s.botId)) setBotId(s.botId);
    setSegment(s.segment ?? {});
    setAddedCriteria(activeCriteria(s.segment ?? {}));
    setText(s.text ?? "");
    setMediaAssetId(s.mediaAssetId ?? "");
    setShowMedia(Boolean(s.mediaAssetId));
    setRows(s.rows ?? []);
    setShowButtons((s.rows ?? []).length > 0);
    setAb(Boolean(s.ab));
    setTextB(s.textB ?? "");
    setMediaAssetIdB(s.mediaAssetIdB ?? "");
    setRowsB(s.rowsB ?? []);
    setShowMediaB(Boolean(s.mediaAssetIdB));
    setShowButtonsB((s.rowsB ?? []).length > 0);
    setSplit(s.split ?? AB_DEFAULT_SPLIT);
    setWhen(s.when === "later" ? "later" : "now");
    if (s.scheduledAt) setScheduledAt(s.scheduledAt);
    setName(s.name ?? "");
    setNameTouched(Boolean(s.nameTouched));
    if (s.ab) setAbOpenKey((k) => k + 1);
    goTo(last);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    // Entrée dans un champ d'une ligne ne doit jamais envoyer le formulaire : à l'étape 1 ou 2, elle fait « Continuer ».
    if (!(t instanceof HTMLInputElement) || ["checkbox", "radio", "file"].includes(t.type)) return;
    e.preventDefault();
    if (step < last) next();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (step < last) {
      e.preventDefault();
      next();
      return;
    }
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const v = submitter instanceof HTMLButtonElement ? submitter.value : "";
    const intent: WizardIntent = v === "now" || v === "schedule" ? v : "draft";
    const problem = firstInvalidStep(intent, draft);
    if (problem) {
      e.preventDefault();
      if (problem.step !== step) {
        setStep(problem.step);
        focusStep(problem.step);
      }
      showErrors(problem.errors);
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved()));
    } catch {
      // Stockage indisponible (navigation privée) : rien à garder.
    }
  }

  function openSendConfirm() {
    const problem = firstInvalidStep("now", draft);
    if (problem) {
      if (problem.step !== step) {
        setStep(problem.step);
        focusStep(problem.step);
      }
      showErrors(problem.errors);
      return;
    }
    setErrors([]);
    setConfirmOpen(true);
  }

  const preview = (
    <TelegramPreview html={text} buttons={filledRows(rows)} mediaCount={mediaAssetId ? 1 : 0} />
  );
  const previewB = (
    <TelegramPreview html={textB} buttons={filledRows(rowsB)} mediaCount={mediaAssetIdB ? 1 : 0} />
  );
  const buttonCount = filledRows(rows).reduce((n, r) => n + r.length, 0);
  const extras = [
    mediaAssetId ? "avec un média" : null,
    buttonCount ? `${buttonCount} bouton${buttonCount > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  const card = "space-y-6 rounded-xl border border-border bg-card p-4 md:p-6";

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      className="scroll-mt-4 space-y-6"
      noValidate
    >
      {/* Champs envoyés : mêmes noms qu'avant, quelle que soit l'étape affichée. */}
      <input type="hidden" name="name" value={effectiveName} />
      <input type="hidden" name="botId" value={botId} />
      {segmentFormFields(segment).map(([k, v], i) => (
        <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="text" value={text} />
      <input type="hidden" name="mediaAssetId" value={mediaAssetId} />
      <input type="hidden" name="buttons" value={JSON.stringify(filledRows(rows))} />
      <input type="hidden" name="scheduledAt" value={when === "later" ? scheduledAt : ""} />
      {ab ? (
        <>
          <input type="hidden" name="abEnabled" value="1" />
          <input type="hidden" name="abSplit" value={String(split)} />
          <input type="hidden" name="textB" value={textB} />
          <input type="hidden" name="mediaAssetIdB" value={mediaAssetIdB} />
          <input type="hidden" name="buttonsB" value={JSON.stringify(filledRows(rowsB))} />
        </>
      ) : null}

      {restorable ? (
        <Alert variant="info" role="status">
          <CircleAlert aria-hidden />
          <AlertTitle>Votre message n&apos;est pas perdu</AlertTitle>
          <AlertDescription>
            <p>Corrigez le point signalé ci-dessus : vous pouvez reprendre là où vous en étiez.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={restore}>
                Reprendre mon message
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRestorable(false)}>
                Recommencer
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Stepper
        steps={WIZARD_STEPS}
        current={step}
        onStepClick={goTo}
        label="Étapes de l'écriture à un groupe"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {/* Étape 1 : Qui */}
          <section
            ref={(el) => {
              stepRefs.current[0] = el;
            }}
            hidden={step !== 0}
            tabIndex={-1}
            aria-label="Étape 1 sur 3 : qui va recevoir ce message"
            className="space-y-6 outline-none"
          >
            {prefill?.carried ? (
              <Alert variant="info" role="status">
                <Users aria-hidden />
                <AlertDescription>
                  Groupe repris de la liste des membres. Vérifiez-le, puis continuez.
                  {prefill.dropped > 0
                    ? " Certains filtres de la liste ne s'appliquent pas ici et n'ont pas été repris."
                    : ""}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className={card}>
              <FormSection
                title="Envoyé par"
                description="Seuls les membres qui ont déjà écrit à ce bot peuvent recevoir son message."
              >
                {options.bots.length > 1 ? (
                  <NativeSelect
                    id="broadcast-bot"
                    aria-label="Bot qui envoie le message"
                    value={botId}
                    onChange={(e) => setBotId(e.target.value)}
                    wrapperClassName="w-full sm:w-80"
                  >
                    {options.bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (@{b.username})
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <p className="text-body text-foreground">
                    {bot ? `${bot.name} (@${bot.username})` : "—"}
                  </p>
                )}
              </FormSection>
              <FormSection
                title="Le groupe de membres"
                description="Sans critère, tous les membres joignables par ce bot. Chaque critère ajouté réduit le groupe."
              >
                <GroupBuilder
                  options={options}
                  segment={segment}
                  setSegment={setSegment}
                  added={addedCriteria}
                  setAdded={setAddedCriteria}
                />
              </FormSection>
            </div>
            <GroupSummary
              count={count}
              sentence={sentence}
              botUsername={bot?.username ?? null}
              pending={pending.length}
              className="lg:hidden"
            />
            <StickyCount count={count} onContinue={next} />
          </section>

          {/* Étape 2 : Quoi */}
          <section
            ref={(el) => {
              stepRefs.current[1] = el;
            }}
            hidden={step !== 1}
            tabIndex={-1}
            aria-label="Étape 2 sur 3 : le message"
            className="space-y-6 outline-none"
          >
            <div className={card}>
              <FormSection
                title={ab ? "Texte — version A" : "Le message"}
                description="Mise en forme Telegram par la barre d'outils. 4 096 caractères au plus."
              >
                <MessageTextEditor
                  id="broadcast-text"
                  text={text}
                  setText={setText}
                  label={ab ? "Texte de la version A" : "Texte du message"}
                  ai={
                    <ImproveButton
                      getText={() => text}
                      setText={setText}
                      context={aiContext}
                      label="Améliorer avec l'IA"
                      variant="ghost"
                      size="sm"
                      className="text-brand-ink"
                      onCreateVariantB={(t) => {
                        setAb(true);
                        setTextB(t);
                        setAbOpenKey((k) => k + 1);
                      }}
                    />
                  }
                />
                <div className="lg:hidden">
                  <p className="mb-2 text-note font-medium text-muted-foreground">
                    Aperçu tel que les membres le verront
                  </p>
                  {preview}
                </div>
              </FormSection>

              <MessageExtras
                version={ab ? "A" : null}
                idPrefix="broadcast"
                media={media}
                mediaAssetId={mediaAssetId}
                setMediaAssetId={setMediaAssetId}
                onUploaded={addUploaded}
                rows={rows}
                setRows={setRows}
                showMedia={showMedia}
                setShowMedia={setShowMedia}
                showButtons={showButtons}
                setShowButtons={setShowButtons}
                affiliateCampaigns={options.affiliateCampaigns}
                campaignOptions={options.ourCampaigns}
              />
            </div>

            <AdvancedSection
              key={abOpenKey}
              defaultOpen={ab && abOpenKey > 0}
              title="Test A/B"
              description="Comparer deux versions du message sur deux parts du groupe."
              modifiedCount={ab ? 1 : 0}
            >
              <label className="flex cursor-pointer items-start gap-3 text-body max-md:min-h-10">
                <Checkbox
                  checked={ab}
                  onCheckedChange={(v) => setAb(v === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block">Comparer deux versions de ce message</span>
                  <span className="block text-note text-muted-foreground">
                    Le groupe est partagé au hasard entre les deux versions. La page du test compare
                    les clics et désigne la gagnante.
                  </span>
                </span>
              </label>
              {ab ? (
                <div className="space-y-5">
                  <div className="space-y-1 sm:max-w-sm">
                    <Label htmlFor="broadcast-ab-split">Part du groupe pour la version A</Label>
                    <SplitSlider
                      id="broadcast-ab-split"
                      min={AB_MIN_SPLIT}
                      max={AB_MAX_SPLIT}
                      step={5}
                      value={split}
                      onChange={setSplit}
                      valueText={`${split} % pour la version A, ${100 - split} % pour la version B`}
                    />
                    <p className="text-note text-muted-foreground tabular-nums">
                      {abSplitSentence(split)}
                    </p>
                  </div>
                  <FormSection
                    title="Texte — version B"
                    description="Même mise en forme que la version A. Changez une seule chose (accroche, bouton…) pour savoir ce qui marche."
                  >
                    <MessageTextEditor
                      id="broadcast-text-b"
                      text={textB}
                      setText={setTextB}
                      label="Texte de la version B"
                      rows={6}
                      ai={
                        <ImproveButton
                          getText={() => textB}
                          setText={setTextB}
                          context={{ ...aiContext, hasMedia: Boolean(mediaAssetIdB) }}
                          label="Améliorer la version B"
                          variant="ghost"
                          size="sm"
                          className="text-brand-ink"
                        />
                      }
                    />
                    <div className="lg:hidden">
                      <p className="mb-2 text-note font-medium text-muted-foreground">
                        Aperçu — version B
                      </p>
                      {previewB}
                    </div>
                  </FormSection>
                  <MessageExtras
                    version="B"
                    idPrefix="broadcast-b"
                    media={media}
                    mediaAssetId={mediaAssetIdB}
                    setMediaAssetId={setMediaAssetIdB}
                    onUploaded={addUploaded}
                    rows={rowsB}
                    setRows={setRowsB}
                    showMedia={showMediaB}
                    setShowMedia={setShowMediaB}
                    showButtons={showButtonsB}
                    setShowButtons={setShowButtonsB}
                    affiliateCampaigns={options.affiliateCampaigns}
                    campaignOptions={options.ourCampaigns}
                  />
                </div>
              ) : null}
            </AdvancedSection>
          </section>

          {/* Étape 3 : Quand + récapitulatif */}
          <section
            ref={(el) => {
              stepRefs.current[2] = el;
            }}
            hidden={step !== 2}
            tabIndex={-1}
            aria-label="Étape 3 sur 3 : quand, et récapitulatif"
            className="space-y-6 outline-none"
          >
            <div className={card}>
              <FormSection title="Quand part-il ?">
                <div
                  role="radiogroup"
                  aria-label="Quand part-il ?"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(
                    [
                      {
                        value: "now",
                        title: "Maintenant",
                        hint: "Dès votre confirmation, par vagues (limites de Telegram).",
                      },
                      {
                        value: "later",
                        title: "Plus tard",
                        hint: "À la date et à l'heure choisies (heure de Paris).",
                      },
                    ] as const
                  ).map((o) => (
                    <label
                      key={o.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-body max-md:min-h-11",
                        when === o.value
                          ? "border-brand bg-brand-soft"
                          : "border-border bg-surface hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="broadcastWhen"
                        value={o.value}
                        checked={when === o.value}
                        onChange={() => setWhen(o.value)}
                        className="mt-0.5 size-4 accent-brand"
                      />
                      <span>
                        <span className="block font-medium text-foreground">{o.title}</span>
                        <span className="block text-note text-muted-foreground">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {when === "later" ? (
                  <div className="space-y-2 sm:max-w-xs">
                    <Label htmlFor="broadcast-scheduled-at">Date et heure (heure de Paris)</Label>
                    <Input
                      id="broadcast-scheduled-at"
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                    />
                  </div>
                ) : null}
              </FormSection>

              <FormSection title="Récapitulatif" description="Vérifiez avant de valider.">
                <p className="text-title text-foreground" aria-live="polite">
                  {count.loading && count.count === null
                    ? "Calcul du nombre de membres…"
                    : count.failed
                      ? "Le nombre de membres sera calculé au moment de l'envoi."
                      : countSentence(count.count)}
                </p>
                <dl className="divide-y divide-border border-y border-border">
                  <RecapRow
                    label="Qui"
                    onEdit={() => goTo(0)}
                    editLabel="Modifier le groupe de membres"
                  >
                    <span className="block">{sentence}.</span>
                    <span className="block text-note text-muted-foreground">
                      {reachableSentence(bot?.username)}
                    </span>
                  </RecapRow>
                  <RecapRow label="Envoyé par" onEdit={() => goTo(0)} editLabel="Modifier le bot">
                    {bot ? `${bot.name} (@${bot.username})` : "—"}
                  </RecapRow>
                  <RecapRow label="Quoi" onEdit={() => goTo(1)} editLabel="Modifier le message">
                    <span className="line-clamp-3 block break-words">{plainText(text) || "—"}</span>
                    {extras.length ? (
                      <span className="block text-note text-muted-foreground">
                        {extras.join(" · ")}
                      </span>
                    ) : null}
                  </RecapRow>
                  {ab ? (
                    <RecapRow
                      label="Test A/B"
                      onEdit={() => goTo(1)}
                      editLabel="Modifier le test A/B"
                    >
                      {abSplitSentence(split)}.
                    </RecapRow>
                  ) : null}
                  <RecapRow label="Quand">{whenSentence(when, scheduledAt)}</RecapRow>
                </dl>
                <div className="space-y-4 lg:hidden">
                  <div>
                    <p className="mb-2 text-note font-medium text-muted-foreground">
                      {ab ? "Aperçu — version A" : "Aperçu tel que les membres le verront"}
                    </p>
                    {preview}
                  </div>
                  {ab ? (
                    <div>
                      <p className="mb-2 text-note font-medium text-muted-foreground">
                        Aperçu — version B
                      </p>
                      {previewB}
                    </div>
                  ) : null}
                </div>
              </FormSection>

              <FormSection
                title="Nom de l'envoi"
                description="Visible seulement par l'équipe, pour le retrouver dans la liste."
              >
                <Label htmlFor="broadcast-name" className="sr-only">
                  Nom de l&apos;envoi
                </Label>
                <Input
                  id="broadcast-name"
                  value={effectiveName}
                  maxLength={120}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  className="sm:max-w-md"
                />
              </FormSection>
            </div>
          </section>

          {errors.length ? (
            <div
              ref={errorsRef}
              tabIndex={-1}
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-body text-danger outline-none"
            >
              <p className="font-semibold">
                {errors.length > 1 ? "Quelques points à corriger :" : "Un point à corriger :"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => goTo(step - 1)}
                  className="self-start max-md:h-10"
                >
                  <ChevronLeft aria-hidden />
                  Retour
                </Button>
              ) : (
                <Link
                  href="/members/broadcasts"
                  className={cn(buttonVariants({ variant: "ghost" }), "self-start max-md:h-10")}
                >
                  Annuler
                </Link>
              )}
              {step < last ? (
                <Button
                  type="button"
                  onClick={next}
                  className={cn("max-md:h-10", step === 0 && "max-lg:hidden")}
                >
                  Continuer
                  <ChevronRight aria-hidden />
                </Button>
              ) : (
                <FinalActions
                  when={when}
                  testAction={testAction}
                  count={count}
                  onSend={openSendConfirm}
                />
              )}
            </div>
            {step === last ? (
              <p className="text-note text-muted-foreground sm:text-right">
                « Envoyer un test à moi » enregistre un brouillon et vous l&apos;envoie sur Telegram
                : rien ne part vers les membres.
              </p>
            ) : null}
          </div>
          {/* Bouton d'envoi immédiat, cliqué par la confirmation (le formulaire part avec intent=now). */}
          <button ref={sendNowRef} type="submit" name="intent" value="now" hidden tabIndex={-1} />
        </div>

        {/* Ordinateur : à droite, ce qui aide à décider à chaque étape. */}
        <aside className="hidden lg:block" aria-label={step === 0 ? "Votre groupe" : "Aperçu"}>
          <div className="sticky top-4 space-y-4">
            {step === 0 ? (
              <GroupSummary
                count={count}
                sentence={sentence}
                botUsername={bot?.username ?? null}
                pending={pending.length}
              />
            ) : (
              <>
                <div>
                  <p className="mb-2 text-note font-medium text-muted-foreground">
                    {ab ? "Aperçu — version A" : "Aperçu tel que les membres le verront"}
                  </p>
                  {preview}
                </div>
                {ab ? (
                  <div>
                    <p className="mb-2 text-note font-medium text-muted-foreground">
                      Aperçu — version B
                    </p>
                    {previewB}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={ab ? "Envoyer le test A/B maintenant ?" : "Envoyer maintenant ?"}
        description={confirmSendMessage(count.loading ? null : count.count, {
          enabled: ab,
          split,
        })}
        confirmLabel="Envoyer"
        onConfirm={() => {
          const btn = sendNowRef.current;
          if (btn) formRef.current?.requestSubmit(btn);
        }}
      />
    </form>
  );
}
