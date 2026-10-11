/** Univers d'affiliation. Les valeurs correspondent à l'enum Prisma `Vertical`. */
export const VERTICALS = ["CASINO", "SPORTS", "DATING"] as const;
export type Vertical = (typeof VERTICALS)[number];

/** Libellés français des univers (affichage). */
export const VERTICAL_LABELS: Record<Vertical, string> = {
  CASINO: "Casino",
  SPORTS: "Paris sportifs",
  DATING: "Rencontres",
};

/** Rôles des utilisateurs internes. Valeurs identiques à l'enum Prisma `Role`. */
export const ROLES = ["ADMIN", "MANAGER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  MANAGER: "Manager",
};

/** Mises à jour Telegram demandées pour chaque webhook. */
export const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  "chat_member",
  "my_chat_member",
  "chat_join_request",
  "message_reaction",
  "message_reaction_count",
] as const;

export function isVertical(value: unknown): value is Vertical {
  return typeof value === "string" && (VERTICALS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
