"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Italic,
  Link2,
  Plus,
  Strikethrough,
  Trash2,
  Underline,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/admin/help-tip";
import { OfferPicker } from "@/components/campaigns/offer-picker";
import { TelegramPreview } from "./telegram-preview";
import { BUTTON_TYPE_LABELS, type PostButton, type PostButtonRow } from "@/lib/posts/buttons";
import {
  AB_DEFAULT_DELAY_MINUTES,
  AB_MAX_DELAY_MINUTES,
  AB_MIN_DELAY_MINUTES,
} from "@/lib/posts/ab";
import { nextOccurrence, toParisLocalInput } from "@/lib/posts/time";
import type { BestSlot } from "@/lib/besthours/types";

export type ChannelOption = { id: string; title: string; language: string };
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
  duplicatedFromId?: string;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  channels: ChannelOption[];
  categories: CategoryOption[];
  campaigns: CampaignOption[];
  initial: PostFormValues;
  /** Édition : un seul canal. */
  singleChannel?: boolean;
  /**
   * Créneaux recommandés par canal puis par catégorie (`all` + identifiants de catégorie), calculés chaque nuit
   * par le worker (fiche canal → Meilleurs horaires).
   */
  bestSlots?: Record<string, Record<string, BestSlot>>;
  /** Création seulement : proposer un test A/B (deux versions publiées, comparées ensuite). */
  abAllowed?: boolean;
};

const inputCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";

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
  { title: "Gras", icon: <Bold className="size-4" />, open: "<b>", close: "</b>" },
  { title: "Italique", icon: <Italic className="size-4" />, open: "<i>", close: "</i>" },
  { title: "Souligné", icon: <Underline className="size-4" />, open: "<u>", close: "</u>" },
  { title: "Barré", icon: <Strikethrough className="size-4" />, open: "<s>", close: "</s>" },
  { title: "Insérer un lien", icon: <Link2 className="size-4" />, open: "", close: "", link: true },
  {
    title: "Texte masqué (spoiler)",
    icon: <EyeOff className="size-4" />,
    open: "<tg-spoiler>",
    close: "</tg-spoiler>",
  },
];
const EMOJIS = ["🔥", "🎁", "💰", "⚡", "✅", "👉", "🎰", "⚽", "❤️"];

/** Barre de mise en forme + zone de texte (version A ou B). */
function TextEditor({
  text,
  setText,
  label,
  rows = 10,
}: {
  text: string;
  setText: (t: string) => void;
  label: string;
  rows?: number;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  function wrap(open: string, close: string) {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = text.slice(s, e) || "texte";
    const next = text.slice(0, s) + open + sel + close + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + open.length, s + open.length + sel.length);
    });
  }
  function insertLink() {
    const url = window.prompt("Adresse du lien (https://…)");
    if (!url) return;
    wrap(`<a href="${url.replace(/"/g, "%22")}">`, "</a>");
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label={`Mise en forme : ${label}`}>
        {TEXT_TOOLS.map((t) => (
          <Button
            key={t.title}
            type="button"
            size="sm"
            variant="outline"
            className="max-md:h-10"
            onClick={() => (t.link ? insertLink() : wrap(t.open, t.close))}
            title={t.title}
            aria-label={t.title}
          >
            {t.icon}
          </Button>
        ))}
        {EMOJIS.map((e) => (
          <Button
            key={e}
            type="button"
            size="sm"
            variant="ghost"
            className="max-md:h-10"
            aria-label={`Insérer ${e}`}
            onClick={() => wrap(e, "")}
          >
            {e}
          </Button>
        ))}
      </div>
      <Textarea
        ref={ta}
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        rows={rows}
        placeholder="Votre message…"
        className="font-mono text-sm"
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
        className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFiles(e.dataTransfer.files);
        }}
      >
        Glissez-déposez ici ou{" "}
        <label className="cursor-pointer text-primary underline">
          choisissez des fichiers
          <input
            type="file"
            multiple
            className="hidden"
            aria-label={label}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
        {uploading ? <div className="mt-1 text-xs">Téléversement…</div> : null}
      </div>
      {uploadError ? <p className="text-sm text-destructive">{uploadError}</p> : null}
      {media.length > 0 ? (
        <ul className="space-y-2">
          {media.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 rounded-md border p-2 text-sm">
              {isImage(m) ? (
                // Aperçu servi par notre propre route (session requise) : pas d'optimisation next/image nécessaire.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${m.id}`} alt="" className="size-12 rounded object-cover" />
              ) : (
                <div className="flex size-12 items-center justify-center rounded bg-muted text-[10px] uppercase">
                  {m.mimeType.split("/")[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{m.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {(m.size / 1024 / 1024).toFixed(1)} Mo{m.warning ? ` · ${m.warning}` : ""}
                </div>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="max-md:size-10"
                aria-label={`Monter ${m.filename}`}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="max-md:size-10"
                aria-label={`Descendre ${m.filename}`}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="max-md:size-10"
                aria-label={`Retirer ${m.filename}`}
                onClick={() => setMedia((x) => x.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
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
  prefix = "",
}: {
  rows: PostButtonRow[];
  setRows: Dispatch<SetStateAction<PostButtonRow[]>>;
  campaigns: CampaignOption[];
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
        <div key={r} className="space-y-2 rounded-md border p-2">
          {row.map((b, c) => (
            <div key={c} className="grid gap-2 sm:grid-cols-[1fr_180px_1fr_auto]">
              <Input
                value={b.text}
                aria-label={`${prefix}Libellé du bouton`}
                placeholder="Libellé"
                maxLength={64}
                className="max-md:h-10"
                onChange={(e) => setButton(r, c, { text: e.target.value })}
              />
              <select
                className={inputCls}
                aria-label={`${prefix}Type de bouton`}
                value={b.type}
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
              </select>
              {b.type === "OFFER" ? (
                <OfferPicker
                  value={{ campaignId: b.campaignId, affiliateCampaignId: b.affiliateCampaignId }}
                  onChange={(patch) => setButton(r, c, patch)}
                  affiliateCampaigns={campaigns}
                  label={`${prefix}Campagne du bouton Offre`}
                />
              ) : (
                <Input
                  value={b.url ?? ""}
                  aria-label={`${prefix}Adresse du bouton`}
                  placeholder="https://…"
                  className="max-md:h-10"
                  onChange={(e) => setButton(r, c, { url: e.target.value })}
                />
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="max-md:size-10"
                aria-label={`${prefix}Supprimer ce bouton`}
                onClick={() =>
                  setRows((rs) =>
                    rs
                      .map((x, i) => (i === r ? x.filter((_, j) => j !== c) : x))
                      .filter((x) => x.length > 0),
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="max-md:h-10"
            onClick={() =>
              setRows((rs) => rs.map((x, i) => (i === r ? [...x, { text: "", type: "URL" }] : x)))
            }
          >
            <Plus className="size-4" /> Bouton sur cette ligne
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="max-md:h-10"
        onClick={() => setRows((rs) => [...rs, [{ text: "", type: "URL" }]])}
      >
        <Plus className="size-4" /> Nouvelle ligne de boutons
      </Button>
    </div>
  );
}

export function PostForm({
  action,
  channels,
  categories,
  campaigns,
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
  const [intent, setIntent] = useState<"draft" | "schedule" | "template">(
    initial.isTemplate ? "template" : "draft",
  );
  // Test A/B (création seulement).
  const [ab, setAb] = useState(false);
  const [abMode, setAbMode] = useState<"same-channel" | "other-channel">("same-channel");
  const [abChannelId, setAbChannelId] = useState("");
  const [abDelay, setAbDelay] = useState(String(AB_DEFAULT_DELAY_MINUTES));
  const [textB, setTextB] = useState("");
  const [mediaB, setMediaB] = useState<MediaItem[]>([]);
  const [rowsB, setRowsB] = useState<PostButtonRow[]>([]);
  const abActive = abAllowed && ab && intent !== "template";

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

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_380px]">
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

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{singleChannel ? "Canal" : "Canaux"}</CardTitle>
            <CardDescription>
              {singleChannel
                ? "Le canal de ce message."
                : "Un message distinct est créé pour chaque canal coché."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {channels.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <input
                  type={singleChannel ? "radio" : "checkbox"}
                  checked={channelIds.includes(c.id)}
                  onChange={(e) =>
                    setChannelIds((ids) =>
                      singleChannel
                        ? [c.id]
                        : e.target.checked
                          ? [...ids, c.id]
                          : ids.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.title}
              </label>
            ))}
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun canal actif : ajoutez d&apos;abord un bot comme administrateur d&apos;un canal
                (page Canaux).
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{abActive ? "Texte — version A" : "Texte"}</CardTitle>
            <CardDescription>
              Mise en forme Telegram : gras, italique, lien… via les boutons. 4 096 caractères
              maximum, 1 024 avec un média.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TextEditor text={text} setText={setText} label="Texte du message" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {abActive ? "Médias — version A" : "Médias"}
            </CardTitle>
            <CardDescription>
              Image, vidéo, gif ou document. Plusieurs médias = album (les boutons suivent dans un
              second message). 50 Mo maximum.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MediaEditor media={media} setMedia={setMedia} label="Fichiers du message" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {abActive ? "Boutons — version A" : "Boutons"}
            </CardTitle>
            <CardDescription>
              Lien direct, lien traqué (clics comptés) ou offre (lien Link Affi avec un identifiant
              de suivi (sub-ID) propre à chaque membre : c&apos;est ce qui rattache inscriptions et
              dépôts au membre).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ButtonsEditor rows={rows} setRows={setRows} campaigns={campaigns} />
          </CardContent>
        </Card>

        {abAllowed && intent !== "template" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test A/B (optionnel)</CardTitle>
              <CardDescription>
                Deux versions du message sont publiées ; la page de comparaison montre vues,
                réactions, clics et inscriptions de chacune et désigne la gagnante provisoire.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ab}
                  onChange={(e) => setAb(e.target.checked)}
                  className="mt-0.5 size-4"
                />{" "}
                Comparer deux versions de ce message (A et B).
              </label>
              {ab ? (
                <div className="space-y-4 rounded-md border p-3">
                  <fieldset className="space-y-2 text-sm">
                    <legend className="font-medium">Où publier la version B ?</legend>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="abModeChoice"
                        checked={abMode === "same-channel"}
                        onChange={() => setAbMode("same-channel")}
                      />{" "}
                      Même canal, B publiée{" "}
                      <Input
                        type="number"
                        min={AB_MIN_DELAY_MINUTES}
                        max={AB_MAX_DELAY_MINUTES}
                        value={abDelay}
                        aria-label="Minutes entre la version A et la version B"
                        onChange={(e) => setAbDelay(e.target.value)}
                        className="h-8 w-20"
                      />{" "}
                      minutes après A
                    </label>
                    <label className="flex flex-wrap items-center gap-2">
                      <input
                        type="radio"
                        name="abModeChoice"
                        checked={abMode === "other-channel"}
                        onChange={() => setAbMode("other-channel")}
                      />{" "}
                      Dans un autre canal, à la même heure :{" "}
                      <select
                        aria-label="Canal de la version B"
                        value={abChannelId}
                        disabled={abMode !== "other-channel"}
                        onChange={(e) => setAbChannelId(e.target.value)}
                        className="h-8 rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="">— choisir —</option>
                        {channels
                          .filter((c) => !channelIds.includes(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </fieldset>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Texte — version B</p>
                    <TextEditor
                      text={textB}
                      setText={setTextB}
                      label="Texte de la version B"
                      rows={6}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Médias — version B</p>
                    <MediaEditor
                      media={mediaB}
                      setMedia={setMediaB}
                      label="Fichiers de la version B"
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Boutons — version B</p>
                    <ButtonsEditor
                      rows={rowsB}
                      setRows={setRowsB}
                      campaigns={campaigns}
                      prefix="Version B : "
                    />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Programmation</CardTitle>
            <CardDescription>
              « Programmer » envoie à la date choisie ; « Enregistrer en brouillon » garde le
              message sans l&apos;envoyer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {intent !== "template" ? (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Date et heure (Europe/Paris)</Label>
                <Input
                  id="scheduledAt"
                  name="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="max-md:h-10"
                />
                {slotInfo ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                    <span>
                      Meilleur créneau pour {slotInfo.channelTitle}
                      {slotInfo.categoryName
                        ? ` et la catégorie ${slotInfo.categoryName}`
                        : ""} : <strong>{slotInfo.slot.label}</strong>{" "}
                      <HelpTip label="Aide : meilleur créneau">
                        Calculé chaque nuit sur les messages envoyés des 8 dernières semaines (taux
                        de clic, puis réactions). Détail dans la fiche du canal, onglet « Meilleurs
                        horaires ».
                      </HelpTip>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 max-md:h-10"
                      onClick={applyBestSlot}
                    >
                      Utiliser
                    </Button>
                  </div>
                ) : null}
                {abActive ? (
                  <p className="text-xs text-muted-foreground">
                    Version A à cette date ;{" "}
                    {abMode === "same-channel"
                      ? `version B ${abDelay || AB_DEFAULT_DELAY_MINUTES} minutes plus tard dans le même canal.`
                      : "version B à la même heure dans l'autre canal."}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="templateName">Nom du modèle</Label>
                <Input
                  id="templateName"
                  name="templateName"
                  defaultValue={initial.templateName}
                  className="max-md:h-10"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="categoryId">Catégorie</Label>
              <select
                id="categoryId"
                name="categoryId"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={inputCls}
              >
                <option value="">— aucune —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Langue (code à deux lettres)</Label>
              <Input
                id="language"
                name="language"
                defaultValue={initial.language}
                maxLength={5}
                className="w-24 max-md:h-10"
              />
            </div>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="pinAfterSend" defaultChecked={initial.pinAfterSend} />{" "}
                Épingler après envoi
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="unpinPrevious"
                  defaultChecked={initial.unpinPrevious}
                />{" "}
                Désépingler le précédent
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="disableNotification"
                  defaultChecked={initial.disableNotification}
                />{" "}
                Silencieux (sans notification)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="protectContent"
                  defaultChecked={initial.protectContent}
                />{" "}
                Contenu protégé (pas de transfert)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="disableLinkPreview"
                  defaultChecked={initial.disableLinkPreview}
                />{" "}
                Sans aperçu de lien
              </label>
              <label className="flex items-center gap-2">
                Supprimer du canal après{" "}
                <Input
                  name="deleteAfterMinutes"
                  aria-label="Supprimer du canal après (minutes)"
                  type="number"
                  min={1}
                  defaultValue={initial.deleteAfterMinutes}
                  className="h-10 w-20 md:h-7"
                />{" "}
                minutes
              </label>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {initial.isTemplate ? (
                <Button type="submit" className="max-md:h-10" onClick={() => setIntent("template")}>
                  Enregistrer le modèle
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    className="max-md:h-10"
                    onClick={() => setIntent("schedule")}
                  >
                    {abActive ? "Programmer le test A/B" : "Programmer"}
                  </Button>
                  <Button
                    type="submit"
                    variant="outline"
                    className="max-md:h-10"
                    onClick={() => setIntent("draft")}
                  >
                    Enregistrer en brouillon
                  </Button>
                  {!initial.postId && !ab ? (
                    <Button
                      type="submit"
                      variant="ghost"
                      className="max-md:h-10"
                      onClick={() => setIntent("template")}
                    >
                      Enregistrer comme modèle
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </CardContent>
        </Card>
        <div>
          <p className="mb-2 text-sm font-medium">
            {abActive ? "Aperçu — version A" : "Aperçu tel que les membres le verront"}
          </p>
          <TelegramPreview html={text} buttons={rows} mediaCount={media.length} />
        </div>
        {abActive ? (
          <div>
            <p className="mb-2 text-sm font-medium">Aperçu — version B</p>
            <TelegramPreview html={textB} buttons={rowsB} mediaCount={mediaB.length} />
          </div>
        ) : null}
      </div>
    </form>
  );
}
