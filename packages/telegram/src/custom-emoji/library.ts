/**
 * Bibliothèque des emojis animés (phase 12) : ajout depuis un message envoyé au bot par un utilisateur de la plateforme
 * (source FORWARD). Jamais de doublon (unicité de `customEmojiId`) ; un emoji retiré de la bibliothèque y revient.
 * Les aperçus sont récupérés ensuite par le worker (file `custom-emoji`, tâche `fetch-previews`).
 */
import { audit, prisma, recordEvent } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import type { CustomEmojiAddOutcome, ExtractedCustomEmoji } from "./extract";

export type AddCustomEmojisInput = {
  emojis: ExtractedCustomEmoji[];
  /** Expéditeur (utilisateur de la plateforme ou admin du dialogue). */
  telegramUserId: bigint;
  /** Bot qui a reçu le message. */
  botId: string;
};

/** Enregistre les emojis animés d'un message (upsert par identifiant), journalise et enfile leurs aperçus. */
export async function addCustomEmojisToLibrary(
  input: AddCustomEmojisInput,
): Promise<CustomEmojiAddOutcome> {
  const byId = new Map<string, string>();
  for (const e of input.emojis)
    if (!byId.has(e.customEmojiId)) byId.set(e.customEmojiId, e.fallback);
  const ids = [...byId.keys()];
  if (ids.length === 0) return { added: [], restored: [], already: [] };

  const user = await prisma.user.findFirst({
    where: { telegramUserId: input.telegramUserId, isActive: true },
    select: { id: true },
  });
  const existing = await prisma.customEmoji.findMany({
    where: { customEmojiId: { in: ids } },
    select: { customEmojiId: true, hiddenAt: true },
  });
  const known = new Set(existing.map((e) => e.customEmojiId));

  // Retirés de la bibliothèque : ils redeviennent visibles (seuls ceux encore retirés au moment de l'écriture).
  const hidden = existing.filter((e) => e.hiddenAt).map((e) => e.customEmojiId);
  let restored: string[] = [];
  if (hidden.length > 0) {
    const rows = await prisma.customEmoji.updateManyAndReturn({
      where: { customEmojiId: { in: hidden }, hiddenAt: { not: null } },
      data: { hiddenAt: null },
      select: { customEmojiId: true },
    });
    restored = rows.map((r) => r.customEmojiId);
  }

  // Nouveaux : insertion sans doublon même si deux messages arrivent en même temps (seuls les vrais ajouts reviennent).
  const missing = ids.filter((id) => !known.has(id));
  const created =
    missing.length === 0
      ? []
      : await prisma.customEmoji.createManyAndReturn({
          data: missing.map((customEmojiId) => ({
            customEmojiId,
            fallback: byId.get(customEmojiId) ?? "",
            source: "FORWARD" as const,
            addedById: user?.id ?? null,
          })),
          skipDuplicates: true,
          select: { customEmojiId: true },
        });
  const added = created.map((r) => r.customEmojiId);
  const changed = new Set([...added, ...restored]);
  const already = ids.filter((id) => !changed.has(id));

  if (changed.size > 0) {
    await recordEvent({
      type: "custom_emoji.added",
      botId: input.botId,
      payload: {
        count: changed.size,
        source: "FORWARD",
        ids: [...changed],
        restored,
        userId: user?.id ?? null,
        telegramUserId: input.telegramUserId.toString(),
      },
    });
  }
  if (restored.length > 0) {
    await audit({
      userId: user?.id ?? null,
      action: "custom_emoji.restored",
      entityType: "CustomEmoji",
      entityId: restored[0]!,
      metadata: {
        customEmojiIds: restored,
        via: "bot",
        telegramUserId: input.telegramUserId.toString(),
      },
    });
  }
  // Aperçus des nouveaux (et des revenus sans aperçu) : jamais bloquant ; le passage périodique du worker rattrape.
  if (changed.size > 0) {
    try {
      await enqueue("custom-emoji", { type: "fetch-previews", customEmojiIds: [...changed] });
    } catch (err) {
      console.warn("[custom-emoji] aperçus non enfilés", (err as Error).message);
    }
  }
  return { added, restored, already };
}
