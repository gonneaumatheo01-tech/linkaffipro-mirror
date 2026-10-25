/** Phase 34, lot B — petits constructeurs de schémas JSON stricts (paramètres envoyés à l'IA). Pur. */

export type JsonSchema = Record<string, unknown>;

export const s = {
  str: (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "string", description, ...extra }),
  int: (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: "integer", description, ...extra }),
  bool: (description: string): JsonSchema => ({ type: "boolean", description }),
  enum: (description: string, values: readonly string[]): JsonSchema => ({ type: "string", enum: [...values], description }),
  list: (description: string, items: JsonSchema = { type: "string" }): JsonSchema => ({ type: "array", items, description }),
};

/** Objet strict : seuls les champs décrits sont acceptés. */
export function obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Canal désigné par une phrase (titre, @nom, lien t.me) ou par son identifiant. */
export const CHANNEL = {
  channel: s.str("Canal visé : son nom, son @nom ou son lien t.me (ex. « Zone Interdite », « t.me/zone_interdite »)."),
  channelId: s.str("Identifiant du canal, si déjà connu (choix d'une liste)."),
};

/** Message transféré à Kevin (`ForwardedContent` du contrat) : texte HTML Telegram et emojis animés gardés tels quels. */
export const FORWARDED = {
  type: "object",
  description: "Message transféré à Kevin, repris tel quel (rempli par Kevin, jamais réécrit).",
  properties: {
    html: { type: "string" },
    media: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string" }, fileId: { type: "string" } },
        required: ["kind", "fileId"],
        additionalProperties: false,
      },
    },
    from: { type: ["string", "null"] },
    receivedAt: { type: "string" },
  },
  required: ["html", "media", "receivedAt"],
  additionalProperties: false,
} as const;
