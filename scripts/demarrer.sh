#!/usr/bin/env bash
# Démarre tout d'un coup, dans une seule fenêtre du Terminal :
#   - empêche le Mac de s'endormir tant que ça tourne ;
#   - lance le surveillant du crédit (messages Telegram si le crédit s'épuise / revient) ;
#   - lance la boucle Claude Code (Opus 5.5, ultracode) sur la phase en cours.
# Usage : scripts/demarrer.sh [docs/prompts/<phase>.md]   (sans argument : la refonte, phase 9)
# Arrêt : Ctrl+C.

cd "$(dirname "$0")/.." || exit 1
PROMPT="${1:-docs/prompts/11-phase-9-refonte-ux.md}"
mkdir -p logs

caffeinate -dims -w $$ &

scripts/watch-credits.sh >> logs/watch-credits.log 2>&1 &
WATCH_PID=$!
trap 'kill $WATCH_PID 2>/dev/null' EXIT

echo "$(date '+%H:%M') Démarrage : Mac maintenu éveillé, surveillant du crédit actif, phase → $PROMPT"
scripts/run-phase-ultra.sh "$PROMPT"
