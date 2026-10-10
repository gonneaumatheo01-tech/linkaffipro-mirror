/**
 * Sections d'aide écrites ici en attendant leur place dans docs/GUIDE-UTILISATEUR.md (fonctions pures, testées dans
 * builtin-sections.test.ts). Le guide prime : dès qu'il contient un titre de même nom, la section d'ici est ignorée
 * (elle peut alors être supprimée). Sinon, elle est insérée dans le guide avant le titre `before` (ou à la fin), pour
 * le volet « ? » comme pour la page /help : même texte, même ancre.
 * Pourquoi : le guide est réécrit par le coordinateur d'après les rapports ; l'accueil refait (phase 9) ne doit pas
 * renvoyer, en attendant, vers les écrans d'avant la refonte.
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

const ACCUEIL = `## Accueil

**À quoi ça sert.** Savoir en un coup d'œil si tout marche, ce que la journée rapporte et ce qu'il reste à faire. L'accueil est pensé d'abord pour le téléphone : tout se lit de haut en bas.

**Ce que vous voyez, de haut en bas.**

1. **La barre d'état.** Verte : « Tout va bien », le nombre de bots en ligne et l'heure de la dernière synchronisation avec Link Affi. Orange : le nombre de points à voir (envois et synchro à l'arrêt, bot en erreur, synchro Link Affi en échec, alertes ouvertes), chacun écrit en dessous. Un administrateur peut cliquer sur **Voir l'état du système** pour le détail.
2. **Les trois chiffres du jour** (heure de Paris, depuis minuit) : **Membres arrivés aujourd'hui**, **Premiers dépôts aujourd'hui** et **Bénéfice du jour**. Sous chaque chiffre, la variation par rapport à hier à la même heure : à 9 h, on compare à hier 9 h, pas à toute la journée d'hier. Le bénéfice du jour, c'est les dépôts plus le revenu net, moins la dépense pub ; le détail est écrit sous le chiffre. Cliquez sur une carte pour ouvrir la page qui détaille ce chiffre.
3. **À faire pour démarrer**, tant que la liste n'est pas finie : relier votre Telegram, créer une campagne, programmer un message et, pour un administrateur, inviter l'équipe. Chaque ligne se coche toute seule quand c'est fait. **Masquer** retire la liste. Pour la faire revenir, cliquez sur **Revoir la visite** dans **Mon compte** ou dans **Réglages** : la visite guidée repart aussi. Sur téléphone, la liste tient sur une ligne : touchez-la pour la déplier.
4. **À faire** : ce qui attend une action de votre part. Demandes d'adhésion à valider à la main, messages qui n'ont pas pu partir, compte pub ou compte Telegram à reconnecter, canaux sans règle d'adhésion, test A/B à conclure, clé de l'assistant IA à ajouter. Chaque ligne ouvre le bon écran. Sinon : « Rien à faire pour l'instant ».
5. **Prochains messages** : les trois prochains messages programmés dans vos canaux, avec leur heure et leur canal. **Voir le calendrier** ouvre Messages.
6. **Campagnes actives** : pour chaque campagne active, sur les 7 derniers jours, ce qu'elle a dépensé, les membres qu'elle a amenés et son bénéfice. Cliquez sur une ligne pour ouvrir la campagne.

Le bouton orange **Programmer un message**, en haut, ouvre directement l'écriture d'un message. Le bouton **?**, en haut à droite de chaque page, ouvre l'aide de la page affichée ; il propose aussi **Revoir la visite guidée**.

**Pièges et questions fréquentes.**

- Le bénéfice d'une campagne ne se calcule pas comme le bénéfice du jour : c'est le revenu net moins la dépense pub, sans les dépôts (comme sur la page Campagnes). C'est écrit sous le titre « Campagnes actives ».
- La dépense pub d'aujourd'hui arrive au fil de la journée : chaque heure si le compte pub est connecté, sinon quand vous importez ou saisissez les coûts. Le matin, le bénéfice du jour peut donc paraître meilleur qu'il ne le sera le soir. Pour la comparaison avec hier, la dépense d'hier est comptée jusqu'à la même heure (au prorata de la journée).
- Seuls vos joueurs comptent : ceux venus d'un de vos liens d'offre ou d'une offre Link Affi rattachée à une de vos campagnes, comme partout sur le site.
- Les chiffres détaillés (pubs, parcours, membres dans le temps) sont dans **Statistiques**.`;

export const BUILTIN_SECTIONS: readonly BuiltinSection[] = [
  { title: "Accueil", before: "Tableau de bord", markdown: ACCUEIL },
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
