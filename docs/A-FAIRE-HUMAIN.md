# Actions humaines requises

## 🚀 Déployer sur Railway (URGENT)

Le code est poussé sur GitHub. Il faut déployer pour que la lecture des bookmakers passe sur le serveur avec le proxy norvégien.

Ouvre un Terminal sur le Mac et lance :

```bash
cd ~/linkaffipro-platform
railway up --service web --detach
railway up --service worker --detach
```

La migration va automatiquement :
- Passer **Celsius** en lecture serveur (plus besoin du Mac allumé)
- Réactiver **Sportaza** (était en pause après un captcha)
- Réactiver **Bet Portal** (était en pause)

Après le déploiement, les 3 bookmakers liront 24h/24 depuis Railway avec le proxy IPRoyal norvégien.

## Vérifier après le déploiement

1. Ouvre https://app.linkaffipro.com/agents/bookmakers
2. Vérifie que les 3 sites sont actifs et que la prochaine lecture se lance
3. Après 5 minutes, vérifie qu'au moins une lecture a réussi (pastille verte)

## Proxy

L'adresse du proxy IPRoyal a déjà été enregistrée dans la base (fait via Réglages → Bookmakers). Rien d'autre à faire.
