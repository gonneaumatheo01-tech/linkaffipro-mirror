/**
 * Réglages de persona que l'équipe Algorithme peut appliquer (phase 21) : mêmes bornes que le formulaire Personas
 * (`apps/web/lib/personas/form.ts`, `PERSONA_LIMITS`) et même contrôle d'honnêteté (`hidesAssistant`). Tout autre champ
 * (identité, illusion, âge, règles adultes, /stop, offre…) est refusé. Fonction pure.
 */
import { hidesAssistant } from "./persona-honesty";

export const PERSONA_TUNING_LIMITS = {
  styleExamples: 1500,
  minExchangesBeforeOffer: { min: 1, max: 20 },
  maxOfferSends: { min: 1, max: 3 },
  followUpAfterHours: { min: 4, max: 168 },
  followUpsMax: { min: 0, max: 2 },
  suggestedFollowUpHours: { maxItems: 6 },
} as const;

export const PERSONA_TUNING_FIELDS = [
  "styleExamples",
  "minExchangesBeforeOffer",
  "maxOfferSends",
  "followUpAfterHours",
  "followUpsMax",
  "suggestedFollowUpHours",
] as const;
export type PersonaTuningField = (typeof PERSONA_TUNING_FIELDS)[number];

export type PersonaTuningCheck = { ok: true; value: unknown } | { ok: false; reason: string };

function intIn(v: unknown, r: { min: number; max: number }): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= r.min && v <= r.max ? v : null;
}

/** Valide une valeur de réglage de persona (identité de la persona : ASSISTANT ou GIRL). */
export function validatePersonaTuning(field: string, value: unknown, identityKind: string = "ASSISTANT"): PersonaTuningCheck {
  const L = PERSONA_TUNING_LIMITS;
  switch (field) {
    case "styleExamples": {
      if (value !== null && typeof value !== "string") return { ok: false, reason: "Exemples de style : texte attendu." };
      const t = (value ?? "").trim();
      if (t.length > L.styleExamples) return { ok: false, reason: `Exemples de style : ${L.styleExamples} caractères au plus.` };
      if (identityKind !== "GIRL" && hidesAssistant(t)) return { ok: false, reason: "Exemples de style refusés : ils cacheraient que c'est une assistante." };
      return { ok: true, value: t || null };
    }
    case "minExchangesBeforeOffer":
    case "maxOfferSends":
    case "followUpAfterHours":
    case "followUpsMax": {
      const n = intIn(value, L[field]);
      return n === null ? { ok: false, reason: `${field} : entier de ${L[field].min} à ${L[field].max}.` } : { ok: true, value: n };
    }
    case "suggestedFollowUpHours": {
      if (!Array.isArray(value) || value.length > L.suggestedFollowUpHours.maxItems || !value.every((h) => Number.isInteger(h) && h >= 0 && h <= 23))
        return { ok: false, reason: "Heures de relance : 6 heures au plus, de 0 à 23." };
      return { ok: true, value: [...new Set(value as number[])].sort((a, b) => a - b) };
    }
    default:
      return { ok: false, reason: `Champ de persona interdit aux réglages automatiques : ${field}.` };
  }
}
