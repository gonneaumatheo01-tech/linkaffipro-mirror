import { z } from "zod";

export const buttonSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Un bouton n'a pas de libellé : écrivez le texte du bouton ou supprimez-le.")
    .max(64, "Le libellé d'un bouton ne peut pas dépasser 64 caractères."),
  type: z.enum(["URL", "BUTTON", "OFFER"]),
  url: z.string().trim().optional(),
  trackingLinkId: z.string().optional(),
  slug: z.string().optional(),
  affiliateCampaignId: z.string().optional(),
  campaignId: z.string().optional(),
});

export const postFormSchema = z.object({
  channelIds: z.array(z.string().min(1)).min(1, "Choisissez au moins un canal."),
  scheduledAt: z.string().optional(),
  categoryId: z.string().optional(),
  language: z
    .string()
    .trim()
    .min(2, "La langue doit être un code de 2 à 5 lettres (ex. fr).")
    .max(5, "La langue doit être un code de 2 à 5 lettres (ex. fr).")
    .default("fr"),
  text: z.string().default(""),
  mediaAssetIds: z.array(z.string()).default([]),
  buttons: z.array(z.array(buttonSchema)).default([]),
  pinAfterSend: z.boolean().default(false),
  unpinPrevious: z.boolean().default(false),
  deleteAfterMinutes: z
    .number()
    .int("« Supprimer après » doit être un nombre entier de minutes.")
    .positive("« Supprimer après » doit être un nombre de minutes supérieur à 0.")
    .nullable()
    .default(null),
  disableNotification: z.boolean().default(false),
  protectContent: z.boolean().default(false),
  disableLinkPreview: z.boolean().default(true),
  intent: z.enum(["draft", "schedule", "template"]),
  templateName: z
    .string()
    .trim()
    .max(80, "Le nom du modèle ne peut pas dépasser 80 caractères.")
    .optional(),
  duplicatedFromId: z.string().optional(),
  // Test A/B (création seulement) : version B publiée 30 min après A dans le même canal, ou dans un autre canal.
  abEnabled: z.boolean().default(false),
  abMode: z.enum(["same-channel", "other-channel"]).default("same-channel"),
  abChannelId: z.string().optional(),
  abDelayMinutes: z.number().default(30),
  textB: z.string().default(""),
  mediaAssetIdsB: z.array(z.string()).default([]),
  buttonsB: z.array(z.array(buttonSchema)).default([]),
  // Emojis animés ET boutons dans un message de canal (phase 12) : « emojis » (publié par le compte connecté, sans
  // boutons) ou « buttons » (publié par le bot, emojis animés remplacés par leurs emojis normaux).
  emojiButtonsChoice: z
    .enum(["emojis", "buttons"], {
      error: "Choisissez « Garder les emojis animés » ou « Garder les boutons ».",
    })
    .optional(),
});

export type PostFormInput = z.infer<typeof postFormSchema>;

/** Lit le formulaire (champs cachés JSON + cases à cocher). */
export function parsePostForm(fd: FormData) {
  return postFormSchema.safeParse(postFormRaw(fd));
}

/**
 * Valeurs brutes du formulaire, avant validation (phase 34 : le cœur partagé avec Kevin valide lui-même par
 * `postFormSchema`).
 */
export function postFormRaw(fd: FormData): Record<string, unknown> {
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
  return {
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
    abEnabled: fd.get("abEnabled") === "1",
    abMode: String(fd.get("abMode") ?? "same-channel"),
    abChannelId: String(fd.get("abChannelId") ?? "") || undefined,
    abDelayMinutes: Number(String(fd.get("abDelayMinutes") ?? "30").trim() || 30),
    textB: String(fd.get("textB") ?? ""),
    mediaAssetIdsB: json("mediaAssetIdsB", []),
    buttonsB: json("buttonsB", []),
    emojiButtonsChoice: String(fd.get("emojiButtonsChoice") ?? "") || undefined,
  };
}
