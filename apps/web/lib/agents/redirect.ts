/**
 * Retour des actions de la rubrique Agents : redirection vers la page avec le message (`?ok=` / `?error=`), comme les
 * autres écrans. Séparé des fichiers « use server » (qui n'exportent que des actions).
 */
import { redirect } from "next/navigation";

export function backTo(path: string, params: Record<string, string>, hash = ""): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${path}${q ? `?${q}` : ""}${hash}`);
}

export function isRedirectError(err: unknown): boolean {
  return Boolean((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT"));
}

/** Message lisible d'une erreur levée par un service (« à écrire » tant que le moteur n'est pas livré). */
export function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : "";
  return m || "erreur inattendue";
}
