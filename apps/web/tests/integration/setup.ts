import { vi } from "vitest";

declare global {
  // eslint-disable-next-line no-var
  var __afterPromises: Promise<unknown>[] | undefined;
}

// Hors d'une requête Next, `after()` lève : on exécute le rappel tout de suite et on garde sa promesse
// pour que les tests puissent attendre les écritures (`flushAfter()` dans helpers.ts).
vi.mock("next/server", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    after: (fn: () => unknown | Promise<unknown>) => {
      const p = Promise.resolve().then(fn);
      (globalThis.__afterPromises ??= []).push(p.catch(() => undefined));
    },
  };
});
