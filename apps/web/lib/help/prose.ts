/**
 * Mise en forme du guide rendu en HTML (`renderMarkdown`), sans dépendance de typographie : classes communes à la
 * page /help et au volet d'aide du bouton « ? ». Trois tailles du design system (titre, texte, note), jetons du thème.
 */
const COMMON =
  "text-body leading-relaxed text-foreground " +
  "[&_p]:text-foreground [&_strong]:font-semibold [&_em]:italic " +
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_li>ul]:mt-1 [&_li>ol]:mt-1 " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-note " +
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80 " +
  "[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground " +
  "[&_hr]:my-8 [&_hr]:border-t [&_hr]:border-border " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-note [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top";

/** Page /help (guide complet) : `#` masqué (le titre de la page est le `<h1>`), sections en titres. */
export const GUIDE_PROSE =
  `space-y-4 ${COMMON} ` +
  "[&_h1]:hidden " +
  "[&_h2]:mt-10 [&_h2]:scroll-mt-20 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2 [&_h2]:text-title [&_h2]:text-foreground [&_h2:first-child]:mt-0 " +
  "[&_h3]:mt-8 [&_h3]:scroll-mt-20 [&_h3]:text-body [&_h3]:font-semibold " +
  "[&_h4]:mt-6 [&_h4]:scroll-mt-20 [&_h4]:text-body [&_h4]:font-semibold [&_h4]:text-muted-foreground";

/**
 * Volet d'aide : extraits rendus avec `headingOffset` (titre de section en `<h3>`, sous-sections en `<h4>`).
 * Sélecteurs `[&_article_…]` : plus précis que ceux du `HelpButton` (puces, paragraphes gris), qui ne s'appliquent pas
 * au guide.
 */
export const HELP_PANEL_PROSE =
  `space-y-3 ${COMMON} ` +
  "[&_article_p]:text-foreground [&_article_ol>li]:ml-0 [&_article_ol>li]:list-decimal [&_article_ul>li]:ml-0 " +
  "[&_article_h3]:mt-0 [&_article_h3]:text-title [&_article_h3]:text-foreground " +
  "[&_article_h4]:mt-5 [&_article_h4]:text-body [&_article_h4]:font-semibold " +
  "[&_article_h5]:mt-4 [&_article_h5]:text-body [&_article_h5]:font-semibold [&_article_h5]:text-muted-foreground";
