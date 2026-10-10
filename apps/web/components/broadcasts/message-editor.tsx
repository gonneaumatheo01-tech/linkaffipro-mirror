"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bold,
  EyeOff,
  ImagePlus,
  Italic,
  Link2,
  MousePointerClick,
  Plus,
  Smile,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { FormSection } from "@/components/admin/form-section";
import { OfferPicker } from "@/components/campaigns/offer-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { BUTTON_TYPE_LABELS, type PostButton, type PostButtonRow } from "@/lib/posts/buttons";

export type MediaOption = { id: string; filename: string; mimeType: string };
export type AffiliateOption = { id: string; name: string; programName: string };

/** Outils de mise en forme Telegram : libellé, icône, balises (ou lien à demander). */
const TEXT_TOOLS: Array<{
  title: string;
  icon: React.ReactNode;
  open: string;
  close: string;
  link?: boolean;
}> = [
  { title: "Gras", icon: <Bold aria-hidden />, open: "<b>", close: "</b>" },
  { title: "Italique", icon: <Italic aria-hidden />, open: "<i>", close: "</i>" },
  { title: "Souligné", icon: <Underline aria-hidden />, open: "<u>", close: "</u>" },
  { title: "Barré", icon: <Strikethrough aria-hidden />, open: "<s>", close: "</s>" },
  { title: "Insérer un lien", icon: <Link2 aria-hidden />, open: "", close: "", link: true },
  {
    title: "Texte masqué (spoiler)",
    icon: <EyeOff aria-hidden />,
    open: "<tg-spoiler>",
    close: "</tg-spoiler>",
  },
];
const EMOJIS = ["🔥", "🎁", "💰", "⚡", "✅", "👉", "🎰", "⚽", "❤️"];

/**
 * Zone de texte du message (version A ou B) : barre d'outils collée (mise en forme, émojis, « Améliorer avec l'IA »
 * à droite). Même présentation que l'éditeur des messages de canal. La sélection est gardée pour insérer un émoji.
 */
export function MessageTextEditor({
  id,
  text,
  setText,
  label,
  rows = 8,
  ai,
}: {
  id: string;
  text: string;
  setText: (t: string) => void;
  /** Nom de la zone pour les lecteurs d'écran (« Texte du message »). */
  label: string;
  rows?: number;
  ai?: React.ReactNode;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const sel = useRef<{ start: number; end: number }>({ start: text.length, end: text.length });
  function remember() {
    const el = ta.current;
    if (el) sel.current = { start: el.selectionStart, end: el.selectionEnd };
  }
  function wrap(open: string, close: string, fromMenu = false) {
    const el = ta.current;
    if (!el) return;
    const s = fromMenu ? sel.current.start : el.selectionStart;
    const e = fromMenu ? sel.current.end : el.selectionEnd;
    const picked = text.slice(s, e) || (close ? "texte" : "");
    setText(text.slice(0, s) + open + picked + close + text.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      const at = s + open.length;
      el.setSelectionRange(at, at + picked.length);
      sel.current = { start: at, end: at + picked.length };
    });
  }
  function insertLink() {
    const url = window.prompt("Adresse du lien (https://…)");
    if (!url) return;
    wrap(`<a href="${url.replace(/"/g, "%22")}">`, "</a>");
  }
  return (
    <div className="rounded-lg border border-muted-foreground/75 bg-surface focus-within:border-ring focus-within:ring-3 focus-within:ring-brand/30">
      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-border p-1"
        role="toolbar"
        aria-label={`Mise en forme : ${label}`}
      >
        {TEXT_TOOLS.map((t) => (
          <Button
            key={t.title}
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => (t.link ? insertLink() : wrap(t.open, t.close))}
            title={t.title}
            aria-label={t.title}
          >
            {t.icon}
          </Button>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Insérer un émoji"
                title="Insérer un émoji"
              />
            }
          >
            <Smile aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent finalFocus={ta} className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Émojis</DropdownMenuLabel>
              <div className="grid grid-cols-5 gap-0.5">
                {EMOJIS.map((e) => (
                  <DropdownMenuItem
                    key={e}
                    aria-label={`Insérer ${e}`}
                    className="justify-center text-title"
                    onClick={() => wrap(e, "", true)}
                  >
                    {e}
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {ai ? <div className="ml-auto">{ai}</div> : null}
      </div>
      <Textarea
        ref={ta}
        id={id}
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onSelect={remember}
        onKeyUp={remember}
        onBlur={remember}
        rows={rows}
        placeholder="Votre message…"
        className="min-h-40 rounded-t-none border-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
      />
    </div>
  );
}

async function uploadFile(file: File): Promise<MediaOption> {
  const fd = new FormData();
  fd.append("files", file);
  const res = await fetch("/api/media", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as {
    files?: Array<MediaOption & { error?: string }>;
    error?: string;
  };
  const f = data.files?.[0];
  if (!res.ok || !f) throw new Error(data.error ?? "Téléversement impossible.");
  if (f.error || !f.id) throw new Error(`${f.filename} : ${f.error ?? "fichier refusé."}`);
  return { id: f.id, filename: f.filename, mimeType: f.mimeType };
}

/**
 * Un média joint au message (image, vidéo, gif ou document) : choisir un fichier déjà envoyé ou en téléverser un.
 * Le texte devient sa légende (au-delà de 1 024 caractères, le média part puis le texte à part).
 */
export function MediaChooser({
  id,
  media,
  value,
  onChange,
  onUploaded,
  label,
}: {
  id: string;
  /** Fichiers proposés (ceux téléversés pendant la saisie compris : voir `onUploaded`). */
  media: MediaOption[];
  value: string;
  onChange: (id: string) => void;
  /** Fichier téléversé : à ajouter aux fichiers proposés (gardé par le formulaire). */
  onUploaded?: (item: MediaOption) => void;
  label: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = media;
  const current = all.find((m) => m.id === value) ?? null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const item = await uploadFile(file);
      onUploaded?.(item);
      onChange(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Téléversement impossible.");
    } finally {
      setUploading(false);
    }
  }

  if (current) {
    const isImage = current.mimeType.startsWith("image/");
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-2 text-body">
        {isImage ? (
          // Aperçu servi par notre propre route (session requise) : pas d'optimisation next/image nécessaire.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/${current.id}`} alt="" className="size-12 rounded object-cover" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted text-note uppercase">
            {current.mimeType.split("/")[0]}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{current.filename}</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Retirer ${current.filename}`}
          title="Retirer le média"
          onClick={() => onChange("")}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {all.length > 0 ? (
          <NativeSelect
            id={id}
            aria-label={`${label} : choisir un fichier déjà envoyé`}
            value=""
            onChange={(e) => onChange(e.target.value)}
            wrapperClassName="w-full sm:max-w-xs"
          >
            <option value="">Choisir un fichier déjà envoyé…</option>
            {all.map((m) => (
              <option key={m.id} value={m.id}>
                {m.filename}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-body font-medium text-brand-ink underline underline-offset-2 max-md:min-h-10">
          {all.length > 0 ? "ou téléverser un fichier" : "Téléverser un fichier"}
          <input
            type="file"
            className="sr-only"
            aria-label={`${label} : téléverser un fichier`}
            accept="image/*,video/*,application/pdf,audio/*"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {uploading ? <p className="text-note text-muted-foreground">Téléversement…</p> : null}
      {error ? <p className="text-body text-danger">{error}</p> : null}
    </div>
  );
}

/** Lignes de boutons sous le message (version A ou B) : lien direct, lien traqué, offre d'une campagne. */
export function ButtonsEditor({
  rows,
  setRows,
  affiliateCampaigns,
  campaignOptions,
  prefix = "",
}: {
  rows: PostButtonRow[];
  setRows: Dispatch<SetStateAction<PostButtonRow[]>>;
  affiliateCampaigns: AffiliateOption[];
  campaignOptions?: CampaignOptionWithOffers[];
  /** Préfixe des noms accessibles (« Version B : »). */
  prefix?: string;
}) {
  function setButton(r: number, c: number, patch: Partial<PostButton>) {
    setRows((rs) =>
      rs.map((row, i) => (i === r ? row.map((b, j) => (j === c ? { ...b, ...patch } : b)) : row)),
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((row, r) => (
        <div key={r} className="space-y-2 rounded-lg border border-border p-2">
          {row.map((b, c) => (
            <div
              key={c}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-sm:border-t max-sm:border-border max-sm:pt-2 max-sm:first:border-t-0 max-sm:first:pt-0 sm:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_auto]"
            >
              <Input
                value={b.text}
                aria-label={`${prefix}Libellé du bouton ${c + 1}, ligne ${r + 1}`}
                placeholder="Libellé"
                maxLength={64}
                onChange={(e) => setButton(r, c, { text: e.target.value })}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="self-center sm:order-last"
                aria-label={`${prefix}Retirer le bouton ${c + 1} de la ligne ${r + 1}`}
                title="Retirer ce bouton"
                onClick={() =>
                  setRows((rs) =>
                    rs
                      .map((x, i) => (i === r ? x.filter((_, j) => j !== c) : x))
                      .filter((x) => x.length > 0),
                  )
                }
              >
                <X aria-hidden />
              </Button>
              <NativeSelect
                aria-label={`${prefix}Type du bouton ${c + 1}, ligne ${r + 1}`}
                value={b.type}
                wrapperClassName="col-span-2 w-full sm:col-span-1"
                onChange={(e) =>
                  setButton(r, c, {
                    type: e.target.value as PostButton["type"],
                    trackingLinkId: undefined,
                    slug: undefined,
                  })
                }
              >
                {(Object.keys(BUTTON_TYPE_LABELS) as PostButton["type"][]).map((t) => (
                  <option key={t} value={t}>
                    {BUTTON_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
              {b.type === "OFFER" ? (
                <OfferPicker
                  value={{ campaignId: b.campaignId, affiliateCampaignId: b.affiliateCampaignId }}
                  onChange={(patch) => setButton(r, c, patch)}
                  campaigns={campaignOptions}
                  affiliateCampaigns={affiliateCampaigns}
                  label={`${prefix}Campagne du bouton ${c + 1}, ligne ${r + 1}`}
                  className="col-span-2 sm:col-span-1"
                />
              ) : (
                <Input
                  value={b.url ?? ""}
                  aria-label={`${prefix}Adresse du bouton ${c + 1}, ligne ${r + 1}`}
                  placeholder="https://…"
                  inputMode="url"
                  className="col-span-2 sm:col-span-1"
                  onChange={(e) => setButton(r, c, { url: e.target.value })}
                />
              )}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setRows((rs) => rs.map((x, i) => (i === r ? [...x, { text: "", type: "URL" }] : x)))
            }
          >
            <Plus aria-hidden /> Bouton sur cette ligne
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setRows((rs) => [...rs, [{ text: "", type: "URL" }]])}
      >
        <Plus aria-hidden /> {rows.length ? "Nouvelle ligne de boutons" : "Ajouter un bouton"}
      </Button>
    </div>
  );
}

/**
 * « Média » et « Boutons » d'une version du message : deux boutons d'ajout, puis les blocs ouverts (choisir un fichier
 * déjà envoyé ou en téléverser un ; lignes de boutons). Le même composant sert aux versions A et B : mêmes outils.
 */
export function MessageExtras({
  version,
  idPrefix,
  media,
  mediaAssetId,
  setMediaAssetId,
  onUploaded,
  rows,
  setRows,
  showMedia,
  setShowMedia,
  showButtons,
  setShowButtons,
  affiliateCampaigns,
  campaignOptions,
}: {
  /** « A » ou « B » pendant un test A/B, sinon null. */
  version: "A" | "B" | null;
  /** Préfixe des identifiants des champs (« broadcast », « broadcast-b »). */
  idPrefix: string;
  media: MediaOption[];
  mediaAssetId: string;
  setMediaAssetId: (id: string) => void;
  onUploaded: (item: MediaOption) => void;
  rows: PostButtonRow[];
  setRows: Dispatch<SetStateAction<PostButtonRow[]>>;
  showMedia: boolean;
  setShowMedia: (show: boolean) => void;
  showButtons: boolean;
  setShowButtons: (show: boolean) => void;
  affiliateCampaigns: AffiliateOption[];
  campaignOptions?: CampaignOptionWithOffers[];
}) {
  const suffix = version ? ` — version ${version}` : "";
  const of = version ? ` de la version ${version}` : "";
  return (
    <>
      {showMedia ? (
        <FormSection
          title={`Média${suffix}`}
          description="Image, vidéo, gif ou document (50 Mo au plus). Le texte devient sa légende."
          actions={
            mediaAssetId ? null : (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Masquer le média${of}`}
                title="Masquer"
                onClick={() => setShowMedia(false)}
              >
                <X aria-hidden />
              </Button>
            )
          }
        >
          <MediaChooser
            id={`${idPrefix}-media`}
            media={media}
            value={mediaAssetId}
            onChange={setMediaAssetId}
            onUploaded={onUploaded}
            label={version ? `Média de la version ${version}` : "Média du message"}
          />
        </FormSection>
      ) : null}

      {showButtons ? (
        <FormSection
          title={`Boutons${suffix}`}
          description="Lien direct, lien traqué (clics comptés) ou offre d'une campagne (lien Link Affi avec l'identifiant de suivi de chaque membre)."
          actions={
            rows.length ? null : (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Masquer les boutons${of}`}
                title="Masquer"
                onClick={() => setShowButtons(false)}
              >
                <X aria-hidden />
              </Button>
            )
          }
        >
          <ButtonsEditor
            rows={rows}
            setRows={setRows}
            affiliateCampaigns={affiliateCampaigns}
            campaignOptions={campaignOptions}
            prefix={version ? `Version ${version} : ` : ""}
          />
        </FormSection>
      ) : null}

      {!showMedia || !showButtons ? (
        <div
          role="group"
          aria-label={version ? `Ajouter à la version ${version}` : "Ajouter au message"}
          className="flex flex-wrap gap-2"
        >
          {!showMedia ? (
            <Button type="button" variant="outline" onClick={() => setShowMedia(true)}>
              <ImagePlus aria-hidden />
              Média
            </Button>
          ) : null}
          {!showButtons ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowButtons(true);
                if (rows.length === 0) setRows([[{ text: "", type: "OFFER" }]]);
              }}
            >
              <MousePointerClick aria-hidden />
              Boutons
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
