"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import type { VeniceModelInfo } from "@linkaffipro/chat";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PersonaSaveState } from "@/app/(admin)/conversations/personas/actions";
import {
  PERSONA_LANGUAGES,
  PERSONA_LIMITS,
  activationProblems,
  advancedModifiedCount,
  personaRole,
  proposedProfileTexts,
  withProfileTexts,
  type PersonaFormField,
  type PersonaFormState,
  type ProfileTemplates,
} from "@/lib/personas/form";
import {
  campaignOfferNote,
  offerChoiceGroups,
  personaModelOptions,
  type CampaignChoice,
  type OfferChoice,
} from "@/lib/personas/view";
import { OfferVisualField, type VisualOption } from "./offer-visual-field";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Champs qui changent les textes proposés du profil du bot. */
const PROFILE_KEYS = new Set<keyof PersonaFormState>(["name", "gender", "languages"]);

/**
 * Formulaire unique d'une persona (création et modification, phase 17) en sections : Identité, Parcours, Offre,
 * Profil du bot, Avancé (replié), Mise en service. Le brouillon part en JSON à l'action serveur, qui valide tout ; un
 * refus revient sous le bouton et sur le champ en cause, la saisie est gardée. Aucune option pour cacher qu'il s'agit
 * d'un assistant : la description du bot doit le dire, et l'activation est refusée sans prénom ou avec une offre liée
 * sans fiche. Un seul bouton principal (« Créer la persona » / « Enregistrer »).
 */
export function PersonaForm({
  initial,
  offers,
  campaigns,
  images: initialImages,
  models,
  defaultModel,
  templates,
  action,
}: {
  initial: PersonaFormState;
  offers: OfferChoice[];
  campaigns: CampaignChoice[];
  images: VisualOption[];
  models: VeniceModelInfo[];
  defaultModel: string;
  templates: ProfileTemplates;
  action: (prev: PersonaSaveState, formData: FormData) => Promise<PersonaSaveState>;
}) {
  const [state, setState] = useState<PersonaFormState>(initial);
  const [images, setImages] = useState<VisualOption[]>(initialImages);
  const [result, dispatch, pending] = useActionState(action, null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result?.error) errorRef.current?.focus();
  }, [result]);

  const errors = result?.errors ?? {};
  const isNew = state.id === null;
  const role = personaRole(state.gender);
  const set = <K extends keyof PersonaFormState>(k: K, v: PersonaFormState[K]) =>
    setState((s) => {
      const next = { ...s, [k]: v };
      return PROFILE_KEYS.has(k) ? withProfileTexts(s, next, templates) : next;
    });

  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);

  const offerGroups = offerChoiceGroups(offers);
  const campaign = campaigns.find((c) => c.id === state.campaignId) ?? null;
  const offerNote = campaignOfferNote(campaign, state.affiliateCampaignId);
  const selectedOffer = offers.find((o) => o.id === state.affiliateCampaignId) ?? null;
  const modelOptions = personaModelOptions(models, defaultModel, state.model);
  const proposed = proposedProfileTexts(templates, state);
  const profileIsProposed =
    !!proposed &&
    state.botDescription === proposed.long &&
    state.botShortDescription === proposed.short;
  const problems = activationProblems({
    name: state.name,
    affiliateCampaignId: state.affiliateCampaignId || null,
    offerPitch: state.offerPitch,
  });
  const err = (k: PersonaFormField) => errors[k];

  function toggleLanguage(code: (typeof PERSONA_LANGUAGES)[number]["code"], on: boolean) {
    const current = state.languages;
    if (on && !current.includes(code)) set("languages", [...current, code]);
    if (!on && current.includes(code) && current.length > 1)
      set(
        "languages",
        current.filter((l) => l !== code),
      );
  }

  function setDefaultLanguage(code: string) {
    const lang = state.languages.find((l) => l === code);
    if (!lang) return;
    set("languages", [lang, ...state.languages.filter((l) => l !== lang)]);
  }

  return (
    <form action={dispatch} className="max-w-3xl space-y-10">
      <input type="hidden" name="payload" value={JSON.stringify(state)} />

      <FormSection
        title="Identité"
        description={`Le personnage de ${role} : un prénom, une personnalité, une façon de parler. Jamais une vraie personne.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="persona-name"
            label="Prénom"
            value={state.name}
            onChange={(v) => set("name", v)}
            max={PERSONA_LIMITS.name}
            placeholder="Léa"
            help="Le prénom affiché dans la conversation."
            error={err("name")}
          />
          <fieldset className="space-y-1.5">
            <legend className="text-body font-medium text-foreground">Se présente comme</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {(["F", "M"] as const).map((g) => (
                <label
                  key={g}
                  className="flex min-h-10 cursor-pointer items-center gap-2 text-body md:min-h-9"
                >
                  <input
                    type="radio"
                    name="persona-gender"
                    value={g}
                    checked={state.gender === g}
                    onChange={() => set("gender", g)}
                    className="size-4 accent-brand"
                  />
                  {personaRole(g)} du canal
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <TextAreaField
          id="persona-personality"
          label="Personnalité"
          value={state.personality}
          onChange={(v) => set("personality", v)}
          max={PERSONA_LIMITS.personality}
          rows={2}
          placeholder="Pétillante, curieuse, pleine d'humour"
          help="Quelques mots sur son caractère."
          error={err("personality")}
        />
        <TextField
          id="persona-tone"
          label="Ton"
          value={state.tone}
          onChange={(v) => set("tone", v)}
          max={PERSONA_LIMITS.tone}
          placeholder="complice, léger, taquin"
          help="Sa façon d'écrire. Le flirt léger est permis, jamais un contenu explicite."
          error={err("tone")}
        />
        <fieldset className="space-y-2" aria-describedby="persona-languages-help">
          <legend className="text-body font-medium text-foreground">Langues</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {PERSONA_LANGUAGES.map((l) => (
              <label
                key={l.code}
                className="flex min-h-10 cursor-pointer items-center gap-2 text-body md:min-h-8"
              >
                <Checkbox
                  checked={state.languages.includes(l.code)}
                  disabled={state.languages.length === 1 && state.languages[0] === l.code}
                  onCheckedChange={(v) => toggleLanguage(l.code, v === true)}
                />
                {l.label}
              </label>
            ))}
          </div>
          {state.languages.length > 1 ? (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="persona-default-language">Langue par défaut</Label>
              <NativeSelect
                id="persona-default-language"
                value={state.languages[0]}
                onChange={(e) => setDefaultLanguage(e.target.value)}
                wrapperClassName="w-full"
              >
                {state.languages.map((code) => (
                  <option key={code} value={code}>
                    {PERSONA_LANGUAGES.find((l) => l.code === code)?.label ?? code}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <p
            id="persona-languages-help"
            className={cn("text-note", err("languages") ? "text-danger" : "text-muted-foreground")}
          >
            {err("languages") ??
              `${cap(role)} répond dans la langue de la personne si elle la parle, sinon dans la langue par défaut.`}
          </p>
        </fieldset>
        <TextField
          id="persona-interests"
          label="Centres d'intérêt"
          value={state.interests}
          onChange={(v) => set("interests", v)}
          max={600}
          placeholder="voyages, musique, cuisine"
          help="Séparés par des virgules (12 au plus) : de quoi parler pour faire connaissance."
          error={err("interests")}
        />
        <p className="rounded-lg bg-info-soft px-3 py-2 text-note text-info">
          {cap(role)} se présente toujours comme {role} du canal au premier message et répond
          franchement si on lui demande si c&apos;est une IA. Ce n&apos;est pas réglable.
        </p>
      </FormSection>

      <FormSection
        title="Parcours"
        description="À quel moment le lien de l'offre part, et quand relancer une personne qui ne répond plus."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="persona-min-exchanges"
            label="Messages de la personne avant le lien"
            value={state.minExchangesBeforeOffer}
            onChange={(v) => set("minExchangesBeforeOffer", v)}
            min={PERSONA_LIMITS.minExchangesBeforeOffer.min}
            max={PERSONA_LIMITS.minExchangesBeforeOffer.max}
            help="Au moins 1 : jamais de lien au premier message. Conseillé : 4."
            error={err("minExchangesBeforeOffer")}
          />
          <SelectField
            id="persona-max-sends"
            label="Envois du lien au plus"
            value={state.maxOfferSends}
            onChange={(v) => set("maxOfferSends", v)}
            options={["1", "2", "3"].map((n) => ({
              value: n,
              label: n === "1" ? "1 fois" : `${n} fois`,
            }))}
            help="Par conversation."
            error={err("maxOfferSends")}
          />
          <NumberField
            id="persona-followup-hours"
            label="Relancer après (heures de silence)"
            value={state.followUpAfterHours}
            onChange={(v) => set("followUpAfterHours", v)}
            min={PERSONA_LIMITS.followUpAfterHours.min}
            max={PERSONA_LIMITS.followUpAfterHours.max}
            help="4 heures au moins. La seconde relance attend au moins 24 heures de plus. Jamais la nuit."
            error={err("followUpAfterHours")}
          />
          <SelectField
            id="persona-followups"
            label="Relances au plus"
            value={state.followUpsMax}
            onChange={(v) => set("followUpsMax", v)}
            options={[
              { value: "0", label: "Aucune relance" },
              { value: "1", label: "1 relance" },
              { value: "2", label: "2 relances" },
            ]}
            help="Jamais plus de 2, puis plus rien. Jamais après /stop."
            error={err("followUpsMax")}
          />
        </div>
        <CheckField
          id="persona-require-interest"
          checked={state.requireInterest}
          onChange={(v) => set("requireInterest", v)}
          label="Attendre que la personne semble intéressée"
          help={`${cap(role)} n'envoie le lien que si l'échange montre un vrai intérêt (6 sur 10 au moins).`}
        />
      </FormSection>

      <FormSection
        title="Offre"
        description="L'app présentée, ce qui peut en être dit, et le bouton qui ouvre le lien suivi (clics, inscriptions et dépôts comptés)."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="persona-offer">Offre Link Affi</Label>
            <NativeSelect
              id="persona-offer"
              value={state.affiliateCampaignId}
              onChange={(e) => set("affiliateCampaignId", e.target.value)}
              wrapperClassName="w-full"
              aria-invalid={err("affiliateCampaignId") ? true : undefined}
              aria-describedby="persona-offer-help"
            >
              <option value="">Aucune offre (jamais de lien)</option>
              {offerGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
            <p
              id="persona-offer-help"
              className={cn(
                "text-note",
                err("affiliateCampaignId") || (selectedOffer && !selectedOffer.isActive)
                  ? "text-danger"
                  : "text-muted-foreground",
              )}
            >
              {err("affiliateCampaignId") ??
                (selectedOffer && !selectedOffer.isActive
                  ? "Cette offre n'est plus active chez Link Affi : aucun lien ne partira. Choisissez-en une autre."
                  : "Les offres de l'univers Rencontres sont en premier.")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="persona-campaign">Campagne (facultatif)</Label>
            <NativeSelect
              id="persona-campaign"
              value={state.campaignId}
              onChange={(e) => set("campaignId", e.target.value)}
              wrapperClassName="w-full"
              aria-invalid={err("campaignId") ? true : undefined}
              aria-describedby="persona-campaign-help"
            >
              <option value="">Aucune campagne</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <p
              id="persona-campaign-help"
              className={cn(
                "text-note",
                err("campaignId")
                  ? "text-danger"
                  : offerNote
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              {err("campaignId") ??
                offerNote ??
                "Pour retrouver les liens envoyés et leurs inscriptions dans une de vos campagnes."}
            </p>
          </div>
        </div>
        <TextAreaField
          id="persona-pitch"
          label={`Ce que ${role} peut dire de l'app`}
          value={state.offerPitch}
          onChange={(v) => set("offerPitch", v)}
          max={PERSONA_LIMITS.offerPitch}
          rows={4}
          counter
          placeholder="Une app de rencontres gratuite à l'inscription, avec des profils vérifiés."
          help="Rien d'autre ne sera dit : pas de chiffres, pas de promesses. Écrivez seulement ce qui est vrai."
          error={err("offerPitch")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="persona-button"
            label="Texte du bouton"
            value={state.offerButtonText}
            onChange={(v) => set("offerButtonText", v)}
            max={PERSONA_LIMITS.offerButtonText}
            placeholder="Découvrir l'app"
            help="Le bouton sous le message qui porte le lien."
            error={err("offerButtonText")}
          />
          <div className="space-y-1.5">
            <Label htmlFor="persona-visual">Visuel de l&apos;app (facultatif)</Label>
            <OfferVisualField
              id="persona-visual"
              images={images}
              value={state.offerMediaAssetId}
              onChange={(v) => set("offerMediaAssetId", v)}
              onUploaded={(item) =>
                setImages((list) => (list.some((m) => m.id === item.id) ? list : [item, ...list]))
              }
              invalid={Boolean(err("offerMediaAssetId"))}
              describedBy="persona-visual-help"
            />
            <p
              id="persona-visual-help"
              className={cn(
                "text-note",
                err("offerMediaAssetId") ? "text-danger" : "text-muted-foreground",
              )}
            >
              {err("offerMediaAssetId") ??
                `Un visuel de l'app ou de l'offre, jamais une photo présentée comme celle de ${role}.`}
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Profil du bot"
        description="Ce que Telegram affiche avant la conversation et sur le profil du bot. Les deux textes doivent dire « assistante » ou « assistant »."
        actions={
          proposed && !profileIsProposed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:h-10"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  botDescription: proposed.long,
                  botShortDescription: proposed.short,
                }))
              }
            >
              <RotateCcw aria-hidden />
              Remettre le texte proposé
            </Button>
          ) : null
        }
      >
        <TextAreaField
          id="persona-bot-description"
          label="Description"
          value={state.botDescription}
          onChange={(v) => set("botDescription", v)}
          max={PERSONA_LIMITS.botDescription}
          rows={3}
          counter
          help="Affichée avant le premier message. Les autres langues de la persona reçoivent le texte proposé, traduit."
          error={err("botDescription")}
        />
        <TextField
          id="persona-bot-short"
          label="Description courte"
          value={state.botShortDescription}
          onChange={(v) => set("botShortDescription", v)}
          max={PERSONA_LIMITS.botShortDescription}
          counter
          help="Affichée sur le profil du bot."
          error={err("botShortDescription")}
        />
      </FormSection>

      <AdvancedSection
        title="Avancé : modèle, créativité, consigne"
        description="Les réglages généraux conviennent le plus souvent."
        modifiedCount={advancedModifiedCount(state)}
        defaultOpen={Boolean(err("model") || err("temperature") || err("extraPrompt"))}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="persona-model"
            label="Modèle"
            value={state.model}
            onChange={(v) => set("model", v)}
            options={modelOptions}
            help="Prix de Venice en dollars."
            error={err("model")}
          />
          <div className="space-y-1.5">
            <Label htmlFor="persona-temperature">Créativité des réponses</Label>
            <Input
              id="persona-temperature"
              type="number"
              inputMode="decimal"
              min={PERSONA_LIMITS.temperature.min}
              max={PERSONA_LIMITS.temperature.max}
              step="0.05"
              value={state.temperature}
              placeholder="Réglage général"
              onChange={(e) => set("temperature", e.target.value)}
              aria-invalid={err("temperature") ? true : undefined}
              aria-describedby="persona-temperature-help"
            />
            <p
              id="persona-temperature-help"
              className={cn(
                "text-note",
                err("temperature") ? "text-danger" : "text-muted-foreground",
              )}
            >
              {err("temperature") ??
                "De 0 (toujours la même réponse) à 2 (très libre). Vide : le réglage général."}
            </p>
          </div>
        </div>
        <TextAreaField
          id="persona-extra"
          label="Consigne supplémentaire"
          value={state.extraPrompt}
          onChange={(v) => set("extraPrompt", v)}
          max={PERSONA_LIMITS.extraPrompt}
          rows={3}
          counter
          placeholder="Parle de séries si la personne aime le cinéma."
          help="Une précision pour l'IA. Les règles du client restent toujours plus fortes."
          error={err("extraPrompt")}
        />
      </AdvancedSection>

      <FormSection
        title="Mise en service"
        description="Une persona activée répond sur les bots qui l'utilisent (Réglages → Bots), selon « Qui reçoit une réponse » (Réglages → IA de conversation)."
      >
        <div className="space-y-1">
          <label className="flex min-h-10 cursor-pointer items-center gap-3 text-body font-medium md:min-h-8">
            <Checkbox
              checked={state.isActive}
              disabled={!state.isActive && problems.length > 0}
              onCheckedChange={(v) => set("isActive", v === true)}
              aria-describedby="persona-active-help"
            />
            Persona activée
          </label>
          <div
            id="persona-active-help"
            className={cn(
              "space-y-0.5 pl-7 text-note",
              err("isActive") ? "text-danger" : "text-muted-foreground",
            )}
          >
            {err("isActive") ? (
              <p>{err("isActive")}</p>
            ) : problems.length > 0 ? (
              problems.map((p) => <p key={p}>{p}</p>)
            ) : (
              <p>
                {state.isActive
                  ? `Activée : ${role} répond aux personnes qui écrivent au bot.`
                  : "Désactivée : personne ne reçoit de réponse avec cette persona. Testez-la d'abord."}
              </p>
            )}
          </div>
        </div>
      </FormSection>

      <div className="space-y-3">
        {result?.error ? (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 text-body text-danger outline-none"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {result.error}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending} className="max-md:h-10 max-md:w-full">
            {pending ? "Enregistrement…" : isNew ? "Créer la persona" : "Enregistrer"}
          </Button>
          <p className="text-note text-muted-foreground">
            {isNew
              ? "Créée désactivée si vous ne cochez pas « Persona activée »."
              : dirty
                ? "Modifications pas encore enregistrées."
                : "Tout est enregistré."}
          </p>
        </div>
      </div>
    </form>
  );
}

function Help({ id, help, error }: { id: string; help?: string; error?: string }) {
  if (!help && !error) return null;
  return (
    <p
      id={`${id}-help`}
      className={cn("text-note", error ? "text-danger" : "text-muted-foreground")}
    >
      {error ?? help}
    </p>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = Array.from(value).length;
  return (
    <span
      className={cn("text-note tabular-nums", n > max ? "text-danger" : "text-muted-foreground")}
    >
      {n} / {max}
    </span>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  max,
  placeholder,
  help,
  error,
  counter,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  help?: string;
  error?: string;
  counter?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {counter ? <Counter value={value} max={max} /> : null}
      </div>
      <Input
        id={id}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={help || error ? `${id}-help` : undefined}
      />
      <Help id={id} help={help} error={error} />
    </div>
  );
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  max,
  rows = 3,
  placeholder,
  help,
  error,
  counter,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  rows?: number;
  placeholder?: string;
  help?: string;
  error?: string;
  counter?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {counter ? <Counter value={value} max={max} /> : null}
      </div>
      <Textarea
        id={id}
        value={value}
        maxLength={max}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={help || error ? `${id}-help` : undefined}
      />
      <Help id={id} help={help} error={error} />
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  help,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  help?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={help || error ? `${id}-help` : undefined}
        className="max-w-40"
      />
      <Help id={id} help={help} error={error} />
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  help,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  help?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        wrapperClassName="w-full"
        aria-invalid={error ? true : undefined}
        aria-describedby={help || error ? `${id}-help` : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      <Help id={id} help={help} error={error} />
    </div>
  );
}

function CheckField({
  id,
  checked,
  onChange,
  label,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <div className="space-y-1">
      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-body md:min-h-8">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          aria-describedby={`${id}-help`}
        />
        {label}
      </label>
      <p id={`${id}-help`} className="pl-7 text-note text-muted-foreground">
        {help}
      </p>
    </div>
  );
}
