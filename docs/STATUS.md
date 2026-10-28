# État — Proxy bookmaker IPRoyal (28 octobre 2026)

## Fait
- Script `scripts/set-proxy.ts` créé : enregistre le proxy chiffré en base et passe les sites en lecture serveur.
- Script `scripts/reactivate-bookmakers.ts` créé : réactive les sites après maintenance.
- `docs/A-FAIRE-HUMAIN.md` mis à jour : section « Adresse de secours (proxy norvégien IPRoyal) » avec les étapes Kevin.
- Commit local créé (pas encore poussé sur GitHub : le réseau du conteneur Claude bloque git push).

## À faire par l'utilisateur (5 minutes)

### 1. Activer le proxy via Kevin (2 minutes)
- Ouvrez Kevin sur Telegram.
- Écrivez : **voici l'adresse de secours des captures**
- Kevin demande l'adresse en privé → collez l'adresse complète du proxy IPRoyal (format `http://identifiant:motdepasse@geo.iproyal.com:12321`).
- Kevin confirme « Adresse de secours enregistrée ».
- Écrivez : **teste les bookmakers** → il vérifie que chaque site répond.

### 2. Pousser le commit (30 secondes)
Dans le Terminal du Mac :
```
cd ~/Desktop/"Platefome de statistiques" && git push origin main
```

## Test de 5 minutes
1. Après l'étape 1, Kevin dit si les bookmakers répondent via le proxy.
2. https://app.linkaffipro.com/agents/bookmakers → les 3 sites passent en « Prêt ».

## Problèmes
- Impossible d'envoyer le message Telegram automatiquement : ni Railway CLI ni pnpm ne sont disponibles dans l'environnement device_bash. L'utilisateur doit lire ces instructions ici ou dans la conversation Claude.
