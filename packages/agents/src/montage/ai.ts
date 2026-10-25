/**
 * Phase 28, chantier C : socle commun des appels d'IA de l'équipe Montage (instructions, plan de coupe, vérification
 * des sous-titres, lisibilité). Rien ici ne touche au réseau directement : l'IA (`LlmProvider`), la transcription et la
 * lecture des fichiers sont injectées (fausses en test).
 *
 * Règles :
 * - Modèle choisi par la tâche (tableau « Modèles IA par agent » du prompt) : Opus 5.5 (`PLANNER_MODEL`) pour la vision
 *   et la vérification, Haiku 5.5 pour lever une ambiguïté des instructions. Jamais de repli d'un appel Opus vers Haiku :
 *   un échec d'Opus remonte en `MontageAiError` (« mieux vaut échouer et signaler »).
 * - Plafond mensuel de l'équipe (`MONTAGE_SETTINGS.monthlyBudgetCents`, `Setting` `montage.monthly_budget_cents`) vérifié
 *   AVANT chaque appel payant ; la dépense est comptée ensuite dans `AgentUsage` (équipe `montage`, poste `llm`).
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { extractJson } from "@linkaffipro/ai";
import { parisMonth } from "../rules/time";
import type { AgentsDeps, LlmImage, LlmProvider, LlmRequest } from "../types";
import { MONTAGE_SETTINGS, MONTAGE_TEAM_KEY } from "./contract";

export type MontageAiErrorCode = "no_ai" | "budget" | "ai_failed" | "invalid_output" | "no_stt" | "stt_failed" | "input";

/** Erreur claire de l'IA du montage (message en français courant, jamais de clé ni de texte du client). */
export class MontageAiError extends Error {
  readonly code: MontageAiErrorCode;
  constructor(code: MontageAiErrorCode, message: string) {
    super(message);
    this.name = "MontageAiError";
    this.code = code;
  }
}

/** Réponse brute d'une transcription (forme commune aux formats de Venice / Whisper, voir `subtitles.ts`). */
export type SttRequest = {
  audio: Uint8Array;
  fileName: string;
  mimeType: string;
  language: string | null;
  /** Biais de vocabulaire (null : aucun, pour la deuxième transcription indépendante). */
  prompt: string | null;
  temperature: number;
};
export type SttClient = { transcribe(req: SttRequest): Promise<unknown> };

/** Dépendances de l'IA du montage. */
export type MontageAiDeps = AgentsDeps & {
  /**
   * IA (Anthropic) du montage. Ordre : `montageLlm`, puis `llm` s'il a la forme d'un `LlmProvider` (`complete`), puis
   * `providers.llm` s'il n'est pas un faux fournisseur. `llm` est typé `unknown` parce que `BossDeps.llm` (interprète
   * de Kevin, autre forme) passe aussi par ici : il est alors ignoré.
   */
  montageLlm?: LlmProvider | null;
  llm?: unknown;
  providers?: { llm?: LlmProvider | null };
  /** Transcription (Venice). Absente : `createVeniceStt` avec la clé `assistant.venice` (voir `subtitles.ts`). */
  stt?: SttClient | null;
  /** Lecture d'un fichier (images extraites, son) ; tests : fichiers en mémoire. */
  readFile?: (path: string) => Promise<Uint8Array>;
  /** Plafond imposé (centimes) ; sinon `Setting` puis valeur du contrat. */
  monthlyBudgetCents?: number;
};

export const nowOf = (deps: Pick<AgentsDeps, "now">): Date => (deps.now ? deps.now() : new Date());

export function llmOfMontage(deps: MontageAiDeps): LlmProvider | null {
  if (deps.montageLlm !== undefined) return deps.montageLlm;
  const direct = deps.llm as Partial<LlmProvider> | null | undefined;
  if (direct === null) return null;
  if (direct && typeof direct.complete === "function") return direct as LlmProvider;
  const ctx = deps.providers?.llm as (LlmProvider & { fake?: boolean }) | null | undefined;
  return ctx && !ctx.fake ? ctx : null;
}

export async function readBytes(deps: MontageAiDeps, path: string): Promise<Uint8Array> {
  if (deps.readFile) return deps.readFile(path);
  return new Uint8Array(await readFile(path));
}

const IMAGE_TYPES: Record<string, LlmImage["mediaType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Image extraite (JPEG par défaut) → image jointe à la demande d'IA. */
export async function loadImage(deps: MontageAiDeps, path: string): Promise<LlmImage> {
  const mediaType = IMAGE_TYPES[extname(path).toLowerCase()] ?? "image/jpeg";
  const bytes = await readBytes(deps, path);
  if (!bytes.length) throw new MontageAiError("input", `Image vide : ${path.split("/").pop()}.`);
  return { mediaType, base64: Buffer.from(bytes).toString("base64") };
}

/** Plafond mensuel de l'équipe (centimes). */
export async function montageBudgetCap(deps: MontageAiDeps): Promise<number> {
  if (typeof deps.monthlyBudgetCents === "number") return deps.monthlyBudgetCents;
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key: MONTAGE_SETTINGS.monthlyBudgetCents.key } });
    const v = row?.value;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  } catch {
    /* réglage illisible : valeur du contrat */
  }
  return MONTAGE_SETTINGS.monthlyBudgetCents.value;
}

/** Dépense du mois (centimes, tous postes de l'équipe montage). */
export async function montageMonthSpent(deps: MontageAiDeps): Promise<number> {
  const rows = await deps.prisma.agentUsage.findMany({ where: { teamKey: MONTAGE_TEAM_KEY, month: parisMonth(nowOf(deps)) } });
  return rows.reduce((s, r) => s + r.cents, 0);
}

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Refuse l'appel si le plafond est atteint (avant tout appel payant). */
export async function assertMontageBudget(deps: MontageAiDeps): Promise<void> {
  const [cap, spent] = await Promise.all([montageBudgetCap(deps), montageMonthSpent(deps)]);
  if (spent >= cap)
    throw new MontageAiError(
      "budget",
      `Plafond mensuel de l'IA du montage atteint (${eur(spent)} pour ${eur(cap)}) : rien n'est envoyé à l'IA jusqu'au mois prochain ou à une hausse du plafond.`,
    );
}

export async function recordMontageUsage(deps: MontageAiDeps, cents: number): Promise<void> {
  const month = parisMonth(nowOf(deps));
  const add = Math.max(0, Math.round(cents));
  try {
    await deps.prisma.agentUsage.upsert({
      where: { teamKey_provider_month: { teamKey: MONTAGE_TEAM_KEY, provider: "llm", month } },
      create: { teamKey: MONTAGE_TEAM_KEY, provider: "llm", month, cents: add, calls: 1 },
      update: { cents: { increment: add }, calls: { increment: 1 } },
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[montage] dépense de l'IA non comptée");
  }
}

/**
 * Un appel d'IA compté : plafond vérifié avant, dépense comptée après, échec → `MontageAiError("ai_failed")` sans
 * aucun autre essai sur un autre modèle.
 */
export async function callMontageLlm(deps: MontageAiDeps, req: LlmRequest, what: string): Promise<string> {
  const llm = llmOfMontage(deps);
  if (!llm) throw new MontageAiError("no_ai", `IA indisponible pour ${what} (clé Anthropic absente dans Réglages → IA).`);
  await assertMontageBudget(deps);
  let res;
  try {
    res = await llm.complete(req);
  } catch (err) {
    throw new MontageAiError("ai_failed", `L'IA n'a pas répondu pour ${what} : ${(err as Error).message.slice(0, 160)}`);
  }
  if (res.costCents > 0) await recordMontageUsage(deps, res.costCents);
  return res.text;
}

/** JSON de la réponse, ou erreur claire. */
export function parseAiJson(text: string, what: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    throw new MontageAiError("invalid_output", `Réponse de l'IA illisible pour ${what} (pas de JSON).`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new MontageAiError("invalid_output", `Réponse de l'IA illisible pour ${what}.`);
  return data as Record<string, unknown>;
}

/** Texte court sans balises ni caractères de contrôle. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** m:ss (ou h:mm:ss) pour les prompts et les messages. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
