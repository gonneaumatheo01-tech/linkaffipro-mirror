# Link Affi — schéma observé (phase 0)

Référence d'accès : `docs/LINKAFFI-API.md`. Ce document décrit ce qui a été **vérifié**. Les parties marquées « à confirmer » attendent les deux clés de l'API (`x-api-key` et `apikey`), qui n'ont pas encore été fournies : dès qu'elles le seront, lancer `pnpm linkaffi:check` puis compléter ce fichier (volumes, colonnes exactes, format du sub-ID).

## Ce qui est vérifié sans clés

### Lien de campagne
Exemple fourni : `https://linkaffi.me/go/47eb8mwc`.

- `linkaffi.me` est une application web (React) ; `/go/:campaignKey` est une page qui, **côté navigateur**, construit l'URL
  `https://igqzbemzzxvuehwnyotn.supabase.co/functions/v1/track-click?campaign_key=<clé>` et y ajoute **tous les paramètres de l'URL d'origine** tels quels (sauf `campaign_key`).
- Conséquence : la clé de campagne est `47eb8mwc` (8 caractères alphanumériques), et tout paramètre ajouté au lien (ex. `?subid=…`) est transmis à la fonction `track-click`, qui l'enregistre dans la table `clicks` puis redirige vers le casino.
- La redirection n'est **pas** un 302 serveur : un clic depuis un bot Telegram ouvre d'abord la page `linkaffi.me` (spinner « Redirection en cours… ») puis la fonction `track-click`. Les prévisualisations de liens (robots) ne déclenchent pas le JavaScript, donc ne créent pas de clic côté Link Affi.
- Aucun test de clic n'a été effectué (cela écrirait une ligne dans les statistiques réelles de Link Affi).

### Nom du paramètre de sub-ID — à confirmer
Le code public de l'application ne contient pas le nom du paramètre (il est traité dans la fonction serveur `track-click`). Deux moyens de le confirmer une fois les clés fournies :
1. lire 5 lignes de `clicks` (`GET /stats-api/clicks?limit=5&order=-created_at`) et repérer la colonne de sub-ID (candidats : `sub_id`, `subid`, `sub1`, `click_ref`) ;
2. demander à la personne qui a créé l'API le nom exact du paramètre accepté par `track-click`.

La plateforme génère ses sub-ID au format `<memberShortId>-<postShortId>` (base62, 8 + 1 + 8 = 17 caractères) : à valider contre la longueur maximale acceptée.

## Tables à utiliser (d'après docs/LINKAFFI-API.md) — colonnes à confirmer

| Table | Signification | Colonnes attendues | Colonne de date pour la synchro | Correspondance prévue |
| --- | --- | --- | --- | --- |
| `campaigns` | Liens de suivi / campagnes de l'affilié | `id`, `campaign_key`, `affiliate_id`, `casino_id`, `name`, `created_at` | `updated_at` sinon `created_at` | `AffiliateCampaign` (`externalId`, `key`, `programId`) |
| `casinos` | Programmes (casinos, bookmakers…) | `id`, `name`, `type` ou catégorie, devise | — (table de référence, synchro complète) | `AffiliateProgram` (`vertical` choisi dans l'interface) |
| `clicks` | Clics enregistrés par `track-click` | `id`, `campaign_id` ou `campaign_key`, sub-ID, `ip`/pays, `user_agent`, `created_at` | `created_at` | `Click.subId` → rattachement au membre et au message |
| `players` | Joueurs | `id`, identifiant externe, `affiliate_id`, `casino_id`, sub-ID, `registered_at`, `ftd_at`, montant FTD | `updated_at` | `Player` |
| `player_events` | Événements joueurs | `id`, `player_id`, `type` (registration, ftd, deposit, redeposit…), `amount`, `currency`, `occurred_at` | `created_at` | `PlayerEvent` |
| `player_financials` | Cumuls par joueur | `player_id`, dépôts cumulés, NGR, période | `updated_at` | `Player.depositTotal`, `Player.ngr` |
| `deposit_snapshots`, `revshare_snapshots` | Historiques | `player_id` ou `affiliate_id`, date, montants | date du snapshot | cohortes / LTV (phase 2) |
| `ftd_invalidations` | FTD annulés | `player_id`, raison, `created_at` | `created_at` | correction de `Player.ftdAt` |
| `postback_logs`, `untracked_postbacks` | Postbacks bruts | payload, statut, `created_at` | `created_at` | diagnostic |
| `stats`, `landing_events_daily` | Agrégats journaliers | date, affilié, casino, clics, inscriptions, FTD, dépôts, NGR | date | contrôle de cohérence |
| `currency_rates` | Taux de change | devise, taux, date | date | conversion en EUR |

Tables à ne pas lire : voir `docs/LINKAFFI-API.md` (données financières et personnelles d'autres utilisateurs).

## Client et synchronisation (prêts)
- `packages/linkaffi` : client typé (`listTables`, `getPage`, `iterate`, `getAll`, `count`), 1 requête/s, pagination `offset` jusqu'à `total`, reprises sur 429/5xx/réseau, erreurs explicites sur 401/403.
- `pnpm linkaffi:check` : affiche la liste des tables et le nombre de lignes des tables utiles.
- Les variables `LINKAFFI_API_URL` (posée) et `LINKAFFI_API_KEY` / `LINKAFFI_ANON_KEY` (à poser) vivent sur le service `worker` uniquement.
