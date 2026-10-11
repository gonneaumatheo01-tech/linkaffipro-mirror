"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { AdvancedSection } from "@/components/admin/form-section";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { UniverseDot } from "@/components/admin/universe-dot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CARD_DEFS,
  cardTitle,
  delayChoices,
  type CardKey,
  type CardSettings,
} from "@/lib/automations/cards";
import {
  buttonsToEntries,
  entriesToButtons,
  previewButtonRows,
  toggleInList,
  type ButtonEntry,
} from "@/lib/automations/node-form";
import { LinkButtonsField } from "./link-buttons-field";
import { MessageField } from "./message-field";

export type CardPanelOptions = {
  /** Canaux actifs et leur univers (pastille de couleur). */
  channels: Array<{ id: string; title: string; vertical?: string | null }>;
  bots: Array<{ id: string; username: string; vertical: string }>;
  media: Array<{ id: string; filename: string }>;
};

type Vertical = "CASINO" | "SPORTS" | "DATING";
const toVertical = (v: string | undefined): Vertical | null =>
  v === "CASINO" || v === "SPORTS" || v === "DATING" ? v : null;

/**
 * Volet de réglage d'une carte prête à l'emploi : le réglage principal (délai, jours sans activité ou seuil), le
 * message (aperçu Telegram modifiable, « Améliorer avec l'IA »), les canaux ; boutons, bot et média dans « Avancé ».
 * « Enregistrer » appelle `saveCardAction` : une erreur s'affiche dans le volet sans rien perdre, le succès ramène
 * aux cartes. La première sauvegarde crée la relance, désactivée.
 */
export function CardSettingsPanel({
  cardKey,
  ruleId,
  settings,
  options,
  action,
  triggerLabel,
  advancedHref,
}: {
  cardKey: CardKey;
  ruleId: string | null;
  settings: CardSettings;
  options: CardPanelOptions;
  action: (formData: FormData) => Promise<{ ok: false; error: string }>;
  triggerLabel: string;
  /** Même relance dans l'éditeur à branches (pour ajouter une condition ou une étape). */
  advancedHref: string;
}) {
  const def = CARD_DEFS[cardKey];
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(settings.message.text);
  const [buttons, setButtons] = useState<ButtonEntry[]>(() =>
    buttonsToEntries(settings.message.buttons),
  );
  const [channelIds, setChannelIds] = useState<string[]>(settings.channelIds);
  const [botId, setBotId] = useState(settings.message.botId ?? "");
  const [mediaId, setMediaId] = useState(settings.message.mediaAssetId ?? "");
  const current =
    def.delayKind === "hours"
      ? settings.hours
      : def.delayKind === "inactiveDays"
        ? settings.inactiveDays
        : def.delayKind === "level"
          ? settings.level
          : undefined;
  const [delay, setDelay] = useState(current === null ? "now" : String(current ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedButtons = entriesToButtons(buttons);
  const previewButtons = previewButtonRows(buttons);
  const bot = options.bots.find((b) => b.id === botId);
  const verticals = [...new Set(options.bots.map((b) => b.vertical))];
  const vertical = toVertical(bot?.vertical ?? (verticals.length === 1 ? verticals[0] : undefined));
  const advancedChanged = (previewButtons.length ? 1 : 0) + (botId ? 1 : 0) + (mediaId ? 1 : 0);
  const delayField =
    def.delayKind === "inactiveDays"
      ? "inactiveDays"
      : def.delayKind === "level"
        ? "level"
        : "delay";
  const preview = cardTitle(cardKey, {
    hours: def.delayKind === "hours" && delay !== "now" ? Number(delay) || null : null,
    inactiveDays: def.delayKind === "inactiveDays" ? Number(delay) || null : null,
  });

  function submit(form: HTMLFormElement) {
    setError(null);
    if (!parsedButtons.ok) {
      setError(parsedButtons.error);
      return;
    }
    const fd = new FormData(form);
    startTransition(async () => {
      const r = await action(fd);
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
      size="xl"
      title={preview}
      description={def.description}
      trigger={
        <Button type="button" variant="outline" size="sm" className="max-md:h-10">
          {triggerLabel}
        </Button>
      }
      footer={
        <>
          <SidePanelClose>Annuler</SidePanelClose>
          <Button type="submit" form={`${uid}-form`} disabled={pending} className="max-md:h-10">
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <form
        id={`${uid}-form`}
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <input type="hidden" name="templateKey" value={cardKey} />
        <input type="hidden" name="buttonsJson" value={JSON.stringify(buttons)} />
        {ruleId ? <input type="hidden" name="ruleId" value={ruleId} /> : null}
        {error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {def.delayKind !== "none" ? (
          <div className="space-y-2">
            <Label htmlFor={`${uid}-delay`}>{def.delayLabel}</Label>
            <NativeSelect
              id={`${uid}-delay`}
              name={delayField}
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              wrapperClassName="w-full sm:w-72"
            >
              {delayChoices(cardKey, current).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
            {def.delayKind === "level" ? (
              <p className="text-note text-muted-foreground">
                Les seuils (montant des dépôts pour « VIP », nombre de dépôts pour « régulier ») se
                règlent dans Réglages → Connexions.
              </p>
            ) : def.condition === "registered" ? (
              <p className="text-note text-muted-foreground">
                Compté à partir du clic. S&apos;il s&apos;est inscrit entre-temps, rien ne part.
              </p>
            ) : def.condition === "deposited" ? (
              <p className="text-note text-muted-foreground">
                Compté à partir de l&apos;inscription. S&apos;il a déposé entre-temps, rien ne part.
              </p>
            ) : null}
          </div>
        ) : null}

        <MessageField
          id={`${uid}-text`}
          name="text"
          label="Message"
          value={text}
          onChange={setText}
          buttons={previewButtons}
          mediaCount={mediaId ? 1 : 0}
          context={{ vertical, ...(mediaId ? { hasMedia: true } : {}) }}
          required
        />

        <fieldset className="space-y-2">
          <legend className="text-body font-medium text-foreground">Canaux</legend>
          <p className="text-note text-muted-foreground">
            Sans case cochée, la relance concerne les membres de tous les canaux.
          </p>
          {options.channels.length === 0 ? (
            <p className="text-note text-muted-foreground">
              Aucun canal actif pour l&apos;instant.
            </p>
          ) : (
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {options.channels.map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-9 items-center gap-2 text-body max-md:min-h-10"
                >
                  <Checkbox
                    name="channelIds"
                    value={c.id}
                    checked={channelIds.includes(c.id)}
                    onCheckedChange={(on) => setChannelIds((l) => toggleInList(l, c.id, on))}
                  />
                  <UniverseDot universe={c.vertical ?? null} />
                  <span className="min-w-0 truncate">{c.title}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <AdvancedSection
          title="Boutons, bot et média"
          description="Un bouton Offre (identifiant de suivi de chaque membre) ou un lien, un autre bot que celui du canal, une image."
          modifiedCount={advancedChanged}
        >
          <LinkButtonsField entries={buttons} onChange={setButtons} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-bot`}>Bot qui écrit</Label>
              <NativeSelect
                id={`${uid}-bot`}
                name="botId"
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                wrapperClassName="w-full"
              >
                <option value="">Le bot du canal</option>
                {options.bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.username}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-media`}>Image ou vidéo jointe</Label>
              <NativeSelect
                id={`${uid}-media`}
                name="mediaAssetId"
                value={mediaId}
                onChange={(e) => setMediaId(e.target.value)}
                wrapperClassName="w-full"
              >
                <option value="">Aucune</option>
                {options.media.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </AdvancedSection>
        <p className="text-note text-muted-foreground">
          Besoin d&apos;une condition ou d&apos;une étape de plus ?{" "}
          <Link
            href={advancedHref}
            className="font-medium text-brand-ink underline-offset-2 hover:underline"
          >
            Ouvrir dans l&apos;éditeur avancé
          </Link>
          {ruleId ? " (la relance passera alors en « sur mesure » si sa forme change)." : "."}
        </p>
      </form>
    </SidePanel>
  );
}
