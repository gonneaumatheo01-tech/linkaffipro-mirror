"use client";

import { useRouter } from "next/navigation";
import type { AiVertical } from "@linkaffipro/ai/types";
import type { SequenceTriggerKey } from "@linkaffipro/telegram";
import { AiTextarea } from "@/components/ai/ai-textarea";
import { saveSequenceTranslationsAction } from "./actions";

/**
 * Texte d'un message du bot (une langue) avec « ✨ Améliorer avec l'IA ». Le champ reste soumis par son `name`
 * (bouton « Enregistrer » du formulaire). « Traduire dans les langues du bot » enregistre directement les autres
 * langues de ce message, puis recharge la fiche.
 */
export function SequenceTextField({
  id,
  channelId,
  trigger,
  lang,
  defaultValue,
  vertical,
  hasMedia,
}: {
  id: string;
  channelId: string;
  trigger: SequenceTriggerKey;
  lang: string;
  defaultValue: string;
  vertical: AiVertical | null;
  hasMedia: boolean;
}) {
  const router = useRouter();
  return (
    <AiTextarea
      id={id}
      name="text"
      defaultValue={defaultValue}
      rows={6}
      className="font-mono text-xs"
      required={lang === "fr"}
      context={{ surface: "bot_text", vertical, language: lang, hasMedia }}
      onTranslations={async (texts) => {
        const r = await saveSequenceTranslationsAction({ channelId, trigger, texts });
        if (!r.ok) throw new Error(r.error);
        router.refresh();
      }}
    />
  );
}
