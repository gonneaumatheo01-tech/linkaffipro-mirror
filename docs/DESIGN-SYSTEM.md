# Design system LinkAffi Pro

Règles visuelles et catalogue des composants de l'interface (phase 9, spécification client : `docs/REFONTE-UX.md`).
Tout est visible en situation sur la page interne **`/styleguide`** (administrateurs seulement, hors menu).

- Jetons de thème : `apps/web/app/globals.css` (thème clair uniquement, pas de classes `.dark`).
- Primitives : `apps/web/components/ui/*` (shadcn sur Base UI, restylées). Composants d'application : `apps/web/components/admin/*`.
- Une seule bibliothèque, un seul style : on n'ajoute pas de deuxième jeu de composants, on n'écrit pas de couleur en dur (`#…`, `emerald-500`, `amber-50`…). On utilise les jetons ci-dessous.

## 1. Règles

### Couleurs et usage

| Jeton (classe Tailwind)                                                   | Valeur            | Usage                                                                                                        |
| ------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `bg-brand` + `text-brand-foreground`                                      | #FCA314 + #020713 | Bouton principal, élément actif ou sélectionné, accents. Jamais de texte blanc sur l'orange (contraste 2:1). |
| `text-brand-ink`                                                          | #9A5B00           | Orange lisible pour un texte ou un lien sur fond clair (5,2:1).                                              |
| `bg-brand-soft`                                                           | #FFF4E0           | Fond orange très pâle : rond des états vides, compteur « réglages modifiés », ligne sélectionnée.            |
| `bg-night`, `text-night-foreground`, `text-night-muted`, `bg-night-hover` | #020713…          | Barre de menu, en-têtes sombres, infobulles.                                                                 |
| `bg-background`                                                           | #FAFAF7           | Fond des pages (blanc cassé).                                                                                |
| `bg-card` / `bg-surface`                                                  | #FFFFFF           | Cartes, tableaux, volets, champs.                                                                            |
| `text-foreground`                                                         | #1A1F2B           | Texte principal.                                                                                             |
| `text-muted-foreground`                                                   | #5B6474           | Texte secondaire, lignes d'aide, en-têtes de tableau (5,7:1).                                                |
| `border-border`                                                           | #E4E6EB           | Bordures 1 px des cartes, tableaux, séparateurs.                                                             |
| `border-muted-foreground/75` (`fieldBorderClass`)                         | ≈ #848C9B         | Bordure des champs (Input, Textarea, SelectTrigger, Checkbox, `NativeSelect`) : 3,4:1 (WCAG 1.4.11).         |
| `border-input`                                                            | #D5D9E0           | Boutons « outline » seulement (1,4:1 : reconnus par leur texte). Jamais pour un champ.                       |
| `text-success` + `bg-success-soft`                                        | #15803D           | Réussi, en ligne, variation favorable.                                                                       |
| `text-warning` + `bg-warning-soft`                                        | #854D0E           | À surveiller, en attente (jaune-brun, distinct de l'orange de marque).                                       |
| `text-danger` + `bg-danger-soft`                                          | #B91C1C           | Échec, erreur, action destructive.                                                                           |
| `text-info` + `bg-info-soft`                                              | #1D4ED8           | En cours, programmé, information.                                                                            |

Contrastes vérifiés (WCAG AA) : chaque texte d'état sur son fond doux ≥ 4,7:1 ; texte nuit sur orange 10:1. Le test
`apps/web/components/ui/theme-contrast.test.ts` recalcule ces rapports depuis `globals.css` (texte ≥ 4,5:1 ; bordure
des champs, courbes et anneau de focus ≥ 3:1) : ajoutez-y tout nouveau couple de couleurs.

### Univers

Casino violet `casino` (#7C3AED), Paris sportifs vert `sports` (#059669), Rencontres rose `dating` (#DB2777).
**Toujours en pastille, en bordure fine ou en étiquette, jamais en fond plein.** Texte coloré : `text-casino-ink`, `text-sports-ink`, `text-dating-ink` (AA).
Libellés et classes : `apps/web/lib/universe.ts` (`UNIVERSE_LABELS`, `toUniverse`, `universeLabel`, `universeClasses`, `UNIVERSE_CSS_VARS` pour les graphiques). Composant : `UniverseDot`.

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

### Espacements, formes, ombres

- Grille de 8 px (`gap-2`, `gap-4`, `p-4`, `space-y-6`…).
- Cartes : `rounded-xl` (12 px), bordure 1 px `border-border`, fond blanc, **aucune ombre lourde** (au plus `shadow-xs` ; les menus et boîtes flottantes ont une ombre légère pour se détacher).
- Boutons et champs : `rounded-lg` ; pastilles : `rounded-full`.

### Un bouton principal par page

Le bouton orange (`<Button>` variante `default`) est **unique** sur un écran : « Programmer », « Envoyer », « Nouvelle campagne ». Les autres actions sont `outline`, `secondary` ou `ghost`. Dans un `PageHeader`, le principal se passe en `primaryAction`, les autres en `secondaryActions`.

### Tableaux : 5 colonnes au plus

Une liste montre au plus 5 colonnes (le `DataTable` avertit en développement au-delà). Le reste va dans le volet de détail (ligne cliquable) ou sur la fiche. Graphiques avant tableaux. Sur téléphone, masquez la colonne la moins utile (`hideOnMobile`).

### Formulaires en trois niveaux

1. **Visible** (`FormSection`) : ce qu'il faut pour que ça marche (3 à 5 champs).
2. **Un clic** (`FormSection` supplémentaire ou bouton « + Ajouter… ») : médias, boutons, test A/B.
3. **Avancé** (`AdvancedSection`, replié) : réglages rares, avec des valeurs par défaut sensées. Pas de champ obligatoire dans un bloc replié.

Un seul bouton principal (« Programmer » / « Envoyer ») ; « Enregistrer en brouillon » en secondaire. Chaque champ a un `<Label htmlFor>` relié (ou un `aria-label`) ; une ligne d'aide en `text-note text-muted-foreground` sous le champ si besoin.

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

Vouvoiement, français simple, pas de jargon en surface. Univers : « Casino », « Paris sportifs », « Rencontres ».

### Le terme technique au survol

Le mot du client est affiché ; le terme exact apparaît au survol, au toucher et au focus clavier : `<Term term="FTD">premiers dépôts</Term>` (soulignement pointillé discret, bulle « Terme technique : FTD »). Il est aussi lu par les lecteurs d'écran (« premiers dépôts (FTD) »). Dans un bouton, un lien ou un libellé (en-tête triable, carte cliquable), `Term` reste un simple texte (pas de bouton dans un bouton) : le terme passe alors dans le nom accessible du parent et en `title`. `StatCard` (`term`) et `DataTable` (`column.term`) le font tout seuls. Les infobulles longues (`HelpTip`) sont l'exception, pas la règle.

### Accessibilité

- Libellés reliés (`<Label htmlFor>`), `aria-label` sur tout bouton icône (contrôlé par `apps/web/tests/a11y`).
- Focus toujours visible : contour 2 px `ring` (#9A5B00) décalé de 2 px ; les champs prennent une bordure orange foncé et un halo.
- Contraste AA pour tout texte (voir tableau des couleurs) ; la couleur n'est jamais la seule information (pastille = point + mot, variation = flèche + signe + phrase pour lecteur d'écran).
- Cibles tactiles ≥ 40 px sur téléphone : les boutons, éléments de menu, listes de choix, pagination, en-têtes triables et premières cellules du `DataTable` le font d'office (`max-md:min-h-10`).
- Bordure des champs à 3:1 au moins (`fieldBorderClass`) ; mini-courbes en `brand-ink` (l'orange de marque ne fait que 2:1 sur blanc).
- Tableau plus large que l'écran : la zone défile, prend le focus clavier (flèches) avec un nom (`label` ou légende) et montre un dégradé sur le bord tant qu'il reste des colonnes (contrôle axe `scrollable-region-focusable`).
- Bulles d'aide (`Term`, `HelpTip`) : ouvertes au survol, au toucher et au focus clavier, rendues dans un portail (jamais coupées par une carte ou un tableau), texte relié au bouton par `aria-describedby`.
- Un seul `<h1>` par page (celui du `PageHeader`) ; titres de section en `<h2>`.

## 2. Pièges connus (développeurs)

- **Fusion de classes** : importez `cn` depuis `@/components/ui/cn`. Il connaît les tailles `text-title|body|note|figure` ; le `cn` brut du paquet « cn » croit que `text-note` est une couleur et l'efface devant `text-muted-foreground`.
- **Lien qui ressemble à un bouton** : `<Link href="…" className={buttonVariants({ variant: "outline" })}>` (et non `<Button render={<Link/>}>`, qui déclenche un avertissement Base UI et donne une sémantique de bouton à un lien).
- **Composants serveur / client** : `DataTable`, `SidePanel`, `HelpButton`, `ConfirmDialog`, `ConfirmSubmit` sont des composants client. Depuis une page serveur, passez des données sérialisables (cellules déjà rendues, `detail` en JSX) ; les fonctions (`renderDetail`, `rowHref`, `onConfirm`, `onStepClick`) seulement depuis un composant client.
- **Tri du DataTable** : il trie les lignes reçues (la page affichée). Pour trier toute une liste paginée, triez côté serveur. Une cellule texte au format français (« 1 234 € », « −15,3 % », « 09/10/2026 14:05 ») est relue comme nombre ou date, et « — » est trié avec les vides ; pour un nœud React (`<span>`, pastille) ou un autre texte (« 12 / 40 »), passez `sortValues`, sinon la colonne ne se trie pas (avertissement en développement pour les colonnes `align: "right"`).
- **`DropdownMenuLabel`** : placez-le dans un `DropdownMenuGroup` (ou `DropdownMenuRadioGroup`) avec les éléments qu'il annonce. Le `Menu.GroupLabel` de Base UI plante sans groupe parent (« MenuGroupContext is missing » : toute la page tombait sur l'écran d'erreur à l'ouverture du menu) ; notre `DropdownMenuLabel` se replie seul sur un simple intitulé hors groupe, mais le groupe reste la bonne écriture (il nomme le groupe pour les lecteurs d'écran). N'utilisez pas `MenuPrimitive.GroupLabel` directement.
- **Bulles et `overflow`** : une bulle positionnée en `absolute` est coupée par une carte (`Card` est en `overflow-hidden`) ou un tableau qui défile. Toute bulle, menu ou liste flottante passe par un portail Base UI (`Popover`, `Menu`, `Select`, `Tooltip`), comme `HelpTip` et `Term`.
- **Chiffres tabulaires** : ne posez pas `tabular-nums` sur un `<table>`, une ligne ou un bloc de texte ; seulement sur les cellules de chiffres (`TableCell numeric`) ou un chiffre isolé. La règle globale `table { tabular-nums }` de `globals.css` est neutralisée par `Table` (`normal-nums`).
- **Pied de boîte de dialogue** : dans `DialogFooter` (et les pieds de `SidePanel`), écrivez d'abord le bouton secondaire (« Annuler », `SidePanelClose`), puis le principal : il se retrouve à droite sur ordinateur et en haut sur téléphone (`flex-col-reverse`). `showCloseButton` place « Fermer » au bon endroit.
- **`<select>` natif** : utilisez `NativeSelect` (ou `nativeSelectClass`) : texte 16 px sur téléphone (sinon iOS zoome au focus), bordure à 3:1, même flèche que `SelectTrigger`.
- **`Term` et `HelpTip` sont des composants client** (bulle Base UI) : utilisables tels quels depuis une page serveur (le contenu est du JSX sérialisable).

## 3. Catalogue des composants

### Primitives (`apps/web/components/ui/`)

#### Button — `button.tsx`

Props : celles de Base UI `Button` + `variant` (`default` orange principal · `outline` · `secondary` · `ghost` · `destructive` rouge doux · `danger` rouge plein, confirmation · `link`) et `size` (`xs` 28 · `sm` 32 · `default` 36 · `lg` 40 · `icon` · `icon-xs` · `icon-sm` · `icon-lg`). Sur téléphone, toute taille fait au moins 40 px. `buttonVariants()` pour styler un `<Link>`.

```tsx
<Button>Programmer</Button>
<Button variant="outline" size="sm"><Download aria-hidden />Exporter</Button>
<Button size="icon" variant="ghost" aria-label="Plus d'actions"><MoreHorizontal aria-hidden /></Button>
<Link href="/campaigns/new" className={buttonVariants()}>Nouvelle campagne</Link>
```

#### Badge — `badge.tsx`

Étiquette courte (compteur, mot-clé). `variant` : `default` (orange pâle) · `secondary` · `outline` · `success` · `warning` · `info` · `destructive` · `ghost` · `link`. Pour un **état**, utilisez `StatusPill` / `StatusBadge`.

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

Champs 36 px (40 px sur téléphone), fond blanc, bordure gris moyen à 3:1 (`fieldBorderClass`), focus orange foncé ; `aria-invalid` → bordure rouge. Texte 16 px sur téléphone (pas de zoom iOS), 14 px sur ordinateur.

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

Boîte centrée : `Dialog`, `DialogTrigger`, `DialogContent` (`showCloseButton`), `DialogHeader`, `DialogTitle` (20 px), `DialogDescription`, `DialogFooter` (`showCloseButton` → « Fermer », placé avant vos boutons), `DialogClose`. Échap, croix « Fermer », focus piégé. Pied : trait fin, sans fond ; bouton secondaire puis principal (principal à droite sur ordinateur, en haut sur téléphone), comme `ConfirmDialog` et `SidePanel`.

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

Menu Base UI : `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuLabel` (dans un groupe : voir Pièges), `DropdownMenuItem` (`variant="destructive"`), `DropdownMenuSeparator`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup` / `DropdownMenuRadioItem`, sous-menus.

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

Tableau brut : `Table` (`label` : nom de la zone défilante, par défaut la légende), `TableHeader`, `TableBody`, `TableFooter`, `TableRow` (`data-state="selected"`), `TableHead` (note grise ; `numeric` → aligné à droite), `TableCell` (ligne de 48 px ; `numeric` → aligné à droite en chiffres tabulaires), `TableCaption`. Plus large que l'écran : la zone défile, reçoit le focus (flèches gauche / droite) et un dégradé montre le côté où il reste des colonnes ; sinon, aucune tabulation en plus. Pour une liste avec tri et détail : `DataTable`.

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

#### Separator — `separator.tsx`

Trait 1 px (`orientation` `horizontal` | `vertical`).

### Composants d'application (`apps/web/components/admin/`)

#### PageHeader — `page-header.tsx`

Le seul `<h1>` de la page. Props : `title`, `description` (une ligne d'aide), `help` (note : la première chose à faire), `primaryAction` (`{ label, href, icon? }` ou un nœud : LE bouton orange), `secondaryActions` (nœuds discrets), `children` (contenu libre à droite, compatibilité), `backHref` / `backLabel` (« ← Retour »), `meta` (pastilles à côté du titre), `className`.

```tsx
<PageHeader
  title="Campagnes"
  description="Ce que vous promouvez et ce que ça rapporte."
  primaryAction={{ label: "Nouvelle campagne", href: "/campaigns/new", icon: <Plus aria-hidden /> }}
  secondaryActions={
    <Link href="/campaigns/links" className={buttonVariants({ variant: "outline" })}>
      Tous les liens
    </Link>
  }
/>
```

#### StatCard — `stat-card.tsx` (+ `stat-card-logic.ts`)

Props : `label`, `value` (déjà formaté), `delta` (variation en %, ex. `deltaPct(aujourdhui, hier)` ; `null` = « Pas de comparaison possible » ; absent = pas de ligne), `favorable` (`up` par défaut · `down` pour un coût · `none`), `comparison` (« vs hier »), `trend` (nombres → mini-courbe SVG : ligne `brand-ink`, remplissage orange à 12 %), `href` (carte cliquable), `term` (terme technique du libellé : bulle au survol, au toucher et au focus si la carte n'est pas un lien), `hint`, `icon`, `className`. `MiniTrend` est exporté seul.

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
Valeurs de tri : nombres, dates et textes au format français (« 1 234 € », « 15,3 % », « 09/10/2026 14:05 ») sont lus tout seuls ; « — » est trié avec les vides ; `sortValues` pour tout le reste (nœud React, « 12 / 40 »).
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

Volet latéral (Dialog Base UI) : à droite sur ordinateur, plein écran sur téléphone ; titre relié, Échap, croix « Fermer », focus piégé puis rendu. Props : `title`, `description`, `children`, `footer`, `size` (`sm` · `md` · `lg` · `xl`), contrôlé (`open`, `onOpenChange`) ou non (`trigger`, `defaultOpen`). `SidePanelClose` : bouton de fermeture pour le pied.

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

Icône lucide dans un rond orange pâle (boîte de réception par défaut), `title`, `description` (une phrase), `action` (`{ href, label, variant? }`, orange par défaut), `children`, `className`.

```tsx
<EmptyState
  icon={<Send />}
  title="Aucun message programmé"
  description="Programmez un premier message."
  action={{ href: "/messages/new", label: "Programmer un message" }}
/>
```

#### StatusPill — `status-pill.tsx`

Pastille d'état : `tone` (`neutral` · `muted` · `info` · `success` · `warning` · `danger` · `brand`), `dot` (par défaut : oui sauf `neutral`), `title`, `className`, `children`. `PILL_TONES`, `pillToneClasses(tone)`, `pillShowsDot(tone)` exportés.

```tsx
<StatusPill tone="success">En ligne</StatusPill>
```

#### StatusBadge, ActiveBadge — `apps/web/lib/status-badges.tsx`

Libellé français et nuance de **tous** les statuts (dictionnaire `STATUS_DICT`), rendus en `StatusPill` ; les univers (`kind="vertical"`) en `UniverseDot` étiquette. `statusLabel`, `statusLabels`, `statusVariant`, `statusTone`, `entryTone` exportés. Tout nouveau statut doit avoir son libellé (un test le vérifie).

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

#### HelpButton — `help-button.tsx`

Bouton rond « ? » (`aria-label` « Aide de cette page ») qui ouvre l'aide de la page dans un `SidePanel`. Props : `children` (contenu de l'aide : `h3`, `p`, `ul` sont stylés), `title`, `description`, `guideHref` (`/help` par défaut, `null` pour masquer), `guideLabel`, `className`.

```tsx
<HelpButton>
  <h3>À quoi sert cette page ?</h3>
  <p>…</p>
</HelpButton>
```

#### Term, HelpTip — `help-tip.tsx`

`Term` : mot du client, terme technique (`term`) en bulle au survol, au toucher et au focus clavier, et lu par les lecteurs d'écran ; simple texte dans un bouton, un lien ou un libellé. `HelpTip` (API inchangée : `children`, `label`, `className`) : petit « ? » discret ; bulle courte au survol, au toucher et au focus clavier, dans un portail (jamais coupée par une carte ou un tableau), retournée près des bords ; texte relié au bouton (`aria-describedby`), pas de `title` en double. Composants client (Popover Base UI). Règle pure testée : `help-tip-logic.ts`.

```tsx
<Term term="NGR">revenu net</Term>
<HelpTip label="Aide : coût par membre">Dépense pub divisée par les membres entrés.</HelpTip>
```

#### Stepper — `stepper.tsx` (+ `stepper-logic.ts`)

Props : `steps` (`{ key?, title, help? }`, ex. `WIZARD_STEPS`), `current` (index à partir de 0), `onStepClick(i)` (étapes faites cliquables, composant client), `label`, `showHelp`, `className`. Ordinateur : étapes numérotées, en cours en orange, faites cochées ; téléphone : « Étape 2 sur 4 · Offres » et une barre d'avancement. `aria-current="step"`.

```tsx
<Stepper steps={WIZARD_STEPS} current={step} onStepClick={(i) => setStep(i)} />
```

#### ConfirmDialog — `confirm-dialog.tsx`

Boîte de confirmation (AlertDialog Base UI). Props : `title`, `description` (ce qui va se passer), `confirmLabel`, `cancelLabel` (« Annuler », focus par défaut), `destructive` (bouton rouge), `onConfirm` (attendu s'il renvoie une promesse) ; `trigger` (élément qui ouvre ; si c'est un bouton de soumission sans `onConfirm`, le formulaire parent est soumis avec ce bouton : `name`/`value`/`formAction` conservés, une seule fois même sur un double clic) ; contrôlé : `open`, `onOpenChange`. Le déclencheur reçoit `aria-haspopup="dialog"` et `aria-expanded` (sauf valeurs fournies). Logique d'envoi testée dans `confirm-logic.ts` (`submitFromOpener`, `confirmTriggerAria`).

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

API inchangée : un `Button` de soumission + `message`. S'appuie sur `ConfirmDialog` (plus de `window.confirm`). Facultatif : `confirmTitle` (par défaut « <libellé> ? »), `confirmLabel` (par défaut le libellé), `destructive` (par défaut : variante `destructive` ou texte rouge). `title` reste l'infobulle HTML du bouton.

```tsx
<ConfirmSubmit name="intent" value="now" message="Le message va partir maintenant à 1 240 membres.">
  Envoyer maintenant
</ConfirmSubmit>
```

#### Flash — `flash.tsx`

Retour d'une action par l'adresse (`ok`, `error`) : bandeau vert (`role="status"`) et/ou rouge, avec icône.

```tsx
<Flash ok={sp.ok} error={sp.error} />
```

#### Pagination — `pagination.tsx`

`Pagination` (`page`, `pages`, `total`, `hrefFor`, `noun`) ; page en cours en orange (`aria-current="page"`). Sur téléphone, une seule ligne : flèches de 40 px (« Précédent » / « Suivant » restent lus par les lecteurs d'écran) et « Page 2 sur 8 ». Fonctions `pageOf`, `pageCount`, `pageSkip`, `pageHref`, `pageWindow`, constante `PAGE_SIZE`.

```tsx
<Pagination
  page={page}
  pages={pageCount(total)}
  total={total}
  noun="membre"
  hrefFor={(n) => pageHref("/members", sp, n)}
/>
```

#### CopyField — `copy-field.tsx`

Champ en lecture seule + « Copier » (annonce « Copié »). Props : `value`, `label` (nom accessible, « Adresse à copier » par défaut).

```tsx
<CopyField value={link.url} label="Lien de la pub" />
```

#### PeriodSelect — `period-select.tsx`

Sélecteur de période (formulaire GET, liste `NativeSelect`) : `period`, `compare`, `extra` (paramètres à conserver), `action`, `className`.

```tsx
<PeriodSelect period={period} compare={compare} extra={{ campaign: sp.campaign }} />
```

#### SoonPage — `soon.tsx`

Page « bientôt disponible » : `title`, `description`, `items`.
