"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CalendarClock,
  EyeOff,
  ImagePlus,
  Italic,
  Link2,
  MousePointerClick,
  Plus,
  Smile,
  Split,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { OfferPicker } from "@/components/campaigns/offer-picker";
import { ImproveButton, type ImproveContext } from "@/components/ai/improve-button";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { TelegramPreview } from "./telegram-preview";
import { CategoryPicker } from "./category-picker";
import { resolvePostVertical } from "./ai-context";
import { BUTTON_TYPE_LABELS, type PostButton, type PostButtonRow } from "@/lib/posts/buttons";
import {
  AB_DEFAULT_DELAY_MINUTES,
  AB_MAX_DELAY_MINUTES,
  AB_MIN_DELAY_MINUTES,
} from "@/lib/posts/ab";
import { advancedModifiedCount, initialSections, scheduleSummary } from "@/lib/posts/form-sections";
import { postLanguageOptions } from "@/lib/posts/display";
import { nextOccurrence, toParisLocalInput } from "@/lib/posts/time";
import type { BestSlot } from "@/lib/besthours/types";

export type ChannelOption = {
  id: string;
  title: string;
  language: string;
  vertical?: string | null;
};
export type CategoryOption = { id: string; name: string; color: string };
export type CampaignOption = { id: string; name: string; programName: string };
export type MediaItem = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  warning?: string;
};

export type PostFormValues = {
  postId?: string;
  channelIds: string[];
  scheduledAt: string;
  categoryId: string;
  language: string;
  text: string;
  media: MediaItem[];
  buttons: PostButtonRow[];
  pinAfterSend: boolean;
  unpinPrevious: boolean;
  deleteAfterMinutes: string;
  disableNotification: boolean;
  protectContent: boolean;
  disableLinkPreview: boolean;
  isTemplate: boolean;
  templateName: string;
  /** Univers du modèle (modèles seulement) : transmis à l'assistant IA. */
  vertical?: string | null;
  duplicatedFromId?: string;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  channels: ChannelOption[];
  categories: CategoryOption[];
  campaigns: CampaignOption[];
  /** Nos campagnes avec leurs offres (bouton « Offre »), chargées par la page : liste toujours à jour. */
  campaignOptions?: CampaignOptionWithOffers[];
  initial: PostFormValues;
  /** Édition : un seul canal. */
  singleChannel?: boolean;
  /**
   * Créneaux recommandés par canal puis par catégorie (`all` + identifiants de catégorie), calculés chaque nuit
   * par le worker (meilleurs créneaux du calendrier des messages).
   */
  bestSlots?: Record<string, Record<string, BestSlot>>;
  /** Création seulement : proposer un test A/B (deux versions publiées, comparées ensuite). */
  abAllowed?: boolean;
};

async function uploadFiles(
  files: FileList | null,
): Promise<{ items: MediaItem[]; error: string | null }> {
  if (!files || files.length === 0) return { items: [], error: null };
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("files", f);
  const res = await fetch("/api/media", { method: "POST", body: fd });
  const data = (await res.json()) as {
    files?: MediaItem[] & Array<{ error?: string }>;
    error?: string;
  };
  if (!res.ok || !data.files) throw new Error(data.error ?? "Téléversement impossible.");
  const errors = data.files
    .filter((f) => (f as { error?: string }).error)
    .map((f) => `${f.filename} : ${(f as { error?: string }).error}`);
  return {
    items: data.files.filter((f) => f.id),
    error: errors.length ? errors.join(" · ") : null,
  };
}

/** Outils de mise en forme : libellé, icône, balises (ou lien à demander). */
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
 * Éditeur de texte (version A ou B) : barre d'outils (mise en forme, émojis, et « Améliorer avec l'IA » à droite)
 * collée à la zone de texte. La sélection est gardée pour insérer un émoji choisi dans le menu.
 */
function TextEditor({
  id,
  text,
  setText,
  label,
  rows = 10,
  ai,
}: {
  id: string;
  text: string;
  setText: (t: string) => void;
  label: string;
  rows?: number;
  /** Bouton de l'assistant IA, placé dans la barre d'outils. */
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
    const next = text.slice(0, s) + open + picked + close + text.slice(e);
    setText(next);
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

/** Dépôt de fichiers + liste ordonnée des médias (version A ou B). */
function MediaEditor({
  media,
  setMedia,
  label,
}: {
  media: MediaItem[];
  setMedia: Dispatch<SetStateAction<MediaItem[]>>;
  label: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  async function onFiles(files: FileList | null) {
    setUploading(true);
    setUploadError(null);
    try {
      const { items, error } = await uploadFiles(files);
      if (error) setUploadError(error);
      setMedia((m) => [...m, ...items.filter((f) => !m.some((x) => x.id === f.id))]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Téléversement impossible.");
    } finally {
      setUploading(false);
    }
  }
  function move(i: number, dir: -1 | 1) {
    setMedia((m) => {
      const n = [...m];
      const j = i + dir;
      if (j < 0 || j >= n.length) return m;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  }
  const isImage = (m: MediaItem) => m.mimeType.startsWith("image/") && m.size <= 20 * 1024 * 1024;
  return (
    <div className="space-y-3">
      <div
        className="rounded-lg border border-dashed border-muted-foreground/75 p-4 text-center text-body text-muted-foreground"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFiles(e.dataTransfer.files);
        }}
      >
        Glissez-déposez ici ou{" "}
        <label className="cursor-pointer font-medium text-brand-ink underline underline-offset-2">
          choisissez des fichiers
          <input
            type="file"
            multiple
            className="sr-only"
            aria-label={label}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
        {uploading ? <div className="mt-1 text-note">Téléversement…</div> : null}
      </div>
      {uploadError ? <p className="text-body text-danger">{uploadError}</p> : null}
      {media.length > 0 ? (
        <ul className="space-y-2">
          {media.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-lg border border-border p-2 text-body"
            >
              {isImage(m) ? (
                // Aperçu servi par notre propre route (session requise) : pas d'optimisation next/image nécessaire.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${m.id}`} alt="" className="size-12 rounded object-cover" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded bg-muted text-note uppercase">
                  {m.mimeType.split("/")[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{m.filename}</div>
                <div className="text-note text-muted-foreground">
                  {(m.size / 1024 / 1024).toFixed(1).replace(".", ",")} Mo
                  {m.warning ? ` · ${m.warning}` : ""}
                </div>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Monter ${m.filename}`}
                onClick={() => move(i, -1)}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Descendre ${m.filename}`}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Retirer ${m.filename}`}
                onClick={() => setMedia((x) => x.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Lignes de boutons (version A ou B). */
function ButtonsEditor({
  rows,
  setRows,
  campaigns,
  campaignOptions,
  prefix = "",
}: {
  rows: PostButtonRow[];
  setRows: Dispatch<SetStateAction<PostButtonRow[]>>;
  campaigns: CampaignOption[];
  campaignOptions?: CampaignOptionWithOffers[];
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
            <div key={c} className="grid gap-2 sm:grid-cols-[1fr_180px_1fr_auto]">
              <Input
                value={b.text}
                aria-label={`${prefix}Libellé du bouton`}
                placeholder="Libellé"
                maxLength={64}
                onChange={(e) => setButton(r, c, { text: e.target.value })}
              />
              <NativeSelect
                aria-label={`${prefix}Type de bouton`}
                value={b.type}
                wrapperClassName="w-full"
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
                  affiliateCampaigns={campaigns}
                  label={`${prefix}Campagne du bouton Offre`}
                />
              ) : (
                <Input
                  value={b.url ?? ""}
                  aria-label={`${prefix}Adresse du bouton`}
                  placeholder="https://…"
                  onChange={(e) => setButton(r, c, { url: e.target.value })}
                />
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`${prefix}Supprimer ce bouton`}
                onClick={() =>
                  setRows((rs) =>
                    rs
                      .map((x, i) => (i === r ? x.filter((_, j) => j !== c) : x))
                      .filter((x) => x.length > 0),
                  )
                }
              >
                <Trash2 aria-hidden />
              </Button>
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
        <Plus aria-hidden /> Nouvelle ligne de boutons
      </Button>
    </div>
  );
}

/** Case à cocher du bloc « Avancé » : contrôlée, et envoyée sous son nom habituel (« on ») si elle est cochée. */
function OptionCheckbox({
  name,
  checked,
  onChange,
  children,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-body max-md:min-h-10">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        <span className="block">{children}</span>
        {hint ? <span className="block text-note text-muted-foreground">{hint}</span> : null}
      </span>
      {checked ? <input type="hidden" name={name} value="on" /> : null}
    </label>
  );
}

/**
 * Formulaire d'un message de canal en trois niveaux (docs/REFONTE-UX.md) :
 * 1. visible : canaux, texte (barre d'outils avec l'assistant IA) et aperçu Telegram, date et heure (Paris) avec le
 *    meilleur créneau, catégorie (« + Nouvelle catégorie ») ;
 * 2. un clic : « + Média », « + Boutons » (Offre par campagne), « Test A/B » ;
 * 3. « Avancé » replié : épingler, désépingler, supprimer après, silencieux, contenu protégé, sans aperçu de lien,
 *    langue, écart entre les versions A et B.
 * Un seul bouton principal « Programmer » ; brouillon et modèle en secondaire. Les noms des champs envoyés et les
 * actions serveur (`createPostAction`, `updatePostAction`) ne changent pas.
 */
export function PostForm({
  action,
  channels,
  categories,
  campaigns,
  campaignOptions,
  initial,
  singleChannel,
  bestSlots = {},
  abAllowed = false,
}: Props) {
  const [text, setText] = useState(initial.text);
  const [media, setMedia] = useState<MediaItem[]>(initial.media);
  const [rows, setRows] = useState<PostButtonRow[]>(initial.buttons);
  const [channelIds, setChannelIds] = useState<string[]>(initial.channelIds);
  const [scheduledAt, setScheduledAt] = useState(initial.scheduledAt);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [categoryName, setCategoryName] = useState<string | null>(
    categories.find((c) => c.id === initial.categoryId)?.name ?? null,
  );
  const [language, setLanguage] = useState(initial.language);
  const [intent, setIntent] = useState<"draft" | "schedule" | "template">(
    initial.isTemplate ? "template" : "draft",
  );
  const opened = initialSections({
    mediaCount: initial.media.length,
    buttonRows: initial.buttons.length,
  });
  const [showMedia, setShowMedia] = useState(opened.media);
  const [showButtons, setShowButtons] = useState(opened.buttons);
  // Niveau 3 : réglages rares (contrôlés pour compter ceux qui sont modifiés).
  const [pinAfterSend, setPinAfterSend] = useState(initial.pinAfterSend);
  const [unpinPrevious, setUnpinPrevious] = useState(initial.unpinPrevious);
  const [deleteAfter, setDeleteAfter] = useState(initial.deleteAfterMinutes);
  const [disableNotification, setDisableNotification] = useState(initial.disableNotification);
  const [protectContent, setProtectContent] = useState(initial.protectContent);
  const [disableLinkPreview, setDisableLinkPreview] = useState(initial.disableLinkPreview);
  // « Enregistrer comme modèle » (création) : le nom se saisit sur place.
  const [namingTemplate, setNamingTemplate] = useState(false);
  // Test A/B (création seulement).
  const [ab, setAb] = useState(false);
  const [abMode, setAbMode] = useState<"same-channel" | "other-channel">("same-channel");
  const [abChannelId, setAbChannelId] = useState("");
  const [abDelay, setAbDelay] = useState(String(AB_DEFAULT_DELAY_MINUTES));
  const [textB, setTextB] = useState("");
  const [mediaB, setMediaB] = useState<MediaItem[]>([]);
  const [rowsB, setRowsB] = useState<PostButtonRow[]>([]);
  const abActive = abAllowed && ab && intent !== "template";
  const isTemplate = initial.isTemplate;

  // Contexte de l'assistant IA : univers (campagne du bouton Offre, modèle, puis canal), catégorie, langue, média.
  const aiContext: ImproveContext = {
    surface: isTemplate || intent === "template" ? "template" : "post",
    vertical: resolvePostVertical({
      rows,
      campaigns: campaignOptions ?? [],
      channels,
      channelIds,
      templateVertical: initial.vertical,
    }),
    categoryId: categoryId || null,
    categoryName,
    language,
    hasMedia: media.length > 0,
  };
  const canCreateVariantB = abAllowed && !isTemplate && intent !== "template";

  // Meilleur créneau : premier canal coché qui a une recommandation pour la catégorie choisie (sinon toutes catégories).
  const slotInfo = (() => {
    for (const id of channelIds) {
      const byCat = bestSlots[id];
      if (!byCat) continue;
      const slot = (categoryId && byCat[categoryId]) || byCat.all;
      if (slot) {
        const c = channels.find((x) => x.id === id);
        const cat =
          categoryId && byCat[categoryId] ? categories.find((x) => x.id === categoryId) : null;
        return { slot, channelTitle: c?.title ?? "", categoryName: cat?.name ?? null };
      }
    }
    return null;
  })();
  function applyBestSlot() {
    if (!slotInfo) return;
    setScheduledAt(toParisLocalInput(nextOccurrence(slotInfo.slot.day, slotInfo.slot.hour)));
  }

  const modified = advancedModifiedCount({
    pinAfterSend,
    unpinPrevious,
    deleteAfterMinutes: deleteAfter,
    disableNotification,
    protectContent,
    disableLinkPreview,
    language,
    abDelayMinutes: abActive && abMode === "same-channel" ? abDelay : undefined,
  });
  const summary = scheduleSummary({
    scheduledAt,
    channelCount: channelIds.length,
    ab: abActive ? { mode: abMode, delayMinutes: abDelay } : null,
  });

  const preview = <TelegramPreview html={text} buttons={rows} mediaCount={media.length} />;
  const previewB = <TelegramPreview html={textB} buttons={rowsB} mediaCount={mediaB.length} />;

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {initial.postId ? <input type="hidden" name="postId" value={initial.postId} /> : null}
      {initial.duplicatedFromId ? (
        <input type="hidden" name="duplicatedFromId" value={initial.duplicatedFromId} />
      ) : null}
      <input type="hidden" name="text" value={text} />
      <input type="hidden" name="mediaAssetIds" value={JSON.stringify(media.map((m) => m.id))} />
      <input type="hidden" name="buttons" value={JSON.stringify(rows)} />
      <input type="hidden" name="intent" value={intent} />
      {channelIds.map((id) => (
        <input key={id} type="hidden" name="channelIds" value={id} />
      ))}
      {abActive ? (
        <>
          <input type="hidden" name="abEnabled" value="1" />
          <input type="hidden" name="abMode" value={abMode} />
          <input
            type="hidden"
            name="abChannelId"
            value={abMode === "other-channel" ? abChannelId : ""}
          />
          <input type="hidden" name="abDelayMinutes" value={abDelay} />
          <input type="hidden" name="textB" value={textB} />
          <input
            type="hidden"
            name="mediaAssetIdsB"
            value={JSON.stringify(mediaB.map((m) => m.id))}
          />
          <input type="hidden" name="buttonsB" value={JSON.stringify(rowsB)} />
        </>
      ) : null}

      <div className="min-w-0 space-y-6">
        {/* Niveau 1 : ce qu'il faut pour que ça marche. */}
        <div className="space-y-6 rounded-xl border border-border bg-card p-4 md:p-6">
          <FormSection
            title={singleChannel ? "Canal" : "Canaux"}
            description={
              singleChannel
                ? "Le canal où le bot publie ce message."
                : "Un message est créé pour chaque canal coché."
            }
          >
            {channels.length === 0 ? (
              <p className="text-body text-muted-foreground">
                Aucun canal actif : ajoutez d&apos;abord un bot comme administrateur d&apos;un canal
                (page Canaux).
              </p>
            ) : singleChannel ? (
              <NativeSelect
                id="post-channel"
                aria-label="Canal"
                value={channelIds[0] ?? ""}
                onChange={(e) => setChannelIds([e.target.value])}
                wrapperClassName="w-full sm:w-80"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <div role="group" aria-label="Canaux" className="flex flex-wrap gap-2">
                {channels.map((c) => {
                  const checked = channelIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-body max-md:h-10",
                        checked
                          ? "border-brand bg-brand-soft text-foreground"
                          : "border-border bg-surface hover:bg-muted",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setChannelIds((ids) =>
                            v === true ? [...ids, c.id] : ids.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <UniverseDot universe={c.vertical} />
                      {c.title}
                    </label>
                  );
                })}
              </div>
            )}
          </FormSection>

          <FormSection
            title={abActive ? "Texte — version A" : "Texte"}
            description="Mise en forme Telegram par la barre d'outils. 4 096 caractères au plus, 1 024 avec un média."
          >
            <Label htmlFor="post-text" className="sr-only">
              Texte du message
            </Label>
            <TextEditor
              id="post-text"
              text={text}
              setText={setText}
              label="Texte du message"
              ai={
                <ImproveButton
                  getText={() => text}
                  setText={setText}
                  context={aiContext}
                  label="Améliorer avec l'IA"
                  variant="ghost"
                  size="sm"
                  className="text-brand-ink"
                  onCreateVariantB={
                    canCreateVariantB
                      ? (t) => {
                          setAb(true);
                          setTextB(t);
                        }
                      : undefined
                  }
                />
              }
            />
            {/* Téléphone : l'aperçu juste sous le texte (sur ordinateur, il est à droite). */}
            <div className="lg:hidden">
              <p className="mb-2 text-note font-medium text-muted-foreground">
                Aperçu tel que les membres le verront
              </p>
              {preview}
            </div>
          </FormSection>

          <div className="grid gap-6 sm:grid-cols-2">
            {isTemplate ? (
              <div className="space-y-2">
                <div className="flex min-h-7 items-center">
                  <Label htmlFor="templateName">Nom du modèle</Label>
                </div>
                <Input
                  id="templateName"
                  name="templateName"
                  defaultValue={initial.templateName}
                  maxLength={80}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex min-h-7 items-center">
                  <Label htmlFor="scheduledAt">Date et heure (heure de Paris)</Label>
                </div>
                <Input
                  id="scheduledAt"
                  name="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                {slotInfo ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-note">
                    <span className="min-w-0 flex-1">
                      Meilleur créneau pour {slotInfo.channelTitle}
                      {slotInfo.categoryName ? ` (${slotInfo.categoryName})` : ""} :{" "}
                      <strong className="font-semibold text-brand-ink">
                        {slotInfo.slot.label}
                      </strong>
                    </span>
                    <Button type="button" size="xs" variant="outline" onClick={applyBestSlot}>
                      <CalendarClock aria-hidden />
                      Utiliser
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={(id, c) => {
                setCategoryId(id);
                setCategoryName(c?.name ?? null);
              }}
            />
          </div>
        </div>

        {/* Niveau 2 : un clic chacun. */}
        {!showMedia || !showButtons || (abAllowed && !isTemplate && !ab) ? (
          <div role="group" aria-label="Ajouter au message" className="flex flex-wrap gap-2">
            {!showMedia ? (
              <Button type="button" variant="outline" onClick={() => setShowMedia(true)}>
                <ImagePlus aria-hidden />
                Média
              </Button>
            ) : null}
            {!showButtons ? (
              <Button type="button" variant="outline" onClick={() => setShowButtons(true)}>
                <MousePointerClick aria-hidden />
                Boutons
              </Button>
            ) : null}
            {abAllowed && !isTemplate && !ab ? (
              <Button
                type="button"
                variant="outline"
                disabled={intent === "template"}
                onClick={() => setAb(true)}
              >
                <Split aria-hidden />
                Test A/B
              </Button>
            ) : null}
          </div>
        ) : null}

        {showMedia ? (
          <div className="relative rounded-xl border border-border bg-card p-4 md:p-6">
            {media.length === 0 ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Masquer les médias"
                className="absolute top-3 right-3"
                onClick={() => setShowMedia(false)}
              >
                <X aria-hidden />
              </Button>
            ) : null}
            <FormSection
              title={abActive ? "Médias — version A" : "Médias"}
              description="Image, vidéo, gif ou document (50 Mo au plus). Plusieurs médias = album ; les boutons suivent dans un second message."
              className="[&>div:first-child]:pr-10"
            >
              <MediaEditor media={media} setMedia={setMedia} label="Fichiers du message" />
            </FormSection>
          </div>
        ) : null}

        {showButtons ? (
          <div className="relative rounded-xl border border-border bg-card p-4 md:p-6">
            {rows.length === 0 ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Masquer les boutons"
                className="absolute top-3 right-3"
                onClick={() => setShowButtons(false)}
              >
                <X aria-hidden />
              </Button>
            ) : null}
            <FormSection
              title={abActive ? "Boutons — version A" : "Boutons"}
              description="Lien direct, lien traqué (clics comptés) ou offre d'une campagne (lien Link Affi avec l'identifiant de suivi de chaque membre)."
              className="[&>div:first-child]:pr-10"
            >
              <ButtonsEditor
                rows={rows}
                setRows={setRows}
                campaigns={campaigns}
                campaignOptions={campaignOptions}
              />
            </FormSection>
          </div>
        ) : null}

        {abActive ? (
          <div className="relative rounded-xl border border-border bg-card p-4 md:p-6">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="absolute top-3 right-3"
              onClick={() => setAb(false)}
            >
              <X aria-hidden />
              Retirer le test
            </Button>
            <FormSection
              title="Test A/B"
              description="Deux versions sont publiées ; la page de comparaison montre vues, clics et inscriptions de chacune et désigne la gagnante."
              className="[&>div:first-child]:pr-32"
            >
              <fieldset className="space-y-2 text-body">
                <legend className="mb-1 font-medium">Où publier la version B ?</legend>
                <label className="flex items-center gap-2 max-md:min-h-10">
                  <input
                    type="radio"
                    name="abModeChoice"
                    checked={abMode === "same-channel"}
                    onChange={() => setAbMode("same-channel")}
                    className="size-4 accent-brand"
                  />
                  Dans le même canal, après la version A (écart réglable dans « Avancé »)
                </label>
                <label className="flex flex-wrap items-center gap-2 max-md:min-h-10">
                  <input
                    type="radio"
                    name="abModeChoice"
                    checked={abMode === "other-channel"}
                    onChange={() => setAbMode("other-channel")}
                    className="size-4 accent-brand"
                  />
                  Dans un autre canal, à la même heure :
                  <NativeSelect
                    aria-label="Canal de la version B"
                    value={abChannelId}
                    disabled={abMode !== "other-channel"}
                    onChange={(e) => setAbChannelId(e.target.value)}
                    wrapperClassName="w-full sm:w-60"
                  >
                    <option value="">— choisir —</option>
                    {channels
                      .filter((c) => !channelIds.includes(c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </NativeSelect>
                </label>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="post-text-b">Texte — version B</Label>
                <TextEditor
                  id="post-text-b"
                  text={textB}
                  setText={setTextB}
                  label="Texte de la version B"
                  rows={6}
                  ai={
                    <ImproveButton
                      getText={() => textB}
                      setText={setTextB}
                      context={{ ...aiContext, hasMedia: mediaB.length > 0 }}
                      label="Améliorer la version B"
                      variant="ghost"
                      size="sm"
                      className="text-brand-ink"
                    />
                  }
                />
                <div className="lg:hidden">{previewB}</div>
              </div>
              <div className="space-y-2">
                <p className="text-body font-medium">Médias — version B</p>
                <MediaEditor media={mediaB} setMedia={setMediaB} label="Fichiers de la version B" />
              </div>
              <div className="space-y-2">
                <p className="text-body font-medium">Boutons — version B</p>
                <ButtonsEditor
                  rows={rowsB}
                  setRows={setRowsB}
                  campaigns={campaigns}
                  campaignOptions={campaignOptions}
                  prefix="Version B : "
                />
              </div>
            </FormSection>
          </div>
        ) : null}

        {/* Niveau 3 : réglages rares, repliés. */}
        <AdvancedSection
          description="Épingler, envoi silencieux, contenu protégé, suppression automatique, langue…"
          modifiedCount={modified}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionCheckbox name="pinAfterSend" checked={pinAfterSend} onChange={setPinAfterSend}>
              Épingler après l&apos;envoi
            </OptionCheckbox>
            <OptionCheckbox
              name="unpinPrevious"
              checked={unpinPrevious}
              onChange={setUnpinPrevious}
            >
              Désépingler le message précédent
            </OptionCheckbox>
            <OptionCheckbox
              name="disableNotification"
              checked={disableNotification}
              onChange={setDisableNotification}
              hint="Les membres le reçoivent sans sonnerie."
            >
              Envoi silencieux
            </OptionCheckbox>
            <OptionCheckbox
              name="protectContent"
              checked={protectContent}
              onChange={setProtectContent}
              hint="Pas de transfert ni de capture du message."
            >
              Contenu protégé
            </OptionCheckbox>
            <OptionCheckbox
              name="disableLinkPreview"
              checked={disableLinkPreview}
              onChange={setDisableLinkPreview}
            >
              Sans aperçu des liens
            </OptionCheckbox>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="deleteAfterMinutes">Supprimer après (minutes)</Label>
              <Input
                id="deleteAfterMinutes"
                name="deleteAfterMinutes"
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="Jamais"
                value={deleteAfter}
                onChange={(e) => setDeleteAfter(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Langue du message</Label>
              <NativeSelect
                id="language"
                name="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                wrapperClassName="w-full"
              >
                {postLanguageOptions(language).map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {abActive && abMode === "same-channel" ? (
              <div className="space-y-2">
                <Label htmlFor="abDelay">Écart entre A et B (minutes)</Label>
                <Input
                  id="abDelay"
                  type="number"
                  min={AB_MIN_DELAY_MINUTES}
                  max={AB_MAX_DELAY_MINUTES}
                  value={abDelay}
                  onChange={(e) => setAbDelay(e.target.value)}
                />
              </div>
            ) : null}
          </div>
        </AdvancedSection>

        {/* Un seul bouton principal. */}
        <div className="space-y-3 border-t border-border pt-4">
          {namingTemplate ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="newTemplateName">Nom du modèle</Label>
                <Input
                  id="newTemplateName"
                  name="templateName"
                  maxLength={80}
                  placeholder="Ex. : Bonus du vendredi"
                  autoFocus
                />
              </div>
              <Button type="submit" variant="outline" onClick={() => setIntent("template")}>
                Enregistrer le modèle
              </Button>
              <Button type="button" variant="ghost" onClick={() => setNamingTemplate(false)}>
                Annuler
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-note text-muted-foreground" aria-live="polite">
              {isTemplate
                ? "Un modèle ne part pas : il sert de base à de nouveaux messages."
                : summary}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {isTemplate ? (
                <Button type="submit" onClick={() => setIntent("template")}>
                  Enregistrer le modèle
                </Button>
              ) : (
                <>
                  {!initial.postId && !ab && !namingTemplate ? (
                    <Button type="button" variant="ghost" onClick={() => setNamingTemplate(true)}>
                      Enregistrer comme modèle
                    </Button>
                  ) : null}
                  <Button type="submit" variant="outline" onClick={() => setIntent("draft")}>
                    Enregistrer en brouillon
                  </Button>
                  <Button type="submit" onClick={() => setIntent("schedule")}>
                    <CalendarClock aria-hidden />
                    {abActive ? "Programmer le test A/B" : "Programmer"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ordinateur : l'aperçu à droite, toujours visible. */}
      <aside className="hidden lg:block" aria-label="Aperçu">
        <div className="sticky top-4 space-y-4">
          <div>
            <p className="mb-2 text-note font-medium text-muted-foreground">
              {abActive ? "Aperçu — version A" : "Aperçu tel que les membres le verront"}
            </p>
            {preview}
          </div>
          {abActive ? (
            <div>
              <p className="mb-2 text-note font-medium text-muted-foreground">Aperçu — version B</p>
              {previewB}
            </div>
          ) : null}
        </div>
      </aside>
    </form>
  );
}
