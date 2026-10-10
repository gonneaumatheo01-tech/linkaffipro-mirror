/**
 * Règles pures de ConfirmSubmit (titre, libellé et couleur de la boîte de confirmation), testées à part.
 */

export type ConfirmSubmitDefaultsInput = {
  children?: unknown;
  confirmTitle?: string;
  confirmLabel?: string;
  destructive?: boolean;
  variant?: string | null;
  /** `className` du bouton ; une classe calculée (fonction Base UI) n'est pas lue. */
  className?: unknown;
};

/**
 * Valeurs par défaut : titre « <libellé du bouton> ? », bouton de confirmation = libellé du bouton,
 * rouge si le bouton est destructif (variante `destructive` ou texte rouge `text-destructive` / `text-danger`).
 */
export function confirmSubmitDefaults(input: ConfirmSubmitDefaultsInput): {
  title: string;
  confirmLabel: string;
  destructive: boolean;
} {
  const label = typeof input.children === "string" && input.children.trim() ? input.children : null;
  const cls = typeof input.className === "string" ? input.className : "";
  return {
    title: input.confirmTitle ?? (label ? `${label} ?` : "Confirmer cette action ?"),
    confirmLabel: input.confirmLabel ?? label ?? "Confirmer",
    destructive:
      input.destructive ??
      (input.variant === "destructive" || /(^|\s)text-(destructive|danger)(\s|$)/.test(cls)),
  };
}

/** Le minimum d'un bouton du DOM dont l'envoi a besoin (un faux bouton suffit dans les tests). */
type SubmitterLike = {
  type?: string;
  form?: { requestSubmit(submitter?: unknown): void } | null;
};

/**
 * Après « Confirmer » : envoie le formulaire de l'élément qui a ouvert la boîte. Un bouton de soumission est passé
 * en « submitter » (son `name`/`value` et son `formAction` partent avec le formulaire, comme un vrai clic).
 * Renvoie vrai si un envoi a été demandé (faux pour un lien ou un bouton hors formulaire).
 */
export function submitFromOpener(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const { form, type } = el as SubmitterLike;
  if (!form || typeof form.requestSubmit !== "function") return false;
  if (type === "submit") form.requestSubmit(el);
  else form.requestSubmit();
  return true;
}

/**
 * Attributs ARIA du déclencheur : il annonce qu'il ouvre une boîte de dialogue (`aria-haspopup`) et si elle est
 * ouverte (`aria-expanded`), sans écraser une valeur fournie par l'appelant.
 */
export function confirmTriggerAria<H, E>(
  props: { "aria-haspopup"?: H; "aria-expanded"?: E },
  open: boolean,
): { "aria-haspopup": H | "dialog"; "aria-expanded": E | boolean } {
  return {
    "aria-haspopup": props["aria-haspopup"] ?? "dialog",
    "aria-expanded": props["aria-expanded"] ?? open,
  };
}
