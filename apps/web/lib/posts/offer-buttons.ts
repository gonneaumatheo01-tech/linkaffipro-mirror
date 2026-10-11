/**
 * Boutons « Offre (campagne) » des messages de canal et des modèles (règles pures, testées dans offer-buttons.test.ts).
 *
 * - Un MODÈLE peut garder un bouton Offre dont la campagne (ou l'offre) n'est pas encore choisie : les modèles fournis
 *   en ont un, sans campagne, et l'équipe doit pouvoir les modifier sans en choisir une. Ce bouton est enregistré tel
 *   quel, sans lien traqué ; la campagne se choisit en utilisant le modèle (« Utiliser » → nouveau message).
 * - Un MESSAGE exige une campagne et une offre pour chaque bouton Offre (`lib/campaigns/offer-button.ts`, vérifié par
 *   le serveur). Le formulaire le vérifie aussi dans le navigateur, avant l'envoi, pour que la saisie ne soit jamais
 *   perdue par un aller-retour refusé.
 */
import type { PostButton } from "./buttons";

type OfferFields = Pick<PostButton, "type" | "campaignId" | "affiliateCampaignId">;

/** Bouton Offre d'un modèle dont la campagne ou l'offre reste à choisir (campagne et offre exigées dans un message). */
export function isOfferToChoose(b: OfferFields): boolean {
  return b.type === "OFFER" && (!b.campaignId || !b.affiliateCampaignId);
}

/**
 * Boutons à vérifier avant l'enregistrement (`assertButtonRows`) : pour un modèle, les boutons Offre à choisir sont
 * écartés (rien à vérifier, ils sont gardés tels quels) ; pour un message, tous les boutons.
 */
export function rowsToVerify<T extends OfferFields>(
  rows: ReadonlyArray<ReadonlyArray<T>>,
  isTemplate: boolean,
): T[][] {
  if (!isTemplate) return rows.map((r) => [...r]);
  return rows.map((r) => r.filter((b) => !isOfferToChoose(b))).filter((r) => r.length > 0);
}

/**
 * Bouton Offre à choisir, tel qu'il est enregistré dans un modèle : son libellé, et la campagne si elle est déjà
 * choisie (l'offre se choisira avec elle). Jamais de lien traqué ni d'ancienne offre : un nouveau message en recrée.
 */
export function templateOfferButton(b: Pick<PostButton, "text"> & Partial<PostButton>): PostButton {
  return { text: b.text, type: "OFFER", ...(b.campaignId ? { campaignId: b.campaignId } : {}) };
}

export type OfferButtonIssue = {
  /** Version du message (« B » : test A/B). */
  version: "A" | "B";
  row: number;
  col: number;
  /** Libellé du bouton. */
  text: string;
  /** Phrase affichée sous le choix de la campagne. */
  message: string;
};

/**
 * Boutons Offre qu'un message ne peut pas garder (même règle que le serveur, `offerButtonError`) : campagne non
 * choisie, ou campagne à plusieurs offres sans offre choisie. Un ancien bouton déjà enregistré (offre sans campagne,
 * lien existant) reste accepté. Rien à signaler pour un modèle (`template`).
 */
export function offerButtonIssues(
  rows: ReadonlyArray<ReadonlyArray<PostButton>>,
  opts: { version?: "A" | "B"; template?: boolean } = {},
): OfferButtonIssue[] {
  if (opts.template) return [];
  const version = opts.version ?? "A";
  const out: OfferButtonIssue[] = [];
  rows.forEach((row, r) =>
    row.forEach((b, c) => {
      if (b.type !== "OFFER") return;
      const legacy = !b.campaignId && !!b.affiliateCampaignId && !!b.trackingLinkId;
      if (legacy) return;
      if (!b.campaignId || !b.affiliateCampaignId)
        out.push({
          version,
          row: r,
          col: c,
          text: b.text,
          message: b.campaignId
            ? "Choisissez l'offre de la campagne pour ce bouton."
            : "Choisissez la campagne de ce bouton Offre.",
        });
    }),
  );
  return out;
}

/** Phrase d'alerte affichée près des boutons d'enregistrement (null : rien à signaler). */
export function offerIssuesSummary(issues: ReadonlyArray<OfferButtonIssue>): string | null {
  if (issues.length === 0) return null;
  const names = [...new Set(issues.map((i) => `« ${i.text.trim() || "Offre"} »`))];
  const list =
    names.length === 1
      ? `du bouton ${names[0]}`
      : `des boutons ${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
  return `Choisissez la campagne ${list} (bloc Boutons) : c'est elle qui donne le lien de l'offre. Votre texte est gardé.`;
}
