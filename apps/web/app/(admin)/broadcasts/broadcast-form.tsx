"use client";

import { useMemo, useState } from "react";
import { SPEND_LEVELS, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import type { PostButton, PostButtonRow } from "@/lib/posts/buttons";

export type BroadcastOptions = {
  bots: Array<{ id: string; name: string; username: string }>;
  channels: Array<{ id: string; title: string }>;
  inviteLinks: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  media: Array<{ id: string; filename: string; mimeType: string }>;
  affiliateCampaigns: Array<{ id: string; name: string; programName: string }>;
};

const STATUSES = ["REQUESTED", "PENDING_GATE", "SCHEDULED", "APPROVED", "LEFT", "KICKED", "EXPIRED"] as const;
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = { REQUESTED: "Demande", PENDING_GATE: "En attente du gate", SCHEDULED: "Acceptation planifiée", APPROVED: "Accepté", LEFT: "Parti", KICKED: "Exclu", EXPIRED: "Expiré" };

function CheckList({ name, items, label }: { name: string; items: Array<{ id: string; label: string }>; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-1">
            <input type="checkbox" name={name} value={i.id} /> {i.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function wrap(textarea: HTMLTextAreaElement | null, open: string, close: string, setText: (t: string) => void) {
  if (!textarea) return;
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const next = value.slice(0, s) + open + value.slice(s, e) + close + value.slice(e);
  setText(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(s + open.length, e + open.length);
  });
}

export function BroadcastForm({ options, defaultScheduledAt }: { options: BroadcastOptions; defaultScheduledAt: string }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PostButtonRow[]>([]);
  const [botId, setBotId] = useState(options.bots[0]?.id ?? "");
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [ta, setTa] = useState<HTMLTextAreaElement | null>(null);
  const previewButtons = useMemo(() => rows.map((r) => r.map((b) => ({ text: b.text }))), [rows]);

  const updateButton = (ri: number, bi: number, patch: Partial<PostButton>) =>
    setRows((prev) => prev.map((r, i) => (i === ri ? r.map((b, j) => (j === bi ? { ...b, ...patch } : b)) : r)));

  async function countTargets(form: HTMLFormElement) {
    setCounting(true);
    try {
      const fd = new FormData(form);
      const list = (k: string) => fd.getAll(k).map(String);
      const segment = {
        channelIds: list("channelIds"),
        membershipStatuses: list("membershipStatuses"),
        spendLevels: list("spendLevels"),
        inviteLinkIds: list("inviteLinkIds"),
        campaignIds: list("campaignIds"),
        languages: String(fd.get("languages") ?? "").split(/[,\s]+/).filter(Boolean),
        inactiveDays: String(fd.get("inactiveDays") ?? ""),
        clickedCategoryIds: list("clickedCategoryIds"),
        tags: String(fd.get("tags") ?? "").split(/[,\s]+/).filter(Boolean),
      };
      const res = await fetch("/broadcasts/count", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: fd.get("botId"), segment }) });
      const data = (await res.json()) as { count?: number };
      setCount(typeof data.count === "number" ? data.count : null);
    } finally {
      setCounting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Envoi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nom interne</Label>
                <Input id="name" name="name" required maxLength={120} placeholder="Relance bonus week-end" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="botId">Bot expéditeur</Label>
                <select id="botId" name="botId" value={botId} onChange={(e) => setBotId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  {options.bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} (@{b.username})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Destinataires (segment)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Sans filtre : tous les membres qui peuvent recevoir un message privé de ce bot. Les filtres se cumulent.</p>
            <CheckList name="channelIds" label="Canaux" items={options.channels.map((c) => ({ id: c.id, label: c.title }))} />
            <CheckList name="membershipStatuses" label="Statut d'adhésion" items={STATUSES.map((s) => ({ id: s, label: STATUS_LABELS[s] }))} />
            <CheckList name="spendLevels" label="Niveau de dépense" items={SPEND_LEVELS.map((l) => ({ id: l, label: SPEND_LEVEL_LABELS[l] }))} />
            <CheckList name="inviteLinkIds" label="Lien d'entrée (pub)" items={options.inviteLinks.map((l) => ({ id: l.id, label: l.name }))} />
            <CheckList name="campaignIds" label="Pub" items={options.campaigns.map((c) => ({ id: c.id, label: c.name }))} />
            <CheckList name="clickedCategoryIds" label="A cliqué un message de la catégorie" items={options.categories.map((c) => ({ id: c.id, label: c.name }))} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="languages">Langues (fr, en…)</Label>
                <Input id="languages" name="languages" placeholder="fr, en" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inactiveDays">Inactifs depuis (jours)</Label>
                <Input id="inactiveDays" name="inactiveDays" type="number" min={1} placeholder="ex. 7" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Étiquettes</Label>
                <Input id="tags" name="tags" placeholder="vip, test" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={counting} onClick={(e) => void countTargets((e.currentTarget as HTMLButtonElement).form!)}>
                {counting ? "Comptage…" : "Compter les destinataires"}
              </Button>
              {count !== null ? <span className="text-sm">{count} destinataire{count > 1 ? "s" : ""} joignable{count > 1 ? "s" : ""}</span> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1">
              {[
                ["B", "<b>", "</b>"],
                ["I", "<i>", "</i>"],
                ["S", "<u>", "</u>"],
                ["Barré", "<s>", "</s>"],
                ["Lien", '<a href="https://">', "</a>"],
                ["Spoiler", "<tg-spoiler>", "</tg-spoiler>"],
              ].map(([l, o, c]) => (
                <Button key={l} type="button" size="sm" variant="outline" onClick={() => wrap(ta, o!, c!, setText)}>
                  {l}
                </Button>
              ))}
            </div>
            <textarea ref={setTa} name="text" value={text} onChange={(e) => setText(e.target.value)} rows={8} required className="w-full rounded-md border bg-background p-3 font-mono text-sm" placeholder="Texte du message (HTML Telegram : b, i, u, s, a, code, tg-spoiler)" />
            <div className="space-y-2">
              <Label htmlFor="mediaAssetId">Média (optionnel)</Label>
              <select id="mediaAssetId" name="mediaAssetId" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">— aucun —</option>
                {options.media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Le média est mémorisé avec l&apos;envoi ; les messages privés partent aujourd&apos;hui en texte + boutons (envoi du média en privé prévu).</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Boutons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row, ri) => (
              <div key={ri} className="space-y-2 rounded-md border p-2">
                {row.map((b, bi) => (
                  <div key={bi} className="grid gap-2 sm:grid-cols-[1fr_170px_1fr_auto]">
                    <Input value={b.text} maxLength={64} placeholder="Libellé" onChange={(e) => updateButton(ri, bi, { text: e.target.value })} />
                    <select value={b.type} onChange={(e) => updateButton(ri, bi, { type: e.target.value as PostButton["type"] })} className="h-9 rounded-md border bg-background px-2 text-sm">
                      <option value="URL">Lien direct</option>
                      <option value="BUTTON">Lien traqué</option>
                      <option value="OFFER">Offre (sub-ID)</option>
                    </select>
                    {b.type === "OFFER" ? (
                      <select value={b.affiliateCampaignId ?? ""} onChange={(e) => updateButton(ri, bi, { affiliateCampaignId: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm">
                        <option value="">— campagne Link Affi —</option>
                        {options.affiliateCampaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.programName} · {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input value={b.url ?? ""} placeholder="https://…" onChange={(e) => updateButton(ri, bi, { url: e.target.value })} />
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRows((p) => p.map((r, i) => (i === ri ? r.filter((_, j) => j !== bi) : r)).filter((r) => r.length > 0))}>
                      Retirer
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => p.map((r, i) => (i === ri ? [...r, { text: "", type: "URL" as const }] : r)))}>
                  + bouton sur cette ligne
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p, [{ text: "", type: "URL" as const }]])}>
              + ligne de boutons
            </Button>
            <input type="hidden" name="buttons" value={JSON.stringify(rows.map((r) => r.filter((b) => b.text.trim())).filter((r) => r.length))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quand</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="scheduledAt">Date et heure (Europe/Paris), pour « Programmer »</Label>
              <Input id="scheduledAt" name="scheduledAt" type="datetime-local" defaultValue={defaultScheduledAt} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="draft" variant="outline">
                Enregistrer en brouillon
              </Button>
              <Button type="submit" name="intent" value="schedule" variant="secondary">
                Programmer
              </Button>
              <Button type="submit" name="intent" value="now">
                Envoyer maintenant
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Aperçu</div>
        <TelegramPreview html={text} buttons={previewButtons} mediaCount={0} />
      </div>
    </div>
  );
}
