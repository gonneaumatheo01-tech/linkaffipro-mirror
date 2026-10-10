#!/usr/bin/env bash
# Boucle « ne jamais s'arrêter » pour Claude Code.
# Usage : scripts/run-phase.sh docs/prompts/01-phase-1-kit-lancement.md
# Relance Claude Code automatiquement à chaque fois qu'il s'arrête, jusqu'à ce
# qu'il crée le fichier docs/PHASE-DONE (uniquement quand la phase est finie,
# testée et déployée). Arrêt manuel : Ctrl+C dans cette fenêtre.

set -u
PROMPT_FILE="${1:?Usage : scripts/run-phase.sh docs/prompts/<fichier>.md}"
cd "$(dirname "$0")/.." || exit 1
DONE_FILE="docs/PHASE-DONE"
mkdir -p logs
rm -f "$DONE_FILE"

REGLES="Règles absolues : ne demande jamais « continue » ni aucune confirmation ; ne termine jamais ton tour pour attendre quelqu'un. Si tu attends une réponse Telegram, boucle avec « sleep 60 » puis « pnpm tg:inbox » (20 minutes maximum), puis prends la décision raisonnable et continue. Avant d'agir, vérifie l'état réel (git log, docs/STATUS.md, tests) pour ne pas refaire ce qui est fait. Quand TOUT est terminé, testé et déployé, et seulement à ce moment-là, crée le fichier $DONE_FILE contenant la date, et annonce-le par Telegram."

PREMIER="Lis CLAUDE.md puis $PROMPT_FILE et exécute la phase en entier. $REGLES"
SUITE="Continue la phase en cours ($PROMPT_FILE) sans rien demander : relis docs/STATUS.md et ta liste de tâches, vérifie pnpm tg:inbox, puis avance. $REGLES"

TOUR=0
while true; do
  if [ -f "$DONE_FILE" ]; then
    echo "$(date '+%H:%M') Phase terminée : $(cat "$DONE_FILE")" | tee -a logs/run-phase.log
    break
  fi
  TOUR=$((TOUR + 1))
  echo "$(date '+%H:%M') Tour $TOUR : relance de Claude Code" | tee -a logs/run-phase.log
  if [ "$TOUR" -eq 1 ]; then
    # Reprend la conversation la plus récente de ce dossier si elle existe, sinon en démarre une.
    claude -c -p "$PREMIER" --dangerously-skip-permissions 2>&1 | tee -a logs/run-phase.log \
      || claude -p "$PREMIER" --dangerously-skip-permissions 2>&1 | tee -a logs/run-phase.log
  else
    claude -c -p "$SUITE" --dangerously-skip-permissions 2>&1 | tee -a logs/run-phase.log
  fi
  echo "$(date '+%H:%M') Tour $TOUR terminé ; nouvelle relance dans 30 secondes." | tee -a logs/run-phase.log
  sleep 30
done

# --- File d'attente des phases (ajouté le 10 octobre) ---
# Quand une phase est terminée, lance automatiquement le prompt suivant listé dans docs/prompts/QUEUE.
QUEUE_FILE="docs/prompts/QUEUE"
if [ -s "$QUEUE_FILE" ]; then
  NEXT_PROMPT="$(head -n 1 "$QUEUE_FILE")"
  tail -n +2 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  if [ -n "$NEXT_PROMPT" ] && [ -f "$NEXT_PROMPT" ]; then
    echo "$(date '+%H:%M') File d'attente : phase suivante → $NEXT_PROMPT" | tee -a logs/run-phase.log
    exec "$0" "$NEXT_PROMPT"
  fi
fi
