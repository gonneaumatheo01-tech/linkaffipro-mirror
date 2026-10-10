/**
 * Assistant « Écrire à un groupe » en trois étapes (Qui, Quoi, Quand) : étapes, vérifications de chaque étape avant
 * de continuer, nom proposé, phrases du récapitulatif (fonctions pures, testées). Le serveur refait toutes les
 * vérifications (`createBroadcastAction`) : celles-ci évitent seulement d'arriver au bout avec un oubli.
 */
import { validateTelegramHtml } from "@linkaffipro/core";
import { buttonUrlError, type PostButtonRow } from "@/lib/posts/buttons";
import { fromParisLocal } from "@/lib/posts/time";
import { membersPhrase, pendingCriterionError, type CriterionKey } from "./group";

export type WizardStepKey = "who" | "what" | "when";

export const WIZARD_STEPS: ReadonlyArray<{ key: WizardStepKey; title: string; help: string }> = [
  {
    key: "who",
    title: "Qui",
    help: "Choisissez le groupe de membres qui recevra le message, et le bot qui l'envoie.",
  },
  {
    key: "what",
    title: "Quoi",
    help: "Écrivez le message. L'aperçu montre ce que les membres verront sur Telegram.",
  },
  {
    key: "when",
    title: "Quand",
    help: "Envoyez tout de suite ou choisissez une date, puis vérifiez le récapitulatif.",
  },
];

export type WizardWhen = "now" | "later";
export type WizardIntent = "draft" | "now" | "schedule";

/** Ce que l'assistant a besoin de vérifier (le reste du formulaire n'a pas de règle côté client). */
export type WizardDraft = {
  botId: string;
  /** Critères ajoutés au groupe mais pas encore réglés (voir `pendingCriteria`). */
  pendingCriteria?: CriterionKey[];
  name: string;
  text: string;
  buttons: PostButtonRow[];
  hasMedia?: boolean;
  ab: { enabled: boolean; textB: string; buttonsB: PostButtonRow[] };
  when: WizardWhen;
  /** Champ datetime-local, heure de Paris (« 2026-10-11T18:00 »). */
  scheduledAt: string;
};

export const NAME_MAX = 120;

/** Boutons prêts à enregistrer : sans les boutons laissés sans libellé (comme le formulaire d'avant). */
export function filledRows(rows: PostButtonRow[]): PostButtonRow[] {
  return rows.map((r) => r.filter((b) => b.text.trim())).filter((r) => r.length > 0);
}

function buttonErrors(rows: PostButtonRow[], prefix: string): string[] {
  const errors: string[] = [];
  for (const row of rows)
    for (const b of row) {
      const text = b.text.trim();
      const touched = Boolean(text || b.url?.trim() || b.campaignId || b.affiliateCampaignId);
      if (!touched) continue;
      if (!text) {
        errors.push(`${prefix}donnez un libellé à chaque bouton, ou retirez-le.`);
        continue;
      }
      if (b.type === "OFFER") {
        if (!b.campaignId && !b.affiliateCampaignId)
          errors.push(`${prefix}bouton « ${text} » : choisissez une campagne.`);
        continue;
      }
      const urlError = buttonUrlError(b);
      if (urlError) errors.push(`${prefix}${urlError.charAt(0).toLowerCase()}${urlError.slice(1)}`);
    }
  return errors;
}

function textErrors(text: string, label: string): string[] {
  if (!text.trim()) return [`Écrivez le texte ${label}.`];
  const v = validateTelegramHtml(text);
  return v.ok ? [] : [`Texte ${label} : ${v.error}`];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Erreurs d'une étape (vide : on peut continuer). */
export function validateStep(step: WizardStepKey, d: WizardDraft, now = new Date()): string[] {
  if (step === "who")
    return [
      ...(d.botId ? [] : ["Choisissez le bot qui envoie le message."]),
      ...(d.pendingCriteria ?? []).map(pendingCriterionError),
    ];
  if (step === "what") {
    const errors = [
      ...textErrors(d.text, d.ab.enabled ? "de la version A" : "du message"),
      ...buttonErrors(d.buttons, d.ab.enabled ? "Version A : " : "Boutons : ").map(capitalize),
    ];
    if (d.ab.enabled)
      errors.push(
        ...textErrors(d.ab.textB, "de la version B"),
        ...buttonErrors(d.ab.buttonsB, "Version B : ").map(capitalize),
      );
    return errors;
  }
  const errors: string[] = [];
  if (!d.name.trim()) errors.push("Donnez un nom à l'envoi.");
  else if (d.name.trim().length > NAME_MAX)
    errors.push(`Le nom est trop long (${NAME_MAX} caractères au plus).`);
  if (d.when === "later") errors.push(...scheduleErrors(d.scheduledAt, now));
  return errors;
}

/** Date d'envoi : présente, lisible et dans le futur (une minute de marge, comme le serveur). */
export function scheduleErrors(scheduledAt: string, now = new Date()): string[] {
  const at = scheduledAt ? fromParisLocal(scheduledAt) : null;
  if (!at) return ["Choisissez la date et l'heure d'envoi."];
  if (at.getTime() < now.getTime() - 60_000)
    return ["Choisissez une date et une heure dans le futur."];
  return [];
}

/** Part remplie de la piste d'un curseur (0 à 100), pour colorer la piste jusqu'à la poignée. */
export function rangeFillPercent(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/** Bouton final d'après « Quand » : « Envoyer » (maintenant) ou « Programmer » (date choisie). */
export function finalIntent(when: WizardWhen): Exclude<WizardIntent, "draft"> {
  return when === "now" ? "now" : "schedule";
}

export function finalLabel(when: WizardWhen): string {
  return when === "now" ? "Envoyer" : "Programmer";
}

/**
 * Vérifie tout ce qu'il faut pour une action finale : brouillon (qui, quoi, nom), envoi maintenant (idem),
 * programmation (idem + date). Renvoie l'étape à corriger (index) et ses erreurs, ou null si tout va bien.
 */
export function firstInvalidStep(
  intent: WizardIntent,
  d: WizardDraft,
  now = new Date(),
): { step: number; errors: string[] } | null {
  const draft: WizardDraft = { ...d, when: intent === "schedule" ? "later" : "now" };
  for (let i = 0; i < WIZARD_STEPS.length; i++) {
    const errors = validateStep(WIZARD_STEPS[i]!.key, draft, now);
    if (errors.length) return { step: i, errors };
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Texte brut d'un message HTML Telegram (balises retirées, entités courantes décodées, espaces réduites). */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Paris",
});

/**
 * Nom proposé pour retrouver l'envoi dans la liste : le début du texte (50 caractères, coupé à un mot), sinon
 * « Message du 10/10/2026 ». Visible seulement par l'équipe.
 */
export function suggestName(text: string, now = new Date(), max = 50): string {
  const plain = plainText(text);
  if (!plain) return `Message du ${dayFmt.format(now)}`;
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}

const whenFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/** « Tout de suite, dès votre confirmation. » ou « Le samedi 11 octobre 2026 à 18:00 (heure de Paris). » */
export function whenSentence(when: WizardWhen, scheduledAt: string): string {
  if (when === "now") return "Tout de suite, dès votre confirmation.";
  const at = scheduledAt ? fromParisLocal(scheduledAt) : null;
  if (!at) return "Date et heure à choisir.";
  return `Le ${whenFmt.format(at)} (heure de Paris).`;
}

/** « Version A : 50 % du groupe · version B : 50 % ». */
export function abSplitSentence(split: number): string {
  return `Version A : ${split} % du groupe · version B : ${100 - split} %`;
}

/** Phrase de la boîte de confirmation de l'envoi immédiat. */
export function confirmSendMessage(
  count: number | null,
  ab: { enabled: boolean; split: number },
): string {
  const who =
    count === null ? "tous les membres du groupe qui peuvent le recevoir" : membersPhrase(count);
  const head = ab.enabled
    ? `Les deux versions vont partir maintenant à ${who} (version A : ${ab.split} %, version B : ${100 - ab.split} %).`
    : `Le message va partir maintenant à ${who}.`;
  return `${head} Une fois parti, un message ne peut pas être rappelé.`;
}
