"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bold, EyeOff, Italic, Link2, Smile, Strikethrough, Underline } from "lucide-react";
import type { AiVertical } from "@linkaffipro/ai/types";
import { ImproveButton } from "@/components/ai/improve-button";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PLACEHOLDER_CHIPS,
  fillExamples,
  wrapSelection,
  type BotMoment,
  type PlaceholderExamples,
} from "@/lib/channels/bot-messages";

/**
 * Outils de mise en forme : les mêmes que l'éditeur des messages (Messages → Nouveau message), pour le même geste.
 * À terme, un seul composant partagé avec `post-form.tsx` (voir le rapport de la phase 9).
 */
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
 * Texte d'un message du bot dans une langue : barre d'outils (gras, italique, lien, émojis, « ✨ Améliorer avec
 * l'IA ») collée à la zone de texte, mots à insérer en un clic (prénom, nom du canal…), et l'aperçu Telegram mis à jour
 * pendant la frappe (mots remplacés par des exemples). Le champ est soumis par son `name` avec le formulaire
 * « Enregistrer ». « Traduire dans les langues du bot » enregistre directement les autres langues, puis recharge.
 */
export function BotTextEditor({
  id,
  label,
  defaultValue,
  required,
  examples,
  buttons,
  mediaCount,
  context,
  channelId,
  moment,
  saveTranslations,
}: {
  id: string;
  label: string;
  defaultValue: string;
  required: boolean;
  examples: PlaceholderExamples;
  buttons: Array<Array<{ text: string }>>;
  mediaCount: number;
  context: { vertical: AiVertical | null; language: string; hasMedia: boolean };
  channelId: string;
  moment: BotMoment;
  /** Action serveur qui enregistre les traductions de l'assistant ; renvoie une erreur lisible sinon. */
  saveTranslations: (input: {
    channelId: string;
    trigger: BotMoment;
    texts: Partial<Record<string, string>>;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const ta = useRef<HTMLTextAreaElement>(null);
  // Sélection gardée quand le focus part dans le menu des émojis.
  const sel = useRef<{ start: number; end: number }>({
    start: defaultValue.length,
    end: defaultValue.length,
  });
  function remember() {
    const el = ta.current;
    if (el) sel.current = { start: el.selectionStart, end: el.selectionEnd };
  }
  function apply(open: string, close = "", fromMenu = false) {
    const el = ta.current;
    if (!el) return;
    const start = fromMenu ? sel.current.start : el.selectionStart;
    const end = fromMenu ? sel.current.end : el.selectionEnd;
    const r = wrapSelection(value, start, end, open, close);
    setValue(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.selectionStart, r.selectionEnd);
      sel.current = { start: r.selectionStart, end: r.selectionEnd };
    });
  }
  function insertLink() {
    const url = window.prompt("Adresse du lien (https://…)");
    if (!url) return;
    apply(`<a href="${url.replace(/"/g, "%22")}">`, "</a>");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <Label htmlFor={id}>{label}</Label>
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
                className="max-md:size-10"
                onClick={() => (t.link ? insertLink() : apply(t.open, t.close))}
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
                    className="max-md:size-10"
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
                        onClick={() => apply(e, "", true)}
                      >
                        {e}
                      </DropdownMenuItem>
                    ))}
                  </div>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto">
              <ImproveButton
                getText={() => value}
                setText={setValue}
                context={{ surface: "bot_text", ...context }}
                onTranslations={async (texts) => {
                  const r = await saveTranslations({ channelId, trigger: moment, texts });
                  if (!r.ok) throw new Error(r.error);
                  router.refresh();
                }}
                size="sm"
              />
            </div>
          </div>
          <Textarea
            ref={ta}
            id={id}
            name="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onSelect={remember}
            onKeyUp={remember}
            onBlur={remember}
            rows={8}
            required={required}
            aria-describedby={`${id}-help`}
            className="min-h-40 rounded-t-none border-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Insérer">
          <span className="mr-1 text-note text-muted-foreground">Insérer :</span>
          {PLACEHOLDER_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => apply(`{${c.key}}`)}
              title={`Insère {${c.key}}, remplacé par le bot pour chaque personne`}
              className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-3 text-note font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:h-10"
            >
              {c.label}
            </button>
          ))}
        </div>
        <p id={`${id}-help`} className="text-note text-muted-foreground">
          Utilisez la barre d&apos;outils pour le gras, l&apos;italique et les liens. Les mots entre
          accolades, comme {"{prenom}"}, sont remplacés par le bot pour chaque personne.
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-body font-medium text-foreground">Aperçu</p>
        <TelegramPreview
          html={fillExamples(value, examples)}
          buttons={buttons}
          mediaCount={mediaCount}
        />
      </div>
    </div>
  );
}
