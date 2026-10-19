#!/usr/bin/env bash
# Execute dans l'ordre les scripts de agent/todo/*.sh, journalise chaque sortie dans agent/out/,
# deplace les scripts reussis dans agent/done/, puis commit + pousse le miroir.
# S'arrete au premier echec (rien n'est pousse en cas d'echec).
set -u
cd "$(dirname "$0")/.."
branch="$(git rev-parse --abbrev-ref HEAD)"
mkdir -p agent/out agent/done
found=0
for f in agent/todo/*.sh; do
  [ -e "$f" ] || continue
  found=1
  name="$(basename "$f" .sh)"
  echo "=== $name ==="
  if bash "$f" >"agent/out/$name.log" 2>&1; then
    echo "OK    $name"
    mv "$f" agent/done/
  else
    echo "ECHEC $name"
    echo "----- fin du journal ($name) -----"
    tail -n 40 "agent/out/$name.log"
    echo "---------------------------------"
    echo "journal complet : agent/out/$name.log"
    exit 1
  fi
done
if [ "$found" = "0" ]; then echo "rien a faire (agent/todo est vide)"; fi
git add -A
if git diff --cached --quiet; then
  echo "aucun changement a committer"
else
  git commit -m "agent : execution du $(date '+%Y-%m-%d %H:%M')"
fi
echo "termine."
