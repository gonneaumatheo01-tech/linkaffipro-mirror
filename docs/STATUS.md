# Statut — Lecture des bookmakers par le serveur

## Fait
- ✅ Proxy résidentiel norvégien IPRoyal enregistré en base (chiffré)
- ✅ Migration SQL prête : Celsius → serveur, Sportaza et Bet Portal réactivés
- ✅ Nouvelles opérations Kevin : changer la cible de lecture, activer/désactiver un site
- ✅ Code poussé sur GitHub (main)

## Reste à faire
- ⏳ **Déployer sur Railway** (`railway up --service web --detach` puis `railway up --service worker --detach`)
- ⏳ Vérifier que les 3 sites lisent correctement depuis le serveur (page Agents → Bookmakers)

## Test de 5 minutes (après le déploiement)
1. Ouvre https://app.linkaffipro.com/agents/bookmakers
2. Les 3 sites doivent être actifs (pastille verte ou en attente de lecture)
3. Après quelques minutes, au moins une lecture doit réussir

## Problèmes
- Railway CLI et API inaccessibles depuis l'environnement Claude → déploiement manuel nécessaire
- L'API Telegram est aussi inaccessible → notification par ce fichier et GitHub uniquement
