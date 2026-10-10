import Link from "next/link";
import { Pencil, Send } from "lucide-react";
import { prisma } from "@linkaffipro/db";
import {
  PLACEHOLDERS,
  ensureDefaultSequences,
  formatDelay,
  isLang,
  t,
  type Lang,
} from "@linkaffipro/telegram";
import type { AiVertical } from "@linkaffipro/ai/types";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { FormSection } from "@/components/admin/form-section";
import { StatusPill } from "@/components/admin/status-pill";
import { BotTextEditor } from "@/components/channels/bot-text-editor";
import { BotToggle } from "@/components/channels/bot-toggle";
import { LangTabs } from "@/components/channels/lang-tabs";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  BOT_MOMENTS,
  BOT_MOMENT_TEXT,
  fillExamples,
  langLabel,
  messageLangs,
  momentNote,
  previewButtons,
  textKey,
  type BotMoment,
  type PlaceholderExamples,
} from "@/lib/channels/bot-messages";
import { effectiveDelay, isRuleInForce, type EntryRule } from "@/lib/channels/entry-rule";
import {
  addSequenceLangAction,
  removeSequenceLangAction,
  saveSequenceTextAction,
  saveSequenceTranslationsAction,
  sendSequenceTestAction,
  setSequenceMediaAction,
  toggleSequenceAction,
} from "./actions";
import { SEQUENCE_LANGS } from "./langs";

function example(key: string): string {
  return PLACEHOLDERS.find((p) => p.key === `{${key}}`)?.example ?? "";
}

/** Exemples des mots magiques pour l'aperçu d'une langue : le vrai canal, les vrais canaux à rejoindre, le vrai délai. */
function examplesFor(
  lang: string,
  ctx: {
    channelTitle: string;
    gateTitles: string[];
    rule: EntryRule | null;
    botUsername: string | null;
  },
): PlaceholderExamples {
  const l: Lang = isLang(lang) ? lang : "fr";
  return {
    prenom: example("prenom"),
    canal: ctx.channelTitle,
    liste_canaux: ctx.gateTitles.length > 0 ? ctx.gateTitles.join(", ") : example("liste_canaux"),
    delai: isRuleInForce(ctx.rule) ? formatDelay(effectiveDelay(ctx.rule), l) : example("delai"),
    bot: ctx.botUsername ? `@${ctx.botUsername}` : example("bot"),
  };
}

function buttonLabels(lang: string) {
  const l: Lang = isLang(lang) ? lang : "fr";
  return { join: t(l, "joinLabel"), joined: t(l, "joinedLabel"), offer: t(l, "offerButton") };
}

/**
 * Onglet « Ce que dit le bot » (ex-« Messages du bot ») : une carte par moment (accueil, rappel, canaux rejoints,
 * accepté, réponse à une offre) avec l'aperçu Telegram, les langues en onglets, « Modifier » (texte, « ✨ Améliorer
 * avec l'IA », média, langues), « Envoyer un test » et l'interrupteur « Activé ». Mêmes actions serveur qu'avant.
 */
export async function SequencesTab({
  channelId,
  channelTitle,
  channelVertical,
  open,
  lang,
  telegramLinked,
  rule,
  gateTitles,
  botUsername,
}: {
  channelId: string;
  channelTitle: string;
  /** Univers du canal (ou de son bot principal), transmis à l'assistant IA. */
  channelVertical: AiVertical | null;
  /** Moment en cours de modification (`?open=`). */
  open: string | undefined;
  /** Langue à montrer dans la carte ouverte (`?lang=`). */
  lang: string | undefined;
  telegramLinked: boolean;
  rule: EntryRule | null;
  gateTitles: string[];
  botUsername: string | null;
}) {
  await ensureDefaultSequences(channelId);
  const [sequences, mediaOptions] = await Promise.all([
    prisma.sequence.findMany({
      where: { channelId },
      include: {
        steps: {
          orderBy: { order: "asc" },
          take: 1,
          include: { mediaAsset: { select: { id: true, filename: true, mimeType: true } } },
        },
      },
    }),
    prisma.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, filename: true, mimeType: true },
    }),
  ]);
  const byTrigger = new Map(sequences.map((s) => [s.trigger as string, s]));
  const ctx = { channelTitle, gateTitles, rule, botUsername };
  const base = `/channels/${encodeURIComponent(channelId)}?tab=sequences`;

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-1">
        <p className="text-body text-muted-foreground">
          Les messages privés que le bot envoie aux membres de ce canal, moment par moment. Le
          français est obligatoire ; ajoutez une langue pour les membres dont Telegram est réglé
          dans une autre langue (sinon ils reçoivent le français).
        </p>
        {!telegramLinked ? (
          <p className="text-note text-muted-foreground">
            Pour recevoir un test, liez votre Telegram dans{" "}
            <Link
              href="/account"
              className="font-medium text-brand-ink underline underline-offset-4"
            >
              Mon compte
            </Link>
            .
          </p>
        ) : null}
      </div>

      {BOT_MOMENTS.map((trigger) => (
        <MomentCard
          key={trigger}
          trigger={trigger}
          channelId={channelId}
          channelVertical={channelVertical}
          seq={byTrigger.get(trigger)}
          isOpen={open === trigger}
          lang={open === trigger ? lang : undefined}
          telegramLinked={telegramLinked}
          rule={rule}
          gateTitles={gateTitles}
          ctx={ctx}
          base={base}
          mediaOptions={mediaOptions}
        />
      ))}
    </div>
  );
}

type SequenceRow = {
  isActive: boolean;
  steps: Array<{
    texts: unknown;
    mediaAsset: { id: string; filename: string; mimeType: string } | null;
  }>;
};

function MomentCard({
  trigger,
  channelId,
  channelVertical,
  seq,
  isOpen,
  lang,
  telegramLinked,
  rule,
  gateTitles,
  ctx,
  base,
  mediaOptions,
}: {
  trigger: BotMoment;
  channelId: string;
  channelVertical: AiVertical | null;
  seq: SequenceRow | undefined;
  isOpen: boolean;
  lang: string | undefined;
  telegramLinked: boolean;
  rule: EntryRule | null;
  gateTitles: string[];
  ctx: Parameters<typeof examplesFor>[1];
  base: string;
  mediaOptions: Array<{ id: string; filename: string; mimeType: string }>;
}) {
  const step = seq?.steps[0];
  const texts = (
    step?.texts && typeof step.texts === "object" ? (step.texts as Record<string, string>) : {}
  ) as Record<string, string>;
  const langs = messageLangs(texts);
  const missing = SEQUENCE_LANGS.filter((l) => !(l in texts) && l !== "fr");
  const { title, when } = BOT_MOMENT_TEXT[trigger];
  const active = seq?.isActive !== false;
  const note = momentNote(trigger, rule);
  const media = step?.mediaAsset ?? null;
  const headingId = `moment-${trigger}`;

  const items = langs.map((l) => {
    const text = texts[l] ?? "";
    const buttons = previewButtons(trigger, rule, gateTitles, buttonLabels(l));
    const content = isOpen ? (
      <form action={saveSequenceTextAction} className="space-y-4">
        <input type="hidden" name="channelId" value={channelId} />
        <input type="hidden" name="trigger" value={trigger} />
        <input type="hidden" name="lang" value={l} />
        <BotTextEditor
          key={textKey(text)}
          id={`${trigger}-${l}`}
          label={`Texte en ${langLabel(l).toLowerCase()}${l === "fr" ? " (obligatoire)" : ""}`}
          defaultValue={text}
          required={l === "fr"}
          examples={examplesFor(l, ctx)}
          buttons={buttons}
          mediaCount={media ? 1 : 0}
          context={{ vertical: channelVertical, language: l, hasMedia: Boolean(media) }}
          channelId={channelId}
          moment={trigger}
          saveTranslations={saveSequenceTranslationsAction}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className="max-md:h-10">
            Enregistrer
          </Button>
          <Button
            type="submit"
            formAction={sendSequenceTestAction}
            variant="outline"
            className="max-md:h-10"
            disabled={!telegramLinked}
          >
            <Send aria-hidden />
            M&apos;envoyer un test
          </Button>
          <Link
            href={`${base}#${trigger}`}
            className={cn(buttonVariants({ variant: "ghost" }), "max-md:h-10")}
          >
            Fermer
          </Link>
          {l !== "fr" ? (
            <ConfirmSubmit
              formAction={removeSequenceLangAction}
              variant="ghost"
              className="text-danger max-md:h-10 sm:ml-auto"
              confirmTitle={`Retirer la langue « ${langLabel(l)} » ?`}
              confirmLabel="Retirer"
              message={`Le texte en ${langLabel(l).toLowerCase()} du message « ${title} » sera supprimé ; les membres concernés recevront le français.`}
            >
              Retirer cette langue
            </ConfirmSubmit>
          ) : null}
        </div>
      </form>
    ) : (
      <div className="grid gap-4 md:grid-cols-[minmax(0,34rem)_auto] md:items-start md:justify-start">
        <TelegramPreview
          html={fillExamples(text, examplesFor(l, ctx))}
          buttons={buttons}
          mediaCount={media ? 1 : 0}
        />
        <div className="flex flex-wrap gap-2 md:flex-col">
          <Link
            href={`${base}&open=${trigger}${l !== "fr" ? `&lang=${l}` : ""}#${trigger}`}
            className={cn(buttonVariants({ variant: "outline" }), "max-md:h-10")}
          >
            <Pencil aria-hidden />
            Modifier
            <span className="sr-only"> le texte en {langLabel(l).toLowerCase()}</span>
          </Link>
          <form action={sendSequenceTestAction}>
            <input type="hidden" name="channelId" value={channelId} />
            <input type="hidden" name="trigger" value={trigger} />
            <input type="hidden" name="lang" value={l} />
            <input type="hidden" name="mode" value="view" />
            <Button
              type="submit"
              variant="outline"
              className="w-full max-md:h-10"
              disabled={!telegramLinked}
            >
              <Send aria-hidden />
              Envoyer un test
            </Button>
          </form>
        </div>
      </div>
    );
    return { value: l, label: langLabel(l), content };
  });

  return (
    <section
      id={trigger}
      aria-labelledby={headingId}
      className={cn(
        "scroll-mt-20 rounded-xl border bg-surface",
        isOpen ? "border-brand/50" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-body font-semibold text-foreground">
              {title}
            </h2>
            {!active ? (
              <StatusPill tone="muted" title="Le bot envoie son texte intégré par défaut">
                Texte intégré du bot
              </StatusPill>
            ) : null}
          </div>
          <p className="mt-0.5 text-note text-muted-foreground">{when}</p>
          {note ? <p className="mt-1 text-note text-warning">{note}</p> : null}
        </div>
        <BotToggle
          active={active}
          title={title}
          channelId={channelId}
          trigger={trigger}
          view={!isOpen}
          action={toggleSequenceAction}
        />
      </div>
      <div className="space-y-6 p-4">
        <LangTabs
          label={`Langues du message « ${title} »`}
          items={items}
          defaultValue={lang}
          actions={
            isOpen && missing.length > 0 ? (
              <form action={addSequenceLangAction} className="flex items-center gap-2">
                <input type="hidden" name="channelId" value={channelId} />
                <input type="hidden" name="trigger" value={trigger} />
                <Label htmlFor={`${trigger}-add`} className="sr-only">
                  Langue à ajouter
                </Label>
                <NativeSelect id={`${trigger}-add`} name="lang" className="h-8 w-36">
                  {missing.map((m) => (
                    <option key={m} value={m}>
                      {langLabel(m)}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" size="sm" variant="outline" className="max-md:h-10">
                  Ajouter une langue
                </Button>
              </form>
            ) : null
          }
        />
        {isOpen ? (
          <FormSection
            title="Média joint"
            description="Une photo, une vidéo, un gif ou un document envoyé avec le texte (au-delà de 1 024 caractères : le média, puis le texte)."
            className="border-t border-border pt-6"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <form
                action={setSequenceMediaAction}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="channelId" value={channelId} />
                <input type="hidden" name="trigger" value={trigger} />
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor={`${trigger}-media`}>Média</Label>
                  <NativeSelect
                    id={`${trigger}-media`}
                    name="mediaAssetId"
                    defaultValue={media?.id ?? ""}
                    wrapperClassName="w-full"
                    aria-describedby={`${trigger}-media-help`}
                  >
                    <option value="">Aucun</option>
                    {mediaOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.filename}
                      </option>
                    ))}
                  </NativeSelect>
                  <p id={`${trigger}-media-help`} className="text-note text-muted-foreground">
                    Les médias se téléversent depuis Messages → Nouveau message.
                  </p>
                </div>
                <Button type="submit" variant="outline" className="max-md:h-10 sm:mb-6">
                  Enregistrer le média
                </Button>
              </form>
              {media ? (
                <div className="space-y-2">
                  <p className="text-body font-medium text-foreground">Média actuel</p>
                  {media.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${media.id}`}
                      alt={`Média joint : ${media.filename}`}
                      className="max-h-40 rounded-lg border border-border object-contain"
                    />
                  ) : media.mimeType.startsWith("video/") ? (
                    <video
                      src={`/api/media/${media.id}`}
                      controls
                      aria-label={`Vidéo jointe : ${media.filename}`}
                      className="max-h-40 rounded-lg border border-border"
                    />
                  ) : (
                    <a
                      href={`/api/media/${media.id}`}
                      className="text-body font-medium text-brand-ink underline underline-offset-4"
                    >
                      {media.filename}
                    </a>
                  )}
                </div>
              ) : null}
            </div>
          </FormSection>
        ) : null}
      </div>
    </section>
  );
}
