/** Résultat standard des actions serveur (formulaires). */
export type ActionResult = { ok: true; message?: string; data?: Record<string, string> } | { ok: false; error: string };

export function failure(err: unknown, fallback = "Une erreur est survenue"): ActionResult {
  const message = err instanceof Error ? err.message : fallback;
  return { ok: false, error: message || fallback };
}
