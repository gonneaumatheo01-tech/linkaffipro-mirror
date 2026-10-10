/** Contexte transmis à l'assistant IA depuis le formulaire de message (fonctions pures, testées). */
import type { AiVertical } from "@linkaffipro/ai/types";
import type { PostButtonRow } from "@/lib/posts/buttons";
import { toAiVertical } from "@/components/ai/improve-logic";

/**
 * Univers du message, dans l'ordre : campagne du premier bouton « Offre » (c'est elle qui détermine l'offre),
 * univers du modèle, premier canal coché qui a un univers. Null si rien n'est connu (modifiable dans le panneau).
 */
export function resolvePostVertical(input: {
  rows: PostButtonRow[];
  campaigns: Array<{ id: string; vertical: string | null }>;
  channels: Array<{ id: string; vertical?: string | null }>;
  channelIds: string[];
  templateVertical?: string | null;
}): AiVertical | null {
  for (const row of input.rows)
    for (const b of row) {
      if (b.type !== "OFFER" || !b.campaignId) continue;
      const v = toAiVertical(input.campaigns.find((c) => c.id === b.campaignId)?.vertical);
      if (v) return v;
    }
  const t = toAiVertical(input.templateVertical);
  if (t) return t;
  for (const id of input.channelIds) {
    const v = toAiVertical(input.channels.find((c) => c.id === id)?.vertical);
    if (v) return v;
  }
  return null;
}
