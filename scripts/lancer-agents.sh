#!/usr/bin/env bash
# Lance la chaîne autonome des phases « agents IA » (phases 19 à 25, plan : docs/AGENTS-ARCHITECTURE.md).
#
# Usage, depuis la racine du projet :   bash scripts/lancer-agents.sh
# (ou, sans attendre la fin d'une autre session : FORCE=1 bash scripts/lancer-agents.sh)
#
# Ce que fait ce script :
#   1. empêche le Mac de s'endormir tant qu'il tourne (caffeinate) ;
#   2. attend que toute autre session Claude Code (par exemple la phase 18) soit terminée,
#      pour ne jamais avoir deux sessions qui modifient le dépôt en même temps ;
#   3. écrit la file d'attente docs/prompts/QUEUE (phases 20 à 25) ;
#   4. lance scripts/run-phase.sh sur la phase 19 ; run-phase.sh enchaîne ensuite les suivantes
#      et s'arrête quand docs/PHASE-DONE existe (fin de la phase 25).
# Arrêt manuel : Ctrl+C dans cette fenêtre. Journal : logs/lancer-agents.log et logs/run-phase.log.
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

# 1. Pas de mise en veille tant que la chaîne tourne.
if [ -z "${LAP_CAFFEINATED:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  export LAP_CAFFEINATED=1
  exec caffeinate -dims bash "$SCRIPT" "$@"
fi

PROMPTS="docs/prompts/21-phase-19-agents-fondations.md
docs/prompts/22-phase-20-agents-dating.md
docs/prompts/23-phase-21-agents-algorithme.md
docs/prompts/24-phase-22-agents-casino.md
docs/prompts/25-phase-23-agents-paris.md
docs/prompts/26-phase-24-agents-ads.md
docs/prompts/27-phase-25-agents-supervision.md"

for f in $PROMPTS; do
  [ -f "$f" ] || { echo "Fichier manquant : $f"; exit 1; }
done
[ -f docs/AGENTS-ARCHITECTURE.md ] || { echo "Fichier manquant : docs/AGENTS-ARCHITECTURE.md"; exit 1; }
[ -f scripts/run-phase.sh ] || { echo "Fichier manquant : scripts/run-phase.sh"; exit 1; }
command -v claude >/dev/null 2>&1 || {
  echo "La commande « claude » est introuvable. Ouvrez un nouveau Terminal et réessayez (ou installez Claude Code)."
  exit 1
}

mkdir -p logs
journal() { echo "$(date '+%d/%m %H:%M') $*" | tee -a logs/lancer-agents.log; }

# 2. Sessions Claude Code en cours, hors l'application Claude.app et ce script.
autres_sessions() {
  ps -axww -o pid=,command= 2>/dev/null \
    | grep -i 'claude' \
    | grep -v 'Claude\.app' \
    | grep -v 'Application Support/Claude' \
    | grep -v 'lancer-agents' \
    | grep -v 'run-phase' \
    | grep -v 'grep' \
    | awk -v moi="$$" '$1 != moi { print $1 }'
}

journal "Lancement de la chaîne agents IA (phases 19 à 25)."
if [ -z "${FORCE:-}" ]; then
  attente=0
  while :; do
    pids="$(autres_sessions | tr '\n' ' ')"
    [ -z "${pids// /}" ] && break
    if [ "$attente" -eq 0 ] || [ $((attente % 10)) -eq 0 ]; then
      journal "Une autre session Claude Code tourne encore (processus $pids) : j'attends qu'elle finisse. Laissez cette fenêtre ouverte."
    fi
    attente=$((attente + 1))
    sleep 120
  done
  journal "Aucune autre session en cours : démarrage."
else
  journal "FORCE=1 : démarrage sans attendre."
fi

# 3. File d'attente : toutes les phases sauf la première, lancée directement.
echo "$PROMPTS" | tail -n +2 > docs/prompts/QUEUE
journal "File d'attente écrite : $(wc -l < docs/prompts/QUEUE | tr -d ' ') phases suivront la phase 19."

# 4. C'est parti.
PREMIER="$(echo "$PROMPTS" | head -n 1)"
exec bash scripts/run-phase.sh "$PREMIER"
