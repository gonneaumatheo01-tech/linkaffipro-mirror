// Préchargement pour le serveur de développement : charge `.env.local` (racine du dépôt) SANS écraser les variables
// déjà posées (PORT, AUTH_URL, APP_BASE_URL d'un agent). Remplace `--env-file-if-exists`, que Next.js recopie dans
// NODE_OPTIONS pour son processus enfant et que Node refuse à cet endroit. Usage (depuis apps/web) :
//   PORT=3103 AUTH_URL=http://localhost:3103 APP_BASE_URL=http://localhost:3103 \
//     node --require ./scripts/load-env.cjs node_modules/next/dist/bin/next dev -p 3103
try {
  process.loadEnvFile(`${__dirname}/../../../.env.local`);
} catch {
  // Pas de .env.local : les variables viennent de l'environnement.
}
