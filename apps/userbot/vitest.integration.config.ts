import { defineConfig } from "vitest/config";

/** Tests d'intégration du userbot (base PostgreSQL réelle) : lancés par `pnpm test:integration`, exclus de `pnpm test`. */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
