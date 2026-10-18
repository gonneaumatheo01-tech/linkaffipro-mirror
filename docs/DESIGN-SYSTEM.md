# Design system LinkAffi Pro

Règles visuelles et catalogue des composants de l'interface (phase 9, spécification client : `docs/REFONTE-UX.md`).
Tout est visible en situation sur la page interne **`/styleguide`** (administrateurs seulement, hors menu).

- Jetons de thème : `apps/web/app/globals.css` (thème clair uniquement, pas de classes `.dark`).
- Primitives : `apps/web/components/ui/*` (shadcn sur Base UI, restylées). Composants partagés de l'application : `apps/web/components/admin/*`. Composants propres à une rubrique : `apps/web/components/<rubrique>/*` (voir § 3.6).
- Une seule bibliothèque, un seul style : on n'ajoute pas de deuxième jeu de composants, on n'écrit pas de couleur en dur (`#…`, `emerald-500`, `amber-50`…). On utilise les jetons ci-dessous. Un composant qui sert à deux rubriques ou plus va dans `components/admin/` (ex. `FilterChips`, `TabNav`, `CollapsibleFilters`, `DetailList`).

Contrôles automatiques (`pnpm --filter web test`) qui gardent ces règles :

| Test                                                | Ce qu'il vérifie                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/ui/theme-contrast.test.ts`     | Contrastes AA recalculés depuis `globals.css` (texte ≥ 4,5:1 ; bordures de champ, courbes, focus ≥ 3:1).               |
| `apps/web/tests/a11y/static-a11y.test.ts`           | `alt` sur les images, nom accessible des boutons icône, champs reliés à un libellé, contour de focus jamais annulé.    |
| `apps/web/tests/vocabulary/no-jargon.test.ts`       | Aucun terme technique dans le texte visible (le terme passe par `Term`, `term` ou `title`).                            |
| `apps/web/tests/routes/no-legacy-addresses.test.ts` | Aucune ancienne adresse (`/broadcasts`, `/links`…) dans le code : tout déplacement s'ajoute à `lib/legacy-routes.ts`.  |
| `apps/web/lib/help/page-help.test.ts`               | Chaque page de `app/(admin)` a son aide « ? » (une ligne de `PAGE_HELP`) et chaque section citée existe dans le guide. |
| `apps/web/lib/help/guide-content.test.ts`           | Plan du guide (ordre du menu), titres uniques, liens internes, vocabulaire du client et vouvoiement.                   |
| `apps/web/lib/status-badges.test.ts`                | Tout statut a son libellé français.                                                                                    |
| `apps/web/components/admin/tab-nav-logic.test.ts`   | Barres d'onglets : jamais de fond orange, onglet ouvert souligné, cibles de 40 px (44 px en grille), focus visible.    |

## 1. Règles

### Couleurs et usage

| Jeton (classe Tailwind)                                                   | Valeur            | Usage                                                                                                         |
| ------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `bg-brand` + `text-brand-foreground`                                      | #FCA314 + #020713 | Bouton principal, élément actif ou sélectionné, accents. Jamais de texte blanc sur l'orange (contraste 2:1).  |
| `text-brand-ink`                                                          | #9A5B00           | Orange lisible pour un texte ou un lien sur fond clair (5,2:1).                                               |
| `bg-brand-soft`                                                           | #FFF4E0           | Fond orange très pâle : rond des états vides, compteur « réglages modifiés », ligne ou pastille sélectionnée. |
| `bg-night`, `text-night-foreground`, `text-night-muted`, `bg-night-hover` | #020713…          | Barre de menu, barre du bas du téléphone, en-têtes sombres, infobulles.                                       |
| `bg-background`                                                           | #FAFAF7           | Fond des pages (blanc cassé).                                                                                 |
| `bg-card` / `bg-surface`                                                  | #FFFFFF           | Cartes, tableaux, volets, champs.                                                                             |
| `text-foreground`                                                         | #1A1F2B           | Texte principal.                                                                                              |
| `text-muted-foreground`                                                   | #5B6474           | Texte secondaire, lignes d'aide, en-têtes de tableau (5,7:1).                                                 |
| `border-border`                                                           | #E4E6EB           | Bordures 1 px des cartes, tableaux, séparateurs.                                                              |
| `border-muted-foreground/75` (`fieldBorderClass`)                         | ≈ #848C9B         | Bordure des champs (Input, Textarea, SelectTrigger, Checkbox, `NativeSelect`) : 3,4:1 (WCAG 1.4.11).          |
| `border-input`                                                            | #D5D9E0           | Boutons « outline » seulement (1,4:1 : reconnus par leur texte). Jamais pour un champ.                        |
| `text-success` + `bg-success-soft`                                        | #15803D           | Réussi, en ligne, variation favorable.                                                                        |
| `text-warning` + `bg-warning-soft`                                        | #854D0E           | À surveiller, en attente (jaune-brun, distinct de l'orange de marque).                                        |
| `text-danger` + `bg-danger-soft`                                          | #B91C1C           | Échec, erreur, action destructive.                                                                            |
| `text-info` + `bg-info-soft`                                              | #1D4ED8           | En cours, programmé, information.                                                                             |

**`primary` = fonds seulement.** `bg-primary` (l'orange de marque, utilisé par les primitives shadcn) est un fond ; `text-primary` est interdit pour du texte (orange à 2:1 sur blanc, illisible). Un texte ou un lien orange s'écrit **`text-brand-ink`** ; un texte posé sur l'orange s'écrit `text-brand-foreground` (nuit). Même règle pour les bordures fines porteuses de sens (`border-brand-ink`) et les courbes (`stroke-brand-ink`).

Contrastes vérifiés (WCAG AA) : chaque texte d'état sur son fond doux ≥ 4,7:1 ; texte nuit sur orange 10:1. Ajoutez tout nouveau couple de couleurs à `theme-contrast.test.ts`.

### Univers

Casino violet `casino` (#7C3AED), Paris sportifs vert `sports` (#059669), Rencontres rose `dating` (#DB2777).
**Toujours en pastille, en bordure fine ou en étiquette, jamais en fond plein.** Texte coloré : `text-casino-ink`, `text-sports-ink`, `text-dating-ink` (AA). Libellés affichés : « Casino », « Paris sportifs », « Rencontres » (jamais « Dating » ni « Sports »).
Libellés et classes : `apps/web/lib/universe.ts` (`UNIVERSE_LABELS`, `toUniverse`, `universeLabel`, `universeClasses`, `UNIVERSE_CSS_VARS` pour les graphiques). Composant : `UniverseDot`. Le calendrier des messages borde chaque carte de la couleur de son univers (bordure gauche, jamais un fond).

### Typographie

Inter (variable `--font-inter` posée par `next/font` dans le layout). Trois tailles seulement, plus le gros chiffre :

| Classe        | Taille           | Usage                                                                                        |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `text-title`  | 20 px, semi-gras | Titre de page (le seul `<h1>`), titres de section, titres de volet et de boîte de dialogue.  |
| `text-body`   | 14 px            | Tout le texte courant, titres de carte (`font-semibold`), libellés de champ (`font-medium`). |
| `text-note`   | 12 px            | Lignes d'aide sous un champ, en-têtes de tableau, pastilles, dates « il y a 2 min ».         |
| `text-figure` | 28 px, semi-gras | Gros chiffre des cartes (`StatCard`).                                                        |

Chiffres tabulaires (`tabular-nums`) dans les cartes de chiffres, `[data-numeric]` et, dans un tableau, **seulement les
cellules de chiffres** (`TableCell numeric`, ou cellule alignée à droite). Pas sur tout le tableau : avec Inter, ils
élargissent les tirets (« week - end », « - 1001111 »).
Exception technique : les champs de saisie passent à 16 px sur téléphone (sinon iOS zoome).

### Chiffres, montants et dates

- **Vrai signe moins.** Un nombre négatif s'écrit avec U+2212 (« −151,64 € »), jamais avec le trait d'union : en chiffres tabulaires, le trait d'union d'Inter prend la largeur d'un chiffre et se détache (« - 151,64 € »). `withMinusSign()` (`lib/campaigns/cards.ts`) ; `groupMoney`, `compactMoney` et `exactMoney` l'appliquent d'office. Une baisse se lit « −12,96 € » ou « −15,3 % ».
- **Une précision d'arrondi par groupe.** Les montants affichés ensemble (une grille de cartes et sa ligne de total, l'en-tête d'une fiche, une colonne) ont tous la même précision : à l'euro dès que l'un d'eux atteint 100 € en valeur absolue, au centime sinon (`groupMoneyDigits(values)` puis `groupMoney(n, digits)`). « 1 813 € » ne côtoie jamais « 558,14 € ». Un montant isolé : `compactMoney`. Le montant exact au centime reste au survol (`title`), dans le volet de détail et dans l'export (`exactMoney`).
- **Montants très petits** : « moins de 0,01 € » plutôt que « 0,00 € ». Des gains de moins d'un centime sont neutres (`gainsTone`), jamais un « −0,00 € » rouge.
- **Valeur absente** : « — » (tiret cadratin), trié avec les vides dans un `DataTable`.
- **Variation** : flèche + signe + pourcentage, verte si favorable (`favorable="down"` pour un coût : une baisse est verte), et une phrase pour les lecteurs d'écran. Si la valeur d'avant est nulle ou négative, aucun pourcentage : « Pas de comparaison possible » (`delta={null}`), la valeur d'avant reste écrite (« Avant : −1,74 € »).
- **Formats** : `lib/format.ts` (`fmtNum` « 12 345 », `fmtMoney`, `fmtPct` « 15,3 % », `fmtDate` « 09/10/2026 14:05 » en heure de Paris, `fmtDateShort` « 9 oct. », `fmtRelative` « il y a 3 min »). Toujours l'heure de Paris à l'écran.

### Espacements, formes, ombres

- Grille de 8 px (`gap-2`, `gap-4`, `p-4`, `space-y-6`…).
- Cartes : `rounded-xl` (12 px), bordure 1 px `border-border`, fond blanc, **aucune ombre lourde** (au plus `shadow-xs` ; les menus et boîtes flottantes ont une ombre légère pour se détacher).
- Boutons et champs : `rounded-lg` ; pastilles : `rounded-full`.

### Un bouton principal par écran

Le bouton orange (`<Button>` variante `default`) est **unique** sur un écran : « Programmer », « Envoyer », « Nouvelle campagne ». Les autres actions sont `outline`, `secondary` ou `ghost`. Dans un `PageHeader`, le principal se passe en `primaryAction`, les autres en `secondaryActions`. Les sous-navigations (onglets), les filtres et le volet d'aide n'ont jamais de bouton orange. Dans un volet ou une boîte de dialogue, le principal est le dernier du pied.

**Lien qui ressemble à un bouton** : `<Link href="…" className={buttonVariants({ variant: "outline" })}>`. Jamais `<Button render={<Link/>}>` (avertissement Base UI, sémantique de bouton donnée à un lien).

### Tableaux : 5 colonnes au plus

Une liste montre au plus 5 colonnes (le `DataTable` avertit en développement au-delà). Le reste va dans le volet de détail (ligne cliquable) ou sur la fiche. **Graphiques avant tableaux.** Sur téléphone, masquez la colonne la moins utile (`hideOnMobile`).

### Formulaires en trois niveaux

1. **Visible** (`FormSection`) : ce qu'il faut pour que ça marche (3 à 5 champs).
2. **Un clic** (`FormSection` supplémentaire ou bouton « + Média », « + Boutons », « Test A/B ») : médias, boutons, test A/B.
3. **Avancé** (`AdvancedSection`, replié) : réglages rares, avec des valeurs par défaut sensées. Pas de champ obligatoire dans un bloc replié ; `modifiedCount` signale ce qui a été changé.

Un seul bouton principal (« Programmer » / « Envoyer ») ; « Enregistrer en brouillon » en secondaire. Chaque champ a un `<Label htmlFor>` relié (ou un `aria-label`) ; une ligne d'aide en `text-note text-muted-foreground` sous le champ si besoin. Les assistants en étapes (nouvelle campagne, écrire à un groupe, import CSV) utilisent `Stepper` avec une ligne d'aide par étape et un récapitulatif avant l'action finale.

### Vocabulaire (interface, guide, rapports, exports)

| Terme technique       | Mot affiché                            | Au survol                                    |
| --------------------- | -------------------------------------- | -------------------------------------------- |
| FTD                   | premier dépôt                          | FTD                                          |
| NGR                   | revenu net                             | NGR                                          |
| sub-ID                | identifiant de suivi                   | sub-ID                                       |
| ROAS                  | retour sur dépense pub                 | ROAS                                         |
| CPL / CPA             | coût par membre / coût par inscription | CPL / CPA                                    |
| automatisation, règle | relance automatique                    | —                                            |
| envoi groupé, segment | écrire à un groupe, groupe de membres  | —                                            |
| séquence              | messages du bot                        | —                                            |
| cohorte               | membres dans le temps                  | cohorte                                      |
| entonnoir             | parcours                               | entonnoir                                    |
| webhook, postback     | connexion, retour du casino            | terme exact dans Réglages → Avancé seulement |
| worker                | service d'arrière-plan                 | —                                            |

Vouvoiement, français simple, une phrase claire plutôt qu'une longue infobulle. Univers : « Casino », « Paris sportifs », « Rencontres ». **Le terme technique ne revient jamais en surface** : `tests/vocabulary/no-jargon.test.ts` échoue sinon. Exceptions courtes et justifiées : Réglages → Avancé (retours du casino), le `/styleguide`, les exports CSV (« Premiers dépôts (FTD) », le terme entre parenthèses après le mot du client) et l'aide intégrée (`lib/help/`). Dans le guide, le terme technique n'apparaît que dans le **Petit lexique**, la table des anciennes pages et Réglages → Avancé.

### Le terme technique au survol

Le mot du client est affiché ; le terme exact apparaît au survol, au toucher et au focus clavier : `<Term term="FTD">premiers dépôts</Term>` (soulignement pointillé discret, bulle « Terme technique : FTD »). Il est aussi lu par les lecteurs d'écran (« premiers dépôts (FTD) »). Dans un bouton, un lien ou un libellé (en-tête triable, carte cliquable), `Term` reste un simple texte (pas de bouton dans un bouton) : le terme passe alors dans le nom accessible du parent et en `title`. `StatCard` (`term`), `CampaignFigure` (`term`) et `DataTable` (`column.term`) le font tout seuls. Les infobulles longues (`HelpTip`) sont l'exception, pas la règle.

### Accessibilité

- Libellés reliés (`<Label htmlFor>`), `aria-label` sur tout bouton icône (contrôlé par `apps/web/tests/a11y`).
- Focus toujours visible : contour 2 px `ring` (#9A5B00) décalé de 2 px ; les champs prennent une bordure orange foncé et un halo.
- Contraste AA pour tout texte (voir tableau des couleurs) ; la couleur n'est jamais la seule information (pastille = point + mot, variation = flèche + signe + phrase pour lecteur d'écran, barres = valeur écrite à côté).
- Cibles tactiles ≥ 40 px sur téléphone : les boutons, éléments de menu, listes de choix, pagination, en-têtes triables, pastilles de filtre et premières cellules du `DataTable` le font d'office (`max-md:min-h-10`, `max-md:h-10`).
- Bordure des champs à 3:1 au moins (`fieldBorderClass`) ; mini-courbes et lignes de graphique en `brand-ink` (l'orange de marque ne fait que 2:1 sur blanc).
- Tableau plus large que l'écran : la zone défile, prend le focus clavier (flèches) avec un nom (`label` ou légende) et montre un dégradé sur le bord tant qu'il reste des colonnes (contrôle axe `scrollable-region-focusable`).
- Bulles d'aide (`Term`, `HelpTip`) : ouvertes au survol, au toucher et au focus clavier, rendues dans un portail (jamais coupées par une carte ou un tableau), texte relié au bouton par `aria-describedby`.
- Un seul `<h1>` par page (celui du `PageHeader`) ; titres de section en `<h2>`.
- Lien d'évitement « Aller au contenu » (coque) ; `prefers-reduced-motion` coupe les animations (`motion-safe:`).
- Contrôle de rendu : `pnpm a11y --base http://localhost:<port> --pages …` (axe, échoue sur « critical » ; `--fail-on serious` à 390 px pour l'accueil). Procédure : `docs/REFONTE-DEV.md`.

### Navigation, adresses et aide

- **Menu** : `components/admin/nav-logic.ts` (`NAV`) : 8 entrées (les 6 de la refonte, plus Pages après Campagnes depuis la phase 15 et Conversations après Membres depuis la phase 17) + Réglages en bas ; « Guide d'utilisation » et « Mon compte » seulement dans « Plus » du téléphone (`mobileOnly`). Barre du bas du téléphone : `MOBILE_PRIMARY_HREFS` (Accueil, Messages, Membres, Campagnes) puis « Plus » (Pages, Canaux, Conversations, Statistiques, puis Réglages, Guide d'utilisation, Mon compte). Une rubrique rangée sous une entrée l'allume (`activeHref`, la plus précise gagne).
- **Adresses déplacées** : `lib/legacy-routes.ts` (redirection 308 appelée par `proxy.ts`, après la branche de tracking). Tout nouveau déplacement s'y ajoute.
- **Aide « ? »** : toute nouvelle page reçoit une ligne dans `lib/help/page-help.ts` (`PAGE_HELP`, segments `:id` permis pour les fiches) et sa section dans `docs/GUIDE-UTILISATEUR.md` (une section par écran, libellés exacts des boutons). Une section pas encore écrite peut vivre dans `lib/help/builtin-sections.ts` le temps de l'écrire.
- **Visite guidée** : repères `data-tour="nav-<clé>"` (`navTourId`), `nav-more` et `help` ; étapes dans `components/admin/tour/tour-logic.ts`.

## 2. Pièges connus (développeurs)

- **Fusion de classes** : importez `cn` depuis `@/lib/utils` (ou `@/components/ui/cn`, même fonction). Il connaît les tailles `text-title|body|note|figure` ; le `cn` brut du paquet « cn » croit que `text-note` est une couleur et l'efface devant `text-muted-foreground`.
- **Lien qui ressemble à un bouton** : `<Link className={buttonVariants({...})}>`, jamais `<Button render={<Link/>}>`. `buttonVariants()` renvoie des classes **déjà fusionnées** par `cn` (la bordure de la variante `outline` remplace la bordure transparente de la base : sans fusion, un lien `outline` perdait sa bordure). Pour ajouter des classes : `buttonVariants({ variant: "outline", className: "max-md:h-10" })` ou `cn(buttonVariants({ variant: "outline" }), "max-md:h-10")` : la dernière classe gagne.
- **Contour de focus et `outline-none` (Tailwind 4)** : `outline-none` (ou `outline-hidden`) pose `--tw-outline-style: none`, que `focus-visible:outline-2` réutilise : le contour de focus clavier reste invisible. Toute chaîne de classes qui cumule les deux ajoute **`focus-visible:outline-solid`** (`Button`, `Badge`, `Checkbox`, `TimeChart`, `TabNav` le font). Contrôlé par `tests/a11y/static-a11y.test.ts` et `components/ui/focus-outline.test.ts` (lit toutes les sources de `app`, `components` et `lib`).
- **Composants serveur / client** : `DataTable`, `SidePanel`, `HelpButton`, `ConfirmDialog`, `ConfirmSubmit`, `ScrollToCurrent`, `ScrollFade`, `CollapsibleFilters`, `RichTextEditor`, `TimeChart`, `MetricChart` sont des composants client. Depuis une page serveur, passez des données sérialisables (cellules déjà rendues, `detail` en JSX) ; les fonctions (`renderDetail`, `rowHref`, `onConfirm`, `onStepClick`) seulement depuis un composant client. `FilterChips`, `TabNav`, `BarList`, `DetailList`, `HomeSection`, `SettingsCardGrid`, `BrandLogo` sont des composants serveur (sans état : utilisables aussi depuis un composant client).
- **Tri du DataTable** : il trie les lignes reçues (la page affichée). Pour trier toute une liste paginée, triez côté serveur. Une cellule texte au format français (« 1 234 € », « −15,3 % », « 09/10/2026 14:05 ») est relue comme nombre ou date, et « — » est trié avec les vides ; pour un nœud React (`<span>`, pastille) ou un autre texte (« 12 / 40 »), passez `sortValues`, sinon la colonne ne se trie pas (avertissement en développement pour les colonnes `align: "right"`).
- **`DropdownMenuLabel`** : placez-le dans un `DropdownMenuGroup` (ou `DropdownMenuRadioGroup`) avec les éléments qu'il annonce. Le `Menu.GroupLabel` de Base UI plante sans groupe parent (« MenuGroupContext is missing ») ; notre `DropdownMenuLabel` se replie seul sur un simple intitulé hors groupe, mais le groupe reste la bonne écriture. N'utilisez pas `MenuPrimitive.GroupLabel` directement.
- **Bulles et `overflow`** : une bulle positionnée en `absolute` est coupée par une carte (`Card` est en `overflow-hidden`) ou un tableau qui défile. Toute bulle, menu ou liste flottante passe par un portail Base UI (`Popover`, `Menu`, `Select`, `Tooltip`), comme `HelpTip` et `Term`.
- **Chiffres tabulaires** : ne posez pas `tabular-nums` sur un `<table>`, une ligne ou un bloc de texte ; seulement sur les cellules de chiffres (`TableCell numeric`) ou un chiffre isolé. La règle globale `table { tabular-nums }` de `globals.css` est neutralisée par `Table` (`normal-nums`).
- **Pied de boîte de dialogue et de volet** : dans `DialogFooter` (et les pieds de `SidePanel`), écrivez d'abord le bouton secondaire (« Annuler », `SidePanelClose`), puis le principal : il se retrouve à droite sur ordinateur et en haut sur téléphone (`flex-col-reverse`). `showCloseButton` place « Fermer » au bon endroit. Deux actions longues côte à côte : un conteneur `flex-wrap` (comme `HelpButton`), pour qu'elles passent à la ligne dans un volet étroit.
- **`<select>` natif** : utilisez `NativeSelect` (ou `nativeSelectClass`) : texte 16 px sur téléphone (sinon iOS zoome au focus), bordure à 3:1, même flèche que `SelectTrigger`.
- **`Term` et `HelpTip` sont des composants client** (bulle Base UI) : utilisables tels quels depuis une page serveur (le contenu est du JSX sérialisable).
- **Serveur de développement** : un dossier de build par serveur (`NEXT_DIST_DIR=.next-<port>`), procédure dans `docs/REFONTE-DEV.md`. Jamais `next build` en parallèle d'un autre serveur.

## 3. Catalogue des composants

### 3.1 Coque de l'application

`app/(admin)/layout.tsx` assemble la coque : lien « Aller au contenu », `Sidebar`, `Header`, `<main id="contenu">` (marges des zones sûres iOS, place réservée à la barre du bas), `Shortcuts`, `BottomNav`, `GuidedTour`.

#### Sidebar — `components/admin/sidebar.tsx`

Barre de menu fond nuit, logo en haut, 8 entrées (dont Pages, phase 15, et Conversations, phase 17) puis Réglages en bas, séparé. Entrée active : texte blanc, fond nuit éclairci, trait orange à gauche. Ordinateur (≥ 1024 px) : 240 px, icône et libellé ; tablette (768–1023 px) : rail de 64 px, icônes seules (nom lu par les lecteurs d'écran, infobulle au survol) ; téléphone : cachée. Props : `isAdmin`.

#### BottomNav — `components/admin/bottom-nav.tsx`

Barre du bas du téléphone (< 768 px), fond nuit : Accueil, Messages, Membres, Campagnes, puis **Plus** (volet : Pages, Canaux, Conversations, Statistiques, puis Réglages, Guide d'utilisation, Mon compte). Onglet actif blanc avec un trait orange en haut ; zones sûres iOS respectées. Props : `isAdmin`.

#### Header — `components/admin/header.tsx`

En-tête blanc de toutes les pages : logo et nom sur téléphone ; à droite `GlobalSearch`, `HelpPanel` (bouton « ? », repère `data-tour="help"`) et le menu du compte (rond aux initiales `initials(name)` : Mon compte, Déconnexion). Props : `user`.

#### nav-logic, nav-icons — `components/admin/nav-logic.ts`, `nav-icons.tsx`

Logique pure du menu (testée) : `NAV`, `MOBILE_PRIMARY_HREFS`, `visibleNav`, `navSections` (ordinateur), `mobileNav` (téléphone : `primary` + `more`), `isActiveHref`, `activeHref`, `navTourId`, `initials`. Icônes lucide par nom : `NAV_ICONS`. Pour ajouter une entrée : une ligne dans `NAV` (et son icône), jamais de liste en dur dans un composant.

#### BrandLogo — `components/admin/brand-logo.tsx`

Logo « L » orange sur nuit (import statique, mis en cache, chargé tout de suite), décoratif (`alt=""` : le nom « LinkAffi Pro » est toujours écrit à côté). Composant serveur, utilisable sur les pages sans session (connexion, invitation, confidentialité). Props : `size` (32 par défaut), `className`.

```tsx
<BrandLogo size={28} />
```

#### GlobalSearch, Shortcuts — `global-search.tsx`, `shortcuts.tsx`

Recherche globale (`/api/search`) : loupe dans l'en-tête, fenêtre avec résultats groupés, clavier ↑ ↓ Entrée Échap ; ouverture par ⌘K / Ctrl+K, `/` hors d'un champ, ou l'événement `SEARCH_OPEN_EVENT` (`lap:search`). `Shortcuts` : `?` (hors d'un champ) ouvre la liste des raccourcis dans une boîte de dialogue (`Dialog` : focus gardé, Échap, « Ouvrir la recherche ») en trois groupes : Partout (⌘K recherche, Échap), Hors d'un champ de saisie (`/`, `?`, `n` nouveau message depuis /messages), **Dans un texte de message** (⌘B gras, ⌘I italique, ⌘U souligné, ⌘K lien, ⌘⇧X barré ; « Ctrl » hors d'un Mac). Liste dans `shortcuts-logic.ts` (testée) : les touches de mise en forme sont lues dans l'éditeur (`shortcutLabel`), la liste ne peut pas les contredire. Plateforme : `useIsMac` (`components/editor/use-is-mac.ts`).

#### HelpPanel — `components/admin/help-panel.tsx`

Le bouton « ? » de l'en-tête : `HelpButton` dont le contenu vient de `GET /api/help?path=…` (sections du guide choisies par `lib/help/page-help.ts`, repli sur « Les 10 premières minutes »), mis en cache par page. Pied : **Revoir la visite guidée** (ferme le volet puis relance la visite par `requestTourStart`) et **Ouvrir le guide complet** (`guideHref(help)` : `/help#<première section>`). Props : `className`.

#### GuidedTour — `components/admin/tour/guided-tour.tsx` (+ `tour-logic.ts`, `tour-events.ts`)

Visite de 2 minutes (9 étapes, `TOUR_STEPS` : Accueil, Campagnes, Pages, Canaux, Messages, Membres, Conversations, Statistiques, aide « ? » ; sur téléphone, les entrées rangées sous « Plus » s'accrochent à « Plus » avec une phrase `fallbackNote`) : bulle accrochée à chaque entrée du menu, fond assombri autour, « Suivant », « Précédent », « Terminer », « Passer la visite », Échap, flèches. Démarre seule à la première connexion (`autoStart`, état `onboarding.<userId>`), jamais dans un navigateur piloté (captures). Relance : `requestTourStart()` ou `restartTourAction` (Réglages, Mon compte, /help). Composant maison sans dépendance ; placement calculé par `tour-logic.ts` (testé).

#### ErrorPage, NotFoundPage, PageSkeleton — `error-page.tsx`, `page-skeleton.tsx`

`ErrorPage` (contenu des `error.tsx`) : carte blanche, phrase simple, « Réessayer » orange, jamais de trace technique (`error`, `reset`, `title`). `NotFoundPage` : « Cette page n'existe pas ou n'existe plus. » + « Retour à l'accueil ». `PageSkeleton` (`rows`) : squelette des `loading.tsx`, animation coupée si l'utilisateur demande moins de mouvement.

### 3.2 Primitives (`apps/web/components/ui/`)

#### Button — `button.tsx`

Props : celles de Base UI `Button` + `variant` (`default` orange principal · `outline` · `secondary` · `ghost` · `destructive` rouge doux · `danger` rouge plein, confirmation · `link`) et `size` (`xs` 28 · `sm` 32 · `default` 36 · `lg` 40 · `icon` · `icon-xs` · `icon-sm` · `icon-lg`). Sur téléphone, toute taille fait au moins 40 px. `buttonVariants()` pour styler un `<Link>`.

```tsx
<Button>Programmer</Button>
<Button variant="outline" size="sm"><Download aria-hidden />Exporter</Button>
<Button size="icon" variant="ghost" aria-label="Plus d'actions"><MoreHorizontal aria-hidden /></Button>
<Link href="/campaigns/new" className={buttonVariants()}>Nouvelle campagne</Link>
```

#### Badge — `badge.tsx`

Étiquette courte (compteur, mot-clé). `variant` : `default` (orange pâle) · `secondary` · `outline` · `success` · `warning` · `info` · `destructive` · `ghost` · `link`. Pour un **état**, utilisez `StatusPill` / `StatusBadge`. `badgeVariants()` renvoie, comme `buttonVariants()`, des classes déjà fusionnées.

```tsx
<Badge variant="secondary">12</Badge>
```

#### Card — `card.tsx`

`Card` (`size` `default` | `sm`), `CardHeader`, `CardTitle` (14 px semi-gras), `CardDescription` (une ligne d'aide grise), `CardAction`, `CardContent`, `CardFooter`.

```tsx
<Card>
  <CardHeader>
    <CardTitle>Campagnes actives</CardTitle>
    <CardDescription>Les 3 qui rapportent le plus.</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
</Card>
```

#### Input, Textarea, Label — `input.tsx`, `textarea.tsx`, `label.tsx`

Champs 36 px (40 px sur téléphone), fond blanc, bordure gris moyen à 3:1 (`fieldBorderClass`), focus orange foncé ; `aria-invalid` → bordure rouge. Texte 16 px sur téléphone (pas de zoom iOS), 14 px sur ordinateur. **Champ de fichier** (`<Input type="file">`) : le bouton « Choisir un fichier » du navigateur prend l'allure d'un bouton secondaire (fond gris clair, bordure fine, 28 px, 32 px sur téléphone) et tout le champ ouvre le sélecteur ; aucun écran ne le restyle (`inputClassName`, testé).

```tsx
<Label htmlFor="title">Titre interne</Label>
<Input id="title" name="title" />
<p className="text-note text-muted-foreground">Visible seulement par l'équipe.</p>
```

#### Select — `select.tsx`

Liste de choix Base UI (`Select`, `SelectTrigger` (`size` `default` | `sm`), `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`). Libellé : `<Label htmlFor>` vers l'`id` du `SelectTrigger`. Dans un formulaire GET simple (filtres), préférez `NativeSelect`.

```tsx
<Select items={items} defaultValue="CASINO">
  <SelectTrigger id="u">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {items.map((i) => (
      <SelectItem key={i.value} value={i.value}>
        {i.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

#### NativeSelect — `native-select.tsx`

`<select>` natif au style de `SelectTrigger` : 36 px (40 px sur téléphone), texte 16 px sur téléphone, bordure à 3:1, flèche dessinée (`appearance-none`). Toutes les props de `<select>` ; `className` va au `<select>`, `wrapperClassName` à son conteneur. Exporte aussi `nativeSelectClass` et `fieldBorderClass` (bordure commune des champs).

```tsx
<Label htmlFor="channel">Canal</Label>
<NativeSelect id="channel" name="channel" defaultValue={sp.channel ?? ""}>
  <option value="">Tous les canaux</option>
  …
</NativeSelect>
```

#### Checkbox — `checkbox.tsx`

Case 16 px, cochée en orange, zone cliquable agrandie. À placer dans un `<label>` avec son texte.

```tsx
<label className="flex items-center gap-2">
  <Checkbox name="pin" />
  Épingler le message
</label>
```

#### Dialog — `dialog.tsx`

Boîte centrée : `Dialog`, `DialogTrigger`, `DialogContent` (`showCloseButton`), `DialogHeader`, `DialogTitle` (20 px), `DialogDescription`, `DialogFooter` (`showCloseButton` → « Fermer », placé avant vos boutons), `DialogClose`. Échap, croix « Fermer », focus piégé. Pied : trait fin, sans fond ; bouton secondaire puis principal.

```tsx
<Dialog>
  <DialogTrigger render={<Button variant="outline">Nouvelle catégorie</Button>} />
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Nouvelle catégorie</DialogTitle>
    </DialogHeader>
    …
  </DialogContent>
</Dialog>
```

#### DropdownMenu — `dropdown-menu.tsx`

Menu Base UI : `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuLabel` (dans un groupe : voir Pièges), `DropdownMenuItem` (`variant="destructive"`), `DropdownMenuSeparator`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup` / `DropdownMenuRadioItem`, sous-menus. Exemple d'usage : le bouton « Plus » de Campagnes, « Exporter » de Membres. Largeur : celle de son texte (`w-auto`), jamais plus étroit que le bouton qui l'ouvre ni que 128 px, jamais plus large que l'espace disponible (le texte passe alors à la ligne) ; un petit bouton icône ne coupe donc plus les libellés. Une largeur posée par l'écran (`className="w-60"` ou `"min-w-60"`) remplace la règle (`DROPDOWN_CONTENT_CLASS`, testé).

```tsx
<DropdownMenu>
  <DropdownMenuTrigger
    render={
      <Button size="icon" variant="outline" aria-label="Plus d'actions">
        <MoreHorizontal aria-hidden />
      </Button>
    }
  />
  <DropdownMenuContent>
    <DropdownMenuGroup>
      <DropdownMenuLabel>Message</DropdownMenuLabel>
      <DropdownMenuItem>Dupliquer</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Supprimer</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

#### Table — `table.tsx`

Tableau brut : `Table` (`label` : nom de la zone défilante, par défaut la légende), `TableHeader`, `TableBody`, `TableFooter`, `TableRow` (`data-state="selected"`), `TableHead` (note grise ; `numeric` → aligné à droite), `TableCell` (ligne de 48 px ; `numeric` → aligné à droite en chiffres tabulaires), `TableCaption`. Plus large que l'écran : la zone défile, reçoit le focus (flèches gauche / droite) et un dégradé montre le côté où il reste des colonnes. Pour une liste avec tri et détail : `DataTable`.

```tsx
<Table label="Canaux">
  <TableHeader>
    <TableRow>
      <TableHead>Canal</TableHead>
      <TableHead numeric>Membres</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Casino week-end</TableCell>
      <TableCell numeric>{fmtNum(1240)}</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

#### Alert — `alert.tsx`

`Alert` (`variant` : `default` · `info` · `success` · `warning` · `destructive`), `AlertTitle`, `AlertDescription`, `AlertAction`. Icône lucide en premier enfant. `role="alert"` par défaut : passez `role="status"` pour une information.

```tsx
<Alert variant="warning" role="status">
  <TriangleAlert aria-hidden />
  <AlertTitle>À vérifier</AlertTitle>
  <AlertDescription>La connexion Meta expire dans 5 jours.</AlertDescription>
</Alert>
```

#### Separator, Avatar — `separator.tsx`, `avatar.tsx`

`Separator` : trait 1 px (`orientation` `horizontal` | `vertical`). `Avatar` (shadcn) existe mais n'est pas utilisé : les ronds aux initiales de l'en-tête et des membres sont dessinés sur place (voir § 4).

### 3.3 Composants d'application (`apps/web/components/admin/`)

#### PageHeader — `page-header.tsx`

Le seul `<h1>` de la page. Props : `title`, `description` (une ligne d'aide), `help` (note : la première chose à faire), `primaryAction` (`{ label, href, icon? }` ou un nœud : LE bouton orange), `secondaryActions` (nœuds discrets), `children` (contenu libre à droite, compatibilité), `backHref` / `backLabel` (« ← Réglages », « ← Membres »), `meta` (pastilles à côté du titre), `className`. Sur téléphone, les actions passent sous le titre, sur toute la largeur, **le bouton principal en premier** (sous le pouce) : aucune page n'ajoute `max-md:order-first` elle-même.

```tsx
<PageHeader
  title="Campagnes"
  description="Ce que vous promouvez, où, et ce que ça rapporte."
  primaryAction={{ label: "Nouvelle campagne", href: "/campaigns/new", icon: <Plus aria-hidden /> }}
  secondaryActions={
    <Link href="/campaigns/links" className={buttonVariants({ variant: "outline" })}>
      Tous les liens
    </Link>
  }
/>
```

#### StatCard — `stat-card.tsx` (+ `stat-card-logic.ts`)

Props : `label`, `value` (déjà formaté), `delta` (variation en %, ex. `deltaPct(aujourdhui, hier)` ; `null` = « Pas de comparaison possible » ; absent = pas de ligne ; affichage plafonné à « > +999 % » / « < −999 % », lu « En hausse de plus de 999 % » : `VARIATION_CAP`, le calcul ne change pas), `favorable` (`up` par défaut · `down` pour un coût · `none`), `comparison` (« vs hier »), `trend` (nombres → mini-courbe SVG : ligne `brand-ink`, remplissage orange à 12 % ; rien n'est dessiné sous deux points ou quand toutes les valeurs sont nulles : `hasTrend`, et `trendOrNone(série)` pour préparer la prop), `href` (carte cliquable), `term` (terme technique du libellé : bulle au survol, au toucher et au focus si la carte n'est pas un lien), `hint`, `icon`, `className`. `MiniTrend` est exporté seul (même règle `hasTrend`). Règles pures testées : `stat-card-logic.ts`.

```tsx
<StatCard
  label="Premiers dépôts aujourd'hui"
  term="FTD"
  value={fmtNum(14)}
  delta={deltaPct(14, 15)}
  comparison="vs hier"
  trend={last7}
  href="/stats"
/>
```

#### DataTable — `data-table.tsx` (+ `data-table-logic.ts`)

Composant client. Props : `columns` (`{ key, header, term?, align? ("right" pour les chiffres), sortable? (oui par défaut), sortFirst?, hideOnMobile?, className? }`, 5 au plus), `rows` (`{ id, cells: { [clé]: nœud }, sortValues?, href?, detail?, detailTitle?, detailDescription?, data? }`), `label` (légende pour lecteur d'écran, et nom de la zone défilante), `empty` (props d'`EmptyState`), `defaultSort` (`{ key, direction }`), `renderDetail(row)` / `rowHref(row)` (depuis un composant client), `panelSize`, `className`.
Clic sur un en-tête : premier sens (les chiffres du plus grand au plus petit) → sens inverse → ordre d'origine (`aria-sort`). Clic sur une ligne : volet de détail (`detail`) ou page (`href`) ; au clavier, la première cellule est un bouton ou un lien.

```tsx
<DataTable
  label="Campagnes actives"
  columns={[
    { key: "name", header: "Campagne" },
    { key: "ftd", header: "Premiers dépôts", term: "FTD", align: "right" },
  ]}
  rows={campaigns.map((c) => ({
    id: c.id,
    cells: { name: c.name, ftd: c.ftds },
    detail: <CampaignDetail c={c} />,
  }))}
  empty={{
    title: "Aucune campagne",
    action: { href: "/campaigns/new", label: "Nouvelle campagne" },
  }}
/>
```

#### SidePanel — `side-panel.tsx`

Volet latéral (Dialog Base UI) : à droite sur ordinateur, plein écran sur téléphone ; titre relié, Échap, croix « Fermer », focus piégé puis rendu. Contenu plus haut que l'écran sans lien ni bouton (texte seul, liste de chiffres) : la zone qui défile prend elle-même le focus clavier (flèches), nommée « Contenu : <titre> » (contrôle axe `scrollable-region-focusable` ; règle pure `scrollRegionNeedsFocus` dans `side-panel-logic.ts`, testée) ; rien à faire dans les pages. Props : `title`, `description`, `children`, `footer`, `size` (`sm` · `md` · `lg` · `xl`), contrôlé (`open`, `onOpenChange`) ou non (`trigger`, `defaultOpen`). `SidePanelClose` : bouton de fermeture pour le pied.

```tsx
<SidePanel
  title="Léa M."
  trigger={<Button variant="outline">Voir</Button>}
  footer={
    <>
      <SidePanelClose />
      <Button>Écrire à ce membre</Button>
    </>
  }
>
  …
</SidePanel>
```

#### FormSection, AdvancedSection — `form-section.tsx`

`FormSection` : `title` (`<h2>`), `description` (une ligne d'aide), `actions` (lien discret à droite, ex. « + Nouvelle catégorie »), `children`, `id`, `className`.
`AdvancedSection` : bloc replié `<details>` (« Avancé » par défaut) ; `title`, `description`, `modifiedCount` (« 2 réglages modifiés »), `defaultOpen`, `children`. `modifiedLabel(n)` exporté.

```tsx
<FormSection title="Le message" description="Ce que les membres vont lire, et où.">…</FormSection>
<AdvancedSection description="Épingler, envoi silencieux, contenu protégé…" modifiedCount={changed}>…</AdvancedSection>
```

#### EmptyState — `empty-state.tsx`

Icône lucide dans un rond orange pâle (boîte de réception par défaut), `title`, `description` (une phrase), `action` (`{ href, label, variant? }`, orange par défaut : c'est alors le bouton principal de l'écran), `children`, `className`.

```tsx
<EmptyState
  icon={<Send />}
  title="Aucun message programmé"
  description="Un message programmé part tout seul dans le canal à l'heure choisie."
  action={{ href: "/messages/new", label: "Programmer un message" }}
/>
```

#### StatusPill — `status-pill.tsx`

Pastille d'état : `tone` (`neutral` · `muted` · `info` · `success` · `warning` · `danger` · `brand`), `dot` (par défaut : oui sauf `neutral`), `title`, `className`, `children`. `PILL_TONES`, `pillToneClasses(tone)`, `pillShowsDot(tone)` exportés.

```tsx
<StatusPill tone="success">En ligne</StatusPill>
```

#### StatusBadge, ActiveBadge — `apps/web/lib/status-badges.tsx`

Libellé français et nuance de **tous** les statuts (dictionnaire `STATUS_DICT`), rendus en `StatusPill` ; les univers (`kind="vertical"`) en `UniverseDot` étiquette. `statusLabel`, `statusLabels`, `statusVariant`, `statusTone`, `entryTone` exportés. Tout nouveau statut doit avoir son libellé (un test le vérifie). Synchronisation (`kind="sync"`) : OK, **En retard** (`late`, ambre : la dernière réussite est trop ancienne, `syncRowState` de `lib/status/health.ts`), Erreur, En cours, Jamais.

```tsx
<StatusBadge kind="post" value={post.status} />
<ActiveBadge active={bot.isActive} />
```

#### UniverseDot — `universe-dot.tsx` (+ `apps/web/lib/universe.ts`)

Props : `universe` (« CASINO », « sports »… ; null = « Sans univers », gris), `withLabel`, `variant` (`dot` · `pill` étiquette à bordure fine), `label`, `className`. Le point seul a son libellé en `title` et pour les lecteurs d'écran.

```tsx
<UniverseDot universe={c.vertical} withLabel />
<UniverseDot universe="DATING" variant="pill" />
```

#### FilterChips — `filter-chips.tsx`

Rangée de pastilles de filtre (liens, formulaire inutile) : un clic filtre la liste, la pastille choisie est orange pâle avec texte `brand-ink` (`aria-current`). Sur téléphone, les pastilles passent à la ligne (40 px de haut) ; sur ordinateur, la rangée défile si elle est trop longue. Composant serveur. Props : `label` (nom du groupe, affiché et annoncé : « Univers », « Statut »), `chips` (`{ key, label, href, count?, selected, icon? }`, `icon` = pastille d'univers), `className`. Utilisé par Campagnes, Membres, Modèles de messages, Comparer par catégorie.

```tsx
<FilterChips
  label="Univers"
  chips={UNIVERSES.map((u) => ({
    key: u,
    label: universeLabel(u),
    href: campaignsHref({ ...filters, vertical: u }),
    count: counts[u],
    selected: filters.vertical === u,
    icon: <UniverseDot universe={u} />,
  }))}
/>
```

#### ScrollToCurrent — `scroll-to-current.tsx` (+ `scroll-to-current-logic.ts`)

Liste horizontale qui défile (onglets sur téléphone) : à l'affichage et à chaque changement de `currentKey`, l'élément marqué `aria-current` est ramené au centre de la liste ; seule la liste défile, jamais la page. Sans JavaScript, la liste reste une simple liste défilante. Composant client ; règle pure `centeredScrollLeft` testée. Props : `currentKey`, `className` (classes du `<ul>`), `children` (les `<li>`). Utilisé par `TabNav` : pour une barre d'onglets, utilisez `TabNav`, pas `ScrollToCurrent` seul.

```tsx
<ScrollToCurrent currentKey={tab} className="-mb-px flex gap-1 overflow-x-auto">
  {TABS.map((t) => (
    <li key={t.key}>
      <Link href={t.href} aria-current={t.key === tab ? "page" : undefined}>
        {t.label}
      </Link>
    </li>
  ))}
</ScrollToCurrent>
```

#### TabNav — `tab-nav.tsx` (+ `tab-nav-logic.ts`)

**La** barre d'onglets de l'application (liens : chaque onglet a son adresse, `aria-current="page"` sur l'onglet ouvert). Ordinateur : onglets soulignés, l'onglet ouvert souligné d'orange et en semi-gras ; si la fenêtre est étroite, la rangée défile. Téléphone, deux présentations (`phone`) : `scroll` (par défaut : une rangée d'onglets de 40 px qui défile, Statistiques, Journal) ou `grid` (boutons bordés de 44 px sur `columns` = 2 ou 3 colonnes, tous visibles, libellé court ou sur deux lignes : fiche campagne, fiche canal, Membres). Quand la rangée défile, un dégradé montre qu'il reste des onglets (`ScrollFade`) et l'onglet ouvert est ramené au centre (`ScrollToCurrent`). Jamais de fond orange (le seul bouton orange reste celui du `PageHeader`). Composant serveur. Props : `label` (nom de la navigation, lu par les lecteurs d'écran), `items` (`{ key, href, label, short?, count?, ariaLabel? }` : `short` = libellé du téléphone, `count` = pastille ambre (rien à 0) ; dites le nombre dans `ariaLabel`, « Demandes, 3 en attente »), `current`, `phone`, `columns`, `className`. Utilisé par `CampaignTabs`, `ChannelTabs`, `MembersNav`, `ConversationsNav`, `StatsNav` et les onglets du Journal (`ViewTabs`). Toute nouvelle barre d'onglets l'utilise.

```tsx
<TabNav
  label="Onglets de la campagne"
  current={tab}
  items={CAMPAIGN_TABS.map((t) => ({
    key: t.key,
    href: campaignTabHref(id, t.key, keep),
    label: t.label,
    short: t.short,
  }))}
  phone="grid"
  columns={3}
/>
```

#### ScrollFade — `scroll-fade.tsx`

Dégradé sur le bord d'une rangée qui défile, tant qu'il reste des éléments à voir de ce côté (même règle que `Table`, `horizontalScrollState`) ; il suit le défilement et la taille de la rangée ; rien quand tout tient ou sans JavaScript. Le **premier enfant** est la zone qui défile (`overflow-x-auto`). Composant client. Props : `children`, `className`, `fadeClassName` (couleur du fond sous la rangée : `from-background` par défaut, `from-card` sur une carte). Utilisé par `TabNav`.

#### CollapsibleFilters — `collapsible-filters.tsx`

Filtres d'une liste : toujours visibles sur ordinateur ; repliés sur téléphone derrière un bouton « Filtres (n) » (`aria-expanded`), pour que la liste se lise d'abord. Le contenu (un formulaire GET) n'est rendu qu'une fois. Composant client. Props : `activeCount` (filtres posés, affiché sur le bouton), `children`, `className`. Utilisé par Messages (calendrier, liste, modèles) et le Journal.

```tsx
<CollapsibleFilters activeCount={active}>
  <form method="get">…</form>
</CollapsibleFilters>
```

#### DetailList, DetailRow — `detail-list.tsx`

Liste « libellé : valeur » des volets de détail et des blocs techniques (`<dl>` en deux colonnes : libellé gris, valeur à gauche). `DetailList` : `children`, `className` ; `DetailRow` : `label`, `children`, `mono` (identifiant, adresse en chasse fixe). Composant serveur. Utilisé par Statistiques, Réglages (Bots, Connexions, État du système, Équipe…) et le Journal.

```tsx
<DetailList>
  <DetailRow label="Devise">EUR</DetailRow>
  <DetailRow label="Identifiant" mono>
    act_1234
  </DetailRow>
</DetailList>
```

#### RememberFilters — `remember-filters.tsx`

Mémorise les filtres d'une liste dans le navigateur (clé par page) et les rappelle quand on revient sur l'adresse nue. Bouton **Effacer les filtres** (discret, `ghost` ; « Les filtres sont mémorisés sur cet appareil » au survol), visible **seulement quand un filtre est actif** (`hasActiveFilters`, `remember-filters-logic.ts`, testé) ; il vide la mémoire et garde la vue choisie (`keepParams` : `view` et `tab` par défaut). Aucune page ne le cache ni ne change son libellé : ni `hidden`, ni `label` (la prop existe encore, ne vous en servez pas). Un paramètre qui n'est pas un filtre (tri) se passe dans `keepParams`. À monter dans un `<Suspense>`. Props : `storageKey` (unique, ex. « members »), `keepParams`, `className`.

```tsx
<Suspense fallback={null}>
  <RememberFilters storageKey="campaigns" className="max-md:h-10" />
</Suspense>
```

#### HelpButton — `help-button.tsx`

Bouton rond « ? » (`aria-label` « Aide de cette page ») qui ouvre une aide dans un `SidePanel`. Props : `children` (contenu de l'aide : `h3`, `p`, `ul` sont stylés), `title`, `description`, `guideHref` (`/help` par défaut, `null` pour masquer), `guideLabel`, `footerExtra` (action de plus dans le pied, à côté du lien vers le guide : un bouton `outline`), `size` (largeur du volet, `lg` 512 px par défaut : ligne de lecture confortable et deux actions côte à côte), `className`. Pas de bouton orange dans une aide. Pour l'aide de la page courante, l'en-tête utilise `HelpPanel` (§ 3.1).

```tsx
<HelpButton footerExtra={<Button variant="outline">Revoir la visite guidée</Button>}>
  <h3>À quoi sert cette page ?</h3>
  <p>…</p>
</HelpButton>
```

#### Term, HelpTip — `help-tip.tsx`

`Term` : mot du client, terme technique (`term`) en bulle au survol, au toucher et au focus clavier, et lu par les lecteurs d'écran ; simple texte dans un bouton, un lien ou un libellé. `HelpTip` (`children`, `label`, `className`) : petit « ? » discret ; bulle courte dans un portail, retournée près des bords ; texte relié au bouton (`aria-describedby`). Composants client (Popover Base UI). Règle pure testée : `help-tip-logic.ts`.

```tsx
<Term term="NGR">revenu net</Term>
<HelpTip label="Aide : membres suivis">Les personnes entrées depuis qu'un de nos bots gère le canal.</HelpTip>
```

#### Stepper — `stepper.tsx` (+ `stepper-logic.ts`)

Props : `steps` (`{ key?, title, help? }`), `current` (index à partir de 0), `onStepClick(i)` (étapes faites cliquables, composant client), `label`, `showHelp`, `className`. Ordinateur : étapes numérotées, en cours en orange, faites cochées ; téléphone : « Étape 2 sur 4 · Offres » et une barre d'avancement. `aria-current="step"`. Utilisé par Nouvelle campagne (4 étapes), Écrire à un groupe (Qui, Quoi, Quand) et Importer des dépenses (3 étapes).

```tsx
<Stepper steps={WIZARD_STEPS} current={step} onStepClick={(i) => setStep(i)} />
```

#### ConfirmDialog — `confirm-dialog.tsx`

Boîte de confirmation (AlertDialog Base UI). Props : `title`, `description` (ce qui va se passer), `confirmLabel`, `cancelLabel` (« Annuler », focus par défaut), `destructive` (bouton rouge), `onConfirm` (attendu s'il renvoie une promesse) ; `trigger` (élément qui ouvre ; si c'est un bouton de soumission sans `onConfirm`, le formulaire parent est soumis avec ce bouton : `name`/`value`/`formAction` conservés, une seule fois même sur un double clic) ; contrôlé : `open`, `onOpenChange`. Logique d'envoi testée dans `confirm-logic.ts`.

```tsx
<form action={deletePostAction}>
  <input type="hidden" name="id" value={post.id} />
  <ConfirmDialog
    title="Supprimer ce message ?"
    description="Il sera retiré du canal Telegram ; les chiffres déjà collectés restent."
    confirmLabel="Supprimer"
    destructive
    trigger={
      <Button type="submit" variant="destructive">
        Supprimer
      </Button>
    }
  />
</form>
```

#### ConfirmSubmit — `confirm-submit.tsx` (+ `confirm-logic.ts`)

Un `Button` de soumission + `message`, sur `ConfirmDialog` (plus de `window.confirm`). Facultatif : `confirmTitle` (par défaut « <libellé> ? »), `confirmLabel`, `destructive`. `title` reste l'infobulle HTML du bouton.

```tsx
<ConfirmSubmit name="intent" value="now" message="Le message va partir maintenant à 1 240 membres.">
  Envoyer maintenant
</ConfirmSubmit>
```

#### Flash, Pagination, CopyField, PeriodSelect, SoonPage

- `Flash` (`flash.tsx`) : retour d'une action par l'adresse (`ok`, `error`) : bandeau vert (`role="status"`) et/ou rouge, avec icône. `<Flash ok={sp.ok} error={sp.error} />`.
- `Pagination` (`pagination.tsx`) : `page`, `pages`, `total`, `hrefFor`, `noun` ; page en cours en orange (`aria-current="page"`). Sur téléphone : flèches de 40 px et « Page 2 sur 8 ». Fonctions `pageOf`, `pageCount`, `pageSkip`, `pageHref`, `pageWindow`, constante `PAGE_SIZE`.
- `CopyField` (`copy-field.tsx`) : champ en lecture seule + « Copier » (annonce « Copié ») ; `value`, `label` (nom lu par les lecteurs d'écran, « Adresse à copier » par défaut), `id` (pour relier un libellé visible `<Label htmlFor>` : c'est alors lui qui nomme le champ, `label` n'est plus posé).
- `PeriodSelect` (`period-select.tsx`) : sélecteur de période (formulaire GET, `NativeSelect`) : `period`, `compare`, `extra` (paramètres à conserver), `action`, `className`. Les Statistiques ont leur sélecteur complet (`StatsFilters`, § 3.6).
- `SoonPage` (`soon.tsx`) : page « bientôt disponible » (`title`, `description`, `items`).

### 3.4 Écriture des messages

#### RichTextEditor — `components/editor/rich-text-editor.tsx` (+ `editor-logic.ts`, `telegram-format.ts`, `html-parser.ts`, `rich-text.css`)

Éditeur de texte sans balise visible : le texte s'écrit et se relit mis en forme (gras, italique, souligné, barré, lien, texte masqué, émojis) ; le formulaire reçoit toujours du HTML Telegram propre et validé. Barre d'outils (une seule tabulation, flèches entre les boutons), raccourcis ⌘B ⌘I ⌘U ⌘K ⌘⇧X (Ctrl hors d'un Mac ; rappelés dans la liste « ? »), collage nettoyé, repères `{prenom}`… insérables (`placeholders`) et mis en évidence, **compteur** (4 096, 1 024 avec un média : c'est le seul compteur de l'écran, l'aperçu n'en affiche pas), emplacement pour l'assistant IA (`ai`). Composant client. Props : `id`, `label` (nom accessible), `value`, `onChange(html)`, `name` (champ caché soumis), `required`, `invalid`, `describedBy`, `placeholder`, `placeholders`, `warnUnresolved`, `hasMedia`, `ai`, `rows`, `className`. Utilisé par Programmer un message, Écrire à un groupe, Ce que dit le bot, Relances automatiques et l'éditeur à branches : **tout nouveau champ de texte de message l'utilise**.

`warnUnresolved` (repère connu, `{offre}`…, qui ne sera pas remplacé dans ce formulaire) : `true` (par défaut) = surligné en jaune dans le texte **et** une phrase sous le champ ; `"highlight"` = surligné seulement, quand le formulaire affiche déjà sa propre alerte (Programmer un message : « Des mots restent à compléter » au-dessus de « Programmer ») ; `false` = rien (démonstrations). Règle pure : `unresolvedDisplay` (`editor-logic.ts`, testée).

```tsx
<RichTextEditor
  id="text"
  label="Texte du message"
  name="text"
  value={text}
  onChange={setText}
  hasMedia={media.length > 0}
  ai={<ImproveButton … />}
/>
```

`FormattedText` (`formatted-text.tsx`) : HTML Telegram affiché mis en forme, en lecture seule (propositions de l'IA, récapitulatifs), réécrit depuis la liste blanche avant affichage. Props : `html`, `className`.

#### TelegramPreview — `components/messages/telegram-preview.tsx`

Rendu approché d'un message Telegram (bulle blanche sur fond de discussion, médias, boutons sous le message). Props : `html`, `buttons`, `mediaCount`, `compact` (galerie de modèles, volet du calendrier : texte coupé), `counter` (nombre de caractères sous la bulle, **non par défaut** : à côté d'un `RichTextEditor`, c'est l'éditeur qui compte ; un aperçu en lecture seule n'en a pas besoin), `highlightPlaceholders` (repères surlignés « à compléter », modèles), `className`. À droite du formulaire sur ordinateur (« Aperçu tel que les membres le verront »).

#### ImproveButton — `components/ai/improve-button.tsx`

« Améliorer avec l'IA » (icône étoiles) : volet de l'assistant d'écriture (3 versions, retouches, traductions, version B). À passer dans `RichTextEditor` (`ai`), jamais en bouton orange.

### 3.5 Graphiques

Règles : SVG maison, sans bibliothèque ; couleurs du thème seulement (ligne `brand-ink`, surface et barres orange de marque, période précédente `muted-foreground`, grille `border`) ; une seule courbe à la fois (pas de double axe) ; la bulle n'est jamais le seul moyen de lire un chiffre (texte alternatif complet et tableau des valeurs repliable) ; graphique avant tableau.

- `TimeChart` (`components/charts/time-chart.tsx`, client) : courbe (`kind="line"`) ou barres (`"bar"`), période précédente en gris. Réticule et bulle au survol, au toucher (la bulle reste jusqu'au prochain toucher) et au clavier (flèches, Début, Fin). Props : `title`, `period`, `labels`, `previousLabels`, `series`, `format`, `integer`, `kind`, `height`, `unitLabel`, `valuesSummary` (« Voir les chiffres jour par jour »), `className`.
- `MetricChart` (`metric-chart.tsx`, client) : `TimeChart` avec le choix du chiffre affiché (« Afficher : Membres entrés »), sans recharger la page. Props : `metrics`, `labels`, `previousLabels`, `period`, `defaultKey`, `kind`, `suffix`, `unitLabel`, `valuesSummary`, `height`, `className`.
- `BarList` (`components/charts/bar-list.tsx`, serveur ; règles dans `bar-list-logic.ts`, testées) : **la** liste en barres horizontales (parcours, canaux des Statistiques, Comparer par catégorie, test A/B), lisible sans couleur : chaque ligne écrit son nom et sa valeur (barre orange masquée aux lecteurs d'écran, longueur `barPercent`). Ordinateur : nom | barre | valeur ; téléphone : nom et valeur sur une ligne, barre en dessous. Props : `items` (`{ key, label, value, valueText, note?, emphasis?, title? }` : `note` = précision sous la valeur ; `emphasis` = barre mise en avant, les autres passent en gris, ex. la version en tête d'un test A/B ; `title` = infobulle native de la ligne), `label` (nom de la liste pour les lecteurs d'écran), `max`, `labelWidth` (`wide` par défaut, `narrow` pour « Version A »), `className`. Sans aucune `note`, la colonne des valeurs prend juste la place des chiffres, alignés à droite.

  ```tsx
  <BarList
    label="Taux de clic"
    labelWidth="narrow"
    items={variants.map((v) => ({
      key: v.variant,
      label: `Version ${v.variant}`,
      value: v.ctr,
      valueText: fmtPct(v.ctr),
      emphasis: v.variant === leader,
    }))}
  />
  ```

- `Funnel` (`components/dashboard/funnel.tsx`) : le parcours en barres (`BarList`) : à chaque étape le nombre, la part gardée, la période précédente. Props : `steps`, `previous`.
- `MetricDetail` (`components/dashboard/metric-detail.tsx`) : tous les chiffres d'une ligne dans le volet (`dl`), avec période précédente et variation. Props : `figures`, `compare`, `className`.
- `MiniTrend` (`stat-card.tsx`) : mini-courbe des cartes (rien sous deux points ou quand tout vaut zéro : `hasTrend`).

### 3.6 Composants de rubrique

Ils servent à une seule rubrique (à déplacer dans `components/admin/` dès qu'une deuxième en a besoin).

**Accueil** (`components/home/`) : `HomeSection` (carte avec titre `<h2>`, une ligne d'aide, lien discret à droite `sectionLinkClass` ; props `id`, `title`, `description`, `action`, `children`, `className`), `StatusBar` (barre d'état verte ou orange), `TodayCards` (les trois chiffres du jour en `StatCard`), `ChecklistCard` (« À faire pour démarrer », repliée sur téléphone), `TodoCard`, `UpcomingCard`, `CampaignsCard`.

**Campagnes** (`components/campaigns/`) :

- `CampaignCard` : carte d'une campagne (univers, statut, nom, contexte, dépensé, membres, premiers dépôts, gains, mini-courbe des membres par jour) ; toute la carte mène à la fiche (lien « étiré » sur le nom). Props : `row`, `href`, `platformLabel`, `compare`, `membersTrend`, `moneyDigits` (précision commune de la grille, `groupMoneyDigits`).
- `CampaignFigure` + `FigureDelta` (`campaign-figure.tsx`) : un chiffre de carte (libellé en note, `term` au survol, valeur 20 px tabulaire, variation sur sa propre ligne, hauteur réservée) ; à placer dans un `<dl>`. Props : `label`, `term`, `value`, `delta`, `favorable`, `valueTone`, `hint`, `className`.
- `NewCampaignButton`, `OfferPicker` (choix des offres Link Affi, état pur `offer-picker-state.ts`).
- `CampaignTabs` (`app/(admin)/campaigns/[id]/tabs/nav.tsx`) : onglets de la fiche (`TabNav`, grille de 3 sur téléphone, libellés courts ; période conservée).

**Pages** (`components/landing/`, phase 15) :

- `LandingPageForm` (client) : le formulaire unique d'une page d'atterrissage (canal, accroche, sous-texte, texte du bouton ; « Sources » avec « Copier le lien » et, à la demande, « Relier à une pub » : pubs des campagnes du canal d'abord, « (déjà reliée) » signalé ; « Avancé » : langue, pixels vérifiés à la frappe, cookies, photo, petite ligne, nom, adresse, pause), un seul bouton principal, l'aperçu à côté (sous les textes de la page sur téléphone). Sous le canal, une ligne si ses exceptions « pub » ne visent pas les pages ; prévient avant de quitter la page avec des modifications non enregistrées. Props : `initial`, `saved`, `channels`, `adGroups`, `links`, `trackingBase`, `takenNames`, `landingExceptionChannels`, `action`, `retryAction`.
- `PhonePreview` : aperçu téléphone en direct, même rendu que la page publique (`renderLandingHtml` en mode aperçu : ni script, ni pixel, ni lien actif). Props : `input`, `drawnWidth` (270 par défaut), `title` (nom du cadre, unique dans la page), `className`.
- `PagePreviewDialog` (client) : « Voir la page » dans l'en-tête de la fiche : la page enregistrée en grand dans une boîte (`Dialog`), jusqu'à la taille réelle d'un téléphone (`largePreviewWidth`, `preview-size.ts` : textes à côté à partir de 768 px, au-dessus sur téléphone). Toujours l'aperçu (`savedPagePreviewInput`), jamais la vraie page publique : l'équipe y serait comptée comme une vraie visite et les pixels enverraient leurs événements aux régies (test de garde `tests/routes/no-public-landing-links.test.ts`). Props : `input`, `isActive`.
- `CopyLinkButton` (client) : « Copier le lien » d'une source, désactivé avec la raison tant que le lien Telegram n'est pas prêt. Props : `url`, `label`, `disabledReason`, `size`, `compact`, `className`.
- `LandingStats` (serveur) : les chiffres d'une page : sélecteur de période (revient sur `#chiffres`), cinq `StatCard`, `DataTable` par source (volet de détail, « — » sans pub, « aucun join » sous une dépense sans demande), ligne des sources inconnues ou retirées, « Telegram ouvert » en `BarList` par téléphone avec le détail par appli replié (`AdvancedSection`), comparaison avec les liens directs des pubs (`DataTable`, colonnes secondaires cachées sur téléphone). Props : `pageId`, `table`, `previous`, `period`, `compare`, `direct`, `slug`, `trackingBase`, `adNames`, `readyKeys`. Règles pures : `lib/landing/form.ts`, `lib/landing/stats.ts`.

**Canaux** (`components/channels/`) : `ChannelTabs` (onglets de la fiche, `TabNav` ; téléphone : deux rangées de deux boutons ; nombre de demandes en pastille), `EntryRuleForm` (« Qui peut entrer et quand » : trois choix, puis Avancé), `BotTextEditor` (texte d'un message du bot avec `RichTextEditor` et aperçu), `LangTabs` (langues en onglets Base UI), `BotToggle` (interrupteur « Activé »), `RequestCard` (une demande, Accepter / Refuser), `ChannelMembersTable`, `ChannelSettingsForm`, `BotPills`, `ChannelStatePills`.

**Messages** (`components/messages/`) :

- `MessagesCalendar` (`calendar/messages-calendar.tsx`, client) : la semaine heure par heure (heure de Paris). Ordinateur : une colonne par jour ; chaque carte (heure, statut, version A/B, début du texte, canal) bordée de la couleur de son univers ; glisser un brouillon ou un message programmé le déplace (confirmation, « Annuler ») ; les 3 meilleurs créneaux surlignés (étoile) ; « + Programmer » sur une case libre ; colonne d'aujourd'hui en orange pâle. Téléphone : un jour à la fois (bande des 7 jours, flèches). Clic sur un message : `PostPanel` (volet : Déplacer, Dupliquer, Modifier, Ouvrir). Props : `monday`, `todayKey`, `nowIso`, `items`, `slots`, `slotsNote`, `computedLabel`, `recomputeChannelId`, `initialDay`, `query`, `prefill`.
- `PostForm` (création en trois niveaux), `CategoryPicker` (« + Nouvelle catégorie » sans quitter la page), `MoveForm` (« Déplacer » au clavier), `ViewTabs` (Calendrier, Liste, Modèles : commutateur sobre, pas d'orange ; ce n'est pas une barre d'onglets), `MessagesListTable`. Les filtres repliables sont `CollapsibleFilters` (§ 3.3).

**Membres** (`components/members/`) : `MembersNav` (Liste, Écrire à un groupe, Relances automatiques : `TabNav`, grille de 3 sur téléphone), `MemberFilterBar` (`member-filters.tsx` : recherche, volet « Filtrer » en trois questions, pastilles `FilterChips`, filtres en phrases), `MemberQuickView` (résumé dans le volet), `MemberTimeline`, `member-cells.tsx` (`MemberAvatar` rond aux initiales, `MemberTags`, `MemberOriginCell`, `DepositsCell`, `LastActivity`).

**Conversations** (`components/conversations/` et `components/personas/`, phase 17) :

- `ConversationsNav` : sous-navigation de la rubrique (Boîte de réception, Personas, Chiffres : `TabNav`, trois boutons côte à côte sur téléphone), avant le `PageHeader` ; la fiche d'une conversation ou d'une persona garde l'onglet de sa rubrique allumé. Props : `current`, `className`.
- `ConversationStatusBadge` (serveur) : pastille « Qui répond » : « L'assistante répond » accordé à la persona (« L'assistant répond » si masculine), « Personne ne répond » (ambre, raison au survol) quand l'assistante ne répondra pas (règle `lib/conversations/reply-state.ts`, même que le webhook), sinon `StatusBadge`. Props : `status`, `gender`, `nobodyReason`, `className`.
- `InboxFilters` (pastilles Toutes / Non lues / L'équipe a la main, puis étape, qui répond, source, persona ; « En pause » caché), `ConversationThread` (client : fil en direct), `MessageBubble`, `ConversationActionButtons` (Prendre la main, Rendre, Fermer, Bloquer), `TeamReplyForm` (client : « Envoyer », seul bouton orange de la fiche), `ConversationFacts` (colonne de droite), `ConversationStatsTable` + `FigureDetail` (Chiffres).
- Personas : `PersonaForm` (client, six blocs), `OfferVisualField` (client : visuel de l'app ; l'étiquette pointe toujours vers un élément), `PersonaTester` (client : « Tester »), `PromptPreview` (consignes envoyées à l'IA, repliées).

**Écrire à un groupe** (`components/broadcasts/`) : `BroadcastWizard` (Qui, Quoi, Quand avec `Stepper` et récapitulatif), `GroupBuilder` (critères en blocs avec croix ; critère non réglé en pointillé « Pas encore réglé »), `message-editor.tsx` (`MessageTextEditor`, `MediaChooser`, `ButtonsEditor`, `MessageExtras`), `SplitSlider` (curseur natif aux couleurs du thème, 40 px), `ScheduleDialog`, `BroadcastProgress`, `ReadOnlyPreview`.

**Relances automatiques** (`components/automations/`) :

- Cartes prêtes à l'emploi : `AutomationCard`, `CardSettingsPanel`, `RuleSwitch` (interrupteur avec confirmation) et `TestOnMeButton`, `RuleStatusPill`, `MessageField`, `LinkButtonsField`, `LanguageChecklist`.
- **Éditeur à branches** (`editor/`, client, `@xyflow/react`) : `RuleEditor` (bibliothèque de blocs `palette.tsx`, canevas avec glisser-déposer, liens, zoom et mini-carte, panneau de réglage `node-panel.tsx`, validation en direct : bloc à corriger entouré de rouge et « N points à corriger », « Tester sur moi », « Enregistrer ») ; `nodes.tsx` (un composant qui s'adapte au type : Départ, Condition à deux sorties « oui » / « non », Action, Attendre, Arrêter ; passages sur la fiche) ; `canvas-controls.tsx` (zoom, ajuster, « Ranger les blocs », barre au-dessus du canevas, jamais dessus) ; `outline.tsx` (le parcours en liste : alternative accessible au canevas, et affichage sur téléphone) ; `flow.css` (styles du canevas aux jetons du thème). Logique pure dans `packages/core` (graphe) et `lib/automations/` (formulaires, description, journal).
- `RuleFlowView` : le parcours en lecture seule avec les passages de chaque bloc (fiche d'une relance), échelle jamais sous 0,85, la molette fait défiler la page.

**Statistiques** (`components/dashboard/`) : `StatsTop` (haut commun des cinq pages : titre, sous-navigation, retour d'action, sélecteur unique, période en toutes lettres ; un seul `primaryAction`, « Exporter » sur Pubs), `StatsNav` (`TabNav`, rangée qui défile sur téléphone, filtres conservés), `StatsFilters` (période, comparaison, univers, campagne, « Plus de filtres » : canal ; bouton « Appliquer »), `NumCell` (`cells.tsx`).

**Réglages** (`components/settings/`) : `SettingsCardGrid` (cartes de Réglages : icône, titre `<h2>` lien, une phrase, pastille d'état, liens des pages regroupées ; grille 1, 2 puis 3 colonnes ; props `cards`, `states`, `className`), `HealthTiles` (six tuiles d'État du système ; props `tiles`, `className`), `ConnectionTiles` (quatre connexions ; props `tiles`, `className`), `AdAccountsTable`, `BotConnection`, `BotModeForm` (serveur : « Mode » et « Persona liée » d'un bot, `bot.channelCount` facultatif) + `BotModeFields` (client : demande confirmation avant de passer en assistant un bot normal, règle `bot-mode-logic.ts`). Les listes « libellé : valeur » sont `DetailList` / `DetailRow` (§ 3.3). Journal : `ViewTabs` (`app/(admin)/settings/journal/view-tabs.tsx`, `TabNav`).

## 4. À consolider (doublons connus)

Relevés pendant la phase 9 ; à faire par l'équipe qui touche ces fichiers, sans changer le rendu attendu.

**Résolus (consolidation de la phase 9)** :

- **Un seul `BarList`** : `components/charts/bar-list.tsx` (avec `emphasis`, `title`, `labelWidth`) ; l'ancien `components/messages/bar-list.tsx` est retiré, le test A/B et Comparer par catégorie l'utilisent (barres orange, la version en tête orange et l'autre grise).
- **Une seule barre d'onglets `TabNav`** pour la fiche campagne, la fiche canal, Membres, les Statistiques et le Journal (même dessin, mêmes cibles, même focus ; adresses inchangées).
- **Composants partagés rangés dans `components/admin/`** : `CollapsibleFilters` (ex-`components/messages/`) et `ScrollFade` (ex-`components/dashboard/`).
- **Un seul compteur de caractères** : celui de `RichTextEditor` ; le compteur de `TelegramPreview` est désactivé par défaut (`counter`).
- **Code mort retiré** : `AiTextarea` (`components/ai/ai-textarea.tsx`, plus utilisé depuis l'éditeur sans balises), `wrapSelection` (`lib/channels/bot-messages.ts`) et `barWidths` (`lib/posts/compare.ts`), avec leurs tests.

**Restent à faire** :

1. **Regroupements de Réglages** (`settings/categories/group-nav.tsx`, `SettingsGroupNav`) : même dessin que `TabNav` à quelques détails près (téléphone : onglets soulignés sur deux colonnes) ; à passer sur `TabNav` (`phone="grid"`, `columns={2}`).
2. **Deux interrupteurs** dessinés à l'identique (`Track` de `BotToggle` et de `RuleSwitch`) : un `SwitchTrack` partagé (ou une primitive `ui/switch.tsx`).
3. **Ronds aux initiales** : l'en-tête et `MemberAvatar` (`member-cells.tsx`) dessinent chacun le leur ; `ui/avatar.tsx` n'est pas utilisé. Un seul composant (ou retirer `avatar.tsx`).
4. **`ReadOnlyPreview`** (Écrire à un groupe) n'est plus qu'un `TelegramPreview` sans compteur, ce qui est désormais le comportement par défaut : à remplacer par `TelegramPreview` (et retirer les `counter={false}` devenus inutiles).
5. **`FigureDelta`** (cartes de campagne) reprend le rendu de la variation de `StatCard` : extraire un `DeltaLine` commun dans `stat-card.tsx`.
6. **« Effacer les filtres » de Membres** (`components/members/member-filters.tsx`) : la page le cache encore elle-même (`count === 0 && "hidden"`) pour que le tri seul (`sort`) ne l'affiche pas. À remplacer par `keepParams={["view", "tab", "sort"]}` (le tri est alors gardé par « Effacer les filtres ») et retirer le `hidden`.
