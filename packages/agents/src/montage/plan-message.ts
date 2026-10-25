/**
 * Phase 28, chantier E — le plan de coupe vu par Kevin (section 4 du prompt) :
 * - `planMessages` : « J'ai trouvé 12 moments… 1. 2:30-2:45 — Gros gain à la roulette (note 9/10) … Je lance le montage ?
 *   Tu veux modifier quelque chose ? », découpé en plusieurs messages s'il est trop long ;
 * - `parsePlanReply` : réponse du client → ajustements (« ok », « ok lance », « enlève le 3 », « le 2, commence 2
 *   secondes plus tôt », « 10 secondes au lieu de 15 », « garde que les 5 meilleurs », « ok sauf le 3 »), règles du
 *   code d'abord, Haiku (interprète de Kevin) seulement si les règles ne comprennent pas ;
 * - `answerPlan` : applique (`approvePlan` de la chaîne) et répond.
 * Textes : `PLAN_VARIANTS` (charte `docs/KEVIN-VOIX.md`, contrôlés par `voiceCheck`).
 */
import type { AiToolDef } from "@linkaffipro/ai";
import { esc } from "../admin/journal";
import { normalizeText } from "../human/answer";
import { BOSS_MESSAGE_MARK } from "../boss/llm";
import { pick, voiceTemplate, type VoiceTable } from "../boss/voice";
import type { ActorRef } from "../admin/team";
import type { MontageInstructions, ShortFormat } from "./contract";
import { montagePort, type KevinMontageDeps, type PlanEdit } from "./kevin-port";
import { clearMontageAwait } from "./kevin-state";

// ------------------------------------------------------------------------------------------------ formats (purs)

/** « 2:30 », « 1:02:30 » (pur). */
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** « 47 min », « 1 h 05 », « 45 s » (pur). */
export function durationLabel(sec: number | null | undefined): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return `${Math.round(sec)} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m === 60 ? 0 : m).padStart(2, "0")}`;
}

/** « 1080p », « 4K », « 720p » d'après le petit côté (pur). */
export function resolutionLabel(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height) return null;
  const small = Math.min(width, height);
  if (small >= 2160) return "4K";
  if (small >= 1440) return "1440p";
  return `${small}p`;
}

/** « vertical 9:16 » (pur). */
export function formatLabel(format: ShortFormat | string | null | undefined): string {
  if (format === "HORIZONTAL_16_9") return "horizontal 16:9";
  if (format === "SQUARE_1_1") return "carré 1:1";
  return "vertical 9:16";
}

/** « 18,4 Mo » (pur). */
export function sizeLabel(bytes: number | null | undefined): string {
  const b = typeof bytes === "number" && bytes > 0 ? bytes : 0;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

// ------------------------------------------------------------------------------------------------ textes

type PlanSample = { count: number; lines: string; source: string };
type EditSample = { changes: string; count: number };

export const PLAN_VARIANTS = {
  /** Plan de coupe (lignes « 1. 2:30-2:45 — … (note 9/10) »), question à la fin. */
  plan: voiceTemplate<PlanSample>(
    [
      { count: 3, lines: "1. 2:30-2:45 — Gros gain à la roulette (note 9/10)\n2. 5:10-5:25 — Série de mises (note 8/10)\n3. 12:02-12:17 — Réaction au jackpot (note 7/10)", source: "47 min" },
      { count: 1, lines: "1. 0:40-0:55 — La bille tombe sur le 17 (note 9/10)", source: "12 min" },
    ],
    (p) => [
      `J'ai trouvé ${plural(p.count, "moment intéressant", "moments intéressants")} dans ta vidéo de ${p.source}. Le plan :\n${p.lines}\nJe lance le montage ? Tu veux modifier quelque chose ?`,
      `${plural(p.count, "moment sort", "moments sortent")} du lot dans ta vidéo de ${p.source} :\n${p.lines}\nJe lance le montage, ou tu veux changer quelque chose ?`,
      `Ce que je garderais de ta vidéo de ${p.source} (${plural(p.count, "moment")}) :\n${p.lines}\nOn lance ? Ou tu modifies quelque chose avant ?`,
    ],
    { allowList: true, allowLong: true },
  ),
  /** Suite d'un plan trop long (deuxième message et suivants). */
  planMore: voiceTemplate<{ lines: string }>([{ lines: "13. 40:02-40:17 — Dernière mise (note 6/10)" }], (p) => [`La suite du plan :\n${p.lines}`, `Et la suite :\n${p.lines}`], {
    allowList: true,
    allowLong: true,
  }),
  /** Fin d'un plan découpé (dernier message). */
  planQuestion: [
    "Je lance le montage ? Tu veux modifier quelque chose ?",
    "On lance ? Ou tu modifies quelque chose avant ?",
    "Je lance le montage, ou tu veux changer quelque chose ?",
  ],
  /** Aucun moment trouvé. */
  planEmpty: [
    "Je n'ai trouvé aucun moment assez fort dans cette vidéo. Tu veux que je réessaie avec d'autres consignes ?",
    "Rien ne sort vraiment du lot dans cette vidéo. Tu me redonnes des consignes et je réessaie ?",
  ],
  /** Plan accepté tel quel. */
  launched: voiceTemplate<{ count: number }>([{ count: 12 }, { count: 1 }], (p) => [
    `C'est parti pour ${plural(p.count, "short")} ✅ Je t'envoie chaque aperçu dès qu'il est prêt.`,
    `Je lance le montage des ${plural(p.count, "short")} ✅ Tu reçois les aperçus au fur et à mesure.`,
    `Lancé ✅ ${plural(p.count, "short")} en fabrication, je t'envoie les aperçus un par un.`,
  ]),
  /** Plan ajusté puis lancé. */
  adjusted: voiceTemplate<EditSample>(
    [
      { changes: "j'enlève le 3", count: 9 },
      { changes: "le 2 commence 2 s plus tôt, les autres font 10 s", count: 10 },
    ],
    (p) => [
      `C'est noté : ${p.changes}. Je lance le montage des ${plural(p.count, "short")} ✅`,
      `Ok, ${p.changes}. C'est parti pour ${plural(p.count, "short")} ✅`,
      `Fait : ${p.changes}. Je lance les ${plural(p.count, "short")} ✅`,
    ],
  ),
  /** Réponse au plan pas comprise. */
  notUnderstood: [
    "Je n'ai pas compris ce que tu veux changer. Dis par exemple « enlève le 3 », « le 2, commence 2 secondes plus tôt » ou « ok » pour lancer.",
    "Pas sûr de comprendre. Tu peux me dire « ok » pour lancer, ou par exemple « garde que les 5 meilleurs » ?",
  ],
  /** Numéro qui n'existe pas dans le plan. */
  noSuchMoment: voiceTemplate<{ index: number; count: number }>([{ index: 14, count: 12 }], (p) => [
    `Il n'y a pas de moment ${p.index} dans le plan : il en compte ${p.count}.`,
    `Le plan s'arrête au ${p.count}, je n'ai pas de ${p.index}.`,
  ]),
  /** Tous les moments retirés. */
  nothingLeft: [
    "Si j'enlève tout, il ne reste aucun short. Tu en gardes au moins un ?",
    "Là il ne reste plus rien à monter. Tu en gardes au moins un ?",
  ],
  /** Le montage n'attend plus de réponse au plan. */
  planGone: [
    "Ce plan n'est plus en attente : le montage est déjà lancé ou annulé. Écris « où en est le montage ? » pour voir.",
    "Ce plan n'attend plus de réponse. Demande-moi « où en est le montage ? » si tu veux le point.",
  ],
} satisfies VoiceTable;

// ------------------------------------------------------------------------------------------------ plan

export type PlanClip = { index: number; startMs: number; endMs: number; description: string | null; score: number | null; status?: string };

/** Une ligne du plan : « 1. 2:30-2:45 — Gros gain à la roulette (note 9/10) » (HTML échappé, pur). */
export function planLine(c: PlanClip): string {
  const what = (c.description ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "Moment retenu";
  // Note sur 10 en mots (un emoji par ligne ferait une série d'emojis, contraire à la voix de Kevin).
  const score = typeof c.score === "number" ? ` (note ${Math.round(c.score)}/10)` : "";
  return `${c.index}. ${clockOf(c.startMs)}-${clockOf(c.endMs)} — ${esc(what)}${score}`;
}

/** Taille d'un message de plan (Telegram coupe à 4 096 ; marge pour la question). */
export const PLAN_MESSAGE_MAX = 3500;

/**
 * Message(s) du plan (pur, sauf la rotation des variantes) : un seul s'il tient, sinon les lignes sont réparties sur
 * plusieurs messages, la question est dans le dernier.
 */
export function planMessages(clips: readonly PlanClip[], sourceDurationSec: number | null, chatId?: string | bigint | null, max = PLAN_MESSAGE_MAX): string[] {
  const list = [...clips].sort((a, b) => a.index - b.index);
  if (!list.length) return [pick(PLAN_VARIANTS.planEmpty, "montage.plan.empty", chatId ?? null)];
  const source = durationLabel(sourceDurationSec) ?? "plusieurs minutes";
  const lines = list.map(planLine);
  const one = pick(PLAN_VARIANTS.plan({ count: list.length, lines: lines.join("\n"), source }), "montage.plan", chatId ?? null);
  if (one.length <= max) return [one];
  // Trop long : morceaux de lignes entières.
  const chunks: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.length + 1 > max - 200) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.length + 1;
  }
  if (cur.length) chunks.push(cur);
  const out: string[] = [];
  chunks.forEach((c, i) => {
    if (i === 0) {
      const head = pick(PLAN_VARIANTS.plan({ count: list.length, lines: c.join("\n"), source }), "montage.plan", chatId ?? null);
      // La question n'est posée qu'à la fin : la première partie s'arrête aux lignes du plan.
      out.push(head.slice(0, head.lastIndexOf(c[c.length - 1]!) + c[c.length - 1]!.length));
    } else out.push(pick(PLAN_VARIANTS.planMore({ lines: c.join("\n") }), "montage.plan.more", chatId ?? null));
  });
  out[out.length - 1] = `${out[out.length - 1]}\n${pick(PLAN_VARIANTS.planQuestion, "montage.plan.question", chatId ?? null)}`;
  return out;
}

// ------------------------------------------------------------------------------------------------ réponses (pur)

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, premier: 1, premiere: 1, deux: 2, deuxieme: 2, trois: 3, troisieme: 3, quatre: 4, quatrieme: 4,
  cinq: 5, cinquieme: 5, six: 6, sixieme: 6, sept: 7, septieme: 7, huit: 8, huitieme: 8, neuf: 9, neuvieme: 9, dix: 10, dixieme: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30,
};
const NUM = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
export function numberOf(raw: string): number {
  const w = NUMBER_WORDS[raw];
  return w ?? Number(raw.replace(",", "."));
}

/** Texte comparable : minuscules, sans accents, apostrophes droites, ponctuation finale retirée (pur). */
export function montageNorm(text: string): string {
  return normalizeText(text).replace(/[«»"“”]/g, " ").replace(/\s+/g, " ").trim();
}

const OK_ONLY = /^(?:ok|okay|oki|ok lance|ok go|go|lance|lance le|lance-le|lance le montage|vas y|vas-y|c'est bon|c bon|parfait|top|nickel|valide|je valide|d'accord|ca marche|ca me va|super|yes|oui|oui lance|ok c'est bon|ok parfait|ok pour moi|ok vas y|ok vas-y|banco|on y va|fonce|👍|✅)$/;

const ORDINALS = "premier|premiere|deuxieme|troisieme|quatrieme|cinquieme|sixieme|septieme|huitieme|neuvieme|dixieme";

/** Numéros cités (« le 3 et le 5 », « 3, 5 », « le troisième ») ; vide si aucun (pur). */
export function indexesIn(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`(?:^|[^\\w:])(\\d{1,2}|${ORDINALS})(?![\\w:.,]\\d|[\\w:]|\\s*(?:s|sec|secondes?|min|minutes?|x)\\b)`, "g");
  for (const m of text.matchAll(re)) {
    const n = numberOf(m[1]!);
    if (Number.isInteger(n) && n > 0 && n < 100 && !out.includes(n)) out.push(n);
  }
  return out;
}

const SECONDS = `${NUM}\\s*(?:s|sec|secs|secondes?|seconde)\\b`;

/** Décalage de début / fin (« commence 2 secondes plus tôt », « finis 3 s plus tard », « avance de 2 s ») (pur). */
export function shiftIn(text: string): { startDeltaMs?: number; endDeltaMs?: number } | null {
  const out: { startDeltaMs?: number; endDeltaMs?: number } = {};
  // « raccourcis de 2 secondes » = la fin 2 s plus tôt ; « rallonge de 3 s » = la fin 3 s plus tard.
  const shorter = new RegExp(`(?:raccourci\\w*|reduis|reduire|enleve|retire|coupe)\\s+(?:le short |le |la fin )?(?:de\\s+)?${SECONDS}`).exec(text);
  if (shorter) out.endDeltaMs = -Math.round(numberOf(shorter[1]!) * 1000);
  const longer = new RegExp(`(?:rallonge\\w*|allonge\\w*|ajoute)\\s+(?:le short |le |la fin )?(?:de\\s+)?${SECONDS}`).exec(text);
  if (longer) out.endDeltaMs = Math.round(numberOf(longer[1]!) * 1000);
  const start = new RegExp(`(?:commence|commencer|debut|demarre|demarrer|part|partir|ouvre)[^.]*?${SECONDS}\\s*(plus tot|avant|plus tard|apres)`).exec(text);
  if (start) out.startDeltaMs = Math.round(numberOf(start[1]!) * 1000) * (/tot|avant/.test(start[2]!) ? -1 : 1);
  const end = new RegExp(`(?:fini[rs]?|finit|termine[rs]?|fin|arrete[rs]?|coupe[rs]?)[^.]*?${SECONDS}\\s*(plus tot|avant|plus tard|apres)`).exec(text);
  if (end) out.endDeltaMs = Math.round(numberOf(end[1]!) * 1000) * (/tot|avant/.test(end[2]!) ? -1 : 1);
  return out.startDeltaMs !== undefined || out.endDeltaMs !== undefined ? out : null;
}

/** Durée demandée (« 10 secondes au lieu de 15 », « en 20 secondes », « des shorts de 12 s ») (pur). */
export function durationIn(text: string): number | null {
  const insteadOf = new RegExp(`${SECONDS}\\s*(?:au lieu de|plutot que|a la place de)`).exec(text);
  if (insteadOf) return numberOf(insteadOf[1]!);
  const m = new RegExp(`(?:en|de|fais|fait|faire|plutot|duree(?: de)?|a)\\s+${SECONDS}`).exec(text);
  return m ? numberOf(m[1]!) : null;
}

export type PlanReply =
  | { kind: "approve"; edits: PlanEdit[] }
  /** Les règles ne comprennent pas : Haiku, puis question. */
  | { kind: "unknown" };

/**
 * Réponse au plan → ajustements (pur). Toute réponse comprise lance le montage (le client répond au « Je lance ? ») :
 * « ok » → aucun ajustement ; « enlève le 3 » / « ok sauf le 3 » → retrait ; « le 2, commence 2 s plus tôt » →
 * décalage ; « 10 secondes au lieu de 15 » → durée de tous ; « garde que les 5 meilleurs » → les 5 meilleurs.
 */
export function parsePlanReply(raw: string): PlanReply {
  const t = montageNorm(raw).replace(/[!.,;]+$/g, "").trim();
  if (!t) return { kind: "unknown" };
  if (OK_ONLY.test(t)) return { kind: "approve", edits: [] };
  const edits: PlanEdit[] = [];
  // Plusieurs consignes séparées par « et », « , puis », un point ou un retour à la ligne : traitées une par une.
  const parts = t.split(/\s*(?:\n|;|\. |,? puis |,? et aussi )\s*/).filter(Boolean);
  for (const part of parts) {
    const p = part.trim();
    const best = /(?:garde|gardes|garder|prends|prend|ne garde|juste|seulement|que)\b[^0-9a-z]*(?:que |seulement |juste )?(?:les )?(\d+|[a-z]+) (?:meilleurs?|premiers?|plus forts?|mieux notes?)/.exec(p);
    if (best && Number.isFinite(numberOf(best[1]!))) {
      edits.push({ kind: "keepBest", count: numberOf(best[1]!) });
      continue;
    }
    const removing = /^(?:ok |c'est bon |parfait |top |valide )?(?:sauf|mais pas|pas le|pas les|sans le|sans les|enleve|enlever|enleves|retire|retirer|retires|supprime|supprimer|vire|virer|degage|oublie|zappe|pas)\b/.test(p) || /\b(?:sauf|enleve|retire|supprime|vire|oublie)\b/.test(p);
    const shift = shiftIn(p);
    const dur = durationIn(p);
    const idx = indexesIn(p.replace(new RegExp(SECONDS, "g"), " ").replace(/\bau lieu de \d+/g, " "));
    if (removing && !shift && dur === null) {
      if (!idx.length) return { kind: "unknown" };
      for (const i of idx) edits.push({ kind: "remove", index: i });
      continue;
    }
    if (shift) {
      const target = idx.length ? idx : [null];
      for (const i of target) edits.push({ kind: "shift", index: i, ...shift });
      continue;
    }
    if (dur !== null) {
      const target = idx.length ? idx : [null];
      for (const i of target) edits.push({ kind: "duration", index: i, seconds: dur });
      continue;
    }
    // « ok lance », « ok » en tête d'une partie : rien de plus à faire.
    if (OK_ONLY.test(p) || /^(?:ok|go|lance|parfait|top)\b/.test(p)) continue;
    return { kind: "unknown" };
  }
  return edits.length || /^(?:ok|go|lance)\b/.test(t) ? { kind: "approve", edits } : { kind: "unknown" };
}

/** Description courte des ajustements (« j'enlève le 3, le 2 commence 2 s plus tôt ») (pur). */
export function describeEdits(edits: readonly PlanEdit[]): string {
  const out: string[] = [];
  const removed = edits.filter((e): e is Extract<PlanEdit, { kind: "remove" }> => e.kind === "remove").map((e) => e.index);
  if (removed.length) out.push(removed.length === 1 ? `j'enlève le ${removed[0]}` : `j'enlève les ${removed.slice(0, -1).join(", ")} et ${removed[removed.length - 1]}`);
  for (const e of edits) {
    if (e.kind === "keepBest") out.push(`je garde les ${e.count} meilleurs`);
    if (e.kind === "duration") out.push(e.index === null ? `les shorts font ${e.seconds} s` : `le ${e.index} fait ${e.seconds} s`);
    if (e.kind === "shift") {
      const who = e.index === null ? "tous les shorts" : `le ${e.index}`;
      const bits: string[] = [];
      if (e.startDeltaMs) bits.push(`commence${e.index === null ? "nt" : ""} ${Math.abs(e.startDeltaMs) / 1000} s plus ${e.startDeltaMs < 0 ? "tôt" : "tard"}`);
      if (e.endDeltaMs) bits.push(`fini${e.index === null ? "ssent" : "t"} ${Math.abs(e.endDeltaMs) / 1000} s plus ${e.endDeltaMs < 0 ? "tôt" : "tard"}`);
      out.push(`${who} ${bits.join(" et ")}`);
    }
  }
  return out.join(", ");
}

/** Nombre de shorts après les ajustements (pur). */
export function countAfterEdits(clips: readonly PlanClip[], edits: readonly PlanEdit[]): number {
  let list = [...clips];
  for (const e of edits) {
    if (e.kind === "remove") list = list.filter((c) => c.index !== e.index);
    if (e.kind === "keepBest") list = [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, Math.max(0, e.count));
  }
  return list.length;
}

// ------------------------------------------------------------------------------------------------ Haiku

/** Outil proposé à l'interprète (Haiku) quand les règles ne comprennent pas la réponse au plan. */
export const PLAN_TOOL: AiToolDef = {
  name: "ajuster_plan",
  description: "Ajustements du plan de coupe demandés par le client (liste vide = lancer tel quel)",
  inputSchema: {
    type: "object",
    properties: {
      lancer: { type: "boolean", description: "true si le client accepte de lancer le montage (avec ou sans ajustements)" },
      ajustements: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["retirer", "garder_meilleurs", "decaler", "duree"] },
            numero: { type: "integer", minimum: 1, maximum: 99, description: "Numéro du moment (absent = tous)" },
            nombre: { type: "integer", minimum: 1, maximum: 99, description: "garder_meilleurs : combien" },
            debut_secondes: { type: "number", minimum: -60, maximum: 60, description: "decaler : début (négatif = plus tôt)" },
            fin_secondes: { type: "number", minimum: -60, maximum: 60, description: "decaler : fin (négatif = plus tôt)" },
            secondes: { type: "number", minimum: 5, maximum: 90, description: "duree : durée voulue" },
          },
          required: ["type"],
          additionalProperties: false,
        },
      },
    },
    required: ["lancer", "ajustements"],
    additionalProperties: false,
  },
  strict: false,
};

const PLAN_SYSTEM_PROMPT = [
  "Tu lis la réponse d'un client au plan de coupe d'une vidéo (liste numérotée de moments).",
  "Tu appelles l'outil ajuster_plan avec ce qu'il demande : retirer un moment, garder les N meilleurs, décaler le début ou la fin d'un moment, changer la durée.",
  "Si la réponse ne parle pas du plan, n'appelle aucun outil.",
].join("\n");

/** Sortie de l'outil → ajustements validés par le code (pur) ; null si illisible. */
export function editsFromTool(input: unknown): { launch: boolean; edits: PlanEdit[] } | null {
  if (!input || typeof input !== "object") return null;
  const o = input as { lancer?: unknown; ajustements?: unknown };
  if (!Array.isArray(o.ajustements)) return null;
  const edits: PlanEdit[] = [];
  const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const sec = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  for (const a of o.ajustements as Array<Record<string, unknown>>) {
    if (!a || typeof a !== "object") return null;
    const n = int(a.numero, 1, 99);
    switch (a.type) {
      case "retirer":
        if (n === null) return null;
        edits.push({ kind: "remove", index: n });
        break;
      case "garder_meilleurs": {
        const c = int(a.nombre, 1, 99);
        if (c === null) return null;
        edits.push({ kind: "keepBest", count: c });
        break;
      }
      case "decaler": {
        const s = sec(a.debut_secondes, -60, 60);
        const e = sec(a.fin_secondes, -60, 60);
        if (s === null && e === null) return null;
        edits.push({ kind: "shift", index: n, ...(s ? { startDeltaMs: Math.round(s * 1000) } : {}), ...(e ? { endDeltaMs: Math.round(e * 1000) } : {}) });
        break;
      }
      case "duree": {
        const d = sec(a.secondes, 5, 90);
        if (d === null) return null;
        edits.push({ kind: "duration", index: n, seconds: d });
        break;
      }
      default:
        return null;
    }
  }
  return { launch: o.lancer === true || edits.length > 0, edits };
}

/** Haiku (interprète de Kevin) pour une réponse que les règles ne comprennent pas ; null sans IA ou sans réponse. */
export async function planReplyByAi(deps: KevinMontageDeps, text: string, clips: readonly PlanClip[]): Promise<{ launch: boolean; edits: PlanEdit[] } | null> {
  if (!deps.llm) return null;
  try {
    const plan = clips.map((c) => `${c.index}. ${clockOf(c.startMs)}-${clockOf(c.endMs)} (${c.score ?? "?"}/10)`).join("\n");
    const r = await deps.llm.interpret({ system: PLAN_SYSTEM_PROMPT, user: `Plan :\n${plan}\n\n${BOSS_MESSAGE_MARK}\n${text.slice(0, 500)}`, tools: [PLAN_TOOL] });
    if (!r.toolUse || r.toolUse.name !== PLAN_TOOL.name) return null;
    return editsFromTool(r.toolUse.input);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[montage] réponse au plan non comprise par l'IA");
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ application

type ClipRow = { id: string; index: number; startMs: number; endMs: number; description: string | null; score: number | null; status: string };

export async function planClipsOf(deps: KevinMontageDeps, jobId: string): Promise<PlanClip[]> {
  const rows = (await deps.prisma.shortClip.findMany({ where: { montageJobId: jobId }, orderBy: { index: "asc" } })) as ClipRow[];
  return rows.filter((r) => r.status !== "CANCELLED").map((r) => ({ index: r.index, startMs: r.startMs, endMs: r.endMs, description: r.description, score: r.score, status: r.status }));
}

export type AnswerPlanResult = { handled: boolean; reply: string; launched: boolean };

/**
 * Réponse du client au plan d'un travail : règles, puis Haiku ; ajustements vérifiés (numéros existants, au moins un
 * short) puis `approvePlan` de la chaîne. Rend la réponse de Kevin.
 */
export async function answerPlan(deps: KevinMontageDeps, jobId: string, text: string, opts: { chatId?: string | bigint | null; actor?: ActorRef } = {}): Promise<AnswerPlanResult> {
  const chatId = opts.chatId ?? null;
  const job = (await deps.prisma.montageJob.findUnique({ where: { id: jobId } })) as { id: string; status: string; planApprovedAt: Date | null } | null;
  if (!job || job.planApprovedAt || !["PLAN_SENT", "ANALYZING", "PENDING"].includes(job.status))
    return { handled: true, reply: pick(PLAN_VARIANTS.planGone, "montage.plan.gone", chatId), launched: false };
  const clips = await planClipsOf(deps, jobId);
  let parsed = parsePlanReply(text);
  if (parsed.kind === "unknown") {
    const ai = await planReplyByAi(deps, text, clips);
    if (ai?.launch) parsed = { kind: "approve", edits: ai.edits };
  }
  if (parsed.kind === "unknown") return { handled: true, reply: pick(PLAN_VARIANTS.notUnderstood, "montage.plan.unknown", chatId), launched: false };
  const indexes = new Set(clips.map((c) => c.index));
  for (const e of parsed.edits) {
    if ((e.kind === "remove" || e.kind === "shift" || e.kind === "duration") && e.index !== null && !indexes.has(e.index))
      return { handled: true, reply: pick(PLAN_VARIANTS.noSuchMoment({ index: e.index, count: clips.length }), "montage.plan.nosuch", chatId), launched: false };
  }
  const left = countAfterEdits(clips, parsed.edits);
  if (left === 0) return { handled: true, reply: pick(PLAN_VARIANTS.nothingLeft, "montage.plan.nothing", chatId), launched: false };
  const r = await montagePort(deps).approvePlan(deps, jobId, parsed.edits, opts.actor);
  if (!r.ok) return { handled: true, reply: esc(r.reason), launched: false };
  if (opts.chatId) await clearMontageAwait(deps, opts.chatId, (a) => a.kind === "plan" && a.jobId === jobId);
  const reply = parsed.edits.length
    ? pick(PLAN_VARIANTS.adjusted({ changes: esc(describeEdits(parsed.edits)), count: left }), "montage.plan.adjusted", chatId)
    : pick(PLAN_VARIANTS.launched({ count: r.kept || left }), "montage.plan.launched", chatId);
  return { handled: true, reply, launched: true };
}

/** Instructions → résumé court pour le client (« shorts de 15 s, vertical 9:16, cam en haut à droite, sous-titres ») (pur). */
export function instructionsSummary(i: MontageInstructions): string {
  const pip: Record<string, string> = { TOP_RIGHT: "cam en haut à droite", TOP_LEFT: "cam en haut à gauche", BOTTOM_RIGHT: "cam en bas à droite", BOTTOM_LEFT: "cam en bas à gauche" };
  const parts = [`${i.count ? `${i.count} shorts` : "shorts"} de ${i.durationTarget} s`, formatLabel(i.format)];
  if (pip[i.pipPosition]) parts.push(pip[i.pipPosition]!);
  parts.push(i.subtitles ? "sous-titres" : "sans sous-titres");
  if (i.overlayText) parts.push(`texte « ${i.overlayText} »`);
  if (i.theme) parts.push(`thème ${i.theme}`);
  if (i.speed && i.speed !== 1) parts.push(`vitesse x${String(i.speed).replace(".", ",")}`);
  return parts.join(", ");
}
