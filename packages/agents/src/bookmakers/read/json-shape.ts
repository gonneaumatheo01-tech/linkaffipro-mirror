/**
 * Phase 35, niveau 1 : lecture d'une réponse JSON d'API interne selon la « forme » de la recette
 * (`RecipeEndpoint.responseShape` : champ → chemin pointé depuis la racine, `[]` = chaque élément d'un tableau,
 * `{}` = chaque valeur d'un objet). Les champs d'une même ligne partagent les tableaux de leur préfixe commun :
 * `markets[].name` et `markets[].outcomes[].price` donnent une ligne par issue, avec le nom de SON marché.
 * Exemple (matchs) : `{ id: "data.events[].id", home: "data.events[].home.name", startsAt: "data.events[].start" }`.
 * Pur ; un chemin absent donne `undefined` (jamais une valeur inventée).
 */
type Seg = { key: string | null; iter: "array" | "object" | null };

/** « a.b[].c », « [].x », « $.a{}.b » → segments. */
export function parsePath(path: string): Seg[] {
  const out: Seg[] = [];
  const clean = path.trim().replace(/^\$\.?/, "");
  for (const raw of clean.split(".").filter((x) => x !== "")) {
    const m = /^([^[\]{}]*)((?:\[\]|\{\})*)$/.exec(raw);
    if (!m) {
      out.push({ key: raw, iter: null });
      continue;
    }
    if (m[1]) out.push({ key: m[1], iter: null });
    for (const it of (m[2] ?? "").match(/\[\]|\{\}/g) ?? []) out.push({ key: null, iter: it === "[]" ? "array" : "object" });
  }
  return out;
}

const iterCount = (segs: Seg[]) => segs.filter((s) => s.iter).length;

/** Préfixe jusqu'au N-ième itérateur inclus, en texte (pour comparer les chemins). */
function prefixKey(segs: Seg[], n: number): string {
  const out: string[] = [];
  let seen = 0;
  for (const s of segs) {
    out.push(`${s.key ?? ""}${s.iter === "array" ? "[]" : s.iter === "object" ? "{}" : ""}`);
    if (s.iter && ++seen === n) break;
  }
  return out.join(".");
}

function childrenOf(v: unknown, iter: "array" | "object"): unknown[] {
  if (iter === "array") return Array.isArray(v) ? v : [];
  return v && typeof v === "object" && !Array.isArray(v) ? Object.values(v as Record<string, unknown>) : [];
}

type Binding = { prefix: string; value: unknown }[];

/** Toutes les lignes définies par le chemin le plus « profond » ; chaque ligne garde la valeur de chaque niveau. */
function enumerate(root: unknown, segs: Seg[]): Binding[] {
  let frontier: Array<{ value: unknown; binding: Binding; depth: number }> = [{ value: root, binding: [], depth: 0 }];
  let seenIters = 0;
  const lastIter = iterCount(segs);
  for (const s of segs) {
    if (seenIters === lastIter) break;
    const next: typeof frontier = [];
    for (const f of frontier) {
      const v = s.key !== null ? (f.value && typeof f.value === "object" ? (f.value as Record<string, unknown>)[s.key] : undefined) : f.value;
      if (!s.iter) {
        next.push({ ...f, value: v });
        continue;
      }
      const p = prefixKey(segs, seenIters + 1);
      for (const c of childrenOf(v, s.iter)) next.push({ value: c, binding: [...f.binding, { prefix: p, value: c }], depth: f.depth + 1 });
    }
    frontier = next;
    if (s.iter) seenIters++;
  }
  return frontier.map((f) => f.binding);
}

/** Valeur d'un chemin pour une ligne : les tableaux déjà liés reprennent l'élément de la ligne, les autres le 1er. */
function resolve(root: unknown, segs: Seg[], binding: Binding): unknown {
  let v: unknown = root;
  let n = 0;
  for (const s of segs) {
    if (s.key !== null) v = v && typeof v === "object" ? (v as Record<string, unknown>)[s.key] : undefined;
    if (s.iter) {
      n++;
      const p = prefixKey(segs, n);
      const bound = binding.find((b) => b.prefix === p);
      v = bound ? bound.value : childrenOf(v, s.iter)[0];
    }
    if (v === undefined || v === null) return v;
  }
  return v;
}

/**
 * Lignes d'une réponse. `rowFields` : champs qui définissent la ligne (le plus profond d'entre eux fixe le niveau).
 * Chaque ligne donne la valeur de TOUS les champs de la forme.
 */
export function extractRows(body: unknown, shape: Record<string, string>, rowFields: readonly string[]): Array<Record<string, unknown>> {
  const parsed = Object.fromEntries(Object.entries(shape).map(([k, p]) => [k, parsePath(p)]));
  const defining = rowFields.filter((f) => parsed[f]);
  if (!defining.length) return [];
  const deepest = defining.map((f) => parsed[f]!).sort((a, b) => iterCount(b) - iterCount(a))[0]!;
  const rows = iterCount(deepest) ? enumerate(body, deepest) : [[]];
  return rows.map((binding) => Object.fromEntries(Object.entries(parsed).map(([k, segs]) => [k, resolve(body, segs, binding)])));
}

export function asText(v: unknown): string {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Versions listées par un manifeste (chemins vers des tableaux ou des valeurs), dans l'ordre, sans doublon. Pur. */
export function manifestVersions(body: unknown, paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    const p = path.trim().replace(/\[\]$/, "");
    for (const row of extractRows(body, { v: p }, ["v"])) {
      const values = Array.isArray(row.v) ? row.v : [row.v];
      for (const v of values) {
        const t = asText(v);
        if (t && !out.includes(t)) out.push(t);
      }
    }
  }
  return out;
}
