# Synchronisation Link Affi → LinkAffi Pro

Lecture seule (GET), via le client `packages/linkaffi` (1 requête/s, `limit=5000`, pagination `offset`, reprises sur 429/5xx). Worker `sync-linkaffi` (`apps/worker/src/sync/linkaffi-sync.ts`), tick toutes les 2 minutes (`repeatableSyncLinkaffi`). Le mapping pur est dans `packages/linkaffi/src/sync/` (testé sans base). Jamais les tables « à ne pas lire » de `docs/LINKAFFI-API.md`.

## Ordre et correspondance

| # | Table Link Affi | Colonne incrémentale | Vers | Clé d'idempotence | Détail |
| --- | --- | --- | --- | --- | --- |
| 1 | `casinos` | — (relue entièrement) | `AffiliateProgram` | `(source LINKAFFI, externalId = id)` | `name`, `isActive`, `raw`. `vertical` reste à choisir dans l'interface. |
| 2 | `campaigns` | — (relue entièrement) | `AffiliateCampaign` | `(programId, externalId = id)` | `campaignKey`, `name`, `trackingUrlTemplate = https://<domain ou linkaffi.me>/go/<campaign_key>?sub_id={subid}` (contrat docs/LINKAFFI-SUBID.md). |
| 3 | `currency_rates` | — | table de taux en mémoire (unités par EUR) | — | Tous les montants sont stockés en EUR (`toEur`). |
| 4 | `players` | `updated_at` | `Player` | `(affiliateCampaignId, externalPlayerId = external_player_id)` | `subId` / `subIdSource` (précédence : `postback` > `time_match` > plus récent ; null n'écrase jamais), `registeredAt = created_at`, `ftdAt`, `ftdAmount`, `depositCount = all_deposits_count`, `redepositCount`, `depositTotal = total_deposited_amount` (ne recule jamais), `status`, `lastEventAt = last_activity_at`, `raw` (contient `id` Link Affi, utilisé pour retrouver le joueur des événements). Campagne ou casino inconnus → campagne/programme « (inconnu) » créés inactifs. |
| 5 | `player_events` | `created_at` | `PlayerEvent` | `(playerId, externalId = idempotency_key ou id)` | `registration` → REGISTRATION ; `ftd` → FTD ; `any_dep` → DEPOSIT, ou REDEPOSIT si `details.is_redeposit` ; `prequalification` / `qualification` / `disqualification` → OTHER ; `revenue` / `ngr` → OTHER aussi (phase 8 : le NGR daté a une seule source, les instantanés `revshare_snapshots`). Montant d'un dépôt = `details.redeposit_delta` (sinon `amount − cumulative_before`), pas le cumul. |
| 6 | `player_financials` | `updated_at` | `Player.raw.financials` | — | CPA affilié conservé en brut (pas de colonne dédiée en phase 1). |
| 7 | `revshare_snapshots` | `updated_at` | `Player.ngr` + `PlayerEvent` NGR | jointure `(casino_id, player_id = identifiant externe)` | Si la valeur change : `PlayerEvent` NGR (montant = variation, date = `last_seen_at` de l'instantané) et nouveau cumul écrits dans une même transaction (une erreur met la table en erreur, la variation est reprise au passage suivant), puis Event `player.ngr_updated`. Les statistiques somment ces variations dans la période. |
| 8 | `deposit_snapshots` | `updated_at` | `Player.depositTotal` | idem | Seulement si plus grand ; Event `player.deposit` avec le delta. |
| 9 | `ftd_invalidations` | `created_at` | `Player.ftdAt = null` + `PlayerEvent` OTHER | `externalId = ftd_invalidation:<id>` | Event `player.ftd_invalidated`. |
| 10 | `clicks` | `created_at` | diagnostic | — | Seules les lignes avec `sub_id` sont lues ; comptage « rapprochés / non rapprochés » dans les logs du worker. |

Événements émis (table `Event`, avec `memberId` quand le joueur est rattaché) : `player.registered` (nouveau joueur), `player.ftd` (premier FTD), `player.deposit` (hausse du nombre de dépôts, montant = delta), `player.ngr_updated`, `player.ftd_invalidated`. Un passage sans changement n'émet rien (idempotent).

## Rattachement par sub-ID
`Player.subId` → `Click.subId` (nos clics d'offre, 12 caractères base62) → `Player.clickId`, `Player.memberId` ; le `postId` du clic alimente `PostStats` (`registrations`, `ftds`, `deposits`, `depositAmount`), recalculées depuis les joueurs rattachés à la fin de chaque passage (`recomputePostStats`, idempotent). Un sub-ID `postback` remplace un `time_match` ; l'inverse est refusé (`chooseSubId`, testé). Les événements et commissions n'ont pas de sub-ID : ils passent par `players.id` → notre joueur.

## Curseurs (`SyncState`, une ligne par table)
- `cursor = { since, until?, offset? }` : `since` = borne haute du dernier passage réussi ; fenêtre suivante = `[since − 15 min, maintenant]` (l'API filtre à la journée via `from`/`to`, le chevauchement couvre les retards). Première synchro : pas de `since` → tout l'historique.
- Page interrompue : `until` (borne figée) et `offset` sont sauvegardés après chaque page de 5 000 lignes, la reprise repart de là.
- `isRunning` = verrou ; un verrou de plus de 30 minutes est considéré périmé.
- `lastRunAt`, `lastSuccessAt`, `lastError`, `rowsImported` (cumul) sont affichés dans Réglages → Connecteurs ; boutons « Synchroniser maintenant » (`{type:"tick"}`) et « Resynchroniser tout » (`{type:"tick", full:true}` : curseurs ignorés, upserts idempotents).
- Une table en erreur ne bloque pas les suivantes ; l'erreur est stockée et le passage suivant reprend.

## Santé du sub-ID (Réglages → Connecteurs)
Calculée depuis nos tables, sur 7 jours glissants (`packages/linkaffi/src/sync/health.ts`, `apps/web/app/(admin)/settings/connectors/health.ts`) :
- `postback` : joueurs créés sur la période avec `subIdSource = postback` ;
- `timeMatch` : idem avec `time_match` ;
- `missingWithClicks` : joueurs sans sub-ID dans les campagnes où nous avons envoyé des clics d'offre avec sub-ID ;
- `offerClicks` : clics d'offre avec sub-ID envoyés.
Alerte rouge si `postback = 0` et `timeMatch > 5` : « Le casino tronque ou altère probablement la valeur combinée : demander à Lovable un encodage sans point ». Avertissement si aucun postback encore, ou si les joueurs sans sub-ID dominent. « En attente » tant qu'aucun clic d'offre n'a été envoyé.

## Limites connues
- Les montants de `players` sont supposés en EUR (Link Affi n'expose pas de devise par joueur) ; seuls `player_events` ont une devise, convertie avec `currency_rates`.
- Les `player_events` d'un joueur pas encore importé sont ignorés jusqu'au passage suivant (chevauchement de 15 minutes) ; une resynchro complète les récupère.
- Le filtre de l'API est à la journée : la précision fine vient de l'idempotence des upserts.
