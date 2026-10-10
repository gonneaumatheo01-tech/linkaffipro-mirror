import { prisma } from "@linkaffipro/db";
import {
  SEQUENCE_TRIGGERS,
  defaultSequenceName,
  defaultSequenceText,
  type SequenceTriggerKey,
} from "./defaults";

/**
 * Crée les séquences par défaut manquantes d'un canal (une étape en français par déclencheur).
 * Idempotent et sûr en parallèle : une séquence existante (même inactive) n'est jamais recréée ni modifiée ;
 * l'unicité (canal, déclencheur) en base et `skipDuplicates` empêchent les doublons quand plusieurs bots
 * découvrent le même canal au même instant.
 */
export async function ensureDefaultSequences(channelId: string): Promise<{ created: string[] }> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, vertical: true },
  });
  if (!channel) return { created: [] };
  const existing = await prisma.sequence.findMany({
    where: { channelId },
    select: { trigger: true },
  });
  const have = new Set(existing.map((s) => s.trigger as string));
  const missing = SEQUENCE_TRIGGERS.filter((trigger) => !have.has(trigger));
  if (missing.length === 0) return { created: [] };
  const created = await prisma.$transaction(async (tx) => {
    // Seules les séquences réellement insérées par cet appel sont renvoyées (les autres existaient déjà).
    const rows = await tx.sequence.createManyAndReturn({
      data: missing.map((trigger) => ({
        name: defaultSequenceName(trigger),
        channelId,
        trigger,
        isActive: true,
      })),
      skipDuplicates: true,
      select: { id: true, trigger: true },
    });
    if (rows.length > 0) {
      await tx.sequenceStep.createMany({
        data: rows.map((r) => ({
          sequenceId: r.id,
          order: 0,
          delaySeconds: 0,
          texts: { fr: defaultSequenceText(channel.vertical, r.trigger as SequenceTriggerKey) },
          buttons: [],
        })),
      });
    }
    return rows.map((r) => r.trigger as string);
  });
  return { created: SEQUENCE_TRIGGERS.filter((t) => created.includes(t)) };
}

/** Crée les séquences manquantes de tous les canaux. */
export async function backfillDefaultSequences(): Promise<
  Array<{ channelId: string; title: string; created: string[] }>
> {
  const channels = await prisma.channel.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const out: Array<{ channelId: string; title: string; created: string[] }> = [];
  for (const c of channels) {
    const { created } = await ensureDefaultSequences(c.id);
    out.push({ channelId: c.id, title: c.title, created });
  }
  return out;
}
