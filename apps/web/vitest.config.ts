import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // Les fichiers .tsx importés par les tests (ex. lib/status-badges.tsx) : JSX compilé par esbuild, sans plugin React.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "tests/integration/**"],
    environment: "node",
  },
});
