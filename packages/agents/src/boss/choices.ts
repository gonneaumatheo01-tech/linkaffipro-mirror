/**
 * Listes numérotées de Kevin et blocages expliqués (correctifs du premier vrai échange avec le client, 25 octobre) :
 * - liste d'une précision de l'IA (outil `preciser`) : options, demande d'origine, conversation et auteur gardés
 *   30 minutes (`Setting` `boss.list.<auteur>`). La réponse suivante qui désigne une option (« 3 », « le 3 », ou son
 *   nom, avec fautes, accents ou lettres stylisées) rejoue la demande d'origine complétée par l'option (`replayText`,
 *   tâche `boss-text`) : jamais « pas prévu » pour un numéro valide ;
 * - blocage expliqué (canal privé sans compte Telegram libre…) : gardé 30 minutes ; « comment ça ? », « pourquoi ? »,
 *   « c'est quoi un compte réel ? » → la même explication ; « 1 » / « 2 » → la marche à suivre de cette option.
 * Correspondance d'une réponse avec une option : `pickOption` (pure), partagée avec la précision du code
 * (`boss.clarify`, `resolve.ts`).
 */
import { esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { AgentsDeps } from "../types";
import { clarifyIsFor, clarifyOwnerOf, editDistance } from "./resolve";
import { pick, type VoiceTable } from "./voice";

export const KEVIN_LIST_PREFIX = "boss.list.";
export const KEVIN_LIST_TTL_MS = 30 * 60_000;

export type KevinListOption = { label: string; /** Blocage : réponse de Kevin quand cette option est choisie. */ answer?: string };

export type KevinList = {
  kind: "replay" | "blocker";
  question: string;
  options: KevinListOption[];
  /** Demande d'origine (liste d'une précision) ; vide pour un blocage. */
  originalText: string;
  /** Blocage : l'explication envoyée (redite sur « comment ça ? »). */
  explanation?: string;
  askedBy: string;
  chatId: string | null;
  createdAt: string;
  expiresAt: string;
};

/** Textes de Kevin (charte `docs/KEVIN-VOIX.md`), vérifiés par `boss/voice.test.ts`. */
export const CHOICES_VARIANTS = {
  replayLost: [
    "Je n'ai pas réussi à reprendre ta demande avec ce choix. Tu me la redis en une phrase ?",
    "Je n'arrive pas à raccrocher ce choix à ta demande. Tu me la réécris en une phrase ?",
  ],
  explainAgain: ["Je t'explique.", "Je reprends."],
} satisfies VoiceTable;

// ------------------------------------------------------------------------------------------ correspondance (pure)

/** Minuscules, sans accents, emojis ni ponctuation ; lettres stylisées ramenées aux lettres ordinaires (pur). */
export function normChoice(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLERS =
  /^(?:c est |cest |ok |oui |alors |bah |ben |euh |je veux |je prends |je choisis |prends |plutot |pour |sur |avec |dans |le |la |les |l |du |de |des |d |un |une |canal |numero |num |n |no |option |choix |reponse )+/;
const ORDINALS: Record<string, number> = { premier: 1, premiere: 1, un: 1, deuxieme: 2, second: 2, seconde: 2, deux: 2, troisieme: 3, trois: 3, quatrieme: 4, quatre: 4, cinquieme: 5 };

function stripFillers(n: string): string {
  const out = n.replace(FILLERS, "").trim();
  return out || n;
}

function digitsOf(s: string): string {
  return (s.match(/\d+/g) ?? []).join(" ");
}

/**
 * Option désignée par une réponse courte (pur) : « 3 », « le 3 », « 3. », « n°3 », « le troisième », ou le nom
 * de l'option (exact après normalisation, sinon une faute tolérée, la plus proche et seule). Index (0…) ou null.
 * Une phrase longue (plus de 6 mots) n'est jamais un choix.
 */
export function pickOption(text: string, labels: readonly string[]): number | null {
  const raw = normChoice(text);
  if (!raw || !labels.length) return null;
  if (raw.split(" ").length > 6) return null;
  const t = stripFillers(raw);
  const num = /^(\d{1,2})(?:er|ere|e|eme)?$/.exec(t);
  if (num) {
    const n = Number(num[1]);
    return n >= 1 && n <= labels.length ? n - 1 : null;
  }
  const names = labels.map((l) => stripFillers(normChoice(l)));
  const exact = names.map((n, i) => (n === t || normChoice(labels[i]!) === raw ? i : -1)).filter((i) => i >= 0);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  if (ORDINALS[t] !== undefined) {
    const n = ORDINALS[t]!;
    return n <= labels.length ? n - 1 : null;
  }
  if (t === "dernier" || t === "derniere") return labels.length - 1;
  if (t.length < 3) return null;
  const want = digitsOf(t);
  // Distance de chaque option (sans chiffre dans la réponse : les chiffres des options sont ignorés, « paris sportif »
  // reste ambigu entre « paris sportif 1 » et « Paris sportifs 2 »).
  const scored = names
    .map((n, i) => {
      if (want && digitsOf(n) !== want) return null;
      const name = want ? n : n.replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
      const len = Math.max(name.length, t.length);
      const max = len < 4 ? 0 : len <= 6 ? 1 : 2;
      const d = editDistance(name, t);
      return { i, d, ok: d <= max };
    })
    .filter((x): x is { i: number; d: number; ok: boolean } => !!x)
    .sort((a, b) => a.d - b.d);
  const best = scored[0];
  if (!best || !best.ok) return null;
  // La plus proche, nettement : la suivante a au moins deux fautes de plus.
  const second = scored[1];
  return second && second.d < best.d + 2 ? null : best.i;
}

/** Le texte n'est qu'un numéro (« 3 », « 3. », « n°3 », « le 3 ») ? (pur) */
export function isBareNumber(text: string): boolean {
  return /^(\d{1,2})(?:er|ere|e|eme)?$/.test(stripFillers(normChoice(text)));
}

const WHY = /^(?:mais |attends |hein |euh |kevin )*(?:comment ca|comment|pourquoi|pk|pq|c est quoi|cest quoi|ca veut dire|qu est ce que|quoi|hein|explique|je comprends pas|je ne comprends pas|comprends pas|j ai pas compris|pas compris)\b/;
const ACCOUNT_WORDS = /\b(?:aucun|aucune|compte|comptes|reel|reels|relie|relies|libre|libres)\b/;

/**
 * Question qui suit une explication de blocage : « comment ça aucun compte réel ? », « pourquoi ? », « c'est quoi un
 * compte réel ? », « je comprends pas » (pur). Courte (12 mots au plus).
 */
export function isWhyFollowUp(text: string): boolean {
  const n = normChoice(text);
  if (!n || n.split(" ").length > 12) return false;
  if (WHY.test(n)) return true;
  return /\?\s*$/.test(text.trim()) && ACCOUNT_WORDS.test(n) && n.split(" ").length <= 8;
}

/** Demande d'origine complétée par l'option choisie (texte envoyé à l'interprète). */
export function replayText(originalText: string, question: string, label: string): string {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${originalText.trim()}\n(réponse à ta question « ${q} » : ${label.trim()})`;
}

// ------------------------------------------------------------------------------------------ mémoire

type Who = { speaker?: { kind: string; telegramUserId: bigint } | null; chatId?: bigint | null };

function keyOf(speaker?: Who["speaker"]): string {
  return `${KEVIN_LIST_PREFIX}${clarifyOwnerOf(speaker)}`;
}

/** Mémorise la liste envoyée par Kevin (une par personne : la plus récente). */
export async function rememberKevinList(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  input: Omit<KevinList, "askedBy" | "chatId" | "createdAt" | "expiresAt"> & Who,
): Promise<KevinList> {
  const now = nowOf(deps);
  const list: KevinList = {
    kind: input.kind,
    question: input.question.slice(0, 500),
    options: input.options.slice(0, 9).map((o) => ({ label: o.label.slice(0, 200), ...(o.answer ? { answer: o.answer } : {}) })),
    originalText: input.originalText.slice(0, 2000),
    ...(input.explanation ? { explanation: input.explanation } : {}),
    askedBy: clarifyOwnerOf(input.speaker),
    chatId: input.chatId != null ? input.chatId.toString() : null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + KEVIN_LIST_TTL_MS).toISOString(),
  };
  await writeSetting(deps, keyOf(input.speaker), list);
  return list;
}

/** Liste encore valable pour cette personne et cette conversation ; null sinon. */
export async function readKevinList(deps: Pick<AgentsDeps, "prisma" | "now">, who: Who): Promise<KevinList | null> {
  const v = (await readSetting(deps, keyOf(who.speaker))) as KevinList | undefined;
  if (!v || typeof v !== "object" || !Array.isArray(v.options) || (v.kind !== "replay" && v.kind !== "blocker")) return null;
  if (new Date(v.expiresAt).getTime() <= nowOf(deps).getTime()) return null;
  if (!clarifyIsFor(v, { speaker: who.speaker ?? null, chatId: who.chatId ?? null })) return null;
  return v;
}

export async function clearKevinList(deps: Pick<AgentsDeps, "prisma">, speaker?: Who["speaker"]): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: keyOf(speaker) } });
}

/** Réponse de Kevin à « comment ça ? » après un blocage : la même explication, reprise. */
export function explainAgainText(list: KevinList, chatId: bigint | null): string {
  return `${pick(CHOICES_VARIANTS.explainAgain, "choices.explainAgain", chatId)} ${list.explanation ?? esc(list.question)}`;
}
