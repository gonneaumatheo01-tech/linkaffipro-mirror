"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bold, Italic, Link2, Plus, Strikethrough, Trash2, Underline, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TelegramPreview } from "./telegram-preview";
import { BUTTON_TYPE_LABELS, type PostButton, type PostButtonRow } from "@/lib/posts/buttons";

export type ChannelOption = { id: string; title: string; language: string };
export type CategoryOption = { id: string; name: string; color: string };
export type CampaignOption = { id: string; name: string; programName: string };
export type MediaItem = { id: string; filename: string; mimeType: string; size: number; warning?: string };

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
};

const inputCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

export function PostForm({ action, channels, categories, campaigns, initial, singleChannel }: Props) {
  const [text, setText] = useState(initial.text);
  const [media, setMedia] = useState<MediaItem[]>(initial.media);
  const [rows, setRows] = useState<PostButtonRow[]>(initial.buttons);
  const [channelIds, setChannelIds] = useState<string[]>(initial.channelIds);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [intent, setIntent] = useState<"draft" | "schedule" | "template">(initial.isTemplate ? "template" : "draft");
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
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const data = (await res.json()) as { files?: MediaItem[] & Array<{ error?: string }>; error?: string };
      if (!res.ok || !data.files) throw new Error(data.error ?? "Téléversement impossible.");
      const errors = data.files.filter((f) => (f as { error?: string }).error).map((f) => `${f.filename} : ${(f as { error?: string }).error}`);
      if (errors.length) setUploadError(errors.join(" · "));
      setMedia((m) => [...m, ...data.files!.filter((f) => f.id && !m.some((x) => x.id === f.id))]);
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
  function setButton(r: number, c: number, patch: Partial<PostButton>) {
    setRows((rs) => rs.map((row, i) => (i === r ? row.map((b, j) => (j === c ? { ...b, ...patch } : b)) : row)));
  }
  const isImage = (m: MediaItem) => m.mimeType.startsWith("image/") && m.size <= 20 * 1024 * 1024;

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {initial.postId ? <input type="hidden" name="postId" value={initial.postId} /> : null}
      {initial.duplicatedFromId ? <input type="hidden" name="duplicatedFromId" value={initial.duplicatedFromId} /> : null}
      <input type="hidden" name="text" value={text} />
      <input type="hidden" name="mediaAssetIds" value={JSON.stringify(media.map((m) => m.id))} />
      <input type="hidden" name="buttons" value={JSON.stringify(rows)} />
      <input type="hidden" name="intent" value={intent} />
      {channelIds.map((id) => (
        <input key={id} type="hidden" name="channelIds" value={id} />
      ))}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{singleChannel ? "Canal" : "Canaux"}</CardTitle>
            <CardDescription>{singleChannel ? "Le canal de ce message." : "Un message est créé par canal coché."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {channels.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <input
                  type={singleChannel ? "radio" : "checkbox"}
                  checked={channelIds.includes(c.id)}
                  onChange={(e) => setChannelIds((ids) => (singleChannel ? [c.id] : e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                />
                {c.title}
              </label>
            ))}
            {channels.length === 0 ? <p className="text-sm text-muted-foreground">Aucun canal actif avec un bot administrateur.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Texte</CardTitle>
            <CardDescription>Mise en forme Telegram (HTML). 4096 caractères maximum, 1024 avec un média.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => wrap("<b>", "</b>")} title="Gras"><Bold className="size-4" /></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => wrap("<i>", "</i>")} title="Italique"><Italic className="size-4" /></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => wrap("<u>", "</u>")} title="Souligné"><Underline className="size-4" /></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => wrap("<s>", "</s>")} title="Barré"><Strikethrough className="size-4" /></Button>
              <Button type="button" size="sm" variant="outline" onClick={insertLink} title="Lien"><Link2 className="size-4" /></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => wrap("<tg-spoiler>", "</tg-spoiler>")} title="Spoiler"><EyeOff className="size-4" /></Button>
              {["🔥", "🎁", "💰", "⚡", "✅", "👉", "🎰", "⚽", "❤️"].map((e) => (
                <Button key={e} type="button" size="sm" variant="ghost" onClick={() => wrap(e, "")}>{e}</Button>
              ))}
            </div>
            <Textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Votre message…" className="font-mono text-sm" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Médias</CardTitle>
            <CardDescription>Image, vidéo, gif ou document. Plusieurs médias = album (les boutons suivent dans un second message). 50 Mo maximum.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFiles(e.dataTransfer.files);
              }}
            >
              Glissez-déposez ici ou <label className="cursor-pointer text-primary underline">choisissez des fichiers<input type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} /></label>
              {uploading ? <div className="mt-1 text-xs">Téléversement…</div> : null}
            </div>
            {uploadError ? <p className="text-sm text-destructive">{uploadError}</p> : null}
            {media.length > 0 ? (
              <ul className="space-y-2">
                {media.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                    {isImage(m) ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/media/${m.id}`} alt="" className="size-12 rounded object-cover" /> : <div className="flex size-12 items-center justify-center rounded bg-muted text-[10px] uppercase">{m.mimeType.split("/")[0]}</div>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{m.filename}</div>
                      <div className="text-xs text-muted-foreground">{(m.size / 1024 / 1024).toFixed(1)} Mo{m.warning ? ` · ${m.warning}` : ""}</div>
                    </div>
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => setMedia((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Boutons</CardTitle>
            <CardDescription>Lien direct, lien traqué (clics comptés) ou offre personnalisée (lien Link Affi avec sub-ID par membre).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row, r) => (
              <div key={r} className="space-y-2 rounded-md border p-2">
                {row.map((b, c) => (
                  <div key={c} className="grid gap-2 sm:grid-cols-[1fr_180px_1fr_auto]">
                    <Input value={b.text} placeholder="Libellé" maxLength={64} onChange={(e) => setButton(r, c, { text: e.target.value })} />
                    <select className={inputCls} value={b.type} onChange={(e) => setButton(r, c, { type: e.target.value as PostButton["type"], trackingLinkId: undefined, slug: undefined })}>
                      {(Object.keys(BUTTON_TYPE_LABELS) as PostButton["type"][]).map((t) => (
                        <option key={t} value={t}>{BUTTON_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    {b.type === "OFFER" ? (
                      <select className={inputCls} value={b.affiliateCampaignId ?? ""} onChange={(e) => setButton(r, c, { affiliateCampaignId: e.target.value })}>
                        <option value="">— campagne Link Affi —</option>
                        {campaigns.map((k) => (
                          <option key={k.id} value={k.id}>{k.programName} · {k.name}</option>
                        ))}
                      </select>
                    ) : (
                      <Input value={b.url ?? ""} placeholder="https://…" onChange={(e) => setButton(r, c, { url: e.target.value })} />
                    )}
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => setRows((rs) => rs.map((x, i) => (i === r ? x.filter((_, j) => j !== c) : x)).filter((x) => x.length > 0))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs.map((x, i) => (i === r ? [...x, { text: "", type: "URL" }] : x)))}><Plus className="size-4" /> Bouton sur cette ligne</Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, [{ text: "", type: "URL" }]])}><Plus className="size-4" /> Nouvelle ligne de boutons</Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Programmation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {intent !== "template" ? (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Date et heure (Paris)</Label>
                <Input id="scheduledAt" name="scheduledAt" type="datetime-local" defaultValue={initial.scheduledAt} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="templateName">Nom du modèle</Label>
                <Input id="templateName" name="templateName" defaultValue={initial.templateName} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="categoryId">Catégorie</Label>
              <select id="categoryId" name="categoryId" defaultValue={initial.categoryId} className={inputCls}>
                <option value="">— aucune —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">Langue</Label>
              <Input id="language" name="language" defaultValue={initial.language} maxLength={5} className="w-20" />
            </div>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="pinAfterSend" defaultChecked={initial.pinAfterSend} /> Épingler après envoi</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="unpinPrevious" defaultChecked={initial.unpinPrevious} /> Désépingler le précédent</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="disableNotification" defaultChecked={initial.disableNotification} /> Silencieux (sans notification)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="protectContent" defaultChecked={initial.protectContent} /> Contenu protégé (pas de transfert)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="disableLinkPreview" defaultChecked={initial.disableLinkPreview} /> Sans aperçu de lien</label>
              <label className="flex items-center gap-2">Supprimer après <Input name="deleteAfterMinutes" type="number" min={1} defaultValue={initial.deleteAfterMinutes} className="h-7 w-20" /> minutes</label>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {initial.isTemplate ? (
                <Button type="submit" onClick={() => setIntent("template")}>Enregistrer le modèle</Button>
              ) : (
                <>
                  <Button type="submit" onClick={() => setIntent("schedule")}>Programmer</Button>
                  <Button type="submit" variant="outline" onClick={() => setIntent("draft")}>Enregistrer en brouillon</Button>
                  {!initial.postId ? <Button type="submit" variant="ghost" onClick={() => setIntent("template")}>Enregistrer comme modèle</Button> : null}
                </>
              )}
            </div>
          </CardContent>
        </Card>
        <div>
          <p className="mb-2 text-sm font-medium">Aperçu</p>
          <TelegramPreview html={text} buttons={rows} mediaCount={media.length} />
        </div>
      </div>
    </form>
  );
}
