/**
 * Recommandations de l'équipe Algorithme à l'écran (phase 21) : libellé du réglage visé, valeurs avant / après en
 * mots, preuves lisibles, droits. Lecture tolérante (les valeurs sont écrites par le moteur). Fonctions pures, testées.
 *
 * Droits (décision du chantier site) : un responsable applique, annule et refuse les petits réglages (horaires,
 * mélange, consignes de style) ; les réglages de persona et les quotas (posts par jour) sont réservés aux
 * administrateurs, comme le niveau 2.
 */

export type RecommendationView = {
  id: string;
  teamKey: string;
  target: string;
  targetId: string;
  field: string;
  before: unknown;
  after: unknown;
  evidence: unknown;
  expectedGain: string | null;
  size: string;
  status: string;
  appliedAt: Date | null;
  appliedBy: string | null;
  undoneAt: Date | null;
  rejectedAt: Date | null;
  weekStart: string | null;
  createdAt: Date;
  /** Nom de la cible (canal, persona, équipe), résolu par la requête. */
  targetLabel: string;
};

export type RecommendationAction = "apply" | "undo" | "reject";

const FIELD_LABELS: Record<string, string> = {
  mix: "Mélange vidéo / photo / texte",
  windowStart: "Début de la fenêtre de publication",
  windowEnd: "Fin de la fenêtre de publication",
  window: "Fenêtre de publication",
  postsPerDay: "Posts par jour",
  minSpacingMinutes: "Espacement minimal entre deux posts",
  styleNotes: "Ce qui marche ici (consignes du canal)",
  suggestedWindows: "Fenêtres conseillées",
  styleGuidelines: "Consignes de style de l'équipe",
  suggestedFollowUpHours: "Heures des relances",
  followUpHours: "Heures des relances",
  styleExamples: "Exemples de style",
  exampleMessages: "Exemples de style",
  messagesBeforeLink: "Échanges avant le lien",
  minMessagesBeforeOffer: "Échanges avant le lien",
  maxFollowUps: "Nombre de relances",
  followUps: "Relances",
};

const TARGET_LABELS: Record<string, string> = {
  CHANNEL_PLAN: "Canal",
  TEAM_CONFIG: "Équipe",
  PERSONA: "Persona",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? `Réglage « ${field} »`;
}

export function targetKindLabel(target: string): string {
  return TARGET_LABELS[target] ?? target;
}

/** Gros réglage : persona ou quota (posts par jour), ou marqué « BIG » par le moteur. */
export function isBigRecommendation(r: Pick<RecommendationView, "size" | "target" | "field">): boolean {
  return r.size === "BIG" || r.target === "PERSONA" || r.field === "postsPerDay";
}

export function canActOnRecommendation(
  role: string,
  r: Pick<RecommendationView, "size" | "target" | "field">,
): boolean {
  return role === "ADMIN" || !isBigRecommendation(r);
}

/** Proposition venue d'un canal d'inspiration (phase 27) : jamais par la voie générique (réservée à l'admin, sur la page Inspiration). */
export const INSPIRATION_ONLY_MESSAGE = "Cette proposition vient d'un canal d'inspiration : elle se gère dans Agents → Inspiration (administrateurs).";

/** Proposition de l'analyse du marché (phase 29) : notée « acceptée » ou « refusée » dans Agents → Analyses, jamais appliquée. */
export const MARKET_ONLY_MESSAGE = "Cette proposition vient de l'analyse du marché : elle se décide dans Agents → Analyses (rien n'est changé automatiquement).";

export function genericRecommendationRefusal(r: { source?: string | null }): string | null {
  if (r.source === "inspiration") return INSPIRATION_ONLY_MESSAGE;
  if (r.source === "market_analysis") return MARKET_ONLY_MESSAGE;
  return null;
}

/** Gestes possibles selon l'état : proposé → appliquer ou refuser ; appliqué → annuler. */
export function actionsFor(status: string): RecommendationAction[] {
  if (status === "PROPOSED") return ["apply", "reject"];
  if (status === "APPLIED") return ["undo"];
  return [];
}

const DAY_SHORT = ["", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cut(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Mélange `{ video, photo, text }` (parts ou pourcentages) → « vidéo 25 %, photo 50 %, texte 25 % ». */
export function mixText(v: unknown): string | null {
  if (!isObj(v)) return null;
  const parts = [
    ["vidéo", num(v.video)],
    ["photo", num(v.photo)],
    ["texte", num(v.text)],
  ] as const;
  if (parts.every(([, n]) => n === null)) return null;
  const total = parts.reduce((s, [, n]) => s + Math.max(0, n ?? 0), 0);
  if (total <= 0) return "rien";
  return parts
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([w, n]) => `${w} ${Math.round(((n ?? 0) / total) * 100)} %`)
    .join(", ");
}

function windowText(w: unknown): string | null {
  if (!isObj(w)) return null;
  const start = typeof w.start === "string" ? w.start : null;
  const end = typeof w.end === "string" ? w.end : null;
  if (!start || !end) return null;
  const day = num(w.day);
  return `${day && DAY_SHORT[day] ? `${DAY_SHORT[day]} ` : ""}${start}-${end}`;
}

/** Valeur d'un réglage en mots (« — » si absente). */
export function valueText(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "mix") return mixText(v) ?? "—";
  if (typeof v === "string") return cut(v);
  if (typeof v === "number") return v.toLocaleString("fr-FR");
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) {
    if (v.length === 0) return "aucune";
    if (v.every((x) => typeof x === "number"))
      return (v as number[]).map((h) => (/hour/i.test(field) ? `${h} h` : h.toLocaleString("fr-FR"))).join(", ");
    const windows = v.map(windowText);
    if (windows.every((w) => w !== null)) return cut(windows.join(", "));
    return cut(v.filter((x) => typeof x === "string").join(" · ") || `${v.length} éléments`);
  }
  if (isObj(v)) {
    const w = windowText(v);
    if (w) return w;
    const m = mixText(v);
    if (m) return m;
    return cut(
      Object.entries(v)
        .filter(([, x]) => ["string", "number", "boolean"].includes(typeof x))
        .map(([k, x]) => `${k} : ${typeof x === "number" ? x.toLocaleString("fr-FR") : String(x)}`)
        .join(", ") || "—",
    );
  }
  return "—";
}

const EVIDENCE_NUMBERS: Array<[string, string, "int" | "pct"]> = [
  ["posts", "posts", "int"],
  ["views", "vues", "int"],
  ["conversations", "conversations", "int"],
  ["samples", "cas mesurés", "int"],
  ["offerCtr", "taux de clic sur l'offre", "pct"],
  ["ctrBefore", "taux de clic avant", "pct"],
  ["ctrAfter", "taux de clic attendu", "pct"],
  ["replyRate", "taux de réponse", "pct"],
];

/** Preuves en phrases courtes (texte du moteur d'abord, puis chiffres connus). */
export function evidenceLines(e: unknown): string[] {
  if (typeof e === "string") return e ? [cut(e, 240)] : [];
  if (!isObj(e)) return [];
  const out: string[] = [];
  for (const k of ["summary", "text", "reason"]) if (typeof e[k] === "string" && e[k]) out.push(cut(e[k] as string, 240));
  if (Array.isArray(e.lines)) for (const l of e.lines) if (typeof l === "string" && l) out.push(cut(l, 240));
  const nums: string[] = [];
  for (const [k, label, kind] of EVIDENCE_NUMBERS) {
    const n = num(e[k]);
    if (n === null) continue;
    nums.push(
      kind === "pct"
        ? `${label} ${(n * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
        : `${n.toLocaleString("fr-FR")} ${label}`,
    );
  }
  if (nums.length) out.push(nums.join(", "));
  if (typeof e.experimentId === "string") out.push("Issu d'un test A/B clos (voir Tests).");
  return out.slice(0, 6);
}

export const ACTION_WORDS: Record<RecommendationAction, { button: string; done: string }> = {
  apply: { button: "Appliquer", done: "Réglage appliqué." },
  undo: { button: "Annuler", done: "Réglage annulé : la valeur d'avant est remise." },
  reject: { button: "Refuser", done: "Proposition refusée." },
};
