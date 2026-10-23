#!/bin/bash
# Double-clic : redémarre le service userbot sur Railway et montre ses logs (scripts/railway-phase18-prod.sh restart).
cd "$HOME/Desktop/Platefome de statistiques" || exit 1
export PATH="$HOME/.railway/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
bash scripts/railway-phase18-prod.sh restart
echo
echo "Terminé : tu peux fermer cette fenêtre."
