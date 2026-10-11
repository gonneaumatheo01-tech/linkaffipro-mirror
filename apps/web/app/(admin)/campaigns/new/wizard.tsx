"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { Vertical } from "@linkaffipro/core";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Term } from "@/components/admin/help-tip";
import { Stepper } from "@/components/admin/stepper";
import { StatusPill } from "@/components/admin/status-pill";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { buildCampaignName, NAMING_EXAMPLE } from "@/lib/campaigns/match";
import { pickShellByName } from "@/lib/campaigns/ad-link";
import type {
  ConnectionOption,
  ImportedShellOption,
  OfferCandidateRow,
} from "@/lib/campaigns/queries";
import {
  AD_PLATFORMS,
  effectiveAdCount,
  findOfferByKey,
  MAX_ADS,
  offerAffiliateLabel,
  parseLinkAffiReference,
  parseWizardPayload,
  planAds,
  searchOffers,
  UNKNOWN_KEY_MESSAGE,
  WIZARD_STEPS,
  type WizardAdPlatform,
  type WizardError,
  type WizardPayload,
  type WizardStepKey,
} from "@/lib/campaigns/wizard";
import {
  adsAdvancedCount,
  fieldIdOnStep,
  generalAdvancedCount,
  hiddenOffersLabel,
  offerChipLabel,
  universeFirst,
  UNIVERSE_CHOICES,
} from "@/lib/campaigns/wizard-display";
import { universeLabel } from "@/lib/universe";

export type WizardChannel = {
  id: string;
  title: string;
  vertical: string | null;
  language: string;
};

const PLATFORM_LABELS: Record<WizardAdPlatform, string> = {
  TIKTOK: "TikTok",
  META: "Meta (Facebook / Instagram)",
  OTHER: "Autre",
};

/** Carte à cocher (case ou bouton radio natifs) : bordure orange et fond orange pâle quand elle est choisie. */
const choiceCls =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-body transition-colors hover:bg-muted/50 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";

/** Identifiant du message d'erreur affiché sous le champ fautif (relié par `aria-describedby`). */
const ERROR_ID = "wz-error";

/** Message d'erreur sous un champ de l'assistant (le champ porte `aria-invalid` et reçoit le focus). */
function FieldError({ message }: { message: string }) {
  return (
    <p id={ERROR_ID} className="text-note font-medium text-danger">
      {message}
    </p>
  );
}

/**
 * Donne le focus au champ en erreur (ou à la première case d'un groupe), en dépliant le bloc « Avancé » qui le
 * contient s'il est replié.
 */
function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const details = el.closest("details");
  if (details && !details.open) details.open = true;
  const target =
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
      ? el
      : el.querySelector<HTMLElement>("input, select, textarea, button");
  target?.focus();
}

/** Bouton « Créer la campagne » : désactivé pendant l'envoi (la création des liens Telegram prend quelques secondes). */
function CreateButton({ onCheck }: { onCheck: () => boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="max-md:h-10"
      disabled={pending}
      aria-disabled={pending}
      onClick={(e) => {
        if (pending || !onCheck()) e.preventDefault();
      }}
    >
      {pending ? "Création en cours…" : "Créer la campagne"}
    </Button>
  );
}

/** Une ligne du récapitulatif. */
function Recap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

/**
 * Assistant « Nouvelle campagne » en 4 étapes (`Stepper`), tout en mémoire côté navigateur, un seul envoi à la fin :
 * 1. nom et univers (budget, dates, notes dans « Avancé ») — 2. offres Link Affi (les nôtres par défaut) —
 * 3. canaux — 4. pubs : plateforme, nombre, canal d'entrée (compte connecté et campagne pub déjà importée dans
 * « Avancé »), puis le récapitulatif (nom conventionnel replié).
 * Un seul bouton principal par étape : « Continuer », puis « Créer la campagne ». Le serveur revérifie tout
 * (`parseWizardPayload`) et crée la campagne, le groupe « Groupe 1 », les pubs et leurs liens d'entrée ; `requestId`
 * (jeton créé par la page) empêche un double envoi de créer deux campagnes ; après une erreur serveur, la saisie
 * revient par `draft` et l'étape fautive par `initialStep`.
 */
export function CampaignWizard({
  action,
  channels,
  offers,
  connections,
  importedCampaigns,
  trackingHost,
  initialStep = 0,
  requestId,
  draft,
}: {
  action: (formData: FormData) => Promise<void>;
  channels: WizardChannel[];
  offers: OfferCandidateRow[];
  connections: ConnectionOption[];
  /** Campagnes pub importées par la synchro et pas encore rattachées (toutes, filtrées par compte ici). */
  importedCampaigns: ImportedShellOption[];
  trackingHost: string;
  initialStep?: number;
  /** Jeton d'idempotence de cette ouverture de l'assistant. */
  requestId: string;
  /** Valeurs à reprendre après une erreur serveur (la saisie n'est pas perdue). */
  draft?: Partial<WizardPayload> | null;
}) {
  const [step, setStep] = useState(Math.min(Math.max(0, initialStep), WIZARD_STEPS.length - 1));
  const [name, setName] = useState(draft?.name ?? "");
  // Rien n'est coché d'office (null) : l'univers donne la couleur de la campagne partout, il se choisit. Après une
  // erreur serveur, la saisie revient : un univers vide y vaut « Sans univers ».
  const [vertical, setVertical] = useState<Vertical | "" | null>(
    draft ? ((draft.vertical as Vertical | null) ?? "") : null,
  );
  const [startAt, setStartAt] = useState(draft?.startAt ?? "");
  const [endAt, setEndAt] = useState(draft?.endAt ?? "");
  const [budgetDaily, setBudgetDaily] = useState(
    draft?.budgetDaily != null ? String(draft.budgetDaily) : "",
  );
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [offerIds, setOfferIds] = useState<string[]>(draft?.affiliateCampaignIds ?? []);
  const [offerQuery, setOfferQuery] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [channelIds, setChannelIds] = useState<string[]>(draft?.channelIds ?? []);
  const [entryChannelId, setEntryChannelId] = useState(draft?.entryChannelId ?? "");
  const [adPlatform, setAdPlatform] = useState<WizardAdPlatform | "">(
    (draft?.adPlatform as WizardAdPlatform | null) ?? "",
  );
  const [connectionId, setConnectionId] = useState(draft?.connectionId ?? "");
  const [importedCampaignId, setImportedCampaignId] = useState(draft?.importedCampaignId ?? "");
  const [adCount, setAdCount] = useState(draft?.adCount ?? 0);
  const [program, setProgram] = useState("");
  const [language, setLanguage] = useState("FR");
  const [error, setError] = useState<WizardError | null>(null);

  // Étape 3 : les canaux de l'univers choisi d'abord (affichage seulement, rien n'est coché d'office).
  const shownChannels = useMemo(() => universeFirst(channels, vertical), [channels, vertical]);
  // Canaux cochés, dans l'ordre affiché ; le canal d'entrée par défaut est le premier d'entre eux (visible et modifiable).
  const checkedChannels = shownChannels.filter((c) => channelIds.includes(c.id));
  const entryChannel =
    checkedChannels.find((c) => c.id === entryChannelId) ?? checkedChannels[0] ?? null;
  const count = effectiveAdCount(adPlatform || null, adCount);

  // Charge envoyée au serveur (recalculée à chaque rendu : petite, et le compilateur React la mémorise).
  const payload: WizardPayload = {
    name,
    vertical: vertical || null,
    startAt: startAt || null,
    endAt: endAt || null,
    budgetDaily: budgetDaily.trim() === "" ? null : Number(budgetDaily.replace(",", ".")),
    affiliateCampaignIds: offerIds,
    channelIds,
    entryChannelId: count > 0 ? (entryChannel?.id ?? null) : null,
    adPlatform: adPlatform || null,
    connectionId: connectionId || null,
    importedCampaignId: connectionId && importedCampaignId ? importedCampaignId : null,
    adCount: count,
    notes: notes || null,
    requestId,
  };

  const current = WIZARD_STEPS[step]!;
  const last = step === WIZARD_STEPS.length - 1;
  const selectedOffers = offerIds
    .map((id) => offers.find((o) => o.id === id))
    .filter((o): o is OfferCandidateRow => !!o);
  const oursKnown = offers.some((o) => o.ours);
  // Les offres de l'univers choisi d'abord (affichage seulement).
  const filteredOffers = useMemo(
    () =>
      universeFirst(
        searchOffers(offerQuery, offers).filter((o) => showOthers || !oursKnown || o.ours),
        vertical,
      ).slice(0, 50),
    [offerQuery, offers, showOthers, oursKnown, vertical],
  );
  const hiddenOthers = oursKnown && !showOthers ? offers.filter((o) => !o.ours).length : 0;
  const platformConnections = connections.filter((c) => c.platform === adPlatform);
  const accountCampaigns = importedCampaigns.filter((c) => c.connectionId === connectionId);
  // « Aucune » choisie : la campagne pub déjà importée du même nom sera reprise à la création (même règle que le serveur).
  const sameNameShell = importedCampaignId ? null : pickShellByName(name, accountCampaigns);
  const reprisedShell = importedCampaignId
    ? (accountCampaigns.find((c) => c.id === importedCampaignId) ?? null)
    : sameNameShell;
  const plan = planAds(name || "Campagne", count);
  const generalModified = generalAdvancedCount({ budgetDaily, startAt, endAt, notes });
  const adsModified = adsAdvancedCount({ connectionId, importedCampaignId });

  /** Vérifie l'étape courante avant d'avancer (mêmes règles que le serveur, limitées à l'étape). */
  function validateStep(key: WizardStepKey): WizardError | null {
    // Avant la dernière étape, les contraintes liées aux pubs (plateforme, canal d'entrée) ne s'appliquent pas encore.
    const r = parseWizardPayload(
      key === "ads" ? payload : { ...payload, adCount: 0, adPlatform: "" },
    );
    if (r.ok) return null;
    return key === "ads" || r.error.step === key ? r.error : null;
  }

  // Champ en erreur sur l'étape affichée (message dessous, focus) ; sinon, bandeau en haut de la carte.
  const errorFieldId = error ? fieldIdOnStep(error.field, current.key) : null;
  const errorStepIndex = error ? WIZARD_STEPS.findIndex((s) => s.key === error.step) : -1;
  /** Attributs d'un champ : en erreur (`aria-invalid`, message relié), sinon sa ligne d'aide éventuelle. */
  const fieldProps = (id: string, help?: string) => {
    const invalid = errorFieldId === id;
    const describedBy = [invalid ? ERROR_ID : null, help].filter(Boolean).join(" ");
    return {
      "aria-invalid": invalid || undefined,
      "aria-describedby": describedBy || undefined,
    };
  };
  const errorUnder = (id: string) =>
    error && errorFieldId === id ? <FieldError message={error.message} /> : null;

  useEffect(() => {
    if (errorFieldId) focusField(errorFieldId);
  }, [error, errorFieldId]);

  function next() {
    const err = validateStep(current.key);
    setError(err);
    if (err) return;
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  function addPasted() {
    const key = parseLinkAffiReference(pasted);
    if (!key) {
      setPasteError(
        "Collez un lien de la forme https://linkaffi.me/go/<clé> ou la clé seule (ex. 47eb8mwc).",
      );
      return;
    }
    const found = findOfferByKey(key, offers);
    if (!found) {
      setPasteError(UNKNOWN_KEY_MESSAGE);
      return;
    }
    setPasteError(
      oursKnown && !found.ours
        ? `Offre ajoutée, mais elle appartient à un autre affilié (${offerAffiliateLabel(found)}) : vérifiez que c'est bien la vôtre.`
        : null,
    );
    setPasted("");
    setOfferIds((ids) => (ids.includes(found.id) ? ids : [...ids, found.id]));
  }

  function generateName() {
    setName(
      buildCampaignName({
        platform: adPlatform || "",
        program: program || selectedOffers[0]?.programName || vertical || "",
        language,
        channel: entryChannel?.title ?? checkedChannels[0]?.title ?? "",
        date: new Date(),
      }),
    );
  }

  const toggle = (list: string[], id: string, set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="max-w-3xl space-y-6">
      <Stepper
        steps={WIZARD_STEPS}
        current={step}
        label="Étapes de la création"
        onStepClick={(i) => {
          setError(null);
          setStep(i);
        }}
      />

      <div className="space-y-6 rounded-xl border border-border bg-card p-4 md:p-6">
        {error && !errorFieldId ? (
          <Alert variant="destructive">
            <AlertDescription className="space-y-2">
              <p>{error.message}</p>
              {errorStepIndex >= 0 && errorStepIndex !== step ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="max-md:h-10"
                  // L'erreur reste affichée : sur la bonne étape, elle passe sous le champ, qui prend le focus.
                  onClick={() => setStep(errorStepIndex)}
                >
                  Corriger à l&apos;étape « {WIZARD_STEPS[errorStepIndex]!.title} »
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {current.key === "general" ? (
          <>
            {/* Pas de titre de bloc : l'étape s'appelle déjà « Nom et univers » juste au-dessus. */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wz-name">Nom de la campagne</Label>
                <Input
                  id="wz-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                  placeholder="ex. Casino Bienvenue TikTok"
                  {...fieldProps("wz-name", "wz-name-help")}
                />
                {errorUnder("wz-name")}
                <p id="wz-name-help" className="text-note text-muted-foreground">
                  Un nom au format conventionnel peut vous être proposé à la dernière étape.
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-body font-medium text-foreground">Univers</legend>
                <p className="text-note text-muted-foreground">
                  Sa couleur repère la campagne partout dans le site.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {UNIVERSE_CHOICES.map((u) => (
                    <label key={u.value || "none"} className={choiceCls}>
                      <input
                        type="radio"
                        name="wz-vertical"
                        value={u.value}
                        checked={vertical === u.value}
                        onChange={() => setVertical(u.value as Vertical | "")}
                        className="size-4 shrink-0 accent-brand"
                      />
                      {/* Le libellé de la carte est celui de la pastille (point décoratif) : lu une seule fois. */}
                      <UniverseDot universe={u.value || null} withLabel label={u.label} />
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <AdvancedSection
              title="Budget, dates et notes"
              description="Facultatif, à titre indicatif."
              modifiedCount={generalModified}
              defaultOpen={generalModified > 0}
            >
              <div className="space-y-2">
                <Label htmlFor="wz-budget">Budget par jour (€)</Label>
                <Input
                  id="wz-budget"
                  inputMode="decimal"
                  value={budgetDaily}
                  onChange={(e) => setBudgetDaily(e.target.value)}
                  placeholder="ex. 50"
                  {...fieldProps("wz-budget")}
                />
                {errorUnder("wz-budget")}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wz-start">Début</Label>
                  <Input
                    id="wz-start"
                    type="date"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    {...fieldProps("wz-start")}
                  />
                  {errorUnder("wz-start")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-end">Fin</Label>
                  <Input
                    id="wz-end"
                    type="date"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    {...fieldProps("wz-end")}
                  />
                  {errorUnder("wz-end")}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wz-notes">Notes</Label>
                <Textarea
                  id="wz-notes"
                  rows={2}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  {...fieldProps("wz-notes")}
                />
                {errorUnder("wz-notes")}
              </div>
            </AdvancedSection>
          </>
        ) : null}

        {current.key === "offers" ? (
          // Pas de titre de bloc : l'étape s'appelle déjà « Offres » juste au-dessus.
          <div className="space-y-4">
            <p className="text-note text-muted-foreground">
              Facultatif : vous pourrez en ajouter depuis la fiche de la campagne.
            </p>
            <div className="space-y-2">
              <Label htmlFor="wz-offer-search">Chercher une offre (nom, clé, casino)</Label>
              <Input
                id="wz-offer-search"
                type="search"
                value={offerQuery}
                onChange={(e) => setOfferQuery(e.target.value)}
                placeholder="ex. casino, 47eb8mwc"
              />
              {oursKnown ? (
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-body md:min-h-0">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={showOthers}
                    onChange={(e) => setShowOthers(e.target.checked)}
                  />
                  Afficher les offres des autres affiliés
                  {hiddenOthers ? (
                    <span className="text-note text-muted-foreground">
                      ({hiddenOffersLabel(hiddenOthers)})
                    </span>
                  ) : null}
                </label>
              ) : offers.length ? (
                <p className="text-note text-warning">
                  Vos offres ne sont pas encore reconnues (aucun clic avec{" "}
                  <Term term="sub-ID">identifiant de suivi</Term> pour l&apos;instant) : toutes les
                  offres Link Affi sont affichées. Vérifiez l&apos;affilié avant de cocher.
                </p>
              ) : null}
              {offers.length === 0 ? (
                <p className="text-body text-muted-foreground">
                  Aucune offre synchronisée pour l&apos;instant : Link Affi est relu toutes les 2
                  minutes (Réglages → Connexions).
                </p>
              ) : (
                <ul
                  className="max-h-80 divide-y divide-border overflow-auto rounded-xl border border-border"
                  aria-label="Offres Link Affi"
                >
                  {filteredOffers.map((o) => {
                    const checked = offerIds.includes(o.id);
                    return (
                      <li key={o.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-body hover:bg-muted/50 has-[:checked]:bg-brand-soft">
                          <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-brand"
                            checked={checked}
                            onChange={() => toggle(offerIds, o.id, setOfferIds)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{o.name}</span>
                            <span className="block text-note text-muted-foreground">
                              {o.programName}
                              {o.campaignKey ? ` · clé ${o.campaignKey}` : ""}
                              {o.vertical ? ` · ${universeLabel(o.vertical)}` : ""}
                            </span>
                          </span>
                          <StatusPill
                            tone={o.ours ? "success" : oursKnown ? "warning" : "muted"}
                            className="max-sm:hidden"
                          >
                            {offerAffiliateLabel(o)}
                          </StatusPill>
                        </label>
                      </li>
                    );
                  })}
                  {filteredOffers.length === 0 ? (
                    <li className="px-3 py-3 text-body text-muted-foreground">
                      Aucune offre ne correspond.
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wz-paste">Ou collez un lien d&apos;offre Link Affi</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="wz-paste"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="https://linkaffi.me/go/47eb8mwc"
                />
                <Button type="button" variant="outline" className="max-md:h-10" onClick={addPasted}>
                  Ajouter
                </Button>
              </div>
              {pasteError ? (
                <p role="alert" className="text-note text-danger">
                  {pasteError}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-body font-medium text-foreground">
                Offres choisies ({selectedOffers.length})
              </p>
              {selectedOffers.length === 0 ? (
                <p className="text-note text-muted-foreground">Aucune pour l&apos;instant.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {selectedOffers.map((o) => (
                    <li
                      key={o.id}
                      className={cn(
                        "inline-flex h-8 items-center gap-1 rounded-full border bg-surface pr-1 pl-3 text-note font-medium max-md:h-10",
                        oursKnown && !o.ours ? "border-warning/50" : "border-border",
                      )}
                    >
                      {offerChipLabel(o)}
                      {oursKnown && !o.ours ? " (autre affilié)" : ""}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Retirer ${o.name}`}
                        onClick={() => toggle(offerIds, o.id, setOfferIds)}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {current.key === "channels" ? (
          // Pas de titre de bloc : l'étape s'appelle déjà « Canaux » juste au-dessus.
          <div className="space-y-4">
            <p className="text-note text-muted-foreground">
              Le canal que les liens des pubs font rejoindre se choisit à l&apos;étape suivante,
              parmi ceux-ci.
            </p>
            {channels.length === 0 ? (
              <p className="text-body text-muted-foreground">
                Aucun canal actif : ajoutez d&apos;abord un canal (menu Canaux). Vous pouvez aussi
                continuer sans canal ni pub.
              </p>
            ) : (
              <div className="space-y-2">
                <fieldset
                  id="wz-channels"
                  className="grid gap-2 sm:grid-cols-2"
                  aria-describedby={errorFieldId === "wz-channels" ? ERROR_ID : undefined}
                >
                  <legend className="sr-only">Canaux alimentés par la campagne</legend>
                  {shownChannels.map((c) => (
                    <label key={c.id} className={choiceCls}>
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-brand"
                        checked={channelIds.includes(c.id)}
                        onChange={() => toggle(channelIds, c.id, setChannelIds)}
                        aria-invalid={errorFieldId === "wz-channels" || undefined}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <UniverseDot universe={c.vertical} />
                    </label>
                  ))}
                </fieldset>
                {errorUnder("wz-channels")}
              </div>
            )}
          </div>
        ) : null}

        {current.key === "ads" ? (
          <>
            {/* Pas de titre de bloc : l'étape s'appelle déjà « Pubs » juste au-dessus. Le nombre de pubs, le canal
                d'entrée et le compte pub n'apparaissent qu'une fois une plateforme choisie. */}
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wz-platform">Plateforme des pubs</Label>
                  <NativeSelect
                    id="wz-platform"
                    value={adPlatform}
                    onChange={(e) => {
                      const v = e.target.value as WizardAdPlatform | "";
                      setAdPlatform(v);
                      setConnectionId("");
                      setImportedCampaignId("");
                      // « Aucune pub pour l'instant » : aucune pub à créer ; une plateforme : au moins une.
                      setAdCount((n) => (v ? Math.max(1, n) : 0));
                    }}
                    wrapperClassName="w-full"
                    {...fieldProps("wz-platform")}
                  >
                    <option value="">Aucune pub pour l&apos;instant</option>
                    {AD_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </NativeSelect>
                  {errorUnder("wz-platform")}
                </div>
                {adPlatform ? (
                  <div className="space-y-2">
                    <Label htmlFor="wz-count">Nombre de pubs (0 à {MAX_ADS})</Label>
                    <Input
                      id="wz-count"
                      type="number"
                      min={0}
                      max={MAX_ADS}
                      value={count}
                      onChange={(e) =>
                        setAdCount(Math.max(0, Math.min(MAX_ADS, Number(e.target.value) || 0)))
                      }
                      {...fieldProps("wz-count")}
                    />
                    {errorUnder("wz-count")}
                  </div>
                ) : null}
              </div>
              {adPlatform ? (
                <div className="space-y-2">
                  <Label htmlFor="wz-entry-channel">Canal où entrent les membres</Label>
                  <NativeSelect
                    id="wz-entry-channel"
                    value={entryChannel?.id ?? ""}
                    onChange={(e) => setEntryChannelId(e.target.value)}
                    disabled={count === 0 || checkedChannels.length === 0}
                    wrapperClassName="w-full"
                    {...fieldProps("wz-entry-channel", "wz-entry-channel-help")}
                  >
                    {checkedChannels.length === 0 ? (
                      <option value="">Cochez d&apos;abord un canal à l&apos;étape 3</option>
                    ) : null}
                    {checkedChannels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </NativeSelect>
                  {errorUnder("wz-entry-channel")}
                  <p id="wz-entry-channel-help" className="text-note text-muted-foreground">
                    Chaque lien d&apos;entrée ouvre une demande d&apos;adhésion à ce canal.
                  </p>
                </div>
              ) : (
                <p className="text-note text-muted-foreground">
                  Sans pub, la campagne est créée seule : ses pubs et leurs liens s&apos;ajoutent
                  ensuite (onglets Pubs et Liens).
                </p>
              )}
            </div>

            {adPlatform ? (
              <AdvancedSection
                title="Compte pub connecté"
                description="Pour recevoir les dépenses Meta ou TikTok toutes seules."
                modifiedCount={adsModified}
                defaultOpen={adsModified > 0}
              >
                <div className="space-y-2">
                  <Label htmlFor="wz-connection">Compte</Label>
                  <NativeSelect
                    id="wz-connection"
                    value={connectionId}
                    onChange={(e) => {
                      setConnectionId(e.target.value);
                      setImportedCampaignId("");
                    }}
                    disabled={platformConnections.length === 0}
                    wrapperClassName="w-full"
                  >
                    <option value="">
                      {platformConnections.length === 0
                        ? "Aucun compte connecté pour cette plateforme"
                        : "Sans compte"}
                    </option>
                    {platformConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.externalId})
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-note text-muted-foreground">
                    Les comptes se connectent dans Réglages → Connexions.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-imported">Campagne pub déjà importée de ce compte</Label>
                  <NativeSelect
                    id="wz-imported"
                    value={importedCampaignId}
                    onChange={(e) => setImportedCampaignId(e.target.value)}
                    disabled={!connectionId || accountCampaigns.length === 0}
                    wrapperClassName="w-full"
                  >
                    <option value="">
                      {!connectionId
                        ? "Choisissez d'abord un compte"
                        : accountCampaigns.length === 0
                          ? "Aucune campagne pub importée libre"
                          : "Aucune (reprise automatique si même nom)"}
                    </option>
                    {accountCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.externalCampaignId})
                      </option>
                    ))}
                  </NativeSelect>
                  {sameNameShell ? (
                    <p className="text-note text-muted-foreground">
                      « {sameNameShell.name} » porte le même nom que la campagne : elle sera reprise
                      à la création (groupes, pubs et dépenses).
                    </p>
                  ) : null}
                </div>
              </AdvancedSection>
            ) : null}

            <FormSection
              title="Récapitulatif"
              description="Tout reste modifiable ensuite depuis la fiche de la campagne."
            >
              <div className="space-y-2">
                <Label htmlFor="wz-name-final">Nom de la campagne</Label>
                <Input
                  id="wz-name-final"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  {...fieldProps("wz-name-final")}
                />
                {errorUnder("wz-name-final")}
              </div>
              <AdvancedSection
                title="Proposer un nom conventionnel"
                description="Le même nom dans TikTok ou Meta relie les dépenses tout seul."
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="wz-program">Programme</Label>
                    <Input
                      id="wz-program"
                      value={program}
                      onChange={(e) => setProgram(e.target.value)}
                      placeholder="offre ou univers si vide"
                      className="w-56"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="wz-language">Langue</Label>
                    <Input
                      id="wz-language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      maxLength={5}
                      className="w-20 uppercase"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="max-md:h-10"
                    onClick={generateName}
                  >
                    Proposer un nom
                  </Button>
                </div>
                <p className="text-note text-muted-foreground">
                  Format plateforme-programme-langue-canal-mois, ex. {NAMING_EXAMPLE}.
                </p>
              </AdvancedSection>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl bg-muted/40 p-4 text-body">
                <Recap label="Campagne">
                  {name || "—"}
                  {vertical ? (
                    <UniverseDot universe={vertical} withLabel className="ml-2 text-note" />
                  ) : null}
                </Recap>
                {budgetDaily || startAt || endAt ? (
                  <Recap label="Budget et dates">
                    {[
                      budgetDaily ? `${budgetDaily} € / jour` : null,
                      startAt || endAt ? `du ${startAt || "?"} au ${endAt || "?"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Recap>
                ) : null}
                <Recap label="Offres">
                  {selectedOffers.length
                    ? selectedOffers.map((o) => o.name).join(", ")
                    : "Aucune pour l'instant"}
                </Recap>
                <Recap label="Canaux">
                  {checkedChannels.length
                    ? checkedChannels.map((c) => c.title).join(", ")
                    : "Aucun pour l'instant"}
                </Recap>
                <Recap label="Pubs">
                  {adPlatform && count > 0
                    ? `${count} pub${count > 1 ? "s" : ""} ${PLATFORM_LABELS[adPlatform]} dans « Groupe 1 »${connectionId ? " (compte connecté)" : ""}, ${count > 1 ? "chacune avec son" : "avec son"} lien d'entrée ${trackingHost}/…${entryChannel ? ` vers « ${entryChannel.title} »` : ""}`
                    : "Aucune pour l'instant (ajoutables ensuite, onglet Pubs)"}
                </Recap>
                {reprisedShell ? (
                  <Recap label="Campagne pub reprise">
                    {reprisedShell.name}
                    {sameNameShell ? " (même nom)" : ""} : ses groupes, pubs et dépenses rejoignent
                    la campagne
                  </Recap>
                ) : null}
              </dl>
              {adPlatform && count > 0 ? (
                <p className="text-note text-muted-foreground">
                  Liens créés : {plan.map((p) => p.linkName).join(" ; ")}. Les adresses à coller
                  dans {PLATFORM_LABELS[adPlatform]} s&apos;affichent juste après la création
                  (onglet Liens).
                </p>
              ) : null}
            </FormSection>
          </>
        ) : null}

        <form
          action={action}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          {step > 0 ? (
            <Button type="button" variant="outline" className="max-md:h-10" onClick={back}>
              <ArrowLeft aria-hidden />
              Retour
            </Button>
          ) : (
            <span aria-hidden />
          )}
          {last ? (
            <CreateButton
              onCheck={() => {
                const err = validateStep("ads");
                setError(err);
                return err === null;
              }}
            />
          ) : (
            <Button type="button" className="max-md:h-10" onClick={next}>
              Continuer
              <ArrowRight aria-hidden />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
