# Phase 9 : plan technique de la refonte (coordinateur, 10 octobre 2026)

La spécification validée par le client est `docs/REFONTE-UX.md` (elle prime). Ce fichier fixe les choix techniques communs à toutes les étapes, pour que les agents travaillent de façon cohérente.

## Principes
- Présentation seulement : aucune modification des données, des bots, des synchronisations ni des calculs (les fonctions de `lib/**/queries.ts`, `packages/*` et le worker restent la source des chiffres). Une nouvelle requête de lecture pour un écran est permise (ex. chiffres « aujourd'hui » de l'accueil) si elle réutilise les règles existantes (`ourPlayers()`, `campaignPlayerWhere`, etc.).
- Rien ne disparaît : ce qui quitte le menu se retrouve dans Réglages, dans une page ou derrière « Avancé ». Toute ancienne adresse redirige (308) vers la nouvelle.
- Une seule bibliothèque de composants : primitives `apps/web/components/ui/*` (shadcn sur Base UI, restylées) et composants d'application `apps/web/components/admin/*`. Pas de deuxième style.
- Thème clair uniquement (`apps/web/app/globals.css`) ; pas de classes `.dark`.

## Jetons de thème (globals.css, classes Tailwind)
- Marque : `bg-brand` (#FCA314, bouton principal, élément actif) avec `text-brand-foreground` (nuit) ; `text-brand-ink` (#9A5B00, orange lisible sur fond clair) ; `bg-brand-soft` (fond orange très pâle). Barre de menu : `bg-night`, `text-night-muted`, `bg-night-hover`, `text-night-foreground`.
- Fond `bg-background` (#FAFAF7), surfaces `bg-card` / `bg-surface` (blanc), texte `text-foreground` (#1A1F2B), secondaire `text-muted-foreground` (#5B6474), bordures `border-border`.
- États : `text-success` / `bg-success-soft`, `text-warning` / `bg-warning-soft` (jaune-brun, distinct de la marque), `text-danger` / `bg-danger-soft`, `text-info` / `bg-info-soft`.
- Univers : `casino` (#7C3AED), `sports` (#059669), `dating` (#DB2777) en pastille, bordure ou étiquette (jamais en fond plein) ; versions texte AA `text-casino-ink`, `text-sports-ink`, `text-dating-ink`.
- Typographie : Inter (`next/font`, variable `--font-inter`) ; trois tailles `text-title` (20/600), `text-body` (14), `text-note` (12) ; gros chiffre `text-figure` (28/600) ; chiffres tabulaires (`tabular-nums`, automatique dans les tableaux).
- Grille de 8, cartes `rounded-xl` (12 px), bordure 1 px `border-border`, pas d'ombre lourde (au plus `shadow-xs`).
- Le bouton principal (variante `default` de `Button`) est orange avec texte nuit ; un seul par écran.

## Navigation cible et adresses
| Menu | Adresse | Contenu |
| --- | --- | --- |
| Accueil | `/` | état, 3 chiffres du jour, À faire, Prochains messages, Campagnes actives |
| Campagnes | `/campaigns` | cartes, assistant `/campaigns/new`, fiche `/campaigns/[id]` (onglets), tous les liens `/campaigns/links` (ex-`/links`), imports `/campaigns/import*` |
| Canaux | `/channels` | liste, fiche `/channels/[id]`, import `/channels/import` |
| Messages | `/messages` | calendrier semaine, création, modèles, catégories (comparaison) |
| Membres | `/members` | liste et fiche ; Écrire à un groupe `/members/broadcasts/**` (ex-`/broadcasts/**`) ; Relances automatiques `/members/automations/**` (ex-`/automations/**`) |
| Statistiques | `/stats` | vue d'ensemble (ex-onglet « Vue d'ensemble » du tableau de bord), `/stats/ads` (Pubs), `/stats/funnel` (Parcours), `/stats/channels` (Canaux), `/stats/cohorts` (Membres dans le temps) |
| Réglages | `/settings` | écran en cartes ; Bots `/settings/bots` (ex-`/bots`), Journal `/settings/journal` et `/settings/journal/events` (ex-`/journal/**`), sous-pages existantes |
| Aide | bouton « ? » | volet d'aide de la page courante ; guide complet `/help` (adresse conservée) ; visite guidée |

Redirections (fonction pure `apps/web/lib/legacy-routes.ts`, appelée par `proxy.ts` après la branche du domaine de tracking, testée) :
- `/broadcasts…` → `/members/broadcasts…` ; `/automations…` → `/members/automations…` ; `/bots` → `/settings/bots` ; `/journal…` → `/settings/journal…` ; `/links` → `/campaigns/links`.
- `/?tab=overview|ads|funnel|cohorts|channels` → `/stats`, `/stats/ads`, `/stats/funnel`, `/stats/cohorts`, `/stats/channels` (paramètres de période et filtres conservés).
- `/channels/[id]?tab=besthours` → `/messages?channelId=[id]` (meilleurs créneaux dans le calendrier).
- Le domaine `go.goolink.eu` n'est jamais concerné (la branche tracking passe avant).
- MANAGER : l'entrée Réglages est visible ; l'écran en cartes ne montre que ce qui lui est permis (Journal…) ; chaque sous-page garde ses propres contrôles d'accès.

## Accueil (étape 2)
- Chiffres du jour en heure de Paris : membres arrivés aujourd'hui (entrées dans un canal), premiers dépôts aujourd'hui (nos joueurs, `ftdAt`), gains du jour = commissions du jour (primes CPA nettes `PlayerEvent` CPA / CPA_REVERSAL + part du revenu `AffiliateDailyStat.revshareRevenue`) − dépense pub du jour (`AdCost`) ; règle de la phase 10, qui remplace le « bénéfice » d'origine (dépôts + revenu net − pub), chacun avec la variation par rapport à hier.
- Visite guidée : état par utilisateur dans `Setting` `onboarding.<userId>` (pas de migration) ; « Revoir la visite » dans Réglages.

## Relances automatiques à branches (étape 5)
- Nouveau champ JSON `AutomationRule.graph` (migration additive, nullable) ; une règle sans `graph` reste une chaîne linéaire (`actions`) exécutée comme avant. Le moteur exécute le graphe (nœuds déclencheur, condition oui / non, actions, attente, arrêt) ; `AutomationRun` garde la position (`step` = index pour les règles linéaires, identifiant de nœud dans `context` pour les graphes).

## Travail en parallèle
- Chaque agent a une liste de fichiers à lui ; il n'écrit nulle part ailleurs et note ses besoins dans `followups`. Les docs (`GUIDE-UTILISATEUR.md`, `DECISIONS-TECH.md`, `STATUS.md`, `CLAUDE.md`) sont écrites par le coordinateur à partir des rapports.
- Pas de `pnpm build` par les agents (8 Go de mémoire, dossier `.next` partagé) : typecheck, lint et tests seulement ; le coordinateur construit et déploie.
- Tests d'intégration sous verrou : `until mkdir /tmp/lap-int-lock 2>/dev/null; do sleep 10; done; …; rmdir /tmp/lap-int-lock`.
- Serveur de développement : un port par agent (indiqué dans sa consigne), `AUTH_URL` et `APP_BASE_URL` sur ce port ; base locale `lap-pg`, jamais la production.
