/**
 * Parseur PUR des commandes du dialogue admin (Telegram), insensible aux accents et à la casse pour les mots-clés ;
 * les valeurs (clés, identifiants, mots de passe) sont gardées telles quelles.
 */
import type { TeamKey } from "../types";
import { isSkipText, normalizeText, secretAcceptsUnreplied } from "../human/answer";

export type AdminCommand =
  | { type: "status" }
  | { type: "report" }
  | { type: "pause"; team: TeamKey | "all" }
  | { type: "resume"; team: TeamKey | "all" }
  | { type: "approve"; number: number }
  | { type: "reject"; number: number; reason: string | null }
  | { type: "requests" }
  | { type: "later" }
  | { type: "secret"; key: string; value: string }
  | { type: "bookmaker"; name: string; login: string; password: string }
  | { type: "budget"; provider: "video"; euros: number }
  | { type: "live"; team: TeamKey }
  | { type: "level"; team: TeamKey; level: 0 | 1 | 2 };

const TEAM_WORDS: Record<string, TeamKey> = {
  dating: "dating",
  rencontre: "dating",
  rencontres: "dating",
  casino: "casino",
  paris: "sports",
  "paris sportifs": "sports",
  "paris sportif": "sports",
  sports: "sports",
  sport: "sports",
  algo: "algo",
  algorithme: "algo",
};

/** Nom d'équipe (« Paris sportifs », « algorithme »…) → clé, sinon null. */
export function parseTeamWord(s: string): TeamKey | null {
  return TEAM_WORDS[normalizeText(s)] ?? null;
}

/** Fournisseur nommé dans « clé <fournisseur> <valeur> » → clé rangée. */
const SECRET_PROVIDERS: Record<string, string> = {
  fal: "providers.fal.apiKey",
  "fal.ai": "providers.fal.apiKey",
  falai: "providers.fal.apiKey",
  cotes: "providers.odds.apiKey",
  cote: "providers.odds.apiKey",
  odds: "providers.odds.apiKey",
  magichour: "providers.magichour.apiKey",
  "magic-hour": "providers.magichour.apiKey",
};

const TRAILING_PUNCT = /[:;,.!?…]+$/u;

/**
 * Mots du message. Les mots de pure ponctuation (« clé : fal … ») sont retirés et la ponctuation finale des DEUX
 * premiers mots (mot-clé et fournisseur : « Clé: fal », « clé fal, … ») aussi ; les valeurs (clé, identifiant, mot de
 * passe) restent telles quelles (un mot de passe peut finir par « ! »).
 */
function tokens(text: string): string[] {
  const raw = text.trim().split(/\s+/).filter((w) => w && !/^[:;,.!?…\-–—]+$/u.test(w));
  return raw.map((w, i) => (i < 2 ? w.replace(TRAILING_PUNCT, "") || w : w));
}

/** La commande transporte-t-elle un secret (« clé … », « bookmaker … ») ? Utilisé pour ne rien journaliser. */
export function isSecretCommandText(text: string): boolean {
  const first = normalizeText(tokens(text)[0] ?? "");
  return (first === "cle" || first === "key" || first === "bookmaker") && tokens(text).length >= 2;
}

/** Analyse un message de l'admin ; null si ce n'est pas une commande connue. */
export function parseAdminCommand(text: string): AdminCommand | null {
  const raw = tokens(text);
  if (raw.length === 0) return null;
  const words = raw.map((w) => normalizeText(w));
  const all = normalizeText(text);
  const head = words[0]!;

  if (all === "agents" || all === "agent") return { type: "status" };
  if (all === "demandes" || all === "demande") return { type: "requests" };
  if (all === "rapport" || all === "rapports" || all === "rapport du jour") return { type: "report" };
  if (isSkipText(text)) return { type: "later" };

  if ((head === "pause" || head === "reprends" || head === "reprendre" || head === "reprise") && raw.length >= 2) {
    const rest = words.slice(1).join(" ");
    const team = rest === "tout" || rest === "tous" || rest === "toutes" ? "all" : parseTeamWord(rest);
    if (!team) return null;
    return head === "pause" ? { type: "pause", team } : { type: "resume", team };
  }

  if ((head === "ok" || head === "non") && raw.length >= 2) {
    const n = /^n?°?(\d{1,7})$/.exec(words[1]!);
    if (!n) return null;
    const number = Number(n[1]);
    if (head === "ok") return raw.length === 2 ? { type: "approve", number } : null;
    const reason = raw.slice(2).join(" ").trim();
    return { type: "reject", number, reason: reason || null };
  }

  if ((head === "cle" || head === "key") && raw.length >= 3) {
    const key = SECRET_PROVIDERS[words[1]!];
    if (!key) return null;
    return { type: "secret", key, value: raw.slice(2).join("") };
  }

  if (head === "bookmaker" && raw.length >= 4) {
    return { type: "bookmaker", name: words[1]!, login: raw[2]!, password: raw.slice(3).join(" ") };
  }

  if (head === "budget" && raw.length === 3 && words[1] === "video") {
    const euros = Number(words[2]!.replace(",", ".").replace(/€$/, ""));
    if (!Number.isFinite(euros) || euros < 0 || euros > 100_000) return null;
    return { type: "budget", provider: "video", euros };
  }

  if (head === "vrai" && raw.length >= 2) {
    const team = parseTeamWord(words.slice(1).join(" "));
    return team ? { type: "live", team } : null;
  }

  if (head === "niveau" && raw.length >= 3) {
    const level = Number(words[words.length - 1]);
    const team = parseTeamWord(words.slice(1, -1).join(" "));
    if (!team || (level !== 0 && level !== 1 && level !== 2)) return null;
    return { type: "level", team, level };
  }
  return null;
}

/**
 * Filet : « clé », « key », « bookmaker », « mot de passe », « password » suivis (plus loin dans le message) d'un mot
 * de 16 caractères ou plus (« voici la clé fal sk-… ») : masqué dans le journal même si ce n'est pas une commande.
 */
const SECRET_HINT =
  /(?<![\p{L}\p{N}])(?:cl[eé]s?|keys?|bookmakers?|mots? de passe|passwords?)(?![\p{L}\p{N}])[\s\S]*?(?<!\S)\S{16,}/iu;

export function hasSecretHint(text: string): boolean {
  return SECRET_HINT.test(text);
}

/** Contexte du dialogue admin pour reconnaître un secret (lu avant la journalisation, voir `agentsAdminState`). */
export type SecretTextContext = {
  /** Demande SECRET en cours (PENDING) : sa clé et le message de la question. */
  pending?: { key: string; telegramMessageId?: number | null } | null;
  /** Le message est une réponse Telegram à ce message. */
  replyToMessageId?: number | null;
  /** Messages (questions, rappels) de TOUTES les demandes SECRET, quel que soit leur statut. */
  secretMessageIds?: readonly number[];
};

/**
 * Le texte de l'admin contient-il un secret à ne jamais journaliser ? Oui pour « clé … » / « bookmaker … », pour le
 * filet `hasSecretHint`, pour une réponse au message d'une demande SECRET (même close, passée, expirée ou en file),
 * et, sans « répondre », pour un texte qui ressemble à une clé pendant une demande SECRET en cours (même règle que
 * `handleAdminText` : « fait », « Parfait! » restent lisibles par `pnpm tg:inbox`).
 * Ancienne forme acceptée : `true` ou `{ kind: "SECRET" }` (demande SECRET en cours, clé inconnue).
 */
export function isSecretAdminText(
  text: string,
  context?: boolean | { kind?: string | null } | SecretTextContext | null,
): boolean {
  if (isSecretCommandText(text) || hasSecretHint(text)) return true;
  let ctx: SecretTextContext = {};
  if (context === true) ctx = { pending: { key: "" } };
  else if (context && typeof context === "object") {
    if ("kind" in context) ctx = context.kind === "SECRET" ? { pending: { key: "" } } : {};
    else ctx = context as SecretTextContext;
  }
  const reply = ctx.replyToMessageId ?? null;
  if (reply !== null) {
    if (ctx.secretMessageIds?.includes(reply)) return true;
    if (ctx.pending?.telegramMessageId != null && ctx.pending.telegramMessageId === reply) return true;
  }
  if (!ctx.pending) return false;
  if (parseAdminCommand(text) !== null) return false;
  return secretAcceptsUnreplied(ctx.pending.key, text.trim());
}
