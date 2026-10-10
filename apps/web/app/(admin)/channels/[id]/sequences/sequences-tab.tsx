import { prisma } from "@linkaffipro/db";
import {
  PLACEHOLDERS,
  SEQUENCE_TRIGGERS,
  TRIGGER_HELP,
  TRIGGER_LABELS,
  ensureDefaultSequences,
  previewText,
} from "@linkaffipro/telegram";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { AiVertical } from "@linkaffipro/ai/types";
import {
  addSequenceLangAction,
  removeSequenceLangAction,
  saveSequenceTextAction,
  sendSequenceTestAction,
  setSequenceMediaAction,
  toggleSequenceAction,
} from "./actions";
import { SEQUENCE_LANGS } from "./langs";
import { SequenceTextField } from "./sequence-text-field";

const LANG_LABELS: Record<string, string> = {
  fr: "Français",
  en: "Anglais",
  es: "Espagnol",
  pt: "Portugais",
  de: "Allemand",
  it: "Italien",
  ar: "Arabe",
  tr: "Turc",
  nl: "Néerlandais",
  pl: "Polonais",
  ro: "Roumain",
  ru: "Russe",
};

/** Clé courte d'un texte : le champ est recréé quand son texte enregistré change (ex. traductions de l'IA). */
function textKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}-${h}`;
}

/** Rendu simplifié du HTML Telegram pour l'aperçu (balises déjà validées à l'enregistrement). */
function previewHtml(text: string): string {
  return text.replace(/\n/g, "<br/>");
}

export async function SequencesTab({
  channelId,
  channelTitle,
  channelVertical,
  open,
  telegramLinked,
}: {
  channelId: string;
  channelTitle: string;
  /** Univers du canal (ou de son bot principal), transmis à l'assistant IA. */
  channelVertical: AiVertical | null;
  open: string | undefined;
  telegramLinked: boolean;
}) {
  await ensureDefaultSequences(channelId);
  const sequences = await prisma.sequence.findMany({
    where: { channelId },
    include: {
      steps: {
        orderBy: { order: "asc" },
        take: 1,
        include: { mediaAsset: { select: { id: true, filename: true, mimeType: true } } },
      },
    },
  });
  const byTrigger = new Map(sequences.map((s) => [s.trigger as string, s]));
  const mediaOptions = await prisma.mediaAsset.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, filename: true, mimeType: true },
  });
  const openKey = open ?? "JOIN_REQUEST";
  const selectCls = "h-10 w-full rounded-md border bg-background px-3 text-sm md:h-9";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p>
            Ces messages sont envoyés en privé par le bot du canal. Le français est obligatoire ;
            ajoutez une langue pour les membres dont Telegram est dans cette langue (sinon ils
            reçoivent le français).
          </p>
          <p className="mt-2">
            Mots magiques :{" "}
            {PLACEHOLDERS.map((p) => (
              <span key={p.key} className="mr-2 font-mono text-xs">
                {p.key}
              </span>
            ))}{" "}
            — remplacés automatiquement (prénom, nom du canal, canaux à rejoindre, délai, bot). Mise
            en forme : &lt;b&gt;gras&lt;/b&gt;, &lt;i&gt;italique&lt;/i&gt;, &lt;a
            href=&quot;…&quot;&gt;lien&lt;/a&gt;.
          </p>
          <p className="mt-2">
            « ✨ Améliorer avec l&apos;IA » sous chaque texte propose 3 versions, écrites dans la
            langue de ce champ ; « Traduire dans les langues du bot » remplit et enregistre ce
            message en français, anglais, espagnol, portugais, allemand et italien.
          </p>
          {!telegramLinked ? (
            <p className="mt-2 text-amber-700">
              Pour « M&apos;envoyer un test », liez votre Telegram dans Mon compte (menu en haut à
              droite).
            </p>
          ) : null}
        </CardContent>
      </Card>

      {SEQUENCE_TRIGGERS.map((trigger) => {
        const seq = byTrigger.get(trigger);
        const step = seq?.steps[0];
        const texts = (
          step?.texts && typeof step.texts === "object"
            ? (step.texts as Record<string, string>)
            : {}
        ) as Record<string, string>;
        const langs = [
          "fr",
          ...Object.keys(texts)
            .filter((l) => l !== "fr")
            .sort(),
        ];
        const missing = SEQUENCE_LANGS.filter((l) => !(l in texts) && l !== "fr");
        const isOpen = openKey === trigger;
        const title = TRIGGER_LABELS[trigger];
        return (
          <Card key={trigger} id={trigger}>
            <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:gap-4">
              <div>
                <CardTitle className="text-base">
                  {title}{" "}
                  {seq && !seq.isActive ? (
                    <Badge variant="secondary" className="ml-2">
                      désactivé
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-2">
                      {langs.length} langue{langs.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{TRIGGER_HELP[trigger]}</CardDescription>
              </div>
              <div className="flex shrink-0 gap-2">
                {!isOpen ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-md:h-10"
                    render={
                      <a href={`/channels/${channelId}?tab=sequences&open=${trigger}#${trigger}`} />
                    }
                  >
                    Modifier
                  </Button>
                ) : null}
                <form action={toggleSequenceAction}>
                  <input type="hidden" name="channelId" value={channelId} />
                  <input type="hidden" name="trigger" value={trigger} />
                  {seq?.isActive === false ? (
                    <Button type="submit" variant="ghost" size="sm" className="max-md:h-10">
                      Activer
                    </Button>
                  ) : (
                    <ConfirmSubmit
                      variant="ghost"
                      size="sm"
                      className="max-md:h-10"
                      message={`Désactiver le message « ${title} » ? Le bot utilisera son texte intégré par défaut à la place du vôtre. Votre texte est conservé et vous pourrez le réactiver.`}
                    >
                      Désactiver
                    </ConfirmSubmit>
                  )}
                </form>
              </div>
            </CardHeader>
            {isOpen ? (
              <CardContent className="space-y-6">
                {langs.map((lang) => (
                  <div key={lang} className="grid gap-4 lg:grid-cols-2">
                    <form action={saveSequenceTextAction} className="space-y-2">
                      <input type="hidden" name="channelId" value={channelId} />
                      <input type="hidden" name="trigger" value={trigger} />
                      <input type="hidden" name="lang" value={lang} />
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`${trigger}-${lang}`}>
                          {LANG_LABELS[lang] ?? lang.toUpperCase()}
                          {lang === "fr" ? " (obligatoire)" : ""}
                        </Label>
                        {lang !== "fr" ? (
                          <ConfirmSubmit
                            formAction={removeSequenceLangAction}
                            variant="ghost"
                            size="sm"
                            className="text-destructive max-md:h-10"
                            message={`Retirer la langue « ${LANG_LABELS[lang] ?? lang} » du message « ${title} » ? Le texte dans cette langue sera supprimé ; les membres concernés recevront le français.`}
                          >
                            Retirer cette langue
                          </ConfirmSubmit>
                        ) : null}
                      </div>
                      <SequenceTextField
                        key={textKey(texts[lang] ?? "")}
                        id={`${trigger}-${lang}`}
                        channelId={channelId}
                        trigger={trigger}
                        lang={lang}
                        defaultValue={texts[lang] ?? ""}
                        vertical={channelVertical}
                        hasMedia={Boolean(step?.mediaAsset)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="sm" className="max-md:h-10">
                          Enregistrer
                        </Button>
                        <Button
                          type="submit"
                          formAction={sendSequenceTestAction}
                          size="sm"
                          variant="outline"
                          className="max-md:h-10"
                          disabled={!telegramLinked}
                        >
                          M&apos;envoyer un test
                        </Button>
                      </div>
                    </form>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Aperçu ({LANG_LABELS[lang] ?? lang})</p>
                      <div
                        className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: previewHtml(
                            previewText(texts[lang] ?? "", { canal: channelTitle }),
                          ),
                        }}
                      />
                      {trigger === "JOIN_REQUEST" ? (
                        <p className="text-xs text-muted-foreground">
                          + boutons « Rejoindre … » et « ✅ J&apos;ai rejoint » ajoutés par le bot
                          si la règle prévoit des canaux à rejoindre.
                        </p>
                      ) : null}
                      {trigger === "OFFER_REPLY" ? (
                        <p className="text-xs text-muted-foreground">
                          + bouton « Ouvrir l&apos;offre » ajouté par le bot.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div className="grid gap-4 lg:grid-cols-2">
                  <form
                    action={setSequenceMediaAction}
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  >
                    <input type="hidden" name="channelId" value={channelId} />
                    <input type="hidden" name="trigger" value={trigger} />
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`${trigger}-media`}>
                        Média joint (photo, vidéo, gif ou document)
                      </Label>
                      <select
                        id={`${trigger}-media`}
                        name="mediaAssetId"
                        defaultValue={step?.mediaAsset?.id ?? ""}
                        className={selectCls}
                      >
                        <option value="">— aucun —</option>
                        {mediaOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.filename}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Envoyé avec le texte en légende (au-delà de 1 024 caractères : le média,
                        puis le texte). Les médias se téléversent depuis Messages → Nouveau message.
                      </p>
                    </div>
                    <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                      Enregistrer le média
                    </Button>
                  </form>
                  {step?.mediaAsset ? (
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Aperçu du média</p>
                      {step.mediaAsset.mimeType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/media/${step.mediaAsset.id}`}
                          alt={`Média joint : ${step.mediaAsset.filename}`}
                          className="max-h-40 rounded-md border object-contain"
                        />
                      ) : step.mediaAsset.mimeType.startsWith("video/") ? (
                        <video
                          src={`/api/media/${step.mediaAsset.id}`}
                          controls
                          aria-label={`Vidéo jointe : ${step.mediaAsset.filename}`}
                          className="max-h-40 rounded-md border"
                        />
                      ) : (
                        <a href={`/api/media/${step.mediaAsset.id}`} className="text-sm underline">
                          {step.mediaAsset.filename}
                        </a>
                      )}
                    </div>
                  ) : null}
                </div>
                {missing.length > 0 ? (
                  <form
                    action={addSequenceLangAction}
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  >
                    <input type="hidden" name="channelId" value={channelId} />
                    <input type="hidden" name="trigger" value={trigger} />
                    <div className="space-y-1">
                      <Label htmlFor={`${trigger}-add`}>Ajouter une langue</Label>
                      <select id={`${trigger}-add`} name="lang" className={selectCls}>
                        {missing.map((l) => (
                          <option key={l} value={l}>
                            {LANG_LABELS[l] ?? l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                      Ajouter
                    </Button>
                  </form>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
