#!/usr/bin/env bash
# Boucle autonome phase 18 : fait executer les taches de agent/tasks/ par Claude Code, une par une,
# verifie (typecheck + tests) puis commite. Le hook post-commit pousse le miroir.
# Arret : creer le fichier agent/STOP, ou Ctrl+C.
set -u
cd "$(git rev-parse --show-toplevel)"
mkdir -p agent/out agent/done agent/tasks

command -v claude >/dev/null 2>&1 || { echo "commande claude introuvable dans le PATH"; exit 1; }
echo "claude : $(claude --version 2>/dev/null || echo version-inconnue)"

notifie() { osascript -e "display notification \"$1\" with title \"phase 18\"" >/dev/null 2>&1 || true; }

while true; do
  if [ -e agent/STOP ]; then echo "[$(date '+%H:%M')] agent/STOP present : arret."; break; fi

  task=""
  for f in agent/tasks/*.md; do
    if [ -e "$f" ]; then task="$f"; break; fi
  done
  if [ -z "$task" ]; then
    echo "[$(date '+%H:%M')] aucune tache en attente (60 s)."
    sleep 60
    continue
  fi

  name="$(basename "$task" .md)"
  echo "================ $(date '+%H:%M') tache $name ================"
  before="$(git rev-parse HEAD)"

  prompt="$(cat agent/ROADMAP.md)

========================
TACHE A FAIRE MAINTENANT
========================
$(cat "$task")

Rappel : tu es l executant, la conception est figee dans la feuille de route. Termine par un resume court."

  claude -p "$prompt" --dangerously-skip-permissions --max-turns 100 \
    --output-format stream-json --verbose > "agent/out/$name.jsonl" 2>&1

  if grep -qiE "usage limit|rate limit|too many requests" "agent/out/$name.jsonl"; then
    echo "limite d usage atteinte : pause de 15 minutes puis reprise de la meme tache."
    sleep 900
    continue
  fi

  echo "--- verification ---"
  if ! pnpm typecheck > "agent/out/$name.typecheck.log" 2>&1; then
    echo "TYPECHECK EN ECHEC"
    tail -n 30 "agent/out/$name.typecheck.log"
    printf '# Blocage\n\nTache : %s\nRaison : typecheck en echec\n\nVoir agent/out/%s.typecheck.log\n' "$name" "$name" > agent/BLOCKED.md
    notifie "typecheck en echec sur $name"
    break
  fi
  tests_ok=0
  for essai in 1 2; do
    if pnpm test > "agent/out/$name.test.log" 2>&1; then tests_ok=1; break; fi
    echo "tests en echec (essai $essai) : nouvelle tentative dans 20 s"
    sleep 20
  done
  if [ "$tests_ok" = "0" ]; then
    echo "TESTS EN ECHEC"
    tail -n 30 "agent/out/$name.test.log"
    printf '# Blocage\n\nTache : %s\nRaison : tests en echec\n\nVoir agent/out/%s.test.log\n' "$name" "$name" > agent/BLOCKED.md
    notifie "tests en echec sur $name"
    break
  fi

  mv "$task" agent/done/
  git add -A
  if git diff --cached --quiet; then
    echo "aucun changement produit par la tache"
    git commit -m "agent : $name (sans changement)" --allow-empty >/dev/null
  else
    git commit -m "phase 18 : $name" >/dev/null
  fi
  echo "[$(date '+%H:%M')] $name terminee ($before -> $(git rev-parse HEAD))"
  notifie "$name terminee"
done
