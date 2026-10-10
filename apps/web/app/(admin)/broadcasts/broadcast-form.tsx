"use client";

import { useMemo, useState } from "react";
import { SPEND_LEVELS, SPEND_LEVEL_LABELS } from "@linkaffipro/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { statusLabels } from "@/lib/status-badges";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import type { PostButton, PostButtonRow } from "@/lib/posts/buttons";
import type { CampaignOptionWithOffers } from "@/lib/campaigns/queries";
import { OfferPicker } from "@/components/campaigns/offer-picker";

export type BroadcastOptions = {
  bots: Array<{ id: string; name: string; username: string }>;
  channels: Array<{ id: string; title: string }>;
  inviteLinks: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  media: Array<{ id: string; filename: string; mimeType: string }>;
  affiliateCampaigns: Array<{ id: string; name: string; programName: string }>;
  /** Nos campagnes avec leurs offres (bouton Offre) ; si absent, chargées depuis `/campaigns/options`. */
  ourCampaigns?: CampaignOptionWithOffers[];
  /** Étiquettes du registre (Réglages → Étiquettes) : si fourni, menu à cocher au lieu d'un champ libre. */
  tags?: Array<{ name: string; color: string }>;
};

const STATUSES = [
  "REQUESTED",
  "PENDING_GATE",
  "SCHEDULED",
  "APPROVED",
  "LEFT",
  "KICKED",
  "EXPIRED",
] as const;
const STATUS_LABELS = statusLabels("membership");

function CheckList({
  name,
  items,
  label,
}: {
  name: string;
  items: Array<{ id: string; label: string }>;
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {items.map((i) => (
          <label key={i.id} className="flex min-h-10 items-center gap-2 md:min-h-0">
            <input type="checkbox" name={name} value={i.id} className="size-4" /> {i.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function wrap(
  textarea: HTMLTextAreaElement | null,
  open: string,
  close: string,
  setText: (t: string) => void,
) {
  if (!textarea) return;
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const next = value.slice(0, s) + open + value.slice(s, e) + close + value.slice(e);
  setText(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(s + open.length, e + open.length);
  });
}

const FORMAT_LABELS: Record<string, string> = {
  B: "Gras",
  I: "Italique",
  S: "Souligné",
  Barré: "Barré",
  Lien: "Lien",
  Spoiler: "Texte masqué",
};

export function BroadcastForm({
  options,
  defaultScheduledAt,
}: {
  options: BroadcastOptions;
  defaultScheduledAt: string;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PostButtonRow[]>([]);
  const [botId, setBotId] = useState(options.bots[0]?.id ?? "");
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [ta, setTa] = useState<HTMLTextAreaElement | null>(null);
  const previewButtons = useMemo(() => rows.map((r) => r.map((b) => ({ text: b.text }))), [rows]);
  const [ab, setAb] = useState(false);
  const [textB, setTextB] = useState("");
  const [rowsB, setRowsB] = useState<PostButtonRow[]>([]);
  const [split, setSplit] = useState(50);
  const [taB, setTaB] = useState<HTMLTextAreaElement | null>(null);
  const previewButtonsB = useMemo(
    () => rowsB.map((r) => r.map((b) => ({ text: b.text }))),
    [rowsB],
  );
  const updateButtonB = (ri: number, bi: number, patch: Partial<PostButton>) =>
    setRowsB((prev) =>
      prev.map((r, i) => (i === ri ? r.map((b, j) => (j === bi ? { ...b, ...patch } : b)) : r)),
    );

  const updateButton = (ri: number, bi: number, patch: Partial<PostButton>) =>
    setRows((prev) =>
      prev.map((r, i) => (i === ri ? r.map((b, j) => (j === bi ? { ...b, ...patch } : b)) : r)),
    );

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
        languages: String(fd.get("languages") ?? "")
          .split(/[,\s]+/)
          .filter(Boolean),
        inactiveDays: String(fd.get("inactiveDays") ?? ""),
        clickedCategoryIds: list("clickedCategoryIds"),
        tags: String(fd.get("tags") ?? "")
          .split(/[,\s]+/)
          .filter(Boolean),
      };
      const res = await fetch("/broadcasts/count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId: fd.get("botId"), segment }),
      });
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
            <CardDescription>
              Le nom interne n&apos;est pas visible par les membres.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nom interne</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Relance bonus week-end"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="botId">Bot expéditeur</Label>
                <select
                  id="botId"
                  name="botId"
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
                >
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
            <p className="text-sm text-muted-foreground">
              Sans filtre : tous les membres qui peuvent recevoir un message privé de ce bot. Chaque
              filtre ajouté réduit la liste.
            </p>
            <CheckList
              name="channelIds"
              label="Canaux"
              items={options.channels.map((c) => ({ id: c.id, label: c.title }))}
            />
            <CheckList
              name="membershipStatuses"
              label="Statut d'adhésion"
              items={STATUSES.map((s) => ({ id: s, label: STATUS_LABELS[s] }))}
            />
            <CheckList
              name="spendLevels"
              label="Niveau de dépense"
              items={SPEND_LEVELS.map((l) => ({ id: l, label: SPEND_LEVEL_LABELS[l] }))}
            />
            <CheckList
              name="inviteLinkIds"
              label="Lien d'entrée (pub)"
              items={options.inviteLinks.map((l) => ({ id: l.id, label: l.name }))}
            />
            <CheckList
              name="campaignIds"
              label="Pub"
              items={options.campaigns.map((c) => ({ id: c.id, label: c.name }))}
            />
            <CheckList
              name="clickedCategoryIds"
              label="A cliqué un message de la catégorie"
              items={options.categories.map((c) => ({ id: c.id, label: c.name }))}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="languages">Langues (fr, en…)</Label>
                <Input id="languages" name="languages" placeholder="fr, en" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inactiveDays">Sans activité depuis (jours)</Label>
                <Input
                  id="inactiveDays"
                  name="inactiveDays"
                  type="number"
                  min={1}
                  placeholder="ex. 7"
                />
              </div>
              {options.tags && options.tags.length > 0 ? (
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Étiquettes (au moins une)</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {options.tags.map((t) => (
                      <label key={t.name} className="flex min-h-10 items-center gap-2 md:min-h-0">
                        <input
                          type="checkbox"
                          value={t.name}
                          checked={pickedTags.includes(t.name)}
                          onChange={(e) =>
                            setPickedTags((prev) =>
                              e.target.checked
                                ? [...prev, t.name]
                                : prev.filter((x) => x !== t.name),
                            )
                          }
                          className="size-4"
                        />{" "}
                        {t.name}
                      </label>
                    ))}
                  </div>
                  <input type="hidden" name="tags" value={pickedTags.join(",")} />
                </fieldset>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="tags">Étiquettes (posées par les automatisations)</Label>
                  <Input id="tags" name="tags" placeholder="vip, test" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-md:h-10"
                disabled={counting}
                onClick={(e) => void countTargets((e.currentTarget as HTMLButtonElement).form!)}
              >
                {counting ? "Comptage…" : "Compter les destinataires"}
              </Button>
              {count !== null ? (
                <span className="text-sm" aria-live="polite">
                  {count} destinataire{count > 1 ? "s" : ""} joignable{count > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
            <CardDescription>
              Mise en forme Telegram : gras, italique, souligné, barré, lien, texte masqué
              (spoiler).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex flex-wrap gap-1"
              role="toolbar"
              aria-label="Mise en forme du message"
            >
              {[
                ["B", "<b>", "</b>"],
                ["I", "<i>", "</i>"],
                ["S", "<u>", "</u>"],
                ["Barré", "<s>", "</s>"],
                ["Lien", '<a href="https://">', "</a>"],
                ["Spoiler", "<tg-spoiler>", "</tg-spoiler>"],
              ].map(([l, o, c]) => (
                <Button
                  key={l}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="max-md:h-10"
                  aria-label={FORMAT_LABELS[l!] ?? l}
                  onClick={() => wrap(ta, o!, c!, setText)}
                >
                  {l}
                </Button>
              ))}
            </div>
            <Label htmlFor="text">Texte du message</Label>
            <textarea
              id="text"
              ref={setTa}
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              required
              className="w-full rounded-md border bg-background p-3 font-mono text-sm"
              placeholder="Texte du message (mise en forme Telegram : b, i, u, s, a, code, tg-spoiler)"
            />
            <div className="space-y-2">
              <Label htmlFor="mediaAssetId">Média (optionnel)</Label>
              <select
                id="mediaAssetId"
                name="mediaAssetId"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
              >
                <option value="">— aucun —</option>
                {options.media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Le média est envoyé avec le texte en légende (texte de plus de 1024 caractères :
                média puis texte séparé).
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Boutons</CardTitle>
            <CardDescription>
              Lien direct : URL telle quelle. Lien traqué : clics comptés. Offre : lien Link Affi
              avec identifiant de suivi (sub-ID) propre à chaque membre, pour rattacher ses
              inscriptions et dépôts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row, ri) => (
              <div key={ri} className="space-y-2 rounded-md border p-2">
                {row.map((b, bi) => (
                  <div key={bi} className="grid gap-2 sm:grid-cols-[1fr_170px_1fr_auto]">
                    <Input
                      value={b.text}
                      maxLength={64}
                      placeholder="Libellé"
                      aria-label={`Libellé du bouton ${bi + 1}, ligne ${ri + 1}`}
                      onChange={(e) => updateButton(ri, bi, { text: e.target.value })}
                    />
                    <select
                      value={b.type}
                      aria-label={`Type du bouton ${bi + 1}, ligne ${ri + 1}`}
                      onChange={(e) =>
                        updateButton(ri, bi, { type: e.target.value as PostButton["type"] })
                      }
                      className="h-10 rounded-md border bg-background px-2 text-sm md:h-9"
                    >
                      <option value="URL">Lien direct</option>
                      <option value="BUTTON">Lien traqué</option>
                      <option value="OFFER">Offre (campagne)</option>
                    </select>
                    {b.type === "OFFER" ? (
                      <OfferPicker
                        value={{ campaignId: b.campaignId, affiliateCampaignId: b.affiliateCampaignId }}
                        onChange={(patch) => updateButton(ri, bi, patch)}
                        campaigns={options.ourCampaigns}
                        affiliateCampaigns={options.affiliateCampaigns}
                        label={`Campagne du bouton ${bi + 1}, ligne ${ri + 1}`}
                      />
                    ) : (
                      <Input
                        value={b.url ?? ""}
                        placeholder="https://…"
                        aria-label={`Adresse du bouton ${bi + 1}, ligne ${ri + 1}`}
                        onChange={(e) => updateButton(ri, bi, { url: e.target.value })}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="max-md:h-10"
                      aria-label={`Retirer le bouton ${bi + 1} de la ligne ${ri + 1}`}
                      onClick={() =>
                        setRows((p) =>
                          p
                            .map((r, i) => (i === ri ? r.filter((_, j) => j !== bi) : r))
                            .filter((r) => r.length > 0),
                        )
                      }
                    >
                      Retirer
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows((p) =>
                      p.map((r, i) => (i === ri ? [...r, { text: "", type: "URL" as const }] : r)),
                    )
                  }
                >
                  + bouton sur cette ligne
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((p) => [...p, [{ text: "", type: "URL" as const }]])}
            >
              + ligne de boutons
            </Button>
            <input
              type="hidden"
              name="buttons"
              value={JSON.stringify(
                rows.map((r) => r.filter((b) => b.text.trim())).filter((r) => r.length),
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test A/B (optionnel)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="abEnabled"
                value="1"
                checked={ab}
                onChange={(e) => setAb(e.target.checked)}
                className="mt-0.5 size-4"
              />{" "}
              Comparer deux versions du message : les destinataires sont répartis au hasard, puis la
              page du test compare les clics et désigne la gagnante.
            </label>
            {ab ? (
              <div className="space-y-4 rounded-md border p-3">
                <div className="space-y-2 sm:max-w-sm">
                  <Label htmlFor="abSplit">
                    Part des destinataires pour la version A : {split} % (B : {100 - split} %)
                  </Label>
                  <input
                    id="abSplit"
                    name="abSplit"
                    type="range"
                    min={10}
                    max={90}
                    step={5}
                    value={split}
                    onChange={(e) => setSplit(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="text-sm font-medium">Message de la version B</div>
                <div
                  className="flex flex-wrap gap-1"
                  role="toolbar"
                  aria-label="Mise en forme de la version B"
                >
                  {[
                    ["B", "<b>", "</b>"],
                    ["I", "<i>", "</i>"],
                    ["S", "<u>", "</u>"],
                    ["Barré", "<s>", "</s>"],
                    ["Lien", '<a href="https://">', "</a>"],
                    ["Spoiler", "<tg-spoiler>", "</tg-spoiler>"],
                  ].map(([l, o, c]) => (
                    <Button
                      key={l}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="max-md:h-10"
                      aria-label={`${FORMAT_LABELS[l!] ?? l} (version B)`}
                      onClick={() => wrap(taB, o!, c!, setTextB)}
                    >
                      {l}
                    </Button>
                  ))}
                </div>
                <Label htmlFor="textB" className="sr-only">
                  Texte de la version B
                </Label>
                <textarea
                  id="textB"
                  ref={setTaB}
                  name="textB"
                  value={textB}
                  onChange={(e) => setTextB(e.target.value)}
                  rows={6}
                  required={ab}
                  className="w-full rounded-md border bg-background p-3 font-mono text-sm"
                  placeholder="Texte de la version B"
                />
                <div className="space-y-2">
                  <Label htmlFor="mediaAssetIdB">Média de la version B (optionnel)</Label>
                  <select
                    id="mediaAssetIdB"
                    name="mediaAssetIdB"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9"
                  >
                    <option value="">— aucun —</option>
                    {options.media.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.filename}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <div className="text-sm font-medium">Boutons de la version B</div>
                  {rowsB.map((row, ri) => (
                    <div key={ri} className="space-y-2 rounded-md border p-2">
                      {row.map((b, bi) => (
                        <div key={bi} className="grid gap-2 sm:grid-cols-[1fr_170px_1fr_auto]">
                          <Input
                            value={b.text}
                            maxLength={64}
                            placeholder="Libellé"
                            aria-label={`Version B : libellé du bouton ${bi + 1}, ligne ${ri + 1}`}
                            onChange={(e) => updateButtonB(ri, bi, { text: e.target.value })}
                          />
                          <select
                            value={b.type}
                            aria-label={`Version B : type du bouton ${bi + 1}, ligne ${ri + 1}`}
                            onChange={(e) =>
                              updateButtonB(ri, bi, { type: e.target.value as PostButton["type"] })
                            }
                            className="h-10 rounded-md border bg-background px-2 text-sm md:h-9"
                          >
                            <option value="URL">Lien direct</option>
                            <option value="BUTTON">Lien traqué</option>
                            <option value="OFFER">Offre (campagne)</option>
                          </select>
                          {b.type === "OFFER" ? (
                            <OfferPicker
                              value={{ campaignId: b.campaignId, affiliateCampaignId: b.affiliateCampaignId }}
                              onChange={(patch) => updateButtonB(ri, bi, patch)}
                              campaigns={options.ourCampaigns}
                              affiliateCampaigns={options.affiliateCampaigns}
                              label={`Version B : campagne du bouton ${bi + 1}, ligne ${ri + 1}`}
                            />
                          ) : (
                            <Input
                              value={b.url ?? ""}
                              placeholder="https://…"
                              aria-label={`Version B : adresse du bouton ${bi + 1}, ligne ${ri + 1}`}
                              onChange={(e) => updateButtonB(ri, bi, { url: e.target.value })}
                            />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="max-md:h-10"
                            aria-label={`Version B : retirer le bouton ${bi + 1} de la ligne ${ri + 1}`}
                            onClick={() =>
                              setRowsB((p) =>
                                p
                                  .map((r, i) => (i === ri ? r.filter((_, j) => j !== bi) : r))
                                  .filter((r) => r.length > 0),
                              )
                            }
                          >
                            Retirer
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRowsB((p) =>
                            p.map((r, i) =>
                              i === ri ? [...r, { text: "", type: "URL" as const }] : r,
                            ),
                          )
                        }
                      >
                        + bouton sur cette ligne
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRowsB((p) => [...p, [{ text: "", type: "URL" as const }]])}
                  >
                    + ligne de boutons
                  </Button>
                  <input
                    type="hidden"
                    name="buttonsB"
                    value={JSON.stringify(
                      rowsB.map((r) => r.filter((b) => b.text.trim())).filter((r) => r.length),
                    )}
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quand</CardTitle>
            <CardDescription>
              « Enregistrer en brouillon » ne lance rien. « Programmer » utilise la date ci-dessous.
              « Envoyer maintenant » part tout de suite.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="scheduledAt">
                Date et heure d&apos;envoi (heure de Paris), utilisée par « Programmer »
              </Label>
              <Input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                defaultValue={defaultScheduledAt}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                name="intent"
                value="draft"
                variant="outline"
                className="max-md:h-10"
              >
                Enregistrer en brouillon
              </Button>
              <Button
                type="submit"
                name="intent"
                value="schedule"
                variant="secondary"
                className="max-md:h-10"
              >
                Programmer
              </Button>
              <ConfirmSubmit
                name="intent"
                value="now"
                className="max-md:h-10"
                message={`Le message va partir maintenant à ${count !== null ? `${count} destinataire${count > 1 ? "s" : ""}` : "tous les destinataires du segment"}, sans possibilité de le rappeler. Continuer ?`}
              >
                Envoyer maintenant
              </ConfirmSubmit>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">{ab ? "Aperçu — version A" : "Aperçu"}</div>
          <TelegramPreview html={text} buttons={previewButtons} mediaCount={0} />
        </div>
        {ab ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Aperçu — version B</div>
            <TelegramPreview html={textB} buttons={previewButtonsB} mediaCount={0} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
