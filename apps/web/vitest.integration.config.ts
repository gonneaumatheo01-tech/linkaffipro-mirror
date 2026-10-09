import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Tests d'intégration (base PostgreSQL réelle) : lancés par `pnpm test:integration`, exclus de `pnpm test`. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["tests/integration/**/*.test.ts"], setupFiles: ["tests/integration/setup.ts"], environment: "node", fileParallelism: false, testTimeout: 30_000 },
});
