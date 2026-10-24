/**
 * Phase 26, section 4 — un message du groupe s'adresse-t-il à Kevin ? Oui pour : une mention `@<bot>` (ou
 * `text_mention` du bot), une réponse à un de ses messages, son prénom en tête (« Kevin, … », « Salut Kevin … ») ou
 * une commande (`/aide@<bot>`, `/aide`). Tout le reste est ignoré : ni envoyé à l'IA, ni stocké en texte. Fonctions
 * pures (mode confidentialité activé ou non : seul ce qui arrive au bot change, pas la règle).
 */
import { normalizeText } from "../../human/answer";

export type GroupEntity = { type: string; offset: number; length: number; user?: { id: number | bigint; first_name?: string; username?: string; is_bot?: boolean } };

export type AddressedInput = {
  text: string;
  entities?: readonly GroupEntity[] | null;
  /** Auteur du message auquel celui-ci répond (null : pas une réponse). */
  replyToFromId?: bigint | number | null;
  botTelegramId: bigint | number;
  botUsername: string;
  bossName: string;
};

export type AddressedVia = "mention" | "reply" | "name" | "command";
export type Addressed = { addressed: boolean; via: AddressedVia | null; text: string };

const GREETING = "(?:salut|hello|hey|coucou|bonjour|bonsoir|yo|ok|dis|eh|he)";

function stripRange(text: string, offset: number, length: number): string {
  return `${text.slice(0, offset)}${text.slice(offset + length)}`;
}

/** Ponctuation et espaces en trop après le retrait d'une mention ou du prénom. */
function tidy(text: string): string {
  return text
    .replace(/^[\s,;:!.\-–—]+/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Retire le prénom en tête (« Kevin, … », « Salut Kevin : … ») ; rend null s'il n'y est pas. */
export function stripLeadingName(text: string, name: string): string | null {
  const n = normalizeText(name);
  if (!n) return null;
  // Accents retirés lettre par lettre (même longueur que le texte d'origine : on coupe ensuite l'original).
  const plain = Array.from(text, (ch) => {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return base.length === ch.length ? base : ch;
  }).join("");
  const nameRe = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(?:${GREETING}[\\s,!]+)?@?${nameRe}(?![\\p{L}\\p{N}_])[\\s,;:!.?\\-–—]*`, "iu");
  const m = re.exec(plain);
  if (!m) return null;
  return tidy(text.slice(m[0].length));
}

/** Analyse d'un message du groupe (pur). */
export function addressedToBoss(input: AddressedInput): Addressed {
  const text = input.text ?? "";
  const bot = input.botUsername.toLowerCase();
  const botId = String(input.botTelegramId);
  const entities = [...(input.entities ?? [])].sort((a, b) => b.offset - a.offset);

  // Commande : « /aide@kevin_bot » (ou « /aide » : Telegram ne l'envoie qu'aux bots concernés en mode confidentialité).
  const cmd = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (cmd) {
    if (cmd[2] && cmd[2].toLowerCase() !== bot) return { addressed: false, via: null, text };
    return { addressed: true, via: "command", text: text.trim() };
  }

  let mentioned = false;
  let rest = text;
  for (const e of entities) {
    const piece = text.slice(e.offset, e.offset + e.length);
    const isBot =
      (e.type === "mention" && piece.replace(/^@/, "").toLowerCase() === bot) ||
      (e.type === "text_mention" && e.user !== undefined && String(e.user.id) === botId);
    if (isBot) {
      mentioned = true;
      rest = stripRange(rest, e.offset, e.length);
    }
  }
  // Mention écrite sans entité (client ancien, texte collé).
  if (!mentioned && new RegExp(`(^|\\s)@${bot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "i").test(text)) {
    mentioned = true;
    rest = text.replace(new RegExp(`@${bot}(?![A-Za-z0-9_])`, "ig"), "");
  }
  if (mentioned) {
    const cleaned = tidy(rest);
    return { addressed: true, via: "mention", text: stripLeadingName(cleaned, input.bossName) ?? cleaned };
  }
  const byName = stripLeadingName(text, input.bossName);
  if (byName !== null) return { addressed: true, via: "name", text: byName };
  if (input.replyToFromId != null && String(input.replyToFromId) === botId) return { addressed: true, via: "reply", text: text.trim() };
  return { addressed: false, via: null, text };
}

export type MentionRef = { telegramUserId?: bigint | null; username?: string | null; firstName?: string | null };

/** Personnes mentionnées dans le message (hors Kevin et hors bots) (pur). */
export function mentionsOf(text: string, entities: readonly GroupEntity[] | null | undefined, botUsername: string, botTelegramId: bigint | number): MentionRef[] {
  const out: MentionRef[] = [];
  const bot = botUsername.toLowerCase();
  for (const e of entities ?? []) {
    if (e.type === "mention") {
      const u = text.slice(e.offset, e.offset + e.length).replace(/^@/, "");
      if (u && u.toLowerCase() !== bot) out.push({ username: u });
    } else if (e.type === "text_mention" && e.user && !e.user.is_bot && String(e.user.id) !== String(botTelegramId)) {
      out.push({ telegramUserId: BigInt(e.user.id), username: e.user.username ?? null, firstName: e.user.first_name ?? null });
    }
  }
  return out;
}

const ROLE_CLAIM =
  /\b(?:je\s+suis|j'?\s*suis|moi\s+c'?est)\s+(?:l'|le\s+|la\s+|un\s+|une\s+|ton\s+|ta\s+|votre\s+)?(?:admin(?:istrat(?:eur|rice))?|manager|responsable|chef|patron(?:ne)?|boss)\b|\b(?:donne|file|passe|mets?)[-\s]*(?:moi|nous)\s+(?:les\s+|tous\s+les\s+)?(?:droits?|acces|admin|role|manager)\b|\bfais[-\s]*(?:moi|nous)\s+(?:admin|manager|responsable)\b|\bmoi\s+aussi\s+(?:je\s+)?(?:peux\s+)?(?:confirmer|valider)\b/u;

/** Quelqu'un essaie-t-il de se donner un rôle ou des droits par message (« je suis admin maintenant ») (pur) ? */
export function looksLikeRoleClaim(text: string): boolean {
  return ROLE_CLAIM.test(normalizeText(text));
}

const HERE = /\b(?:c'?est\s+)?ici\s+qu'?on\s+(?:bosse|travaille|bossera|travaillera)\b|\b(?:c'?est\s+)?(?:notre|le)\s+groupe\s+(?:de\s+travail|de\s+l'?equipe)\b/u;

/** « Kevin, c'est ici qu'on bosse » (pur). */
export function isHereWeWork(text: string): boolean {
  return HERE.test(normalizeText(text));
}
