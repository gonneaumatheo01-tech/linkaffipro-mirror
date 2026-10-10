# Phase 9 : serveur de développement, données de démo, captures et accessibilité

Procédure vérifiée sur la machine de développement (Node 26, pnpm, base locale Docker `lap-pg`, Redis `lap-redis`). Jamais la production.

## 1. Données de démonstration (base locale seulement)
```bash
cd "/Users/utilisateur/Desktop/Platefome de statistiques"
pnpm db:demo            # refuse toute base qui n'est pas sur localhost ; idempotent, ~7 s
```
Comptes créés : `verification@linkaffipro.internal` (ADMIN) et `manager.demo@linkaffipro.internal` (MANAGER), mot de passe `DEMO_PASSWORD` (défaut `demo-local-1234`, base locale seulement). 3 bots (jetons factices : Telegram les refuse), 6 canaux, 4 campagnes, ~300 membres, messages, joueurs, statistiques recalculées. Relancer `pnpm db:demo` remet « aujourd'hui » et « hier » à jour ; les identifiants des campagnes, canaux, membres et pubs restent stables, ceux des messages, adhésions et envois changent (utiliser les motifs `:id` dans les captures).

## 2. Serveur de développement : un par agent, chacun son dossier de build
Next 16 verrouille `.next/dev/lock` : deux `next dev` dans le même dossier de build sont impossibles. `next.config.ts` lit `NEXT_DIST_DIR` : chaque agent prend le sien (`.next-<port>`, ignoré par git et Docker).
```bash
cd "/Users/utilisateur/Desktop/Platefome de statistiques/apps/web"
P=3105   # ton port
NEXT_DIST_DIR=.next-$P PORT=$P AUTH_URL=http://localhost:$P APP_BASE_URL=http://localhost:$P \
  node --require ./scripts/load-env.cjs node_modules/next/dist/bin/next dev -p $P > /tmp/lap-dev-$P.log 2>&1 &
echo $! > /tmp/lap-dev-$P.pid
# attendre « Ready » : until grep -q "Ready" /tmp/lap-dev-$P.log; do sleep 1; done
# à la fin : kill $(cat /tmp/lap-dev-$P.pid) ; pkill -f "next dev -p $P" ; rm -rf .next-$P
```
`scripts/load-env.cjs` charge `.env.local` sans écraser les variables déjà posées (`--env-file-if-exists` ne marche pas : Next le recopie dans NODE_OPTIONS et Node 26 le refuse ; `next` n'est pas à la racine du dépôt). Mémoire : 8 Go sur la machine, pas plus de deux serveurs à la fois, jamais `next build`.

## 3. Captures (Playwright, webp)
```bash
cd "/Users/utilisateur/Desktop/Platefome de statistiques"
pnpm captures --base http://localhost:$P --pages /,/campaigns,/members/:id --out /tmp/lap-shots-$P
# options : --widths 1440,390  --email … --password …  --prune  --keep-png  --help
```
Connexion par le formulaire avec le compte de vérification (mot de passe de démo par défaut en local). Les captures de contrôle des agents vont dans `/tmp` ; `docs/captures/` ne reçoit que la passe finale de l'étape 8 (avec l'index `docs/REFONTE-CAPTURES.md`). Lire les images avec l'outil de lecture de fichiers pour juger le rendu.

## 4. Accessibilité (axe)
```bash
pnpm a11y --base http://localhost:$P --pages /,/campaigns --report /tmp/lap-a11y-$P.json            # échoue sur « critical »
pnpm a11y --base http://localhost:$P --pages / --width 390 --fail-on serious --report /tmp/…json
```

## 5. Contrôles de code
`pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter web test` ; intégration sous verrou :
`until mkdir /tmp/lap-int-lock 2>/dev/null; do sleep 10; done; pnpm test:integration --only=web; rmdir /tmp/lap-int-lock`.
