# Link Affi — sub-ID : contrat d'intégration (9 octobre 2026)

Statut : implémenté côté Link Affi (Lovable), 7 tests unitaires verts, **pas encore validé avec un vrai postback casino**. Aucune modification côté casino n'est nécessaire ni demandée.

## Comment ça marche côté Link Affi
- `track-click` (lien `https://linkaffi.me/go/<campaign_key>`) accepte un paramètre d'URL optionnel `sub_id` : 1 à 32 caractères, uniquement `A-Z a-z 0-9 _ -`. Valide → stocké dans `clicks.sub_id`.
- Vers le casino, `track-click` envoie la valeur combinée `<campaign_key>.<sub_id>` dans les paramètres `afp`, `sub`, `sub2`, `token` (et les macros `{campaign_key}` / `{token}` si l'URL casino en contient) ; `pubid` garde le `campaign_key` seul. Sans `sub_id`, l'URL envoyée est identique à avant.
- Au retour (fonction postback), seule la partie avant le premier « . » sert à l'attribution de campagne ; la partie après est le `sub_id`, écrit dans `postback_logs.sub_id`, `players.sub_id` (avec `players.sub_id_source = 'postback'`) et `untracked_postbacks.sub_id` quand la campagne est inconnue.
- Rattachement de secours (déclencheur en base) : joueur créé sans `sub_id` → dernier `sub_id` distinct porté par un clic de la même campagne dans les 60 minutes précédentes, s'il est unique → `players.sub_id` avec `sub_id_source = 'time_match'`. Un vrai `sub_id` reçu ensuite par postback remplace le `time_match`.
- `stats-api` expose `sub_id` dans `clicks`, `players`, `postback_logs`, filtre `eq.sub_id=` disponible.
- Non couvert : les liens courts et les landing pages de Link Affi ne passent pas par `track-click` et ne portent donc pas de `sub_id`. **Ne jamais les utiliser pour les boutons d'offre.**

## Ce que notre plateforme doit faire
1. **Lien d'offre généré par le bot** : `https://<campaigns.domain ou linkaffi.me>/go/<campaign_key>?sub_id=<SUB_ID>`. `SUB_ID` = notre `Click.subId`, 12 caractères base62 (`A-Z a-z 0-9`), unique par clic, jamais de point ni d'autre caractère. Conserver `AffiliateCampaign.trackingUrlTemplate` = `https://linkaffi.me/go/<key>?sub_id={subid}`.
2. **Synchro** : rattacher `Player` ↔ `Click` par `sub_id` ; stocker `Player.subIdSource` (`postback` | `time_match` | null) ; si la valeur change (`time_match` → `postback`), prendre la plus récente. `player_events` et `player_financials` n'ont pas de `sub_id` : passer par `players.id` → `players.sub_id`.
3. **Contrôle de santé** (Réglages → Connecteurs) : sur 7 jours glissants, compter les joueurs avec `sub_id_source = postback`, `time_match`, et sans `sub_id` alors que des clics avec `sub_id` existent sur la même campagne. Alerte visible si `postback = 0` et `time_match > 0` sur plus de 5 joueurs : le casino tronque ou altère probablement la valeur combinée (le « . » n'a jamais été testé chez Celsius) ; dans ce cas, demander à Lovable un encodage sans point.
4. **Vérification immédiate possible** (une seule fois, sur une campagne de test, à annoter) : un clic sur un lien avec `sub_id` doit apparaître dans `clicks` via `eq.sub_id=<valeur>`. Un clic de test ajoute un clic aux stats de l'affilié : à faire une seule fois.

## Ce que les premiers vrais joueurs confirmeront
`players.sub_id_source = 'postback'` sur les premiers inscrits venus de nos liens = la chaîne complète fonctionne (pub → membre → clic → inscription → dépôt). Seulement `time_match` = fonctionne par secours, précision bonne à faible trafic, à corriger ensuite.
