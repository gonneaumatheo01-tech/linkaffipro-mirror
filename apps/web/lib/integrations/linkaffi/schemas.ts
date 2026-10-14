import { z } from "zod";
import { IntegrationError } from "./http";

/**
 * Validation stricte des appels de Link Affi (types, longueurs, formats), messages en français par champ. Les champs
 * inconnus sont ignorés (Link Affi peut en ajouter sans casser l'intégration).
 */

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Nature d'une valeur reçue, en mots (messages d'erreur). */
function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "une liste";
  switch (typeof v) {
    case "number":
      return "un nombre";
    case "boolean":
      return "un booléen";
    case "string":
      return "un texte";
    case "object":
      return "un objet";
    default:
      return typeof v;
  }
}

/**
 * Message d'un champ du mauvais type : « obligatoire » seulement s'il est absent ; présent mais d'un autre type, le
 * type attendu et le type reçu (un nombre envoyé pour un texte n'est pas un champ manquant).
 */
function typeError(field: string, missing: string, expected = "un texte") {
  return (issue: { input?: unknown }) =>
    issue.input === undefined
      ? `« ${field} » est obligatoire : ${missing}`
      : `« ${field} » doit être ${expected} (reçu : ${describeType(issue.input)}).`;
}

/** Durée d'attribution maximale acceptée (10 ans) ; 0 ou null = à vie ; absente = non précisée. */
export const MAX_ATTRIBUTION_DAYS = 3650;

const campaignKey = z
  .string({
    error: typeError("campaignKey", "la clé du lien de l'affilié (celle de linkaffi.me/go/<clé>)."),
  })
  .trim()
  .regex(KEY_RE, {
    error:
      "« campaignKey » doit faire de 1 à 64 caractères parmi les lettres, les chiffres, « _ » et « - ».",
  });

export const createInviteLinkSchema = z.object(
  {
    campaignKey,
    campaignName: z
      .string({ error: typeError("campaignName", "le nom de la campagne Telegram.") })
      .trim()
      .min(1, { error: "« campaignName » ne peut pas être vide." })
      .max(200, { error: "« campaignName » est trop long : 200 caractères au plus." }),
    affiliateId: z
      .union([z.string(), z.number()], {
        error: typeError(
          "affiliateId",
          "l'identifiant de l'affilié dans Link Affi.",
          "un texte ou un nombre",
        ),
      })
      .transform((v) => String(v).trim())
      .pipe(
        z
          .string()
          .min(1, { error: "« affiliateId » ne peut pas être vide." })
          .max(128, { error: "« affiliateId » est trop long : 128 caractères au plus." }),
      ),
    // Facultatif. Absent = non précisé (un lien existant garde son nom) ; null ou vide = pas de nom.
    affiliateName: z
      .string({
        error: (issue) =>
          `« affiliateName » doit être un texte (le nom de l'affilié) ou null (reçu : ${describeType(issue.input)}).`,
      })
      .trim()
      .max(200, { error: "« affiliateName » est trop long : 200 caractères au plus." })
      .nullish()
      .transform((v) => (v === undefined ? undefined : v || null)),
    channelId: z
      .string({
        error: typeError("channelId", "l'identifiant d'un canal donné par GET /channels."),
      })
      .trim()
      .min(1, { error: "« channelId » ne peut pas être vide." })
      .max(64, { error: "« channelId » est trop long : ce n'est pas un identifiant de canal." }),
    attributionDays: z
      .number({
        error:
          "« attributionDays » doit être un nombre entier de jours, ou null pour une attribution à vie.",
      })
      .int({ error: "« attributionDays » doit être un nombre entier de jours." })
      .min(0, { error: "« attributionDays » ne peut pas être négatif." })
      .max(MAX_ATTRIBUTION_DAYS, {
        error: `« attributionDays » est trop grand : ${MAX_ATTRIBUTION_DAYS} jours au plus (ou null pour « à vie »).`,
      })
      .nullish()
      // Absent = non précisé (un lien existant garde sa durée, un nouveau lien est « à vie ») ; null ou 0 = à vie.
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
  },
  { error: "Le corps de la requête doit être un objet JSON." },
);
export type CreateInviteLinkInput = z.output<typeof createInviteLinkSchema>;

export const patchInviteLinkSchema = z.object(
  {
    isActive: z.boolean({
      error: typeError("isActive", "false pour désactiver le lien.", "un booléen (true ou false)"),
    }),
  },
  { error: "Le corps de la requête doit être un objet JSON." },
);
export type PatchInviteLinkInput = z.output<typeof patchInviteLinkSchema>;

export const membersQuerySchema = z.object({
  campaignKey,
  since: z
    .string({ error: "« since » doit être une date." })
    .trim()
    .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s)), {
      error: "« since » doit être une date ISO 8601, par exemple 2026-10-14T08:00:00Z.",
    })
    .transform((s) => new Date(s))
    .optional(),
});
export type MembersQuery = z.output<typeof membersQuerySchema>;

/** Valide ou lève une erreur 400 `{ error, message, details }` en français. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
  code: "invalid_body" | "invalid_query",
): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const details = r.error.issues.map((i) => ({
    field: i.path.map(String).join(".") || (code === "invalid_body" ? "corps" : "adresse"),
    message: i.message,
  }));
  const intro = code === "invalid_body" ? "Requête invalide : " : "Paramètres invalides : ";
  throw new IntegrationError(
    400,
    code,
    `${intro}${details.map((d) => d.message).join(" ")}`,
    {},
    details,
  );
}

/** Taille maximale d'un corps de requête (quelques centaines d'octets attendus). */
export const MAX_BODY_BYTES = 16_384;

/** Lit le corps JSON d'une requête (taille bornée) ou lève une erreur 400 / 413 en français. */
export async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES)
    throw new IntegrationError(
      413,
      "payload_too_large",
      `Corps trop volumineux : ${MAX_BODY_BYTES} octets au plus.`,
    );
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES)
    throw new IntegrationError(
      413,
      "payload_too_large",
      `Corps trop volumineux : ${MAX_BODY_BYTES} octets au plus.`,
    );
  if (!text.trim())
    throw new IntegrationError(
      400,
      "invalid_json",
      "Corps vide : envoyez un objet JSON (en-tête « Content-Type: application/json »).",
    );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new IntegrationError(
      400,
      "invalid_json",
      "Le corps de la requête n'est pas du JSON valide.",
    );
  }
}
