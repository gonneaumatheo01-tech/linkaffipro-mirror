"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  ImagePlus,
  MousePointerClick,
  Plus,
  Split,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { AdvancedSection, FormSection } from "@/components/admin/form-section";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { OfferPicker } from "@/components/campaigns/offer-picker";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { ImproveButton, type ImproveContext } from "@/components/ai/improve-button";
import { hasCustomEmoji, withFallbackEmojis, type MtprotoPublishStatus } from "@linkaffipro/core";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { TelegramPreview } from "./telegram-preview";
import {
  EmojiPublishPanel,
  TelegramSettingsLink,
  type AccountCheckState,
} from "./emoji-publish-panel";
import { PublisherBadge } from "./publisher-badge";
import { TextOfferLink, type CreateTextOfferLink } from "./text-offer-link";
import { placeholdersToComplete } from "./preview-placeholders";
import { CategoryPicker } from "./category-picker";
import { resolvePostVertical } from "./ai-context";
import { BUTTON_TYPE_LABELS, type PostButton, type PostButtonRow } from "@/lib/posts/buttons";
import {
  offerButtonIssues,
  offerIssuesSummary,
  type OfferButtonIssue,
} from "@/lib/posts/offer-buttons";
import {
  AB_DEFAULT_DELAY_MINUTES,
  AB_MAX_DELAY_MINUTES,
  AB_MIN_DELAY_MINUTES,
} from "@/lib/posts/ab";
import { advancedModifiedCount, initialSections, scheduleSummary } from "@/lib/posts/form-sections";
import { postLanguageOptions } from "@/lib/posts/display";
import { nextOccurrence, toParisLocalInput } from "@/lib/posts/time";
import { appendToText } from "@/lib/posts/offer-link";
import {
  ACCOUNT_PROTECT_NOTE,
  accountProblemsFor,
  channelsToCheck,
  hasAccountProblem,
  needsAccountFor,
  postEmojiState,
  statusAnswered,
  targetsOf,
  type EmojiButtonsChoice,
} from "@/lib/posts/publisher";
import type { BestSlot } from "@/lib/besthours/types";

export type ChannelOption = {
  id: string;
  title: string;
  language: string;
  vertical?: string | null;
  /**
   * `Channel.type` : CHANNEL (canal) ou GROUP (groupe ou supergroupe). Emojis animés : dans un groupe, le bot les publie
   * lui-même, avec ses boutons ; seul un canal passe par le compte Telegram connecté. Absent : canal.
   */
  type?: string | null;
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

/** Actions serveur des emojis animés (passées par la page : le formulaire reste sans accès à la base). */
export type PostEmojiActions = {
  /** « Vérifier » : relevé de l'état du compte Telegram connecté pour ces canaux. */
  checkAccount: (
    channelIds: string[],
  ) => Promise<{ ok: true; requestedAt: string } | { ok: false; error: string }>;
  /** Dernier relevé de l'état du compte. */
  accountStatus: () => Promise<MtprotoPublishStatus | null>;
  /** « Ajouter l'offre comme lien dans le texte ». */
  createOfferLink: CreateTextOfferLink;
};

/** Attente du relevé demandé par « Vérifier » : un coup d'œil toutes les 3 s, 45 s au plus. */
const CHECK_POLL_MS = 3000;
const CHECK_TIMEOUT_MS = 45_000;

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
  /**
   * Emojis animés (phase 12) : dernier relevé de l'état du compte Telegram connecté (`Setting` `mtproto.publishStatus`)
   * et actions serveur (vérifier le compte, offre en lien dans le texte).
   */
  accountStatus?: MtprotoPublishStatus | null;
  emojiActions?: PostEmojiActions;
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

/** Repère d'un choix de campagne dans le formulaire (mise au point sur le premier bouton Offre à compléter). */
function offerSlot(i: Pick<OfferButtonIssue, "version" | "row" | "col">): string {
  return `${i.version}-${i.row}-${i.col}`;
}

/**
 * Lignes de boutons (version A ou B). `issues` : boutons Offre à compléter, signalés sous leur choix de campagne
 * (après un essai d'enregistrement refusé dans le navigateur).
 */
function ButtonsEditor({
  rows,
  setRows,
  campaigns,
  campaignOptions,
  prefix = "",
  version = "A",
  issues = [],
  disabled = false,
}: {
  rows: PostButtonRow[];
  setRows: Dispatch<SetStateAction<PostButtonRow[]>>;
  campaigns: CampaignOption[];
  campaignOptions?: CampaignOptionWithOffers[];
  prefix?: string;
  version?: "A" | "B";
  issues?: OfferButtonIssue[];
  /** Message publié par le compte Telegram connecté (emojis animés) : boutons gardés à l'écran mais non publiés. */
  disabled?: boolean;
}) {
  function setButton(r: number, c: number, patch: Partial<PostButton>) {
    setRows((rs) =>
      rs.map((row, i) => (i === r ? row.map((b, j) => (j === c ? { ...b, ...patch } : b)) : row)),
    );
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-60">
      <legend className="sr-only">{`${prefix}Boutons du message`}</legend>
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
                <div
                  className="flex flex-col gap-1"
                  data-offer-slot={offerSlot({ version, row: r, col: c })}
                >
                  <OfferPicker
                    value={{ campaignId: b.campaignId, affiliateCampaignId: b.affiliateCampaignId }}
                    onChange={(patch) => setButton(r, c, patch)}
                    campaigns={campaignOptions}
                    affiliateCampaigns={campaigns}
                    label={`${prefix}Campagne du bouton Offre`}
                  />
                  {issues
                    .filter((i) => i.row === r && i.col === c)
                    .map((i) => (
                      <p key={offerSlot(i)} className="text-note font-medium text-danger">
                        {i.message}
                      </p>
                    ))}
                </div>
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
    </fieldset>
  );
}

/**
 * Case à cocher du bloc « Avancé » : contrôlée, et envoyée sous son nom habituel (« on ») si elle est cochée.
 * `disabled` : réglage sans effet pour ce message (affichée non cochée, rien n'est envoyé ; la phrase dit pourquoi).
 */
function OptionCheckbox({
  name,
  checked,
  onChange,
  children,
  hint,
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  const on = checked && !disabled;
  return (
    <label
      className={cn(
        "flex items-start gap-3 text-body max-md:min-h-10",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <Checkbox
        checked={on}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
      />
      <span>
        <span className={cn("block", disabled && "text-muted-foreground")}>{children}</span>
        {hint ? <span className="block text-note text-muted-foreground">{hint}</span> : null}
      </span>
      {on ? <input type="hidden" name={name} value="on" /> : null}
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
  accountStatus = null,
  emojiActions,
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

  // Emojis animés (phase 12) : qui publie chaque version, choix « emojis » / « boutons », état du compte connecté.
  const [emojiChoice, setEmojiChoice] = useState<EmojiButtonsChoice | null>(null);
  const [choiceCheck, setChoiceCheck] = useState(false);
  const [status, setStatus] = useState<MtprotoPublishStatus | null>(accountStatus);
  const [check, setCheck] = useState<AccountCheckState>({ state: "idle" });
  const [accountCheckShown, setAccountCheckShown] = useState(false);
  const [showOfferLink, setShowOfferLink] = useState(false);
  const autoChecked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Où part chaque version : canaux (compte connecté si emojis animés) et/ou groupes (le bot les publie lui-même).
  const chatTypeOf = (id: string) => channels.find((c) => c.id === id)?.type ?? null;
  const channelIdsB = abMode === "other-channel" ? (abChannelId ? [abChannelId] : []) : channelIds;
  const targetsA = targetsOf(channelIds.map(chatTypeOf));
  const targetsB = targetsOf(channelIdsB.map(chatTypeOf));
  const emoji = postEmojiState({
    textA: text,
    buttonsA: rows,
    textB,
    buttonsB: rowsB,
    abActive,
    choice: emojiChoice,
    // « Enregistrer comme modèle » depuis un nouveau message : rien à choisir non plus.
    isTemplate: isTemplate || intent === "template",
    targetsA,
    targetsB,
  });
  const titleOf = (id: string) => channels.find((c) => c.id === id)?.title ?? "ce canal";
  /** Canaux (pas les groupes) où le compte connecté publiera (versions sans boutons avec emojis animés). */
  const accountChannels = (() => {
    const ids: string[] = [];
    const add = (id: string) => {
      if (id && needsAccountFor(chatTypeOf(id)) && !ids.includes(id)) ids.push(id);
    };
    if (emoji.modeA === "account") channelIds.forEach(add);
    if (emoji.modeB === "account") channelIdsB.forEach(add);
    return ids.map((id) => ({ id, title: titleOf(id) }));
  })();
  /** Groupes qui recevront des emojis animés du bot lui-même. */
  const emojiGroups = (() => {
    const ids: string[] = [];
    const add = (id: string) => {
      if (id && !needsAccountFor(chatTypeOf(id)) && !ids.includes(id)) ids.push(id);
    };
    if (emoji.groupEmoji && hasCustomEmoji(text)) channelIds.forEach(add);
    if (emoji.groupEmoji && abActive && hasCustomEmoji(textB)) channelIdsB.forEach(add);
    return ids.map(titleOf);
  })();
  const problems = accountProblemsFor(status, accountChannels);
  const scheduleBlocked = emoji.account && hasAccountProblem(problems);
  const accountIds = accountChannels.map((c) => c.id);
  const toCheckKey = emoji.account ? channelsToCheck(status, accountIds).join(",") : "";

  /** « Vérifier » : relevé demandé au service d'arrière-plan, puis attente de sa réponse (la page n'est pas rechargée). */
  async function runCheck(ids: string[]) {
    if (!emojiActions) return;
    setCheck({ state: "checking" });
    try {
      const r = await emojiActions.checkAccount(ids);
      if (!r.ok) {
        if (alive.current) setCheck({ state: "error", error: r.error });
        return;
      }
      const deadline = Date.now() + CHECK_TIMEOUT_MS;
      while (alive.current && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, CHECK_POLL_MS));
        const s = await emojiActions.accountStatus();
        if (statusAnswered(s, r.requestedAt)) {
          if (alive.current) {
            setStatus(s);
            setCheck({ state: "idle" });
          }
          return;
        }
      }
      if (alive.current) setCheck({ state: "late" });
    } catch {
      if (alive.current)
        setCheck({ state: "error", error: "Vérification impossible : réessayez dans une minute." });
    }
  }
  // Canal jamais vérifié pour le compte connecté : la vérification part toute seule (une fois par liste de canaux).
  const autoCheck = useEffectEvent((key: string) => {
    if (!key || !emojiActions || check.state === "checking" || autoChecked.current.has(key)) return;
    autoChecked.current.add(key);
    void runCheck(key.split(","));
  });
  useEffect(() => {
    if (!toCheckKey) return;
    const t = setTimeout(() => autoCheck(toCheckKey), 600);
    return () => clearTimeout(t);
  }, [toCheckKey]);

  /** Lien d'offre créé : ajouté à la fin du texte de la version choisie. */
  function insertOfferLink(version: "A" | "B", html: string) {
    if (version === "B") setTextB((t) => appendToText(t, html));
    else setText((t) => appendToText(t, html));
  }
  // Bouton Offre sans campagne : refusé dans le navigateur avant l'envoi (la saisie reste à l'écran). Les messages
  // apparaissent après un premier essai et disparaissent dès que la campagne est choisie.
  const formRef = useRef<HTMLFormElement>(null);
  const [offerCheck, setOfferCheck] = useState(false);
  // Boutons retirés (message publié par le compte connecté) : absents de l'aperçu (celui d'un canal) ; rien à
  // compléter s'ils ne partent nulle part (ils restent publiés dans les groupes cochés).
  const keptRows = emoji.modeA === "account" ? [] : rows;
  const keptRowsB = emoji.modeB === "account" ? [] : rowsB;
  const offerIssues = isTemplate
    ? []
    : [
        ...offerButtonIssues(emoji.buttonsOffA ? [] : rows),
        ...(abActive ? offerButtonIssues(emoji.buttonsOffB ? [] : rowsB, { version: "B" }) : []),
      ];
  const shownOfferIssues = offerCheck ? offerIssues : [];
  const offerSummary = offerIssuesSummary(shownOfferIssues);

  /**
   * Avant l'envoi : un message (pas un modèle) dont un bouton Offre n'a pas de campagne est arrêté ici, avec la phrase
   * sous le choix de la campagne et la mise au point dessus. Sinon le serveur le refuserait et la page rechargée
   * perdrait le texte saisi. « Enregistrer le modèle » n'est pas concerné (`data-intent="template"`).
   */
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    if (isTemplate || submitter?.dataset.intent === "template") return;
    // Emojis animés et boutons : le choix est exigé (sinon le serveur refuserait et la saisie serait perdue).
    if (emoji.choiceMissing) {
      e.preventDefault();
      setChoiceCheck(true);
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLInputElement>("#emoji-buttons-choice input[type=radio]")
          ?.focus(),
      );
      return;
    }
    // Programmer un message que le compte connecté ne peut pas (encore) publier : arrêté ici, avec la raison.
    if (submitter?.dataset.intent === "schedule" && scheduleBlocked) {
      e.preventDefault();
      setAccountCheckShown(true);
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>("#account-blocked")?.focus(),
      );
      return;
    }
    if (offerIssues.length === 0) return;
    e.preventDefault();
    setOfferCheck(true);
    setShowButtons(true);
    const first = offerIssues[0]!;
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLSelectElement>(`[data-offer-slot="${offerSlot(first)}"] select`)
        ?.focus(),
    );
  }

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

  // « Contenu protégé » : Telegram réserve la protection d'un message aux bots (sans effet par le compte connecté).
  const protectOff = emoji.protect === "none";
  const modified = advancedModifiedCount({
    pinAfterSend,
    unpinPrevious,
    deleteAfterMinutes: deleteAfter,
    disableNotification,
    protectContent: protectContent && !protectOff,
    disableLinkPreview,
    language,
    abDelayMinutes: abActive && abMode === "same-channel" ? abDelay : undefined,
  });
  const summary = scheduleSummary({
    scheduledAt,
    channelCount: channelIds.length,
    ab: abActive ? { mode: abMode, delayMinutes: abDelay } : null,
  });

  // Repères {offre}, {canal}… laissés dans le texte (souvent un modèle) : un message de canal ne les remplace pas.
  const toComplete = isTemplate
    ? []
    : [
        ...new Set([
          ...placeholdersToComplete(text),
          ...(abActive ? placeholdersToComplete(textB) : []),
        ]),
      ];

  // Aperçu : sans boutons quand le compte publie, emojis normaux quand l'équipe garde les boutons.
  const previewHtml = emoji.modeA === "fallback" ? withFallbackEmojis(text) : text;
  const previewHtmlB = emoji.modeB === "fallback" ? withFallbackEmojis(textB) : textB;
  const preview = (
    <TelegramPreview html={previewHtml} buttons={keptRows} mediaCount={media.length} />
  );
  const previewB = (
    <TelegramPreview html={previewHtmlB} buttons={keptRowsB} mediaCount={mediaB.length} />
  );
  const canOfferLink = !!emojiActions && emoji.account;
  const offerVersions: Array<"A" | "B"> = [
    ...(emoji.modeA === "account" ? (["A"] as const) : []),
    ...(emoji.modeB === "account" ? (["B"] as const) : []),
  ];

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={onSubmit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      {initial.postId ? <input type="hidden" name="postId" value={initial.postId} /> : null}
      {initial.duplicatedFromId ? (
        <input type="hidden" name="duplicatedFromId" value={initial.duplicatedFromId} />
      ) : null}
      <input type="hidden" name="text" value={text} />
      <input type="hidden" name="mediaAssetIds" value={JSON.stringify(media.map((m) => m.id))} />
      <input type="hidden" name="buttons" value={JSON.stringify(rows)} />
      <input type="hidden" name="intent" value={intent} />
      {emoji.choiceOffered && emojiChoice ? (
        <input type="hidden" name="emojiButtonsChoice" value={emojiChoice} />
      ) : null}
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
            description="Ce que les membres liront. Sélectionnez un mot pour le mettre en gras, en italique ou en lien."
          >
            <RichTextEditor
              id="post-text"
              value={text}
              onChange={setText}
              label={abActive ? "Texte de la version A" : "Texte du message"}
              hasMedia={media.length > 0}
              // Repères à compléter : surlignés dans le texte ; la phrase est l'alerte au-dessus de « Programmer ».
              warnUnresolved="highlight"
              rows={10}
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
            <EmojiPublishPanel
              isTemplate={isTemplate || intent === "template"}
              state={emoji}
              choice={emojiChoice}
              onChoice={(c) => setEmojiChoice(c)}
              choiceError={choiceCheck}
              problems={problems}
              accountChannels={accountChannels}
              status={status}
              check={check}
              onCheck={() => void runCheck(accountIds)}
              canCheck={!!emojiActions}
              onAddOfferLink={canOfferLink ? () => setShowOfferLink(true) : undefined}
              offerLinkOpen={showOfferLink}
              groupTitles={emojiGroups}
            />
            {/* Téléphone : l'aperçu juste sous le texte (sur ordinateur, il est à droite). */}
            <div className="lg:hidden">
              <p className="mb-2 flex flex-wrap items-center gap-2 text-note font-medium text-muted-foreground">
                Aperçu tel que les membres le verront
                {emoji.modeA === "account" ? <PublisherBadge publisher="ACCOUNT" /> : null}
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
              <Button
                type="button"
                variant="outline"
                disabled={emoji.buttonsOffA}
                title={
                  emoji.buttonsOffA
                    ? "Pas de boutons : ce message sera publié par votre compte Telegram (emojis animés)."
                    : undefined
                }
                onClick={() => setShowButtons(true)}
              >
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
              {emoji.modeA === "account" ? (
                <p className="text-body font-medium text-foreground">
                  {!emoji.buttonsOffA
                    ? "Ces boutons ne partiront que dans les groupes : dans les canaux, ce message est publié par votre compte Telegram, sans boutons."
                    : rows.length > 0
                      ? "Ces boutons ne seront pas publiés : un message publié par votre compte Telegram n'a pas de boutons."
                      : "Pas de boutons : ce message sera publié par votre compte Telegram (emojis animés)."}
                </p>
              ) : null}
              <ButtonsEditor
                rows={rows}
                setRows={setRows}
                campaigns={campaigns}
                campaignOptions={campaignOptions}
                issues={shownOfferIssues.filter((i) => i.version === "A")}
                disabled={emoji.buttonsOffA}
              />
            </FormSection>
          </div>
        ) : null}

        {canOfferLink && showOfferLink ? (
          <TextOfferLink
            campaigns={campaigns}
            campaignOptions={campaignOptions}
            versions={offerVersions}
            createLink={emojiActions!.createOfferLink}
            onInsert={insertOfferLink}
            onClose={() => setShowOfferLink(false)}
          />
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
                <RichTextEditor
                  id="post-text-b"
                  value={textB}
                  onChange={setTextB}
                  label="Texte de la version B"
                  hasMedia={mediaB.length > 0}
                  warnUnresolved="highlight"
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
                  version="B"
                  issues={shownOfferIssues.filter((i) => i.version === "B")}
                  disabled={emoji.buttonsOffB}
                />
                {emoji.modeB === "account" ? (
                  <p className="text-note text-muted-foreground">
                    {emoji.buttonsOffB
                      ? "Version B publiée par votre compte Telegram (emojis animés) : sans boutons."
                      : "Version B publiée par votre compte Telegram (emojis animés) dans les canaux, sans boutons ; ses boutons partent dans les groupes."}
                  </p>
                ) : null}
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
              disabled={protectOff}
              hint={
                protectOff
                  ? ACCOUNT_PROTECT_NOTE
                  : emoji.protect === "partial"
                    ? "Pas de transfert ni de capture du message. Ne s'applique pas aux messages publiés par votre compte Telegram : avec des emojis animés, Telegram ne permet pas de les protéger."
                    : "Pas de transfert ni de capture du message."
              }
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
          {offerSummary ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>Un bouton Offre n&apos;a pas de campagne</AlertTitle>
              <AlertDescription>{offerSummary}</AlertDescription>
            </Alert>
          ) : null}
          {accountCheckShown && scheduleBlocked ? (
            <Alert variant="destructive" id="account-blocked" tabIndex={-1}>
              <TriangleAlert aria-hidden />
              <AlertTitle>Pas encore programmable</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>
                  Ce message sera publié par votre compte Telegram :{" "}
                  {problems.global ??
                    problems.channels.map((c) => `« ${c.title} » : ${c.problem}`).join(" ")}
                </p>
                <p>
                  Corrigez-le (bloc des emojis animés plus haut, « Vérifier »), ou enregistrez le
                  message en brouillon en attendant.
                </p>
                <TelegramSettingsLink />
              </AlertDescription>
            </Alert>
          ) : null}
          {toComplete.length > 0 ? (
            <Alert variant="warning" role="status">
              <TriangleAlert aria-hidden />
              <AlertTitle>Des mots restent à compléter</AlertTitle>
              <AlertDescription>
                {toComplete.map((k) => `{${k}}`).join(", ")}{" "}
                {toComplete.length > 1 ? "partiraient tels quels" : "partirait tel quel"} dans le
                canal : remplacez-{toComplete.length > 1 ? "les" : "le"} par les vrais mots avant de
                programmer.
              </AlertDescription>
            </Alert>
          ) : null}
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
              <Button
                type="submit"
                variant="outline"
                data-intent="template"
                onClick={() => setIntent("template")}
              >
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
                <Button type="submit" data-intent="template" onClick={() => setIntent("template")}>
                  Enregistrer le modèle
                </Button>
              ) : (
                <>
                  {!initial.postId && !ab && !namingTemplate ? (
                    <Button type="button" variant="ghost" onClick={() => setNamingTemplate(true)}>
                      Enregistrer comme modèle
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    variant="outline"
                    data-intent="draft"
                    onClick={() => setIntent("draft")}
                  >
                    Enregistrer en brouillon
                  </Button>
                  <Button
                    type="submit"
                    data-intent="schedule"
                    onClick={() => setIntent("schedule")}
                  >
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
            <p className="mb-2 flex flex-wrap items-center gap-2 text-note font-medium text-muted-foreground">
              {abActive ? "Aperçu — version A" : "Aperçu tel que les membres le verront"}
              {emoji.modeA === "account" ? <PublisherBadge publisher="ACCOUNT" /> : null}
            </p>
            {preview}
          </div>
          {abActive ? (
            <div>
              <p className="mb-2 flex flex-wrap items-center gap-2 text-note font-medium text-muted-foreground">
                Aperçu — version B
                {emoji.modeB === "account" ? <PublisherBadge publisher="ACCOUNT" /> : null}
              </p>
              {previewB}
            </div>
          ) : null}
        </div>
      </aside>
    </form>
  );
}
