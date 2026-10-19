# agent

Harnais de travail avec l'agent (phase 18).

- `agent/todo/` : scripts a executer, dans l'ordre alphabetique.
- `agent/run.sh` : execute toute la file, journalise, commit et pousse le miroir.
- `agent/out/` : journaux d'execution (un par script).
- `agent/done/` : scripts deja passes.
- `agent/logs/` : journaux des poussees automatiques (hook).

Le hook `.githooks/post-commit` pousse le miroir public apres chaque commit,
ce qui permet a l'agent de relire le depot sans intervention.

Usage : ./agent/run.sh
