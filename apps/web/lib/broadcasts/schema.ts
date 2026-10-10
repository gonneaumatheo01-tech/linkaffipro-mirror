import { z } from "zod";
import { parseSegment, type Segment } from "@linkaffipro/core";
import { buttonSchema } from "@/lib/posts/schema";
import { splitTags } from "./group";

export { splitTags };

export const broadcastFormSchema = z.object({
  name: z.string().trim().min(1, "Donnez un nom à l'envoi.").max(120),
  botId: z.string().min(1, "Choisissez un bot."),
  text: z.string().trim().min(1, "Le texte est vide."),
  buttons: z.array(z.array(buttonSchema)).default([]),
  mediaAssetId: z.string().optional(),
  scheduledAt: z.string().optional(),
  intent: z.enum(["draft", "now", "schedule"]),
});
export type BroadcastFormInput = z.infer<typeof broadcastFormSchema> & { segment: Segment };

function json(fd: FormData, key: string, fallback: unknown): unknown {
  const raw = fd.get(key);
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Lit le segment depuis les champs du formulaire (listes à cocher, textes). */
export function parseSegmentForm(fd: FormData): Segment {
  const list = (k: string) => fd.getAll(k).map(String).filter(Boolean);
  const csv = (k: string) =>
    String(fd.get(k) ?? "")
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  return parseSegment({
    channelIds: list("channelIds"),
    membershipStatuses: list("membershipStatuses"),
    spendLevels: list("spendLevels"),
    inviteLinkIds: list("inviteLinkIds"),
    campaignIds: list("campaignIds"),
    languages: csv("languages").map((l) => l.toLowerCase()),
    inactiveDays: String(fd.get("inactiveDays") ?? "").trim() || undefined,
    clickedCategoryIds: list("clickedCategoryIds"),
    tags: splitTags(String(fd.get("tags") ?? "")),
  });
}

export function parseBroadcastForm(fd: FormData) {
  const parsed = broadcastFormSchema.safeParse({
    name: String(fd.get("name") ?? ""),
    botId: String(fd.get("botId") ?? ""),
    text: String(fd.get("text") ?? ""),
    buttons: json(fd, "buttons", []),
    mediaAssetId: String(fd.get("mediaAssetId") ?? "") || undefined,
    scheduledAt: String(fd.get("scheduledAt") ?? "") || undefined,
    intent: String(fd.get("intent") ?? "draft"),
  });
  if (!parsed.success) return parsed;
  return { success: true as const, data: { ...parsed.data, segment: parseSegmentForm(fd) } };
}
