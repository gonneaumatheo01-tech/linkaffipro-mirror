import { createCn } from "cn/config";

/**
 * Fusion des classes Tailwind (comme clsx + tailwind-merge) qui connaît les tailles de texte du thème
 * (`text-title`, `text-body`, `text-note`, `text-figure`, voir app/globals.css).
 * Sans cette configuration, `cn("text-note text-muted-foreground")` supprimerait `text-note`
 * (pris pour une couleur de texte). À utiliser partout à la place de `cn` importé de « cn ».
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["title", "body", "note", "figure"] }] } },
});
