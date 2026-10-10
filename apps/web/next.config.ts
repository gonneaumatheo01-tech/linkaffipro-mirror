import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendu dynamique classique (outil interne) : pas de Cache Components pour l'instant.
  cacheComponents: false,
  // Les paquets internes sont du TypeScript source, transpilé par Next.
  transpilePackages: ["@linkaffipro/core", "@linkaffipro/db", "@linkaffipro/telegram", "@linkaffipro/queue", "@linkaffipro/linkaffi", "@linkaffipro/mtproto"],
  // Dépendances natives ou volumineuses laissées à Node (non empaquetées).
  serverExternalPackages: ["@prisma/client", "bcryptjs", "grammy", "ioredis", "bullmq", "telegram"],
  poweredByHeader: false,
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
