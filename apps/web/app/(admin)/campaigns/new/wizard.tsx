"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { VERTICALS, VERTICAL_LABELS, type Vertical } from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/admin/help-tip";
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
  type WizardPayload,
  type WizardStepKey,
} from "@/lib/campaigns/wizard";

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
const PLATFORM_SHORT: Record<WizardAdPlatform, string> = {
  TIKTOK: "TT",
  META: "FB",
  OTHER: "AUTRE",
};

const inputCls = "h-10 md:h-9";
const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";

/** Bouton « Créer la campagne » : désactivé pendant l'envoi (la création des liens Telegram prend quelques secondes). */
function CreateButton({ onCheck }: { onCheck: () => string | null }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="max-md:h-10"
      disabled={pending}
      aria-disabled={pending}
      onClick={(e) => {
        if (pending || onCheck()) e.preventDefault();
      }}
    >
      {pending ? "Création en cours…" : "Créer la campagne"}
    </Button>
  );
}

/**
 * Assistant « Nouvelle campagne » en 4 étapes (tout en mémoire côté navigateur, un seul envoi à la fin) :
 * 1. nom, univers, dates, budget — 2. offres Link Affi (les nôtres par défaut) — 3. canaux — 4. pubs (plateforme,
 * compte, campagne pub déjà importée, canal d'entrée, nombre) + récapitulatif avec le générateur de nom conventionnel.
 * Le serveur revérifie tout (`parseWizardPayload`) et crée la campagne, le groupe « Groupe 1 », les pubs et leurs
 * liens d'entrée ; `requestId` (jeton créé par la page) empêche un double envoi de créer deux campagnes.
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
  const [vertical, setVertical] = useState<Vertical | "">(
    (draft?.vertical as Vertical | null) ?? "",
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
  const [localError, setLocalError] = useState<string | null>(null);

  // Canaux cochés, dans l'ordre affiché ; le canal d'entrée par défaut est le premier d'entre eux (visible et modifiable).
  const checkedChannels = channels.filter((c) => channelIds.includes(c.id));
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
  const selectedOffers = offerIds
    .map((id) => offers.find((o) => o.id === id))
    .filter((o): o is OfferCandidateRow => !!o);
  const oursKnown = offers.some((o) => o.ours);
  const filteredOffers = useMemo(
    () =>
      searchOffers(offerQuery, offers)
        .filter((o) => showOthers || !oursKnown || o.ours)
        .slice(0, 50),
    [offerQuery, offers, showOthers, oursKnown],
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

  /** Vérifie l'étape courante avant d'avancer (mêmes règles que le serveur, limitées à l'étape). */
  function validateStep(key: WizardStepKey): string | null {
    // Avant la dernière étape, les contraintes liées aux pubs (plateforme, canal d'entrée) ne s'appliquent pas encore.
    const r = parseWizardPayload(
      key === "ads" ? payload : { ...payload, adCount: 0, adPlatform: "" },
    );
    if (r.ok) return null;
    return key === "ads" || r.error.step === key ? r.error.message : null;
  }

  function next() {
    const err = validateStep(current.key);
    setLocalError(err);
    if (err) return;
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }
  function back() {
    setLocalError(null);
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
        program: program || selectedOffers[0]?.programName || vertical,
        language,
        channel: entryChannel?.title ?? checkedChannels[0]?.title ?? "",
        date: new Date(),
      }),
    );
  }

  const toggle = (list: string[], id: string, set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="max-w-3xl space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Étapes">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => {
                if (i < step) {
                  setLocalError(null);
                  setStep(i);
                }
              }}
              aria-current={i === step ? "step" : undefined}
              className={`rounded-full border px-3 py-1 ${i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "bg-muted hover:bg-muted/70" : "text-muted-foreground"}`}
            >
              {i + 1}. {s.title}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Étape {step + 1} sur {WIZARD_STEPS.length} : {current.title}
          </CardTitle>
          <CardDescription>{current.help}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {localError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {localError}
            </p>
          ) : null}

          {current.key === "general" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="wz-name">Nom de la campagne</Label>
                <Input
                  id="wz-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                  placeholder={`ex. ${NAMING_EXAMPLE}`}
                  className={inputCls}
                />
                <p className="text-xs text-muted-foreground">
                  Un nom conventionnel (plateforme-programme-langue-canal-mois) peut être proposé à
                  l&apos;étape 4, une fois les offres, les canaux et la plateforme choisis.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wz-vertical">Univers</Label>
                <select
                  id="wz-vertical"
                  value={vertical}
                  onChange={(e) => setVertical(e.target.value as Vertical | "")}
                  className={selectCls}
                >
                  <option value="">— non précisé —</option>
                  {VERTICALS.map((v) => (
                    <option key={v} value={v}>
                      {VERTICAL_LABELS[v]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wz-budget">Budget par jour (€, facultatif)</Label>
                <Input
                  id="wz-budget"
                  inputMode="decimal"
                  value={budgetDaily}
                  onChange={(e) => setBudgetDaily(e.target.value)}
                  placeholder="ex. 50"
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wz-start">Début (facultatif)</Label>
                <Input
                  id="wz-start"
                  type="date"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wz-end">Fin (facultatif)</Label>
                <Input
                  id="wz-end"
                  type="date"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="wz-notes">Notes (facultatif)</Label>
                <Textarea
                  id="wz-notes"
                  rows={2}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {current.key === "offers" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wz-paste">Coller un lien d&apos;offre Link Affi</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="wz-paste"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="https://linkaffi.me/go/47eb8mwc"
                    className={inputCls}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="max-md:h-10"
                    onClick={addPasted}
                  >
                    Ajouter
                  </Button>
                </div>
                {pasteError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {pasteError}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="wz-offer-search">
                  Ou chercher dans les offres synchronisées (nom, clé, casino)
                </Label>
                <Input
                  id="wz-offer-search"
                  value={offerQuery}
                  onChange={(e) => setOfferQuery(e.target.value)}
                  placeholder="ex. casino, 47eb8mwc"
                  className={inputCls}
                />
                {oursKnown ? (
                  <label className="flex min-h-10 items-center gap-2 text-sm md:min-h-0">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={showOthers}
                      onChange={(e) => setShowOthers(e.target.checked)}
                    />
                    Afficher les offres des autres affiliés
                    {hiddenOthers ? (
                      <span className="text-xs text-muted-foreground">
                        ({hiddenOthers} masquées)
                      </span>
                    ) : null}
                  </label>
                ) : offers.length ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Vos offres ne sont pas encore reconnues (aucun clic avec identifiant de suivi
                    pour l&apos;instant) : toutes les offres Link Affi sont affichées. Vérifiez
                    l&apos;affilié avant de cocher.
                  </p>
                ) : null}
                {offers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucune offre synchronisée pour l&apos;instant : la synchronisation Link Affi
                    tourne toutes les 2 minutes (Réglages → Connecteurs).
                  </p>
                ) : (
                  <ul className="max-h-72 divide-y overflow-auto rounded-md border text-sm">
                    {filteredOffers.map((o) => {
                      const checked = offerIds.includes(o.id);
                      return (
                        <li key={o.id}>
                          <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={checked}
                              onChange={() => toggle(offerIds, o.id, setOfferIds)}
                            />
                            <span className="flex-1">
                              <span className="font-medium">{o.name}</span>
                              <span className="text-muted-foreground">
                                {" "}
                                · {o.programName}
                                {o.campaignKey ? ` · clé ${o.campaignKey}` : ""}
                                {o.vertical
                                  ? ` · ${VERTICAL_LABELS[o.vertical as Vertical] ?? o.vertical}`
                                  : ""}
                              </span>
                            </span>
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${o.ours ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
                            >
                              {offerAffiliateLabel(o)}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                    {filteredOffers.length === 0 ? (
                      <li className="px-3 py-2 text-muted-foreground">
                        Aucune offre ne correspond.
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
              <p className="text-sm">
                Offres choisies :{" "}
                {selectedOffers.length === 0 ? (
                  <span className="text-muted-foreground">
                    aucune pour l&apos;instant (vous pourrez en ajouter depuis la fiche).
                  </span>
                ) : (
                  selectedOffers.map((o) => (
                    <span
                      key={o.id}
                      className={`mr-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${oursKnown && !o.ours ? "border-amber-500/60" : ""}`}
                    >
                      {o.programName} · {o.name}
                      {oursKnown && !o.ours ? " (autre affilié)" : ""}
                      <button
                        type="button"
                        aria-label={`Retirer ${o.name}`}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => toggle(offerIds, o.id, setOfferIds)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </p>
            </div>
          ) : null}

          {current.key === "channels" ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Canaux Telegram alimentés par cette campagne
              </legend>
              {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun canal actif : ajoutez d&apos;abord un canal (menu Canaux).
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {channels.map((c) => (
                  <label
                    key={c.id}
                    className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={channelIds.includes(c.id)}
                      onChange={() => toggle(channelIds, c.id, setChannelIds)}
                    />
                    <span className="flex-1">{c.title}</span>
                    {c.vertical ? (
                      <span className="text-xs text-muted-foreground">
                        {VERTICAL_LABELS[c.vertical as Vertical] ?? c.vertical}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Le canal que les liens des pubs font rejoindre (demande d&apos;adhésion) se choisit
                à l&apos;étape 4, parmi ces canaux.
              </p>
            </fieldset>
          ) : null}

          {current.key === "ads" ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wz-platform">Plateforme des pubs</Label>
                  <select
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
                    className={selectCls}
                  >
                    <option value="">— aucune pub pour l&apos;instant —</option>
                    {AD_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
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
                    className={inputCls}
                    disabled={!adPlatform}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-connection" className="inline-flex items-center gap-1">
                    Compte pub connecté
                    <HelpTip>
                      Si vous avez connecté un compte Meta ou TikTok (Réglages → Connecteurs), ses
                      dépenses arrivent toutes seules dans la campagne : choisissez la campagne pub
                      déjà importée ci-dessous, ou donnez à la campagne le même nom que dans TikTok
                      ou Meta.
                    </HelpTip>
                  </Label>
                  <select
                    id="wz-connection"
                    value={connectionId}
                    onChange={(e) => {
                      setConnectionId(e.target.value);
                      setImportedCampaignId("");
                    }}
                    className={selectCls}
                    disabled={!adPlatform || platformConnections.length === 0}
                  >
                    <option value="">
                      {!adPlatform
                        ? "—"
                        : platformConnections.length === 0
                          ? "Aucun compte connecté pour cette plateforme"
                          : "— sans compte —"}
                    </option>
                    {platformConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.externalId})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wz-imported">Campagne pub déjà importée de ce compte</Label>
                  <select
                    id="wz-imported"
                    value={importedCampaignId}
                    onChange={(e) => setImportedCampaignId(e.target.value)}
                    className={selectCls}
                    disabled={!connectionId || accountCampaigns.length === 0}
                  >
                    <option value="">
                      {!connectionId
                        ? "—"
                        : accountCampaigns.length === 0
                          ? "Aucune campagne pub importée libre"
                          : "— aucune (reprise automatique si même nom) —"}
                    </option>
                    {accountCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.externalCampaignId})
                      </option>
                    ))}
                  </select>
                  {sameNameShell ? (
                    <p className="text-xs text-muted-foreground">
                      « {sameNameShell.name} » porte le même nom que la campagne : elle sera reprise
                      à la création (groupes, pubs et dépenses).
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="wz-entry-channel">Canal d&apos;entrée des pubs</Label>
                  <select
                    id="wz-entry-channel"
                    value={entryChannel?.id ?? ""}
                    onChange={(e) => setEntryChannelId(e.target.value)}
                    className={selectCls}
                    disabled={count === 0 || checkedChannels.length === 0}
                  >
                    {checkedChannels.length === 0 ? (
                      <option value="">Cochez d&apos;abord un canal à l&apos;étape 3</option>
                    ) : null}
                    {checkedChannels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Chaque lien d&apos;entrée ouvre une demande d&apos;adhésion à ce canal.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Récapitulatif</p>
                <div className="space-y-2">
                  <Label htmlFor="wz-name-final">Nom de la campagne</Label>
                  <Input
                    id="wz-name-final"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    className={inputCls}
                  />
                  <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed bg-background p-2">
                    <div className="space-y-1">
                      <Label htmlFor="wz-program" className="text-xs">
                        Programme (ex. casinoX)
                      </Label>
                      <Input
                        id="wz-program"
                        value={program}
                        onChange={(e) => setProgram(e.target.value)}
                        placeholder="offre ou univers si vide"
                        className="h-9 w-44 md:h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="wz-language" className="text-xs">
                        Langue
                      </Label>
                      <Input
                        id="wz-language"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        maxLength={5}
                        className="h-9 w-16 uppercase md:h-8"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="max-md:h-10"
                      onClick={generateName}
                    >
                      Proposer un nom conventionnel
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Plateforme-programme-langue-canal-mois : le même nom dans TikTok ou Meta
                      permet l&apos;import automatique des coûts.
                    </span>
                  </div>
                </div>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    Campagne « {name || "—"} »{vertical ? ` · ${VERTICAL_LABELS[vertical]}` : ""}
                    {budgetDaily ? ` · ${budgetDaily} € / jour` : ""}
                    {startAt || endAt ? ` · du ${startAt || "?"} au ${endAt || "?"}` : ""}
                  </li>
                  <li>
                    {selectedOffers.length} offre{selectedOffers.length > 1 ? "s" : ""} Link Affi
                    {selectedOffers.length
                      ? ` : ${selectedOffers.map((o) => o.name).join(", ")}`
                      : ""}
                  </li>
                  <li>
                    {channelIds.length} canal{channelIds.length > 1 ? "aux" : ""}
                    {checkedChannels.length
                      ? ` : ${checkedChannels.map((c) => c.title).join(", ")}`
                      : ""}
                  </li>
                  <li>
                    {adPlatform && count > 0
                      ? `${count} pub${count > 1 ? "s" : ""} ${PLATFORM_SHORT[adPlatform]} dans « Groupe 1 »${connectionId ? " (compte connecté)" : ""} → ${count} lien${count > 1 ? "s" : ""} d'entrée ${trackingHost}/… + invitation Telegram${entryChannel ? ` vers « ${entryChannel.title} »` : ""}`
                      : "Aucune pub pour l'instant (ajoutables ensuite depuis l'onglet Pubs ou Liens)."}
                  </li>
                  {reprisedShell ? (
                    <li>
                      Campagne pub reprise : {reprisedShell.name}
                      {sameNameShell ? " (même nom)" : ""} (ses groupes, pubs et dépenses rejoignent
                      la campagne)
                    </li>
                  ) : null}
                </ul>
                {adPlatform && count > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Liens créés : {plan.map((p) => p.linkName).join(" ; ")}. Les adresses à coller
                    dans {PLATFORM_LABELS[adPlatform]} s&apos;affichent juste après la création
                    (onglet Liens).
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <form action={action} className="flex flex-wrap items-center gap-2 border-t pt-4">
            <input type="hidden" name="payload" value={JSON.stringify(payload)} />
            <Button
              type="button"
              variant="outline"
              className="max-md:h-10"
              onClick={back}
              disabled={step === 0}
            >
              ← Précédent
            </Button>
            {step < WIZARD_STEPS.length - 1 ? (
              <Button type="button" className="max-md:h-10" onClick={next}>
                Suivant →
              </Button>
            ) : (
              <CreateButton
                onCheck={() => {
                  const err = validateStep("ads");
                  setLocalError(err);
                  return err;
                }}
              />
            )}
            <span className="text-xs text-muted-foreground">
              Tout reste modifiable ensuite depuis la fiche de la campagne.
            </span>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
