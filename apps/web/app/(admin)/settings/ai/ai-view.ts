/**
 * Affichage de Réglages → IA (fonctions pures, testées) : état de la clé, part du plafond utilisée et libellés de
 * l'historique dans le vocabulaire du client (docs/REFONTE-UX.md).
 */
import { AI_LABELS, AI_MODELS, type AiKind, type AiSurface } from "@linkaffipro/ai";
import type { PillTone } from "@/components/admin/status-pill";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { toUniverse, universeLabel } from "@/lib/universe";

export type AiKeyStatus = "missing" | "unverified" | "verified" | "refused";

export type AiKeyView = {
  status: AiKeyStatus;
  /** Pastille courte à côté du titre de la page. */
  pill: string;
  tone: PillTone;
  /** Titre et phrase du bandeau d'état. */
  title: string;
  sentence: string;
  alert: "default" | "success" | "warning" | "destructive";
};

/**
 * État de la clé Anthropic : absente, à vérifier, vérifiée ou refusée (le refus le plus récent l'emporte).
 * `readOnly` (manager) : la phrase dit qu'un administrateur doit agir, au lieu de « collez la clé ci-dessous ».
 */
export function aiKeyView(
  state: {
    hasKey: boolean;
    keyHint: string | null;
    verifiedAt: string | null;
    lastError: string | null;
  },
  { readOnly = false }: { readOnly?: boolean } = {},
): AiKeyView {
  if (!state.hasKey)
    return {
      status: "missing",
      pill: "Aucune clé",
      tone: "muted",
      title: "Aucune clé enregistrée",
      sentence: readOnly
        ? "L'assistant est désactivé : un administrateur doit coller une clé Anthropic sur cette page."
        : "L'assistant est désactivé : collez une clé Anthropic ci-dessous (le guide explique comment la créer).",
      alert: "default",
    };
  const hint = state.keyHint ?? "enregistrée";
  if (state.lastError)
    return {
      status: "refused",
      pill: "Clé refusée",
      tone: "danger",
      title: "Anthropic refuse la clé",
      sentence: readOnly
        ? `${state.lastError} Un administrateur doit recoller une clé valide.`
        : `${state.lastError} Recollez une clé valide, enregistrez, puis cliquez sur « Vérifier ».`,
      alert: "destructive",
    };
  if (state.verifiedAt)
    return {
      status: "verified",
      pill: "Clé vérifiée",
      tone: "success",
      title: `Clé vérifiée le ${fmtDate(new Date(state.verifiedAt))}`,
      sentence: `Anthropic accepte la clé (${hint}). L'assistant est actif pour toute l'équipe.`,
      alert: "success",
    };
  return {
    status: "unverified",
    pill: "À vérifier",
    tone: "warning",
    title: "Clé enregistrée, pas encore vérifiée",
    sentence: readOnly
      ? `Clé ${hint} enregistrée : un administrateur doit encore la vérifier.`
      : `Clé ${hint} enregistrée. Cliquez sur « Vérifier » pour la tester (un appel de quelques jetons).`,
    alert: "warning",
  };
}

/** Part du plafond mensuel utilisée : pourcentage entier (0 à 100) et nuance de la barre. */
export function capUsage(
  costEur: number,
  capEur: number,
): { pct: number; tone: "brand" | "warning" | "danger"; sentence: string } {
  const ratio = capEur > 0 ? Math.min(1, Math.max(0, costEur / capEur)) : 0;
  const pct = Math.round(ratio * 100);
  const tone = ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warning" : "brand";
  const sentence =
    capEur <= 0
      ? "Aucun plafond : l'assistant n'est jamais bloqué par le coût."
      : ratio >= 1
        ? "Plafond atteint : l'assistant est bloqué jusqu'au mois prochain (ou relevez le plafond)."
        : `${pct} % du plafond utilisé ce mois-ci.`;
  return { pct, tone, sentence };
}

/**
 * Coût du mois affiché en gros chiffre ou par personne : au centime comme le reste du site (« 0,00 € », « 5,00 € »).
 * Entre 0 et 1 centime : « moins de 0,01 € » (`lessThan`, `amount` = « 0,01 € ») plutôt qu'un « 0,00 € » qui ferait
 * croire à zéro. Le coût exact à 4 décimales reste dans l'historique, demande par demande.
 */
export function aiCostFigure(costEur: number): { lessThan: boolean; amount: string; text: string } {
  if (costEur > 0 && costEur < 0.01) {
    const amount = fmtMoney(0.01);
    return { lessThan: true, amount, text: `moins de ${amount}` };
  }
  const amount = fmtMoney(costEur);
  return { lessThan: false, amount, text: amount };
}

/** Écran d'où vient la demande, avec les mots du client (« Écrire à un groupe », « Relance automatique »). */
const SURFACE_LABELS: Record<AiSurface, string> = {
  post: "Message de canal",
  bot_text: "Messages du bot",
  broadcast: "Écrire à un groupe",
  template: "Modèle",
  automation: "Relance automatique",
};

export function aiKindLabel(kind: string): string {
  return kind in AI_LABELS.kind ? AI_LABELS.kind[kind as AiKind] : kind;
}

export function aiSurfaceLabel(ctx: unknown): string {
  const s = (ctx as { surface?: string } | null)?.surface;
  return s && s in SURFACE_LABELS ? SURFACE_LABELS[s as AiSurface] : "—";
}

export function aiUniverseLabel(ctx: unknown): string {
  const v = (ctx as { vertical?: string } | null)?.vertical;
  return toUniverse(v) ? universeLabel(v) : "—";
}

export function aiModelLabel(id: string): string {
  return id in AI_MODELS ? AI_MODELS[id as keyof typeof AI_MODELS].label : id;
}

/** Demande facturée mais sans version (réponse coupée ou inexploitable) : enregistrée pour que le plafond reste juste. */
export function aiFailedLabel(ctx: unknown): string | null {
  const f = (ctx as { failed?: string } | null)?.failed;
  if (!f) return null;
  return f === "too_long" ? "Échec : réponse coupée" : "Échec : réponse inexploitable";
}

/** Colonne « Utilisée » : échec, « Non », ou « Version 2 ». */
export function aiUsedLabel(h: { context: unknown; usedIndex: number | null }): string {
  return aiFailedLabel(h.context) ?? (h.usedIndex === null ? "Non" : `Version ${h.usedIndex + 1}`);
}

/** « 1 200 lus / 340 écrits (800 en cache) ». */
export function aiTokensLabel(h: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number | null;
}): string {
  const cached = h.cachedTokens ? ` (${fmtNum(h.cachedTokens)} en cache)` : "";
  return `${fmtNum(h.inputTokens)} lus / ${fmtNum(h.outputTokens)} écrits${cached}`;
}
