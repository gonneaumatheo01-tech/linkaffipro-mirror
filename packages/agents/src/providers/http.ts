/**
 * Appels HTTP des fournisseurs de médias (`fetch` injectable, aucune dépendance). Classement des erreurs : 429, 5xx et
 * coupure réseau = passagères (on relira plus tard) ; autre 4xx = échec avec un message clair. La clé n'apparaît
 * jamais dans un message d'erreur (elle n'est que dans l'en-tête, et tout texte renvoyé est expurgé).
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type HttpDeps = { fetch: typeof fetch; label: string; secret: string };

/** Retire la clé d'un texte (au cas où un fournisseur la renverrait). */
export function redact(text: string, secret: string): string {
  return secret && secret.length >= 4 ? text.split(secret).join("•••") : text;
}

function detailOf(body: unknown): string {
  if (!body || typeof body !== "object") return typeof body === "string" ? body : "";
  const o = body as Record<string, unknown>;
  const d = o.detail ?? o.message ?? o.error;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x && typeof x === "object" ? String((x as { msg?: unknown }).msg ?? "") : String(x))).join(" ; ");
  if (d && typeof d === "object") return String((d as { message?: unknown }).message ?? "");
  return "";
}

/** Erreur lisible pour un statut HTTP. */
export function errorForStatus(label: string, status: number, body: unknown, secret: string): ProviderError {
  const detail = redact(detailOf(body), secret).replace(/\s+/g, " ").trim().slice(0, 160);
  const tail = detail ? ` : ${detail}` : "";
  if (status === 401 || status === 403) return new ProviderError(`${label} : clé refusée (${status}). Vérifie la clé dans Réglages → Agents.`, false, status);
  if (status === 402) return new ProviderError(`${label} : crédit épuisé (402). Ajoute du crédit sur le compte.`, false, status);
  if (status === 429) return new ProviderError(`${label} limite le débit pour le moment (429)`, true, status);
  if (status >= 500) return new ProviderError(`${label} indisponible (${status})`, true, status);
  return new ProviderError(`${label} : demande refusée (${status})${tail}`, false, status);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Requête JSON ; lève `ProviderError` (passagère ou non) au moindre problème. */
export async function requestJson<T>(http: HttpDeps, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await http.fetch(url, init);
  } catch (err) {
    throw new ProviderError(`${http.label} injoignable (${redact((err as Error).message || "réseau", http.secret).slice(0, 120)})`, true);
  }
  const body = await readBody(res);
  if (!res.ok) throw errorForStatus(http.label, res.status, body, http.secret);
  if (body === null || typeof body !== "object") throw new ProviderError(`${http.label} : réponse inattendue`, true, res.status);
  return body as T;
}

/** Téléchargement d'octets (résultat d'un fournisseur, adresse publique temporaire : aucune clé envoyée). */
export async function downloadBytes(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    throw new ProviderError(`${label} : téléchargement impossible (${(err as Error).message || "réseau"})`.slice(0, 200), true);
  }
  if (!res.ok) throw errorForStatus(`${label} (téléchargement)`, res.status, null, "");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new ProviderError(`${label} : fichier téléchargé vide`, true);
  const mimeType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
  let filename = "media";
  try {
    filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "media");
  } catch {
    /* adresse sans chemin lisible */
  }
  return { bytes, mimeType, filename };
}
