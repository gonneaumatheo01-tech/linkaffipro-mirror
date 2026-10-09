# Sauvegardes et restauration

## 1. Sauvegarde automatique quotidienne (depuis la phase 4)
- Chaque jour à partir de **4 h (Europe/Paris)**, le worker exécute `pg_dump` (client PostgreSQL 18, même version majeure que le serveur Railway) et écrit un fichier compressé `linkaffipro-<date>.sql.gz` dans le **volume Railway** `worker-volume` monté sur `/data` du service `worker` (dossier `/data/backups`, variable `BACKUP_DIR` pour changer).
- Rotation : les **14** fichiers les plus récents sont conservés.
- État écrit dans `Setting` `backup.last` (date, fichier, taille, succès ou erreur) : visible dans **Réglages → État du système** et dans le brief Telegram quotidien. Une sauvegarde en échec deux jours de suite déclenche l'alerte Telegram « sauvegarde en échec ».
- Vérification toutes les 10 minutes par la file `maintenance` (tâche `backup`) ; une seule sauvegarde par jour (clé de jour Paris).
- Forcer une sauvegarde maintenant : `pnpm db:backup:now` (exécute `node apps/worker/dist/backup-now.js` dans le conteneur worker via `railway ssh`) ; `pnpm db:backup:now -- --list` liste les fichiers du volume.
- Code : `apps/worker/src/backups/plan.ts` (règles pures, testées) et `run.ts` (pg_dump, rotation, état).

Limite : le volume vit chez Railway, dans la même région que le worker. Il protège contre une erreur humaine ou une corruption de données, pas contre la perte du compte Railway. Pour une copie hors Railway : `pnpm db:dump` depuis le Mac (section 3) ou activer les sauvegardes de volume Railway (section 2).

## 2. Ce que Railway fournit en plus (action humaine, une fois)
- Sauvegardes planifiées des **volumes** : tableau de bord → projet `linkaffipro` → service **Postgres** → **Settings** → onglet **Backups** → activer *Daily* (6 jours), *Weekly* (27 jours), *Monthly* (89 jours). Restauration dans le même onglet (**Restore** : Railway monte un nouveau volume horodaté pour vérification).
- Claude ne peut pas activer ces sauvegardes par l'API : c'est dans `docs/A-FAIRE-HUMAIN.md`.

## 3. Sauvegarde manuelle depuis le Mac
- `pnpm db:dump` : `pg_dump` exécuté **dans le conteneur Postgres** via `railway ssh`, compressé, rapatrié dans `backups/linkaffipro-<date>.sql.gz` (dossier ignoré par git). Aucun mot de passe ne transite ni ne reste sur le Mac. Pré-requis : CLI Railway connectée et clé SSH enregistrée.
- Récupérer une sauvegarde automatique du volume : `railway ssh --service worker -- sh -c "base64 -w0 /data/backups/<fichier>" > /tmp/b.b64 && base64 -d /tmp/b.b64 > backups/<fichier>`.

## 4. Restauration
### Vérifier qu'une sauvegarde est exploitable (en local, sans risque)
`pnpm db:restore backups/linkaffipro-<date>.sql.gz` : crée la base locale `linkaffipro_restore` dans le conteneur Docker `lap-pg`, y charge le fichier, affiche le nombre de tables et d'utilisateurs. Testé le 9 octobre 2026 avec une sauvegarde de production (42 tables, 2 utilisateurs).

### Restaurer la production (uniquement après une perte avérée)
1. Mettre `web` et `worker` en pause (tableau de bord Railway → service → Settings → *Remove deployment* ou retirer temporairement les domaines) pour qu'aucune écriture n'arrive pendant la restauration.
2. Envoyer le fichier dans le conteneur Postgres et le charger dans une base vide :
   ```
   base64 -w0 < backups/linkaffipro-<date>.sql.gz > /tmp/dump.b64
   railway ssh --service Postgres -- sh -c "base64 -d > /tmp/dump.sql.gz" < /tmp/dump.b64
   railway ssh --service Postgres -- sh -c 'psql -U "$PGUSER" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" "$PGDATABASE" && gunzip -c /tmp/dump.sql.gz | psql -U "$PGUSER" -v ON_ERROR_STOP=1 "$PGDATABASE"'
   ```
3. Redéployer `web` (les migrations Prisma vérifient l'état du schéma) puis `worker`. Vérifier https://app.linkaffipro.com/api/health.

## 5. Ce qui n'a pas besoin de sauvegarde
- Redis : files BullMQ (les tâches périodiques se recréent au démarrage du worker ; un envoi groupé en cours reprend grâce aux `OutboundMessage` en base).
- Les médias sont en base (`MediaAsset.bytes`) : couverts par la sauvegarde Postgres.
