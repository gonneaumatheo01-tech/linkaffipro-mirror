# Sauvegardes et restauration

## Ce que Railway fournit (vérifié sur docs.railway.com/reference/backups le 9 octobre 2026)
- Sauvegardes planifiées des **volumes** (donc de Postgres et Redis), à activer service par service : tableau de bord → projet `linkaffipro` → service **Postgres** → **Settings** → onglet **Backups** → activer *Daily* (conservée 6 jours), *Weekly* (27 jours) et *Monthly* (89 jours). Faire de même pour **Redis** (facultatif : Redis ne contient que la file d'attente, reconstruite au besoin).
- Sauvegardes manuelles à la demande dans le même onglet (plafond : 50 % de la capacité du volume). Pas de restauration à un instant précis (PITR) documentée.
- Coût : facturé comme un volume, sur la taille incrémentale seulement.
- Restauration : onglet **Backups** du service → choisir la date → **Restore**. Railway monte un nouveau volume horodaté pour vérification avant de le mettre en service.

Action humaine (une fois, 1 minute) : activer les sauvegardes quotidiennes, hebdomadaires et mensuelles sur le service Postgres (clics ci-dessus). Claude ne peut pas le faire par l'API.

## Sauvegarde logique par la plateforme
- `pnpm db:dump` : exécute `pg_dump` (version 18, identique au serveur) **dans le conteneur Postgres** via `railway ssh`, compresse et rapatrie le fichier dans `backups/linkaffipro-<date>.sql.gz` (dossier ignoré par git). Aucun mot de passe de base ne transite ni ne reste sur le Mac. Pré-requis : CLI Railway connectée et clé SSH enregistrée (`railway ssh keys add`).
- Fréquence conseillée : avant chaque migration de schéma et une fois par semaine ; garder les 4 derniers fichiers hors du Mac (disque externe ou stockage chiffré).

## Restauration d'une sauvegarde logique
1. Créer une base vide de test (ou vider la base cible) : ne jamais restaurer par-dessus la production sans l'avoir arrêtée (`railway down` n'existe pas : mettre le service `web` et `worker` en pause depuis le tableau de bord, ou retirer temporairement leur domaine).
2. Envoyer le fichier dans le conteneur Postgres et restaurer :
   ```
   base64 -w0 < backups/linkaffipro-<date>.sql.gz > /tmp/dump.b64
   railway ssh --service Postgres -- sh -c "base64 -d > /tmp/dump.sql.gz" < /tmp/dump.b64
   railway ssh --service Postgres -- sh -c 'gunzip -c /tmp/dump.sql.gz | psql -U "$PGUSER" "$PGDATABASE"'
   ```
3. Redémarrer `web` (les migrations Prisma vérifient l'état du schéma) puis `worker`.

## Ce qui n'a pas besoin de sauvegarde
- Redis : files BullMQ (les tâches périodiques se recréent au démarrage du worker ; un envoi groupé en cours reprend grâce aux `OutboundMessage` en base).
- Les médias sont en base (`MediaAsset.bytes`) : couverts par la sauvegarde Postgres.
