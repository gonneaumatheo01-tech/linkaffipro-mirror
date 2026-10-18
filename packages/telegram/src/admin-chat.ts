/**
 * Dialogue avec l'administrateur par Telegram : découpage des messages et choix de l'identifiant.
 * Fonctions pures, testées ; l'accès base est dans les scripts.
 */

export const TELEGRAM_MAX_MESSAGE = 4000;

/** Découpe un texte (HTML Telegram) en morceaux ≤ max, de préférence aux sauts de ligne puis aux espaces. */
export function splitMessage(text: string, max = TELEGRAM_MAX_MESSAGE): string[] {
  const out: string[] = [];
  let rest = text.replace(/\r\n/g, "\n").trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

export type MemberStart = { telegramUserId: bigint; username: string | null; firstName: string | null; startedAt: Date };

export type AdminCandidateInput = {
  /** Identifiant déjà mémorisé dans Setting `admin.telegramUserId`. */
  settingId?: bigint | null;
  /** `User.telegramUserId` du premier ADMIN. */
  adminUserTelegramId?: bigint | null;
  /** Variable ADMIN_TELEGRAM_USERNAME (avec ou sans @). */
  envUsername?: string | null;
  /** Membres ayant fait /start sur le bot casino, du plus récent au plus ancien. */
  starts: MemberStart[];
};

export type AdminCandidate =
  | { id: bigint; source: "setting" | "user" | "username" }
  | { id: bigint; source: "last-start"; needsConfirmation: true; member: MemberStart }
  | null;

/** Choisit l'identifiant Telegram de l'administrateur selon l'ordre de priorité documenté. */
export function chooseAdminTelegramId(input: AdminCandidateInput): AdminCandidate {
  if (input.settingId) return { id: input.settingId, source: "setting" };
  if (input.adminUserTelegramId) return { id: input.adminUserTelegramId, source: "user" };
  const wanted = input.envUsername?.replace(/^@/, "").trim().toLowerCase();
  if (wanted) {
    const m = input.starts.find((s) => s.username?.toLowerCase() === wanted);
    if (m) return { id: m.telegramUserId, source: "username" };
  }
  const last = input.starts[0];
  if (last) return { id: last.telegramUserId, source: "last-start", needsConfirmation: true, member: last };
  return null;
}

export type InboxMessage = { at: Date; text: string; updateId?: number };

/** Messages de l'admin lus au plus par `tg:inbox` (les plus récents). */
export const INBOX_LIMIT = 500;

/**
 * Filtre des messages privés de l'admin dans `Event` (`telegram.message`), fait PAR LA BASE : chat privé, expéditeur =
 * l'admin, reçus par un bot qui n'est pas un assistant de conversation (ses messages y sont sans texte). Sans ce filtre,
 * les messages des personnes qui écrivent à l'assistant passeraient avant ceux de l'admin dans la limite de lecture.
 */
export function adminInboxWhere(adminId: bigint, since: Date) {
  return {
    type: "telegram.message",
    occurredAt: { gte: since },
    AND: [
      { payload: { path: ["message", "chat", "type"], equals: "private" } },
      { payload: { path: ["message", "from", "id"], equals: Number(adminId) } },
    ],
    NOT: { bot: { is: { mode: "ASSISTANT" as const } } },
  };
}

/** Extrait, d'un payload d'événement `telegram.message`, le message privé s'il vient de l'admin. */
export function inboxMessageFromPayload(payload: unknown, adminId: bigint): InboxMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const upd = payload as { update_id?: number; message?: { date?: number; text?: string; caption?: string; chat?: { type?: string }; from?: { id?: number | string } } };
  const msg = upd.message;
  if (!msg || msg.chat?.type !== "private" || msg.from?.id === undefined) return null;
  if (String(msg.from.id) !== adminId.toString()) return null;
  const text = msg.text ?? msg.caption ?? "";
  if (!text) return null;
  return { at: new Date((msg.date ?? 0) * 1000), text, updateId: upd.update_id };
}

/** Formate une ligne de l'inbox : heure Europe/Paris + texte. */
export function formatInboxLine(m: InboxMessage): string {
  const time = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(m.at);
  return `[${time}] ${m.text}`;
}
