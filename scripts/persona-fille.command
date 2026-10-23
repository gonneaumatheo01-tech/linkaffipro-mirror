#!/bin/bash
# Double-clic : passe la persona Léa de la PROD en identité « une fille » (prénom seul, 23 ans, textes du Mac ; elle dit être une IA si on le lui demande). Effet immédiat.
cd "$HOME/Desktop/Platefome de statistiques" || exit 1
export PATH="$HOME/.railway/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
bash scripts/railway-phase18-prod.sh fille
echo
echo "Terminé : tu peux fermer cette fenêtre."
