# Link Affi — schéma observé (phase 0, vérifié le 9 octobre 2026)

Accès : `docs/LINKAFFI-API.md`. Inspection faite avec `pnpm linkaffi:check` (volumes) et `pnpm linkaffi:inspect` (colonnes et types apparents sur 5 lignes par table, valeurs personnelles masquées). Les volumes sont ceux du 9 octobre 2026.

## Résumé pour le produit

1. **Aucun sub-ID n'existe aujourd'hui dans Link Affi.** Ni `clicks`, ni `players`, ni `postback_logs` n'ont de colonne de sub-ID libre. La seule colonne approchante, `sub_profile_id`, est un identifiant de « sous-profil » interne à Link Affi, vide sur 100 % des 2 000 derniers clics. Le lien `linkaffi.me/go/<clé>` transmet bien tous les paramètres d'URL à la fonction `track-click`, mais celle-ci n'en conserve aucun.
2. **L'attribution d'un joueur se fait au niveau de la campagne** (`campaign_key`, 8 caractères, ex. `47eb8mwc`) : clic → `clicks.campaign_id` ; postback du casino → `postback_logs.campaign_key` → `players.campaign_id`. Un `click_id` apparaît dans certains postbacks bruts, mais il est fabriqué par le casino (`<id joueur>_<code du lien casino>`), pas par nous.
3. **Conséquence** : sans modification de Link Affi, la plateforme peut attribuer au niveau **campagne = canal / message / pub** (une campagne Link Affi par usage, créée dans Link Affi), mais pas au niveau **membre**. Pour l'attribution par membre, il faut demander au développeur de Link Affi : (a) que `track-click` accepte un paramètre `sub_id` (texte, ≥ 32 caractères) et le stocke dans `clicks.sub_id` ; (b) qu'il le transmette au casino dans le lien d'affiliation (si le casino accepte un paramètre libre, ex. `click_id`) ; (c) que le postback le renvoie et qu'il soit copié dans `players.sub_id` ; (d) que `clicks` et `players` l'exposent dans l'API. Détail dans STATUS.md.
4. **Dates** : `from` / `to` filtrent par défaut sur `created_at` (vérifié : sur `stats`, sans `date_col` = avec `date_col=created_at` ; `date_col=date` donne un autre total). Pour la synchro incrémentale : `date_col=updated_at` quand la colonne existe (`players`, `player_financials`, `casinos`, snapshots), sinon `created_at`.

## Tables utiles, colonnes et correspondance

### `campaigns` — 109 lignes — synchro complète (petite table)
`id` uuid, `affiliate_id` uuid, `name` texte, `campaign_key` texte (8 car., clé du lien `/go/<clé>`), `casino_id` uuid, `domain` texte (`linkaffi.me`), `sub_profile_id` null, `created_at`.
→ `AffiliateCampaign` (`externalId` = id, `key` = campaign_key, `programId` ← casino_id, `affiliateExternalId`). La campagne `47eb8mwc` pointe sur le casino « Celsius Paris sportifs » (hybride : CPA 110 + 40 % revshare, FR, FTD minimum 20) : 211 clics et 22 joueurs à ce jour.

### `casinos` — 11 lignes — synchro complète
`id`, `name`, `logo_url`, `affiliate_url` (lien du casino, ex. `https://celsius.games/<code>`), `commission_type` (`hybrid`…), `cpa_amount`, `revshare_percent`, `is_active`, `min_ftd_amount`, `geos` (tableau, ex. `["FR"]`), `ignore_revenue_postbacks`, `payout_frequency`, `payout_day_of_month`, `payout_day_of_week`, `created_at`, `updated_at`.
→ `AffiliateProgram` (`vertical` choisi dans l'interface : le nom contient parfois l'univers, ex. « Paris sportifs »).

### `clicks` — 18 810 lignes — incrémental sur `created_at`
`id` uuid, `affiliate_id`, `casino_id`, `campaign_id`, `ip_address` (texte, à ne pas stocker en clair : hacher), `country` (souvent null), `device` (`mobile`…), `browser` (`Safari`…), `source` (null), `sub_profile_id` (null), `created_at`.
→ `Click` côté Link Affi (rapprochement avec nos propres clics goolink par campagne + horodatage ± quelques secondes + empreinte navigateur, en attendant un vrai sub-ID).

### `players` — 1 757 lignes — incrémental sur `updated_at`
`id` uuid, `casino_id`, `external_player_id` (identifiant chez le casino, texte numérique), `affiliate_id`, `campaign_id`, `username` (null), `acquisition_source` (`link` 329, `promo_code` 4, null 1 424), `status` (`registered` 1 203, `ftd_pending` 128, `ftd_qualified` 250, `ftd_disqualified` 176), `cpa_status` (`none`, `approved`, `not_eligible`, `reversed`), `cpa_affiliate_amount`, `ftd_amount`, `ftd_at`, `prequalified_at`, `qualified_at`, `disqualified_at`, `disqualification_reason`, `cpa_credited_at`, `cpa_reversed_at`, `all_deposits_count`, `total_deposited_amount`, `last_deposit_at`, `redeposits_count`, `redeposits_amount`, `last_cumulative_deposit`, `is_legacy`, `needs_review`, `review_reason`, `last_activity_at`, `created_at`, `updated_at`.
→ `Player` (`externalId` = external_player_id, `registeredAt` = created_at, `ftdAt`, `ftdAmount`, `depositTotal` = total_deposited_amount, `redeposits*`, `status`, `campaignId`).

### `player_events` — 5 328 lignes — incrémental sur `created_at`
`id`, `player_id` (uuid → players.id), `casino_id`, `event` (`registration` 1 614, `prequalification` 1 160, `qualification` 1 162, `ftd` 482, `any_dep` 426, `disqualification` 156), `idempotency_key` (ex. `registration:<external_player_id>`), `amount`, `currency` (`EUR`), `result` (`applied`), `details` json (`status_before/after`, `cpa_status_before/after`, `is_redeposit`, `redeposit_delta`, `cumulative_before`, `credited`, `reversed`…), `created_at`.
→ `PlayerEvent` (`type` = event, `amount`, `currency`, `occurredAt` = created_at, `raw` = ligne complète).

### `player_financials` — 1 757 lignes — incrémental sur `updated_at`
`player_id`, `cpa_affiliate`, `cpa_manager`, `cpa_gross`, `cpa_eligible`, `cpa_amount_unknown`, `cpa_credited_columns` json, `cpa_credit_count`, `cpa_reversal_count`, `cpa_manager_split` json, `created_at`, `updated_at`.
→ `Player.cpaAmount` (côté affilié). Pas de NGR ici : le NGR par joueur est dans `revshare_snapshots`.

### `revshare_snapshots` — 595 lignes — incrémental sur `updated_at`
`id`, `player_id` (**identifiant externe** du casino, texte numérique, pas l'uuid), `casino_id`, `last_ngr` (nombre), `last_seen_at`, `created_at`, `updated_at`.
→ `Player.ngr` (jointure sur `external_player_id` + `casino_id`).

### `deposit_snapshots` — 6 lignes — incrémental sur `updated_at`
`id`, `player_id` (externe), `casino_id`, `last_total` (dépôts cumulés), `last_seen_at`, `created_at`, `updated_at`.

### `ftd_invalidations` — 22 lignes — incrémental sur `created_at`
`id`, `player_id` (externe), `casino_id`, `reason` (texte libre), `created_by`, `created_at`. → remise à zéro de `Player.ftdAt`.

### `postback_logs` — 11 896 lignes — incrémental sur `created_at`
`id`, `campaign_key`, `event` (`revenue` 3 329, `signup` 638, `cpa` 417, `lifecycle_redeposit` 322, `deposit` 294), `amount`, `net_amount`, `player_id` (externe, texte), `affiliate_id`, `casino_id`, `is_duplicate`, `sub_profile_id`, `created_at`. → diagnostic et contrôle des événements.

### `untracked_postbacks` — 2 340 lignes — incrémental sur `created_at`
`id`, `player_id`, `event`, `amount`, `status` (`untracked`), `matched_affiliate_id`, `matched_claim_id`, `raw_params` json (clés vues : `amount, campaign_key, click_id, commission, country, currency, deposit, event, ngr, player_id, player_username, ref_code, registration, source, wager`), `created_at`, `matched_at`. → diagnostic des postbacks sans campagne ; contient des pseudos (ne pas stocker `player_username`).

### `stats` — 1 789 lignes — agrégat journalier, incrémental sur `date`
`affiliate_id`, `casino_id`, `campaign_id`, `date`, `clicks`, `signups`, `deposits`, `deposit_amount`, `revenue`, `gross_revenue`, `manager_revenue`, `cpa_revenue`, `cpa_gross_revenue`, `revshare_revenue`, `revshare_gross_revenue`, `cpa_manager_revenue`, `revshare_manager_revenue`, `active_players`, `redeposits`, `redeposit_amount`, `prequalified_ftds`, `qualified_ftds`, `disqualified_ftds`, `all_deposits_count`, `all_deposits_amount`, `redeposits_count`, `redeposits_amount`, `sub_profile_id`, `created_at`. → contrôle de cohérence par campagne et par jour.

### `landing_events_daily` — 3 109 lignes — par `day`
`day`, `slug` (pages d'atterrissage Link Affi, ex. `lk746`), `event_type` (`view`…), `event_count`, `unique_sessions`, `unique_ips`, `created_at`. Peu utile pour nous (pages d'atterrissage Link Affi).

### `currency_rates` — 6 lignes
`currency`, `rate` (base EUR = 1), `last_updated`.

## Scripts
- `pnpm linkaffi:check` : liste des tables et volumes.
- `pnpm linkaffi:inspect [table]` : colonnes, types apparents, exemples masqués.
