import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendu dynamique classique (outil interne) : pas de Cache Components pour l'instant.
  cacheComponents: false,
  // Dossier de build : un par serveur de développement (Next 16 verrouille `.next/dev/lock`) ; voir docs/REFONTE-DEV.md.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Les paquets internes sont du TypeScript source, transpilé par Next.
  transpilePackages: ["@linkaffipro/agents", "@linkaffipro/chat", "@linkaffipro/core", "@linkaffipro/db", "@linkaffipro/telegram", "@linkaffipro/queue", "@linkaffipro/linkaffi", "@linkaffipro/mtproto"],
  // Dépendances natives ou volumineuses laissées à Node (non empaquetées).
  serverExternalPackages: ["@prisma/client", "bcryptjs", "grammy", "ioredis", "bullmq", "telegram"],
  poweredByHeader: false,
  // Image Railway seulement (Dockerfile) : le typage du site demande 8 Go, plus que la machine de build ; la CI le
  // vérifie à chaque envoi (`pnpm typecheck`). Partout ailleurs, `next build` vérifie les types.
  typescript: { ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === "1" },
  experimental: {
    // Le proxy (proxy.ts) lit chaque requête : sans ce réglage, Next coupe les envois au-delà de 10 Mo. Les médias
    // (`/api/media`, vidéos sources des agents `/api/agents/media`) vont jusqu'à 50 Mo (phase 20).
    proxyClientMaxBodySize: "60mb",
  },
  // En-têtes de sécurité : posés par proxy.ts (CSP exclue des redirections de tracking et des API), voir docs/SECURITE.md.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
