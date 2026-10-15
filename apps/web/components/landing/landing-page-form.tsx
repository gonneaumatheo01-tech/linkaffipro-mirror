"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Link2, Plus, RotateCw, Undo2, X } from "lucide-react";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { LandingSaveState } from "@/app/(admin)/pages/actions";
import {
  LANDING_LANG_OPTIONS,
  LANDING_NAME_MAX,
  MAX_LANDING_SOURCES,
  adUsedElsewhere,
  advancedModifiedCount,
  checkPixel,
  formPlaceholders,
  landingPhotoPreviewUrl,
  newSource,
  orderAdGroups,
  pixelOkText,
  previewInput,
  shortUrl,
  slugPlaceholder,
  slugProblem,
  slugWillChange,
  sourceKeyProblem,
  sourcePublicUrl,
  suggestedPageName,
  type LandingFormSource,
  type LandingFormState,
} from "@/lib/landing/form";
import type { LandingSourceLinkView } from "@/lib/landing/links";
import type { LandingAdGroup, LandingChannelChoice } from "@/lib/landing/queries";
import { channelTabHref } from "@/lib/channels/tabs";
import { universeLabel } from "@/lib/universe";
import { LANDING_TEXT_LIMITS, normalizeSourceKey } from "@linkaffipro/core";
import { CopyLinkButton } from "./copy-link-button";
import { PhonePreview } from "./phone-preview";

/** Préfixe affiché devant l'adresse de la page. */
function hostPrefix(base: string): string {
  return `${shortUrl(base).replace(/\/+$/, "")}/j/`;
}

/**
 * Formulaire unique de la rubrique « Pages » (phase 15) : création et modification d'une page d'atterrissage.
 * - Niveau 1 : canal (vrai titre Telegram, jamais saisi), phrase d'accroche, sous-texte, texte du bouton.
 * - Sources : une par pub ou par régie (« tk01 »), chacune son lien à coller dans la pub (« Copier le lien ») et,
 *   en option, la pub reliée (« Relier à une pub » : coût par join ; pubs du canal d'abord, « déjà reliée »
 *   signalé) ; le lien principal sert à tout le reste.
 * - Sous le canal : une ligne si ses exceptions « pub » ne visent pas les pages (`landingExceptionChannels`).
 * - « Avancé » : langue, pixels TikTok et Meta (vérifiés à la frappe), bandeau cookies, photo du canal, petite ligne,
 *   nom et adresse de la page, mise en pause.
 * - À côté : l'aperçu téléphone en direct (même rendu que la page publique, sans script ni pixel).
 * Un seul bouton principal (« Créer la page » / « Enregistrer ») ; le brouillon part en JSON à l'action serveur, qui
 * valide tout. Un refus revient sous le bouton et sur le champ en cause.
 */
export function LandingPageForm({
  initial,
  saved,
  channels,
  adGroups,
  links,
  trackingBase,
  takenNames,
  landingExceptionChannels = [],
  action,
  retryAction,
}: {
  initial: LandingFormState;
  /** Nom et adresse enregistrés (page existante), sinon null. */
  saved: { name: string; slug: string } | null;
  channels: LandingChannelChoice[];
  adGroups: LandingAdGroup[];
  /** État des liens des sources enregistrées. */
  links: LandingSourceLinkView[];
  /** Adresse des liens (https://go.goolink.eu). */
  trackingBase: string;
  /** Noms des autres pages (nom proposé sans doublon). */
  takenNames: string[];
  /** Canaux dont une exception « pub » ne vise pas les pages (`channelsMissingLandingException`). */
  landingExceptionChannels?: string[];
  action: (prev: LandingSaveState, formData: FormData) => Promise<LandingSaveState>;
  retryAction?: (formData: FormData) => Promise<void>;
}) {
  const id = useId();
  const [state, setState] = useState<LandingFormState>(initial);
  const [result, dispatch, pending] = useActionState(action, null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result?.error) errorRef.current?.focus();
  }, [result]);

  const isNew = state.pageId === null;
  const channel = channels.find((c) => c.id === state.channelId) ?? null;
  const channelTitle = channel?.title ?? "";
  const errors = result?.errors ?? {};
  const set = <K extends keyof LandingFormState>(k: K, v: LandingFormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));
  const setSource = (i: number, patch: Partial<LandingFormSource>) =>
    setState((s) => ({
      ...s,
      sources: s.sources.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    }));

  const placeholders = formPlaceholders(state.language);
  const tiktok = checkPixel("tiktok", state.tiktokPixel);
  const meta = checkPixel("meta", state.metaPixel);
  const hasPixel = tiktok.state === "ok" || meta.state === "ok";
  const nameHint = suggestedPageName(channelTitle, takenNames);
  // Page existante : un champ vidé garde l'adresse enregistrée (le serveur la garde aussi), sans avertissement.
  const slugShown = slugPlaceholder(state, saved, channelTitle, takenNames);
  const slugError = slugProblem(state.slug) ?? errors.slug ?? null;
  const slugChanged = slugWillChange(state.slug, saved);
  const adGroupsShown = orderAdGroups(adGroups, state.channelId, channel?.vertical ?? null);
  const pageExceptionHint = !!channel && landingExceptionChannels.includes(channel.id);
  const advancedErrors =
    !!errors.tiktokPixel ||
    !!errors.metaPixel ||
    !!errors.name ||
    !!errors.slug ||
    !!errors.footnote;
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  // Modifications pas encore enregistrées : le navigateur prévient avant de quitter la page (changer la période des
  // chiffres recharge la page).
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);
  const activeSources = state.sources.filter((s) => !s.removed);
  const linkOf = (s: LandingFormSource) =>
    s.id ? (links.find((l) => l.sourceId === s.id) ?? null) : null;
  const preview = previewInput(state, {
    channelTitle: channelTitle || "Nom de votre canal",
    photoUrl: channel?.hasPhoto ? landingPhotoPreviewUrl(channel.id) : null,
  });

  return (
    <form action={dispatch} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:gap-10">
      <input type="hidden" name="payload" value={JSON.stringify(state)} />
      {state.pageId ? <input type="hidden" name="pageId" value={state.pageId} /> : null}

      <FormSection
        title="La page"
        description="Ce que voit la personne qui clique sur votre pub."
        className="lg:col-start-1"
      >
        <div className="space-y-1.5">
          {isNew ? (
            <Label htmlFor={`${id}-channel`}>Canal</Label>
          ) : (
            <p className="text-body font-medium text-foreground">Canal</p>
          )}
          {isNew ? (
            <NativeSelect
              id={`${id}-channel`}
              value={state.channelId}
              required
              onChange={(e) => set("channelId", e.target.value)}
              wrapperClassName="w-full"
              aria-invalid={errors.channelId ? true : undefined}
              aria-describedby={`${id}-channel-help`}
            >
              {state.channelId ? null : <option value="">Choisissez un canal…</option>}
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.vertical ? `${c.title} (${universeLabel(c.vertical)})` : c.title}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="flex min-h-9 items-center rounded-lg border border-border bg-muted/40 px-3 text-body text-foreground">
              {channelTitle || "Canal supprimé"}
            </p>
          )}
          <p
            id={`${id}-channel-help`}
            className={cn("text-note", errors.channelId ? "text-danger" : "text-muted-foreground")}
          >
            {errors.channelId ??
              (isNew
                ? "Le nom affiché sur la page est le vrai nom du canal dans Telegram, mis à jour tout seul."
                : "Le canal d'une page ne change pas : pour un autre canal, créez une autre page.")}
          </p>
          {pageExceptionHint && channel ? (
            <p className="text-note text-warning">
              Les exceptions « pub » de ce canal ne visent pas les pages : pour les visiteurs de la
              page, ajoutez une exception dans{" "}
              <Link
                href={channelTabHref(channel.id, "rules")}
                className="font-medium text-brand-ink underline"
              >
                Qui peut entrer et quand
              </Link>
              .
            </p>
          ) : null}
        </div>

        <TextField
          id={`${id}-headline`}
          label="Phrase d'accroche"
          value={state.headline}
          onChange={(v) => set("headline", v)}
          max={LANDING_TEXT_LIMITS.headline}
          required
          placeholder="Les meilleurs bonus du jour, en direct"
          error={errors.headline}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-subtext`}>
            Sous-texte <span className="font-normal text-muted-foreground">(facultatif)</span>
          </Label>
          <Textarea
            id={`${id}-subtext`}
            value={state.subtext}
            maxLength={LANDING_TEXT_LIMITS.subtext}
            rows={2}
            onChange={(e) => set("subtext", e.target.value)}
            aria-invalid={errors.subtext ? true : undefined}
            aria-describedby={errors.subtext ? `${id}-subtext-error` : undefined}
            placeholder="Une phrase courte sous l'accroche."
          />
          {errors.subtext ? (
            <p id={`${id}-subtext-error`} className="text-note text-danger">
              {errors.subtext}
            </p>
          ) : null}
        </div>
        <TextField
          id={`${id}-button`}
          label="Texte du bouton"
          value={state.buttonText}
          onChange={(v) => set("buttonText", v)}
          max={LANDING_TEXT_LIMITS.buttonText}
          placeholder={placeholders.buttonText}
          help={`Vide : « ${placeholders.buttonText} ».`}
          error={errors.buttonText}
        />
      </FormSection>

      <aside
        aria-labelledby={`${id}-preview-title`}
        className="lg:col-start-2 lg:row-span-4 lg:row-start-1"
      >
        <div className="space-y-3 lg:sticky lg:top-4">
          <h2 id={`${id}-preview-title`} className="text-body font-semibold text-foreground">
            Aperçu sur un téléphone
          </h2>
          <PhonePreview input={preview} />
          <p className="text-note text-muted-foreground">
            Même page pour tout le monde. Le bouton ouvre Telegram sur la demande d&apos;adhésion du
            canal.
          </p>
        </div>
      </aside>

      <FormSection
        title="Sources"
        description="Une source par pub ou par régie : chacune a son lien à coller dans la pub et ses propres chiffres. Reliée à une pub, sa dépense donne le coût par join."
        className="lg:col-start-1"
      >
        <ul className="space-y-3" aria-label="Sources de la page">
          {state.sources.map((s, i) => {
            const others = activeSources
              .filter((o) => o !== s && !o.main)
              .map((o) => normalizeSourceKey(o.key))
              .filter((k): k is string => !!k);
            return (
              <SourceRow
                key={s.id ?? `new-${i}`}
                id={`${id}-source-${i}`}
                source={s}
                link={linkOf(s)}
                url={
                  saved && s.id
                    ? sourcePublicUrl(trackingBase, saved.slug, s.main ? "" : s.key)
                    : null
                }
                savedSlugChanged={slugChanged}
                problem={
                  errors.sourceErrors?.[i] ??
                  (!s.main && !s.id && s.key.trim() ? sourceKeyProblem(s.key, others) : null)
                }
                adGroups={adGroupsShown}
                usedElsewhere={(ad) => adUsedElsewhere(ad, state, i)}
                dirty={dirty}
                retryAction={retryAction}
                onChange={(patch) => setSource(i, patch)}
                onRemove={() =>
                  s.id
                    ? setSource(i, { removed: true })
                    : setState((st) => ({ ...st, sources: st.sources.filter((_, j) => j !== i) }))
                }
              />
            );
          })}
        </ul>
        {errors.sources ? <p className="text-note text-danger">{errors.sources}</p> : null}
        {activeSources.length < MAX_LANDING_SOURCES ? (
          <Button
            type="button"
            variant="outline"
            className="max-md:h-10"
            onClick={() => setState((s) => ({ ...s, sources: [...s.sources, newSource()] }))}
          >
            <Plus aria-hidden />
            Ajouter une source
          </Button>
        ) : null}
      </FormSection>

      <AdvancedSection
        description="Langue, pixels, cookies, photo, petite ligne, adresse de la page"
        modifiedCount={advancedModifiedCount(state, saved)}
        defaultOpen={advancedErrors}
        className="lg:col-start-1"
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-lang`}>Langue de la page</Label>
          <NativeSelect
            id={`${id}-lang`}
            value={state.language}
            onChange={(e) => set("language", e.target.value as LandingFormState["language"])}
            wrapperClassName="w-full sm:w-64"
          >
            {LANDING_LANG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <p className="text-note text-muted-foreground">
            Textes par défaut (bouton, bandeau cookies) dans cette langue.
          </p>
        </div>

        <PixelField
          id={`${id}-tiktok`}
          label="Pixel TikTok"
          value={state.tiktokPixel}
          onChange={(v) => set("tiktokPixel", v)}
          check={tiktok}
          serverError={errors.tiktokPixel}
          placeholder="CD2UC93C77U35BVUO310"
        />
        <PixelField
          id={`${id}-meta`}
          label="Pixel Meta"
          value={state.metaPixel}
          onChange={(v) => set("metaPixel", v)}
          check={meta}
          serverError={errors.metaPixel}
          placeholder="1070571443971391"
        />

        <CheckField
          id={`${id}-cookies`}
          checked={state.cookieBanner}
          onChange={(v) => set("cookieBanner", v)}
          disabled={!hasPixel && !state.cookieBanner}
          label="Demander l'accord pour les cookies"
          help={
            hasPixel
              ? "Un bandeau fin sous le bouton ; les pixels ne se chargent qu'après « Accepter »."
              : "Utile seulement avec un pixel : sans pixel, la page ne pose aucun cookie."
          }
        />
        <CheckField
          id={`${id}-photo`}
          checked={state.showPhoto}
          onChange={(v) => set("showPhoto", v)}
          label="Afficher la photo du canal"
          help={
            state.showPhoto && channel && !channel.hasPhoto
              ? "Photo pas encore connue : elle sera relue dans Telegram à l'enregistrement."
              : "La petite photo du canal, au-dessus de son nom."
          }
        />

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-footnote`}>
            Petite ligne sous le bouton{" "}
            <span className="font-normal text-muted-foreground">(facultatif)</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${id}-footnote`}
              value={state.footnote}
              maxLength={LANDING_TEXT_LIMITS.footnote}
              onChange={(e) => set("footnote", e.target.value)}
              placeholder={placeholders.footnote}
              aria-invalid={errors.footnote ? true : undefined}
              className="min-w-0 flex-1 basis-56"
            />
            {state.footnote.trim() ? null : (
              <Button
                type="button"
                variant="ghost"
                className="max-md:h-10"
                onClick={() => set("footnote", placeholders.footnote)}
              >
                Utiliser l&apos;exemple
              </Button>
            )}
          </div>
          {errors.footnote ? <p className="text-note text-danger">{errors.footnote}</p> : null}
        </div>

        <TextField
          id={`${id}-name`}
          label="Nom de la page (pour vous)"
          value={state.name}
          onChange={(v) => set("name", v)}
          max={LANDING_NAME_MAX}
          placeholder={isNew ? nameHint : (saved?.name ?? nameHint)}
          help="Sert dans la liste des pages et dans le nom des liens Telegram."
          error={errors.name}
        />

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-slug`}>Adresse de la page</Label>
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-body text-muted-foreground">
              {hostPrefix(trackingBase)}
            </span>
            <Input
              id={`${id}-slug`}
              value={state.slug}
              maxLength={48}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) =>
                setState((s) => ({ ...s, slug: e.target.value.toLowerCase(), slugTouched: true }))
              }
              placeholder={slugShown}
              aria-invalid={slugError ? true : undefined}
              aria-describedby={`${id}-slug-help`}
              className="min-w-0 flex-1"
            />
          </div>
          <p
            id={`${id}-slug-help`}
            className={cn(
              "text-note",
              slugError ? "text-danger" : slugChanged ? "text-warning" : "text-muted-foreground",
            )}
          >
            {slugError ??
              (slugChanged
                ? "Attention : les liens déjà collés dans vos pubs ne marcheront plus avec l'ancienne adresse."
                : isNew
                  ? "Vide : proposée d'après le nom de la page."
                  : "Minuscules, chiffres et tirets.")}
          </p>
        </div>

        {isNew ? null : (
          <CheckField
            id={`${id}-active`}
            checked={state.isActive}
            onChange={(v) => set("isActive", v)}
            label="Page en ligne"
            help={
              state.isActive
                ? "Décochez pour mettre la page en pause (ses liens Telegram restent)."
                : "En pause : la page n'est plus affichée aux visiteurs."
            }
          />
        )}
      </AdvancedSection>

      <div className="space-y-3 lg:col-start-1">
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
            {pending ? "Enregistrement…" : isNew ? "Créer la page" : "Enregistrer"}
          </Button>
          <p className="text-note text-muted-foreground">
            {isNew
              ? "Les liens Telegram des sources sont créés tout de suite."
              : dirty
                ? "Modifications pas encore enregistrées."
                : "Tout est enregistré."}
          </p>
        </div>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  max,
  required,
  placeholder,
  help,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  required?: boolean;
  placeholder?: string;
  help?: string;
  error?: string;
}) {
  const describedBy = error || help ? `${id}-help` : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={max}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error || help ? (
        <p
          id={`${id}-help`}
          className={cn("text-note", error ? "text-danger" : "text-muted-foreground")}
        >
          {error ?? help}
        </p>
      ) : null}
    </div>
  );
}

function CheckField({
  id,
  checked,
  onChange,
  label,
  help,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-body md:min-h-8">
        <Checkbox
          checked={checked}
          disabled={disabled}
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

function PixelField({
  id,
  label,
  value,
  onChange,
  check,
  serverError,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  check: ReturnType<typeof checkPixel>;
  serverError?: string;
  placeholder: string;
}) {
  const error = check.state === "invalid" ? check.message : (serverError ?? null);
  const ok = pixelOkText(check);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} <span className="font-normal text-muted-foreground">(facultatif)</span>
      </Label>
      <Input
        id={id}
        value={value}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help`}
        className="font-mono md:text-note"
      />
      <p
        id={`${id}-help`}
        className={cn(
          "flex items-start gap-1.5 text-note",
          error ? "text-danger" : ok ? "text-success" : "text-muted-foreground",
        )}
      >
        {ok ? <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null}
        {error ??
          ok ??
          "Collez l'identifiant du pixel, ou son code complet : l'identifiant est retrouvé tout seul. Chargé après l'affichage de la page, jamais avant."}
      </p>
    </div>
  );
}

/** Une source dans le formulaire : nom, lien à copier, état du lien Telegram, pub reliée, retrait. */
function SourceRow({
  id,
  source,
  link,
  url,
  savedSlugChanged,
  problem,
  adGroups,
  usedElsewhere,
  dirty,
  retryAction,
  onChange,
  onRemove,
}: {
  id: string;
  source: LandingFormSource;
  link: LandingSourceLinkView | null;
  /** Adresse à coller dans la pub (source enregistrée), sinon null. */
  url: string | null;
  savedSlugChanged: boolean;
  problem: string | null;
  /** Campagnes proposées, celles du canal de la page d'abord (`orderAdGroups`). */
  adGroups: LandingAdGroup[];
  /** Pub déjà reliée à une autre source ou une autre page (`adUsedElsewhere`). */
  usedElsewhere: (ad: LandingAdGroup["ads"][number]) => boolean;
  dirty: boolean;
  retryAction?: (formData: FormData) => Promise<void>;
  onChange: (patch: Partial<LandingFormSource>) => void;
  onRemove: () => void;
}) {
  // Le menu des pubs n'est montré qu'à la demande (« Relier à une pub »), ou quand une pub est déjà reliée.
  const [picking, setPicking] = useState(false);
  if (source.removed)
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-3">
        <p className="min-w-0 flex-1 basis-56 text-body text-muted-foreground">
          Source « {source.key} » retirée à l&apos;enregistrement : l&apos;adresse de sa pub ouvrira
          la page avec le lien principal. Pensez à arrêter la pub.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          onClick={() => onChange({ removed: false })}
        >
          <Undo2 aria-hidden />
          Annuler
        </Button>
      </li>
    );

  const ready = link?.status === "ready";
  const copyReason = !url
    ? "Le lien sera prêt après l'enregistrement."
    : savedSlugChanged
      ? "Enregistrez d'abord la nouvelle adresse."
      : !ready
        ? "Lien Telegram pas encore prêt."
        : null;
  const title = source.main
    ? "Lien principal"
    : source.id
      ? `Source « ${source.key} »`
      : "Nouvelle source";
  const showPicker = picking || !!source.adId;
  return (
    <li className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-body font-semibold text-foreground">{title}</p>
          <p className="text-note text-muted-foreground">
            {source.main
              ? url
                ? "Pour les visites sans source, et toute source inconnue."
                : "Pour les visites sans source. Son lien sera prêt après l'enregistrement."
              : url
                ? shortUrl(url)
                : "Un nom court par pub ou par régie. Son lien sera prêt après l'enregistrement."}
          </p>
          {source.main && url ? (
            <p className="text-note break-all text-muted-foreground">{shortUrl(url)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {url ? <CopyLinkButton url={url} disabledReason={copyReason} /> : null}
          {source.main ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:h-10"
              onClick={onRemove}
              aria-label={source.key ? `Retirer la source ${source.key}` : "Retirer cette source"}
            >
              <X aria-hidden />
              Retirer
            </Button>
          )}
        </div>
      </div>

      {!source.main && !source.id ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-key`}>Nom de la source</Label>
          <Input
            id={`${id}-key`}
            value={source.key}
            maxLength={32}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="tk01"
            onChange={(e) => onChange({ key: e.target.value })}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-key-help`}
            className="sm:w-64"
          />
          <p
            id={`${id}-key-help`}
            className={cn("text-note", problem ? "text-danger" : "text-muted-foreground")}
          >
            {problem ?? "Lettres, chiffres et tirets ; il apparaît à la fin du lien."}
          </p>
        </div>
      ) : problem ? (
        <p className="text-note text-danger">{problem}</p>
      ) : null}

      {showPicker ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-ad`}>Pub reliée</Label>
          <NativeSelect
            id={`${id}-ad`}
            value={source.adId ?? ""}
            onChange={(e) => onChange({ adId: e.target.value || null })}
            wrapperClassName="w-full"
          >
            <option value="">Aucune pub</option>
            {adGroups.map((g) => (
              <optgroup key={g.campaignId} label={g.label}>
                {g.ads.map((a) => (
                  <option key={a.id} value={a.id}>
                    {usedElsewhere(a) ? `${a.label} (déjà reliée)` : a.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>
      ) : adGroups.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-md:h-10"
          onClick={() => setPicking(true)}
          aria-label={
            source.main
              ? "Relier le lien principal à une pub"
              : `Relier la source ${source.key || "nouvelle"} à une pub`
          }
        >
          <Link2 aria-hidden />
          Relier à une pub
        </Button>
      ) : null}

      {link?.status === "pending" ? (
        <p className="text-note text-muted-foreground" role="status">
          Lien Telegram en cours de création : il sera prêt dans quelques minutes.
        </p>
      ) : null}
      {link?.status === "error" ? (
        <div className="flex flex-wrap items-start gap-2 rounded-lg bg-danger-soft px-3 py-2">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="min-w-0 flex-1 basis-56 text-note text-danger">{link.error}</p>
          {retryAction && !dirty ? (
            <Button
              type="submit"
              size="sm"
              variant="outline"
              formAction={retryAction}
              formNoValidate
              className="max-md:h-10"
            >
              <RotateCw aria-hidden />
              Réessayer
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
