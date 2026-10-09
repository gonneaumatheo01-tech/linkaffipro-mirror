import { defineConfig } from "vitest/config";

/** Tests d'intégration du worker (base PostgreSQL réelle) : lancés par `pnpm test:integration`, exclus de `pnpm test`. */
export default defineConfig({
  test: { include: ["tests/integration/**/*.test.ts"], setupFiles: ["tests/integration/setup.ts"], environment: "node", fileParallelism: false, testTimeout: 30_000 },
});
