import { prisma } from "@linkaffipro/db";
import { SEQUENCE_TRIGGERS, defaultSequenceName, defaultSequenceText } from "./defaults";

/**
 * Crée les séquences par défaut manquantes d'un canal (une étape en français par déclencheur).
 * Idempotent : une séquence existante (même inactive) n'est jamais recréée ni modifiée.
 */
export async function ensureDefaultSequences(channelId: string): Promise<{ created: string[] }> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, vertical: true } });
  if (!channel) return { created: [] };
  const existing = await prisma.sequence.findMany({ where: { channelId }, select: { trigger: true } });
  const have = new Set(existing.map((s) => s.trigger as string));
  const created: string[] = [];
  for (const trigger of SEQUENCE_TRIGGERS) {
    if (have.has(trigger)) continue;
    await prisma.sequence.create({
      data: {
        name: defaultSequenceName(trigger),
        channelId,
        trigger,
        isActive: true,
        steps: { create: [{ order: 0, delaySeconds: 0, texts: { fr: defaultSequenceText(channel.vertical, trigger) }, buttons: [] }] },
      },
    });
    created.push(trigger);
  }
  return { created };
}

/** Crée les séquences manquantes de tous les canaux. */
export async function backfillDefaultSequences(): Promise<Array<{ channelId: string; title: string; created: string[] }>> {
  const channels = await prisma.channel.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "asc" } });
  const out: Array<{ channelId: string; title: string; created: string[] }> = [];
  for (const c of channels) {
    const { created } = await ensureDefaultSequences(c.id);
    out.push({ channelId: c.id, title: c.title, created });
  }
  return out;
}
