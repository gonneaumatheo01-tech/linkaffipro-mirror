/**
 * Adresse de retour après l'enregistrement des réglages d'un canal (volet de la liste ou de la fiche) : seulement la
 * liste des canaux ou la fiche d'un canal (avec son onglet), jamais une adresse extérieure ; la liste sinon.
 */
export function channelsReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/channels";
  const m = /^\/channels(?:\/([A-Za-z0-9_-]{1,64}))?(?:\?tab=([a-z]{1,20}))?$/.exec(value);
  if (!m) return "/channels";
  if (!m[1]) return "/channels";
  return m[2] ? `/channels/${m[1]}?tab=${m[2]}` : `/channels/${m[1]}`;
}

/** Ajoute le message de retour (`ok` / `error`) à une adresse sûre de `channelsReturnPath`. */
export function withFlash(path: string, params: { ok?: string; error?: string }): string {
  const [pathname, query = ""] = path.split("?");
  const qs = new URLSearchParams(query);
  if (params.ok) qs.set("ok", params.ok);
  if (params.error) qs.set("error", params.error);
  const s = qs.toString();
  return s ? `${pathname}?${s}` : pathname!;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNIVERSE = /^(CASINO|SPORTS|DATING)$/;

/**
 * Filtres du calendrier des messages à garder après « Recalculer maintenant » (semaine, jour, univers, campagne,
 * catégorie), lus dans les champs cachés du formulaire. Valeurs simples seulement (jour AAAA-MM-JJ, identifiants),
 * le reste est ignoré : l'utilisateur revient sur la semaine et les filtres qu'il regardait.
 */
export function calendarReturnParams(get: (name: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const pick = (name: string, re: RegExp) => {
    const v = get(name);
    if (typeof v === "string" && re.test(v)) out[name] = v;
  };
  pick("week", DAY_KEY);
  pick("day", DAY_KEY);
  pick("vertical", UNIVERSE);
  pick("campaignId", SIMPLE_ID);
  pick("category", SIMPLE_ID);
  return out;
}
