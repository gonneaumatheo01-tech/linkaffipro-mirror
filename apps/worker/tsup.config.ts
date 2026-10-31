import { defineConfig } from "tsup";

// Le worker est empaqueté en un seul fichier ESM ; les paquets internes (@linkaffipro/*) sont inclus,
// les dépendances externes (Prisma, BullMQ, grammY…) restent dans node_modules.
export default defineConfig({
  entry: ["src/index.ts", "src/backup-now.ts", "src/scripts/import-flirt.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@linkaffipro\//],
  external: ["@prisma/client", "bullmq", "ioredis", "pino", "grammy", "bcryptjs", "telegram"],
});
