/**
 * Sections d'aide écrites ici en attendant leur place dans docs/GUIDE-UTILISATEUR.md (fonctions pures, testées dans
 * builtin-sections.test.ts). Le guide prime : dès qu'il contient un titre de même nom, la section d'ici est ignorée
 * (elle peut alors être supprimée). Sinon, elle est insérée dans le guide avant le titre `before` (ou à la fin), pour
 * le volet « ? » comme pour la page /help : même texte, même ancre.
 * Pourquoi : un écran refait peut être mis en ligne avant la réécriture du guide ; son aide ne doit pas renvoyer, en
 * attendant, vers l'écran d'avant.
 *
 * Liste vide depuis la réécriture du guide (phase 9) jusqu'à la phase 13 : « Affiliés sur vos canaux », le temps de
 * l'écrire dans le guide (même titre : la section d'ici est alors ignorée). Pour un nouvel écran, ajoutez ici sa
 * section le temps de l'écrire dans le guide (un test vérifie le vocabulaire).
 */
import { guideHeadings } from "./sections";
import { slugify } from "./markdown";

export type BuiltinSection = {
  /** Titre de niveau 2 (`## …`) : celui qu'emploie `PAGE_HELP`. */
  title: string;
  /** Titre de niveau 2 du guide devant lequel insérer la section ; absent ou introuvable : à la fin du guide. */
  before?: string;
  /** Markdown complet de la section, titre compris. */
  markdown: string;
};

export const BUILTIN_SECTIONS: readonly BuiltinSection[] = [
  {
    // Phase 13 : page Campagnes → « Affiliés Link Affi » (/campaigns/affiliates), en attendant le guide.
    title: "Affiliés sur vos canaux",
    before: "Canaux",
    markdown: `## Affiliés sur vos canaux

Les affiliés de Link Affi peuvent amener des membres sur vos canaux Telegram. Leurs membres, puis les inscriptions et les premiers dépôts qui en viennent, leur sont crédités dans Link Affi, comme leurs autres campagnes. Ici, vous suivez tout dans **Campagnes → Affiliés Link Affi**.

1. **Coller les deux clés dans Link Affi (une seule fois).** Un administrateur ouvre Réglages → Connexions → Link Affi → « Campagnes Telegram des affiliés », génère la clé de connexion et le secret de signature, et les colle dans les secrets de Link Affi.
2. **Créer la campagne dans Link Affi.** Dans Link Affi, Campagnes → nouvelle campagne de type Telegram pour l'affilié, puis choisissez le canal. Le lien d'invitation est créé tout seul ; la campagne apparaît dans la page Affiliés Link Affi.
3. **L'affilié partage son lien.** Il diffuse son lien Link Affi comme d'habitude. Les personnes arrivent sur votre canal avec une demande d'adhésion, et vos règles d'entrée s'appliquent (vous pouvez régler une exception pour un affilié dans la fiche du canal, onglet « Qui peut entrer et quand »).
4. **Suivre ses membres ici et dans Link Affi.** Par affilié puis par campagne : clics (comptés par Link Affi), demandes, acceptés, présents, partis, clics sur les offres, inscriptions, premiers dépôts (liste dépliable), dépôts et revenu net, sur la période choisie, avec l'export en fichier. Le filtre « Affilié » existe aussi dans Membres et dans Statistiques. Dans Link Affi, l'affilié voit ses membres dans la partie Joueurs.
5. **Premier affilié gagne, et les boutons d'offre seulement.** Un membre déjà rattaché à un affilié, ou déjà dans le canal avant de cliquer le lien, ne change pas d'affilié. Seuls les boutons d'offre du bot créditent l'affilié : un message publié par votre compte Telegram (avec des emojis animés, donc sans boutons) ne le peut pas, et le formulaire du message vous prévient.

Un administrateur peut corriger l'affilié d'un membre depuis sa fiche (« Corriger », avec un motif gardé dans le journal).
`,
  },
];

/**
 * Guide complété des sections intégrées qu'il ne contient pas encore (comparaison des titres sans accents ni
 * ponctuation, comme `findHeading`). Chaque section manquante est insérée avant son titre `before` de niveau 2, ou à
 * la fin. Un guide qui a déjà toutes les sections est rendu tel quel.
 */
export function withBuiltinSections(
  markdown: string,
  builtins: readonly BuiltinSection[] = BUILTIN_SECTIONS,
): string {
  let out = markdown;
  for (const b of builtins) {
    const headings = guideHeadings(out);
    const wanted = slugify(b.title);
    if (headings.some((h) => slugify(h.text) === wanted)) continue;
    const anchor = b.before
      ? headings.find((h) => h.level === 2 && slugify(h.text) === slugify(b.before!))
      : undefined;
    const section = b.markdown.trim();
    if (!anchor) {
      out = `${out.replace(/\s+$/, "")}\n\n${section}\n`;
      continue;
    }
    const lines = out.split(/\r?\n/);
    lines.splice(anchor.line, 0, section, "");
    out = lines.join("\n");
  }
  return out;
}
