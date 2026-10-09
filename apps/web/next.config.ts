import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendu dynamique classique (outil interne) : pas de Cache Components pour l'instant.
  cacheComponents: false,
  // Les paquets internes sont du TypeScript source, transpilé par Next.
  transpilePackages: ["@linkaffipro/core", "@linkaffipro/db", "@linkaffipro/telegram"],
  // Dépendances natives ou volumineuses laissées à Node (non empaquetées).
  serverExternalPackages: ["@prisma/client", "bcryptjs", "grammy", "ioredis"],
  poweredByHeader: false,
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
