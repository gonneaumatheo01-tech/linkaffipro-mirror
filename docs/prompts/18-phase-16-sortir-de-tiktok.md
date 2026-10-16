# Phase 16 — Pages d'atterrissage : sortir du navigateur intégré de TikTok (et des autres applis)

Si `docs/STATUS.md` indique déjà « phase 16 terminée », vérifie le déploiement, crée `docs/PHASE-DONE` et arrête-toi.

Lis `CLAUDE.md`, `docs/STATUS.md` (phase 15), la partie « Ouverture de Telegram » de `docs/DECISIONS-TECH.md`, puis `packages/core/src/landing-render.ts`, `packages/core/src/landing.ts`, `apps/web/app/j/`, `apps/worker/src/landing/` et la rubrique Pages. Mode autonome, aucune question, décisions dans `docs/DECISIONS-TECH.md`. Petite phase : vise environ 1 heure, sans rogner sur les tests.

## Constat (client, 15 octobre, 18 h)
- Dans TikTok, le bouton de la page n'ouvre pas Telegram : `tg://` et le lien `https://t.me/+…` restent bloqués dans le navigateur intégré.
- Recherches :
  - inapp-debugger, iPhone, mars 2026 : TikTok ❌ « Safari scheme » (`x-safari-https`), ❌ « Browser scheme », n'utilise pas le navigateur du téléphone ;
  - inapp-debugger, Android, novembre 2024 : TikTok, échappée par `intent://` « not dependable ».
  
  **Aucune sortie automatique n'est fiable.** La seule voie sûre est que la personne ouvre la page dans Safari ou Chrome (menu « ⋯ » de l'appli, puis « Ouvrir dans le navigateur »). De là, Telegram s'ouvre normalement.

## PRIORITÉ ABSOLUE : AUCUN DÉLAI (exigence du client, 15 octobre, 18 h 22)
Le client trouve qu'il y a « un gros délai » après l'appui sur « Rejoindre », et ne veut **aucun délai**.

Cause dans le code actuel :
- `LANDING_FALLBACK_MS` attend 2 s (iPhone) ou 1,5 s (Android) après un essai `tg://` / `intent://` bloqué par TikTok, avant de passer au lien `https://t.me/+…`. Ce lien charge à son tour la page t.me dans TikTok, sans ouvrir Telegram.
- `LANDING_FALLBACK_AFTER_DIALOG_MS` peut prolonger l'attente jusqu'à 10 s.

À faire :
- **Supprime toute attente visible** : plus de minuterie de repli vers t.me dans les navigateurs intégrés, et plus de saut automatique vers la page t.me dans TikTok (elle n'ouvre pas Telegram).
- **Réaction instantanée à l'appui** : état « appuyé » visible tout de suite et action en moins de 100 ms. Rien n'est calculé ni envoyé avant : visites, clics et pixels partent après, sans être attendus.
- **Navigateur normal** (Safari, Chrome, etc.) : le lien natif part immédiatement, sans script devant.
- **Ouverture automatique dans Safari ou Chrome** (point 4) : un petit script en tout début de `<head>`, exécuté avant le reste de la page, jamais après `load`. Les pixels viennent après.
- Mesure et note dans `docs/STATUS.md` avec Playwright (marques de performance) :
  - temps entre l'appui et l'aide visible ou le départ vers Telegram : objectif < 100 ms ;
  - temps entre la première réponse du serveur et la tentative d'ouverture automatique : objectif < 300 ms.

## Ce que montre la capture iPhone du client (16 octobre, `docs/tiktok-captures/iphone-tiktok-menu-ouvert.png`)
Regarde cette image avant de placer quoi que ce soit.
- **iPhone, navigateur intégré de TikTok :**
  - barre du haut **noire** sous la barre d'état : flèche retour « ‹ » à gauche, adresse en gris au centre, **« ••• » (trois points horizontaux) en haut à droite** ;
  - pas de barre en bas.
- **Le menu** est une feuille sombre qui monte du bas, avec 3 lignes et leurs icônes : « Signaler », **« Ouvrir dans le navigateur »** (2e ligne, icône boussole), « Copier le lien ».
- **La flèche iPhone pointe donc en haut à droite**, sur les « ••• », juste sous la barre d'état et l'encoche (`env(safe-area-inset-top)`), sans les cacher.
- **Le texte de l'aide** écrit « ••• » (le même signe que TikTok) et reprend mot pour mot « Ouvrir dans le navigateur ».
- **Android :** pas encore de capture. Le client pense que le bouton n'est pas au même endroit que sur iPhone, probablement en bas à droite. Vérifie avec tes recherches, choisis la position la plus probable, et dépose une capture Android dans `docs/tiktok-captures/` si tu en trouves une fiable.
- **Écran intermédiaire :** la capture montre aussi l'écran « Tu quittes TikTok pour accéder à un site Internet externe » (tiktoklinksafety.eu), qui apparaît pour les liens en bio ou en message. Note-le dans le guide (section Pages) : pour les liens hors pub, il y a une étape TikTok avant la page.
- **Aperçu validé :** le client a validé un aperçu du parcours en 4 écrans :
  1. la page ;
  2. l'aide plein écran (fond sombre, « Appuie sur ••• » en très gros, « puis « Ouvrir dans le navigateur » », 3 étapes numérotées, flèche jaune `#FFD43B` animée, lien « Réessayer ») ;
  3. le menu de TikTok ;
  4. Safari avec la question de l'iPhone « Ouvrir dans « Telegram » ? ».
  
  Reproduis cet esprit dans le style de la page existante.

## Ce que le client a validé (15 octobre, 18 h 19 et 18 h 22)
1. **Aide instantanée dans les navigateurs intégrés.**
   - Dans un navigateur intégré (TikTok, Instagram, Facebook, Messenger, Snapchat, etc., reconnus à leur identifiant de navigateur), l'appui sur « Rejoindre » fait deux choses **en même temps** :
     - il tente d'ouvrir Telegram en arrière-plan (`tg://`, ou `intent://` là où ça peut marcher) ;
     - il affiche **immédiatement** l'aide **plein écran** (0 ms, aucune attente).
   - Si Telegram s'ouvre quand même, la page passe en arrière-plan et l'aide ne gêne pas.
   - Cette détection est acceptée par le client **uniquement** pour afficher cette aide et placer la flèche. Le contenu de la page et la destination ne changent pas. Note-le dans `docs/DECISIONS-TECH.md` comme précision de la règle 7.
2. **Aide très visible.**
   - Fond sombre sur tout l'écran.
   - Texte énorme, dans la langue de la page : « Appuie sur ⋯ puis « Ouvrir dans le navigateur » ». Utilise le libellé exact du menu de chaque appli, dans chaque langue et sur chaque système.
   - Une **grosse flèche animée pointée pile sur le bouton ⋯** de l'appli, sans le cacher.
   - **La position du ⋯ n'est pas la même sur iPhone et sur Android**, ni d'une appli à l'autre. L'aide TikTok parle d'un menu « en bas de l'écran » ; vérifie pour chaque appli et chaque système.
   - Mets les positions dans **une seule table** (appli × système : coin, décalages, zone de sécurité de l'écran `env(safe-area-inset-*)`), facile à corriger.
   - **Avant de finaliser, regarde le dossier `docs/tiktok-captures/`** : le client peut y avoir déposé des captures de son téléphone. Aligne la flèche dessus et cite-les dans `docs/DECISIONS-TECH.md`.
   - Petit lien « Réessayer » (relance l'ouverture de Telegram).
   - L'aide réapparaît, instantanément, à chaque nouvel appui.
3. **Marqueur dans l'adresse.**
   - Juste avant d'afficher l'aide, `history.replaceState` ajoute `tgo=1` et l'identifiant de la visite (`vid`) à l'adresse, en gardant `src`, `ttclid` et `fbclid`. Ainsi, « Ouvrir dans le navigateur » emporte le marqueur.
   - Vérifie que ces applis transmettent bien l'adresse modifiée. Si ce n'est pas fiable, accepte aussi comme marqueur : présence de `ttclid` ou `fbclid` hors navigateur intégré.
4. **Ouverture automatique dans Safari ou Chrome, sans deuxième clic.**
   - Hors navigateur intégré, avec le marqueur : lancer Telegram **dès l'affichage** de la page, une seule fois par chargement, puis retirer le marqueur de l'adresse (jamais de boucle).
   - iPhone (Safari) : `tg://join?invite=…`. iOS affiche alors sa propre question « Ouvrir dans Telegram ? », qu'on ne peut pas supprimer.
   - Android (Chrome) : la façon qui marche sans geste. Essaie `intent://…;scheme=tg;package=org.telegram.messenger;S.browser_fallback_url=…`, puis une réponse 302 du serveur vers ce lien. Documente ce que Chrome accepte.
   - Si rien ne s'ouvre, la page normale reste avec son bouton (un appui).
5. **Suivi.**
   - Nouveaux événements : aide affichée, sortie de l'appli (visite marquée ouverte hors navigateur intégré, rattachée à la visite d'origine par `vid`), ouverture automatique tentée.
   - Dans le tableau de la rubrique Pages, par page et par source, avec le détail iPhone / Android : « Aide affichée », « Sortis de TikTok », « % sortis ».
   - Pixels : pas de deuxième « ClickButton » / « Contact » pour la même visite (`vid`).

## Tests et livraison
- Tests unitaires :
  - rendu avec l'aide ;
  - table des positions (chaque appli × système a une entrée) ;
  - lecture du marqueur ;
  - aucune ouverture automatique sans marqueur ni dans un navigateur intégré ;
  - aucune boucle ;
  - plus aucune minuterie de repli d'au moins 1 seconde dans le script de la page (test qui échoue si `LANDING_FALLBACK_MS` ou une attente équivalente revient) ;
  - poids de la page toujours < 15 Ko hors pixels.
- Playwright avec les identifiants de navigateur TikTok, Instagram et Facebook (iPhone et Android) :
  - clic : l'aide est visible **en moins de 100 ms**, la flèche est au bon endroit d'après la table, l'adresse contient `tgo=1`, et aucune navigation automatique vers t.me n'a lieu ;
  - navigateur normal : départ vers Telegram en moins de 100 ms après l'appui ;
  - Safari puis Chrome avec le marqueur : tentative d'ouverture au chargement.
- Captures 390 px de l'aide pour TikTok iPhone et TikTok Android dans `docs/captures/`. Lighthouse mobile refait sur la page de test du canal Test.
- `pnpm lint && pnpm build && pnpm test` verts, déploiement vérifié, `docs/STATUS.md` et guide (section Pages) à jour, commit et push.
- Bilan Telegram en 3 lignes, avec le test à faire par le client : s'envoyer le lien de la page de test dans un message TikTok, l'ouvrir depuis TikTok, appuyer sur « Rejoindre », suivre la flèche. Puis `docs/PHASE-DONE`.
