# À faire par un humain (rien d'urgent, regroupé)

## Tableau de bord Railway (2 clics chacun)
1. **Worker en Europe** : railway.com → projet linkaffipro → service worker → Settings → Regions → EU West (Amsterdam) → Deploy. Il est encore aux États-Unis (0,15 s par requête vers la base). Le volume de sauvegardes suivra le service.
2. **Sauvegardes de volume Railway** (en plus des sauvegardes automatiques de la plateforme) : projet linkaffipro → Postgres → Settings → Backups → activer Daily, Weekly et Monthly (voir `docs/SAUVEGARDES.md`).

## Quand les comptes existeront
3. **Comptes publicitaires** : dès qu'un compte TikTok Ads ou Meta Ads existe, le dire : les connecteurs API remplaceront l'import CSV. En attendant, tester l'import avec un vrai export (Pubs → Importer des coûts) et signaler toute colonne mal reconnue.
4. **Vues par message** (nombre de vues Telegram) : nécessite une connexion avec le numéro de téléphone (code SMS), 5 minutes à faire ensemble. Sans cela, les meilleurs horaires et les tests A/B se basent sur les clics et les réactions.

## Relecture (quand vous voulez)
5. **Automatisations** : les règles modèles sont créées inactives ; relire les textes puis les activer (page Automatisations).
6. **Modèles de messages** : 63 modèles installés (Messages → Modèles) ; relire ceux de votre univers avant de les utiliser, et ne pas retirer la mention des risques (casino, paris).
7. **Traductions du bot** : les textes en, es, pt, de, it ont été écrits par Claude ; faire relire par un locuteur si une langue devient importante.
8. **Équipe** : créer le compte de l'associé dans Réglages → Équipe (copier le lien d'invitation et le lui envoyer).
