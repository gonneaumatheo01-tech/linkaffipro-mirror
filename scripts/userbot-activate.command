#!/bin/bash
# Double-clic : active le compte Telegram en prod (ce que le bouton « Activer » aurait dû faire), redémarre le userbot, montre ses logs.
cd "$HOME/Desktop/Platefome de statistiques" || exit 1
export PATH="$HOME/.railway/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
bash scripts/railway-phase18-prod.sh activate
echo
echo "Terminé : tu peux fermer cette fenêtre."
