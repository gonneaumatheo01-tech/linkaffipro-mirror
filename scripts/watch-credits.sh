#!/usr/bin/env bash
# Surveille la boucle Claude Code et prévient sur Telegram quand le crédit est épuisé, puis quand le travail reprend.
# Usage : scripts/watch-credits.sh   (à laisser tourner dans sa propre fenêtre du Terminal ; Ctrl+C pour arrêter)
# N'utilise aucun crédit Claude : l'envoi passe par `pnpm tg:send` (bot casino, via Railway).

cd "$(dirname "$0")/.." || exit 1
LOG="logs/run-phase.log"
RAILWAY_API_TOKEN="$(grep '^RAILWAY_API_TOKEN=' .env.local 2>/dev/null | head -n 1 | cut -d= -f2-)"
export RAILWAY_API_TOKEN

envoyer() {
  if pnpm -s tg:send "$1" >/dev/null 2>&1; then
    echo "$(date '+%H:%M') Telegram envoyé : $1"
  else
    echo "$(date '+%H:%M') ÉCHEC de l'envoi Telegram (vérifiez Railway) : $1"
  fi
}

etat_courant() {
  # Renvoie « panne » si la dernière relance a été refusée faute de crédit, sinon « travail ».
  local derniere_erreur derniere_relance
  derniere_erreur=$(grep -n "out of usage credits" "$LOG" 2>/dev/null | tail -n 1 | cut -d: -f1)
  derniere_relance=$(grep -n ": relance de Claude Code" "$LOG" 2>/dev/null | tail -n 1 | cut -d: -f1)
  derniere_erreur=${derniere_erreur:-0}
  derniere_relance=${derniere_relance:-0}
  if [ "$derniere_erreur" -gt "$derniere_relance" ]; then echo "panne"; else echo "travail"; fi
}

envoyer "🔔 Surveillance du crédit Claude activée. Je vous préviens ici si Claude Code s'arrête faute de crédit, et quand il repart."

EN_PANNE=0
CONFIRMATIONS=0
DEBUT_PANNE=""
DERNIER_RAPPEL=0

while true; do
  ETAT=$(etat_courant)
  MAINTENANT=$(date +%s)
  if [ "$ETAT" = "panne" ]; then
    CONFIRMATIONS=0
    if [ "$EN_PANNE" -eq 0 ]; then
      EN_PANNE=1
      DEBUT_PANNE=$(date '+%H:%M')
      DERNIER_RAPPEL=$MAINTENANT
      envoyer "⚠️ Plus de crédit Claude depuis $DEBUT_PANNE : Claude Code est en pause. Rien n'est perdu, il repartira tout seul à la remise à zéro. Pour repartir tout de suite : ajoutez du crédit sur claude.ai/settings/usage"
    elif [ $((MAINTENANT - DERNIER_RAPPEL)) -ge 21600 ]; then
      DERNIER_RAPPEL=$MAINTENANT
      envoyer "⏳ Toujours en pause faute de crédit Claude (depuis $DEBUT_PANNE). Crédit : claude.ai/settings/usage"
    fi
  else
    if [ "$EN_PANNE" -eq 1 ]; then
      CONFIRMATIONS=$((CONFIRMATIONS + 1))
      # Deux contrôles d'affilée sans refus (environ 2 minutes) : le travail a vraiment repris.
      if [ "$CONFIRMATIONS" -ge 2 ]; then
        EN_PANNE=0
        CONFIRMATIONS=0
        envoyer "✅ Le crédit est revenu : Claude Code a repris le travail (pause depuis $DEBUT_PANNE)."
      fi
    fi
  fi
  sleep 60
done
