import { z } from "zod";

export const buttonSchema = z.object({
  text: z.string().trim().min(1, "Libellé de bouton vide.").max(64),
  type: z.enum(["URL", "BUTTON", "OFFER"]),
  url: z.string().trim().optional(),
  trackingLinkId: z.string().optional(),
  slug: z.string().optional(),
  affiliateCampaignId: z.string().optional(),
});

export const postFormSchema = z.object({
  channelIds: z.array(z.string().min(1)).min(1, "Choisissez au moins un canal."),
  scheduledAt: z.string().optional(),
  categoryId: z.string().optional(),
  language: z.string().trim().min(2).max(5).default("fr"),
  text: z.string().default(""),
  mediaAssetIds: z.array(z.string()).default([]),
  buttons: z.array(z.array(buttonSchema)).default([]),
  pinAfterSend: z.boolean().default(false),
  unpinPrevious: z.boolean().default(false),
  deleteAfterMinutes: z.number().int().positive().nullable().default(null),
  disableNotification: z.boolean().default(false),
  protectContent: z.boolean().default(false),
  disableLinkPreview: z.boolean().default(true),
  intent: z.enum(["draft", "schedule", "template"]),
  templateName: z.string().trim().max(80).optional(),
  duplicatedFromId: z.string().optional(),
});

export type PostFormInput = z.infer<typeof postFormSchema>;

/** Lit le formulaire (champs cachés JSON + cases à cocher). */
export function parsePostForm(fd: FormData) {
  const json = (k: string, fallback: unknown) => {
    const raw = fd.get(k);
    if (typeof raw !== "string" || raw === "") return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const del = String(fd.get("deleteAfterMinutes") ?? "").trim();
  return postFormSchema.safeParse({
    channelIds: fd.getAll("channelIds").map(String),
    scheduledAt: String(fd.get("scheduledAt") ?? ""),
    categoryId: String(fd.get("categoryId") ?? "") || undefined,
    language: String(fd.get("language") ?? "fr"),
    text: String(fd.get("text") ?? ""),
    mediaAssetIds: json("mediaAssetIds", []),
    buttons: json("buttons", []),
    pinAfterSend: fd.get("pinAfterSend") === "on",
    unpinPrevious: fd.get("unpinPrevious") === "on",
    deleteAfterMinutes: del ? Number(del) : null,
    disableNotification: fd.get("disableNotification") === "on",
    protectContent: fd.get("protectContent") === "on",
    disableLinkPreview: fd.get("disableLinkPreview") === "on",
    intent: String(fd.get("intent") ?? "draft"),
    templateName: String(fd.get("templateName") ?? "") || undefined,
    duplicatedFromId: String(fd.get("duplicatedFromId") ?? "") || undefined,
  });
}
