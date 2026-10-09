# Link Affi — API de lecture (source de vérité pour les connecteurs)

Link Affi tourne sur **Lovable Cloud** (Supabase géré en interne) : il n'existe aucun compte supabase.com, donc ni jeton personnel, ni accès SQL, ni serveur MCP. Une **API en lecture seule** a été créée spécialement pour cette plateforme. C'est le seul canal d'accès aux données Link Affi.

## Accès

- URL de base : `https://igqzbemzzxvuehwnyotn.supabase.co/functions/v1/stats-api`
- Méthode : `GET` uniquement (lecture seule, aucune écriture possible).
- En-têtes obligatoires sur chaque requête :
  - `x-api-key: <LINKAFFI_API_KEY>` (commence par `lkst_`)
  - `apikey: <LINKAFFI_ANON_KEY>` (un JWT Supabase « anon »)
- Les deux valeurs sont des secrets : variables d'environnement `LINKAFFI_API_URL`, `LINKAFFI_API_KEY`, `LINKAFFI_ANON_KEY` (fichier `.env.local` en local, variables du service `worker` sur Railway). Jamais dans git, jamais dans les logs, jamais dans STATUS.md.

## Endpoints

- `GET /stats-api` → liste toutes les tables disponibles.
- `GET /stats-api/<table>` → lit une table.

Paramètres de requête :

| Paramètre | Rôle | Exemple |
| --- | --- | --- |
| `from`, `to` | filtre par date (`YYYY-MM-DD`) | `from=2026-09-01&to=2026-09-30` |
| `date_col` | colonne de date utilisée par `from` / `to` (défaut : à vérifier, sans doute `created_at`) | `date_col=updated_at` |
| `limit`, `offset` | pagination (`limit` max 5000, défaut 1000) | `limit=5000&offset=5000` |
| `order` | tri ; préfixe `-` = décroissant | `order=-created_at` |
| `eq.<colonne>` | filtre d'égalité | `eq.affiliate_id=<uuid>` |

Réponse : JSON `{ table, total, offset, limit, count, rows: [...] }`. Utiliser `total` pour paginer avec `offset`.

Exemples :
- Stats de septembre : `GET /stats-api/stats?from=2026-09-01&to=2026-09-30`
- Joueurs d'un affilié : `GET /stats-api/players?eq.affiliate_id=<uuid>&limit=5000`
- Demandes de paiement : `GET /stats-api/withdrawal_requests?order=-created_at`

## Tables disponibles

`stats`, `players`, `player_events`, `player_financials`, `clicks`, `campaigns`, `casinos`, `profiles`, `withdrawal_requests`, `payments`, `manager_commissions`, `sub_affiliate_earnings`, `sub_affiliations`, `postback_logs`, `landing_events_daily`, `deposit_snapshots`, `revshare_snapshots`, `ftd_invalidations`, `statements`, `statement_adjustments`, `affiliate_casinos`, `manager_casinos`, `affiliate_managers`, `invoices`, `untracked_postbacks`, `leaderboard_archive`, `monteur_earnings`, `currency_rates`, `promo_claims`, `reward_claims`, `user_roles`, `manager_contracts`.

## Tables à utiliser par la plateforme (et seulement celles-là, sauf besoin documenté)

| Table | Usage attendu | À confirmer en phase 0 |
| --- | --- | --- |
| `campaigns` | campagnes / liens de suivi Link Affi → `AffiliateCampaign` ; format du lien et du sub-ID | colonnes du lien, de l'affilié, du casino |
| `casinos` | programmes → `AffiliateProgram` (univers casino / paris / dating) | type ou catégorie du programme |
| `clicks` | clics Link Affi avec le sub-ID → rattachement `Click.subId` | nom de la colonne sub-ID, horodatage |
| `players` | joueurs → `Player` (inscription, FTD, identifiant joueur, sub-ID) | colonnes d'identifiant externe et de sub-ID |
| `player_events` | événements (inscription, FTD, dépôt, redépôt…) → `PlayerEvent` | valeurs du type d'événement, montants, devise |
| `player_financials` | dépôts cumulés, NGR → `Player.depositTotal`, `Player.ngr` | périodicité (par jour ? cumulé ?) |
| `deposit_snapshots`, `revshare_snapshots` | historiques de dépôts et de revenus | utiles pour les cohortes et la LTV (phase 2) |
| `ftd_invalidations` | FTD annulés → corriger `Player.ftdAt` | — |
| `postback_logs`, `untracked_postbacks` | postbacks bruts → diagnostic, sub-ID manquants | — |
| `stats`, `landing_events_daily` | agrégats journaliers → contrôle de cohérence des totaux | granularité |
| `currency_rates` | conversion des montants en EUR | — |

Tables à **ne pas lire** sans raison documentée (données financières et personnelles d'autres utilisateurs de Link Affi) : `profiles`, `withdrawal_requests`, `payments`, `invoices`, `statements`, `statement_adjustments`, `manager_commissions`, `manager_contracts`, `user_roles`, `sub_affiliate_earnings`, `sub_affiliations`, `monteur_earnings`, `promo_claims`, `reward_claims`, `leaderboard_archive`, `affiliate_managers`, `affiliate_casinos`, `manager_casinos`. Exception : lire `profiles` uniquement pour afficher le nom d'un affilié à partir de son `affiliate_id`, en ne stockant que l'identifiant et le nom.

## Règles de synchronisation

- Lecture seule, et pas plus de **une requête par seconde** vers l'API (file d'attente côté worker) ; `limit=5000` et pagination par `offset` jusqu'à `total`.
- Incrémental : par fenêtre de dates sur la colonne de mise à jour quand elle existe (`date_col=updated_at`), sinon sur `created_at`, avec un chevauchement de 15 minutes et un dédoublonnage par identifiant. Première synchronisation : tout l'historique, table par table, en tâche de fond avec reprise.
- Chaque table synchronisée a un `SyncState` (curseur, dernière réussite, lignes importées, dernière erreur) visible dans Réglages → Connecteurs.
- Les lignes brutes sont conservées (`raw` JSON) pour pouvoir recalculer plus tard sans resynchroniser.
- En cas d'erreur (401, 403, 429, 5xx, délai) : journaliser, réessayer avec attente croissante, ne jamais bloquer les autres workers.
