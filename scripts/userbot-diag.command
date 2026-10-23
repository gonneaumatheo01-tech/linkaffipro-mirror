#!/bin/bash
# Double-clic : diagnostic en lecture seule du userbot (logs + état en base), rien n'est modifié.
cd "$HOME/Desktop/Platefome de statistiques" || exit 1
export PATH="$HOME/.railway/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
bash scripts/railway-phase18-prod.sh diag
echo
echo "Terminé : tu peux fermer cette fenêtre."
