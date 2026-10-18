/**
 * Affichage de Réglages → IA de conversation (fonctions pures, testées dans assistant-view.test.ts) : état de la clé
 * Venice, activation, listes de modèles avec leurs prix, part du plafond mensuel utilisée. Vocabulaire du client
 * (docs/REFONTE-UX.md) : « Rencontres », « parcours », jamais de terme technique en surface.
 */
import {
  ASSISTANT_ACTIVATIONS,
  selectableModels,
  type AssistantActivation,
  type VeniceModelInfo,
} from "@linkaffipro/chat";
import type { PillTone } from "@/components/admin/status-pill";
import { fmtDate } from "@/lib/format";

export type AssistantKeyStatus = "missing" | "unverified" | "verified" | "refused";

export type AssistantKeyView = {
  status: AssistantKeyStatus;
  pill: string;
  tone: PillTone;
  title: string;
  sentence: string;
  alert: "default" | "success" | "warning" | "destructive";
};

/** État de la clé Venice : absente, à vérifier, vérifiée ou refusée (le refus le plus récent l'emporte). */
export function assistantKeyView(state: {
  hasKey: boolean;
  keyHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}): AssistantKeyView {
  if (!state.hasKey)
    return {
      status: "missing",
      pill: "Aucune clé",
      tone: "muted",
      title: "Aucune clé Venice enregistrée",
      sentence:
        "L'assistant ne peut répondre à personne : collez la clé Venice ci-dessous (le guide en bas de page explique comment la créer).",
      alert: "default",
    };
  const hint = state.keyHint ?? "enregistrée";
  if (state.lastError)
    return {
      status: "refused",
      pill: "Clé refusée",
      tone: "danger",
      title: "Venice refuse la clé",
      sentence: `${state.lastError} Corrigez le problème, puis cliquez de nouveau sur « Vérifier ».`,
      alert: "destructive",
    };
  if (state.verifiedAt)
    return {
      status: "verified",
      pill: "Clé vérifiée",
      tone: "success",
      title: `Clé vérifiée le ${fmtDate(new Date(state.verifiedAt))}`,
      sentence: `Venice accepte la clé (${hint}).`,
      alert: "success",
    };
  return {
    status: "unverified",
    pill: "À vérifier",
    tone: "warning",
    title: "Clé enregistrée, pas encore vérifiée",
    sentence: `Clé ${hint} enregistrée. Cliquez sur « Vérifier » : la vérification ne coûte rien et relit la liste des modèles.`,
    alert: "warning",
  };
}

/** Libellés de l'activation, dans l'ordre du choix. */
export const ACTIVATION_LABELS: Record<AssistantActivation, string> = {
  off: "Désactivé",
  team: "Seulement l'équipe (essai)",
  all: "Tout le monde",
};

export const ACTIVATION_OPTIONS = ASSISTANT_ACTIVATIONS.map((value) => ({
  value,
  label: ACTIVATION_LABELS[value],
}));

/** Pastille et phrase de l'activation. */
export function activationView(activation: AssistantActivation): {
  pill: string;
  tone: PillTone;
  sentence: string;
} {
  switch (activation) {
    case "all":
      return {
        pill: "Actif pour tout le monde",
        tone: "success",
        sentence:
          "L'assistant répond à toutes les personnes qui écrivent d'elles-mêmes au bot de conversation.",
      };
    case "team":
      return {
        pill: "Essai par l'équipe",
        tone: "info",
        sentence:
          "L'assistant ne répond qu'aux comptes Telegram de l'équipe (reliés dans « Mon compte ») : les autres personnes ne reçoivent aucune réponse.",
      };
    default:
      return {
        pill: "Désactivé",
        tone: "muted",
        sentence: "L'assistant ne répond à personne. Il s'active ici, quand l'essai est concluant.",
      };
  }
}

const usd = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Prix d'entrée et de sortie : « lu 0,50 $ · écrit 2,00 $ par million de jetons », ou « prix inconnu ». */
export function modelPriceLabel(
  m: Pick<VeniceModelInfo, "inputUsdPerM" | "outputUsdPerM">,
): string {
  if (m.inputUsdPerM === null || m.outputUsdPerM === null) return "prix inconnu";
  return `lu ${usd.format(m.inputUsdPerM)} · écrit ${usd.format(m.outputUsdPerM)} par million de jetons`;
}

export type ModelOption = { value: string; label: string; missing?: boolean };

/**
 * Options d'une liste de modèles : les modèles proposables du cache (du moins cher au plus cher, avec leurs prix) ; la
 * valeur actuelle est toujours gardée, même absente de la liste (modèle retiré, liste pas encore relue).
 */
export function modelOptions(models: readonly VeniceModelInfo[], current: string): ModelOption[] {
  const options: ModelOption[] = selectableModels(models).map((m) => ({
    value: m.id,
    label: `${m.name === m.id ? m.id : `${m.name} (${m.id})`} — ${modelPriceLabel(m)}`,
  }));
  if (current && !options.some((o) => o.value === current))
    options.unshift({
      value: current,
      label: `${current} — modèle actuel, absent de la liste`,
      missing: true,
    });
  return options;
}

/**
 * Part du plafond mensuel utilisée (0 à 100) et nuance de la barre. Plafond à 0 : aucun appel (l'assistant est
 * arrêté), contrairement à l'assistant d'écriture.
 */
export function assistantCapUsage(
  costEur: number,
  capEur: number,
): { pct: number; tone: "brand" | "warning" | "danger"; sentence: string } {
  if (capEur <= 0)
    return {
      pct: 100,
      tone: "danger",
      sentence: "Plafond à 0 € : l'assistant ne fait aucun appel à l'IA et ne répond à personne.",
    };
  const ratio = Math.min(1, Math.max(0, costEur / capEur));
  const pct = Math.round(ratio * 100);
  const tone = ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warning" : "brand";
  const sentence =
    ratio >= 1
      ? "Plafond atteint : l'assistant ne répond plus jusqu'au mois prochain (ou relevez le plafond)."
      : `${pct} % du plafond utilisé ce mois-ci.`;
  return { pct, tone, sentence };
}

/** Date de la dernière lecture de la liste des modèles, ou « jamais ». */
export function modelsFetchedLabel(modelsFetchedAt: string | null): string {
  return modelsFetchedAt
    ? `Liste des modèles relue le ${fmtDate(new Date(modelsFetchedAt))}.`
    : "Liste des modèles pas encore relue : cliquez sur « Vérifier ».";
}
