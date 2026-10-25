import { defineConfig } from "vitest/config";
// Préparations et fermetures des navigateurs de test (Chromium, phase 35) : lentes quand toute la suite tourne en même temps.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], hookTimeout: 60_000 } });
