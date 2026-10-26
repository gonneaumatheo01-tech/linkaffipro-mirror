/**
 * Phase 30 — agent QA Global : le dernier verrou avant toute sortie (contrat `qa/contract.ts`).
 *
 * `qaCheck` : réglage `qa.enabled` (coupé = ERROR, sortie BLOQUÉE ; c'est le réglage qui l'est, jamais un
 * contournement) → masquage → contexte croisé et contrôles du code → plafond du QA → appel(s) à Fable 5.1 dans le délai
 * (`qa.timeout_ms`), en sous-vérifications PARALLÈLES au-delà de 40 000 caractères → sortie JSON validée → règle
 * « un critical = REJECTED » appliquée par le code → `QaCheck` écrit, dépense comptée (`AgentUsage` équipe `qa`).
 *
 * Jamais d'approbation par défaut : modèle absent, en panne, refus du modèle (`stop_reason = "refusal"`), autre modèle
 * que Fable 5.1, JSON illisible, plafond atteint → ERROR ; délai dépassé → TIMEOUT. Le QA ne modifie jamais le contenu
 * reçu (il travaille sur une copie masquée).
 */
import { createQaClient, extractJson, isQaModelUnavailable } from "@linkaffipro/ai";
import { readAiApiKey } from "../providers/llm";
import { parisMonth } from "../rules/time";
import {
  QA_LIMITS,
  QA_MODEL,
  QA_SETTINGS,
  QA_TEAM_KEY,
  type QaContent,
  type QaContentType,
  type QaContext,
  type QaCorrection,
  type QaDeps,
  type QaLlm,
  type QaReason,
  type QaResult,
  type QaVerdict,
} from "./contract";
import { isQaModel, QA_ENGINE_CODES, QA_NO_MODEL } from "./codes";
import { loadQaContext } from "./qa-cross-check";
import { buildQaUserMessage, QA_SYSTEM_PROMPT } from "./qa-system-prompt";
import { canonicalJson, contentHash, redactDetailed, redactText, type RedactionKind } from "./redact";

export { QA_ENGINE_CODES, QA_NO_MODEL };

const nowOf = (deps: QaDeps) => (deps.now ? deps.now() : new Date());

export type QaRequest = {
  contentType: QaContentType;
  contentId: string;
  teamKey: string;
  content: QaContent;
  context?: QaContext;
  effort?: "low" | "medium" | "high";
};

// ————— Réglages —————

function settingValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)) return (v as Record<string, unknown>).value;
  return v;
}

async function readSetting<T extends number | boolean>(deps: QaDeps, key: string, fallback: T): Promise<T> {
  try {
    const row = await deps.prisma.setting.findUnique({ where: { key } });
    const v = settingValue(row?.value);
    if (typeof fallback === "boolean") {
      if (typeof v === "boolean") return v as T;
      if (v === "false" || v === 0) return false as T;
      if (v === "true" || v === 1) return true as T;
      return fallback;
    }
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return (Number.isFinite(n) ? n : fallback) as T;
  } catch {
    return fallback;
  }
}

export type QaSettingsState = { enabled: boolean; timeoutMs: number; maxAttempts: number; monthlyBudgetCents: number; model: typeof QA_MODEL };

/**
 * Réglages du QA. `qa.model` est lu pour l'affichage seulement : le moteur n'utilise JAMAIS un autre modèle que
 * `claude-fable-5-1`, quelle que soit la valeur écrite.
 */
export async function readQaSettings(deps: QaDeps): Promise<QaSettingsState> {
  const [enabled, timeoutMs, maxAttempts, budget] = await Promise.all([
    readSetting(deps, QA_SETTINGS.enabled.key, QA_SETTINGS.enabled.value as boolean),
    readSetting(deps, QA_SETTINGS.timeoutMs.key, QA_SETTINGS.timeoutMs.value as number),
    readSetting(deps, QA_SETTINGS.maxAttempts.key, QA_SETTINGS.maxAttempts.value as number),
    readSetting(deps, QA_SETTINGS.monthlyBudgetCents.key, QA_SETTINGS.monthlyBudgetCents.value as number),
  ]);
  return {
    enabled,
    timeoutMs: Math.min(120_000, Math.max(1000, Math.round(timeoutMs))),
    maxAttempts: Math.min(10, Math.max(1, Math.round(maxAttempts))),
    monthlyBudgetCents: Math.max(0, Math.round(budget)),
    model: QA_MODEL,
  };
}

// ————— Dépense —————

export async function qaMonthSpent(deps: QaDeps, at: Date = nowOf(deps)): Promise<number> {
  const rows = await deps.prisma.agentUsage.findMany({ where: { teamKey: QA_TEAM_KEY, month: parisMonth(at) } });
  return rows.reduce((s, r) => s + r.cents, 0);
}

export async function recordQaUsage(deps: QaDeps, cents: number, calls: number): Promise<void> {
  if (calls <= 0 && cents <= 0) return;
  const month = parisMonth(nowOf(deps));
  const add = Math.max(0, Math.round(cents));
  try {
    await deps.prisma.agentUsage.upsert({
      where: { teamKey_provider_month: { teamKey: QA_TEAM_KEY, provider: "llm", month } },
      create: { teamKey: QA_TEAM_KEY, provider: "llm", month, cents: add, calls },
      update: { cents: { increment: add }, calls: { increment: calls } },
    });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[qa] dépense non comptée");
  }
}

// ————— IA du QA —————

/** IA du QA : `deps.qaLlm` si fourni (null = absente), sinon client réel avec la clé de Réglages → IA. */
export async function qaLlmOf(deps: QaDeps): Promise<QaLlm | null> {
  if (deps.qaLlm !== undefined) return deps.qaLlm;
  const key = await readAiApiKey(deps.prisma).catch(() => null);
  return key ? createQaClient({ apiKey: key }) : null;
}

// ————— Sortie du modèle —————

export type ParsedQaOutput = { verdict: "APPROVED" | "REJECTED"; reasons: QaReason[]; corrections: QaCorrection[] };

const oneLine = (v: unknown, max: number): string =>
  typeof v === "string"
    ? redactText(
        v
          // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ).text.slice(0, max)
    : "";

/** Valide la sortie JSON du modèle ; null si elle est illisible (→ ERROR, jamais APPROVED). */
export function parseQaOutput(text: string): ParsedQaOutput | null {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const verdict = typeof d.verdict === "string" ? d.verdict.trim().toUpperCase() : "";
  if (verdict !== "APPROVED" && verdict !== "REJECTED") return null;
  const rawReasons = d.reasons ?? [];
  if (!Array.isArray(rawReasons)) return null;
  const reasons: QaReason[] = [];
  for (const r of rawReasons) {
    if (!r || typeof r !== "object") return null;
    const x = r as Record<string, unknown>;
    const severity = typeof x.severity === "string" ? x.severity.trim().toLowerCase() : "";
    if (severity !== "critical" && severity !== "warning") return null;
    const code = (typeof x.code === "string" ? x.code : "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40);
    const message = oneLine(x.message, 400);
    if (!code || !message) return null;
    reasons.push({ code, message, severity });
  }
  const rawCorr = d.corrections ?? [];
  if (!Array.isArray(rawCorr)) return null;
  const corrections: QaCorrection[] = rawCorr
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c))
    .slice(0, 20)
    .map((c) => ({ field: oneLine(c.field, 80), expected: oneLine(c.expected, 300), got: oneLine(c.got, 300), suggestion: oneLine(c.suggestion, 400) }))
    .filter((c) => c.field || c.suggestion || c.expected);
  return { verdict: verdict as "APPROVED" | "REJECTED", reasons: reasons.slice(0, 20), corrections };
}

// ————— Découpage —————

const PART_KEY = "_partie";

/**
 * Contenu masqué → parties de `maxChars` caractères JSON au plus : les champs courts sont répétés dans chaque partie,
 * chaque champ long (texte, liste, objet) est coupé. Contenu court : une seule partie (le contenu tel quel).
 */
export function splitQaContent(content: QaContent, maxChars: number = QA_LIMITS.maxContentChars): QaContent[] {
  if (canonicalJson(content).length <= maxChars) return [content];
  const small: QaContent = {};
  const large: Array<[string, unknown]> = [];
  const smallLimit = Math.floor(maxChars / 20);
  for (const [k, v] of Object.entries(content)) {
    if (JSON.stringify(v ?? null).length <= smallLimit) small[k] = v;
    else large.push([k, v]);
  }
  const budget = Math.max(1000, maxChars - JSON.stringify(small).length - 200);
  const parts: QaContent[] = [];
  for (const [k, v] of large) {
    for (const piece of chunkValue(v, budget)) parts.push({ ...small, [k]: piece });
  }
  if (!parts.length) parts.push(small);
  return parts.map((p, i) => ({ ...p, [PART_KEY]: `${i + 1}/${parts.length}` }));
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

function chunkValue(v: unknown, budget: number): unknown[] {
  if (typeof v === "string") return chunkString(v, Math.floor(budget * 0.9));
  if (Array.isArray(v)) {
    const out: unknown[][] = [];
    let cur: unknown[] = [];
    let size = 2;
    for (const x of v) {
      const len = JSON.stringify(x ?? null).length + 1;
      if (len > budget) {
        if (cur.length) out.push(cur);
        cur = [];
        size = 2;
        for (const piece of chunkValue(typeof x === "string" ? x : JSON.stringify(x), budget)) out.push([piece]);
        continue;
      }
      if (size + len > budget && cur.length) {
        out.push(cur);
        cur = [];
        size = 2;
      }
      cur.push(x);
      size += len;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  if (v && typeof v === "object") {
    const out: Array<Record<string, unknown>> = [];
    let cur: Record<string, unknown> = {};
    let size = 2;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const len = JSON.stringify(x ?? null).length + k.length + 4;
      if (len > budget) {
        if (Object.keys(cur).length) out.push(cur);
        cur = {};
        size = 2;
        for (const piece of chunkValue(x, budget)) out.push({ [k]: piece });
        continue;
      }
      if (size + len > budget && Object.keys(cur).length) {
        out.push(cur);
        cur = {};
        size = 2;
      }
      cur[k] = x;
      size += len;
    }
    if (Object.keys(cur).length) out.push(cur);
    return out;
  }
  return [v];
}

// ————— Un appel —————

type PartOutcome =
  | { kind: "ok"; parsed: ParsedQaOutput; costCents: number; model: string }
  | { kind: "timeout"; costCents: number }
  | { kind: "error"; reason: QaReason; costCents: number; model: string | null };

const TIMEOUT = Symbol("timeout");

async function checkPart(llm: QaLlm, req: { system: string; user: string; effort: "low" | "medium" | "high" }, deadline: number): Promise<PartOutcome> {
  const ctrl = new AbortController();
  const left = Math.max(0, deadline - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(TIMEOUT);
    }, left);
  });
  try {
    const res = await Promise.race([llm.check({ ...req, maxTokens: QA_LIMITS.maxTokens, signal: ctrl.signal }), timeout]);
    if (res === TIMEOUT) return { kind: "timeout", costCents: 0 };
    const cost = Math.max(0, Math.round(res.costCents || 0));
    if (!isQaModel(res.model))
      return { kind: "error", costCents: cost, model: res.model, reason: { code: QA_ENGINE_CODES.wrongModel, message: `Réponse d'un autre modèle que ${QA_MODEL} : refusée (aucun repli).`, severity: "critical" } };
    if (res.stopReason === "refusal")
      return { kind: "error", costCents: cost, model: res.model, reason: { code: QA_ENGINE_CODES.refusal, message: "Le modèle a bloqué sa propre réponse (filtre de sécurité) : sortie bloquée.", severity: "critical" } };
    const parsed = parseQaOutput(res.text);
    if (!parsed)
      return { kind: "error", costCents: cost, model: res.model, reason: { code: QA_ENGINE_CODES.invalidOutput, message: "Réponse du contrôle qualité illisible : sortie bloquée.", severity: "critical" } };
    return { kind: "ok", parsed, costCents: cost, model: res.model };
  } catch (err) {
    if (ctrl.signal.aborted) return { kind: "timeout", costCents: 0 };
    const msg = isQaModelUnavailable(err) ? (err as Error).message : `Le contrôle qualité n'a pas répondu : ${redactText(String((err as Error)?.message ?? err)).text.slice(0, 160)}`;
    return { kind: "error", costCents: 0, model: null, reason: { code: QA_ENGINE_CODES.unavailable, message: msg, severity: "critical" } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ————— Verdict —————

const RANK: Record<QaVerdict, number> = { APPROVED: 0, TIMEOUT: 1, ERROR: 2, REJECTED: 3 };

/** Verdict le plus sévère (REJECTED > ERROR > TIMEOUT > APPROVED). */
export function worstVerdict(list: readonly QaVerdict[]): QaVerdict {
  return list.reduce<QaVerdict>((w, v) => (RANK[v] > RANK[w] ? v : w), "APPROVED");
}

/**
 * Verdict d'une sortie du modèle, décidé par le CODE : un critical → REJECTED ; warnings seuls → APPROVED avec les
 * remarques ; « REJECTED » sans aucun critical = réponse incohérente → ERROR (jamais une approbation par défaut).
 */
export function verdictOf(parsed: ParsedQaOutput): { verdict: QaVerdict; extra: QaReason | null } {
  if (parsed.reasons.some((r) => r.severity === "critical")) return { verdict: "REJECTED", extra: null };
  if (parsed.verdict === "REJECTED")
    return { verdict: "ERROR", extra: { code: QA_ENGINE_CODES.invalidOutput, message: "Refus sans motif bloquant : réponse incohérente, sortie bloquée.", severity: "critical" } };
  return { verdict: "APPROVED", extra: null };
}

function dedupeReasons(list: QaReason[]): QaReason[] {
  const seen = new Set<string>();
  const out: QaReason[] = [];
  for (const r of list) {
    const k = `${r.code}|${r.severity}|${r.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

const SENSITIVE_LABELS: Record<RedactionKind, string> = {
  telegram_token: "jeton de bot Telegram",
  api_key: "clé d'API",
  bearer: "jeton d'accès",
  jwt: "jeton d'accès",
  password: "mot de passe ou secret",
  email: "adresse e-mail",
  phone: "numéro de téléphone",
  iban: "IBAN",
  card: "numéro de carte",
  url_secret: "secret dans une adresse",
  internal_id: "identifiant interne",
};

/** Contenu gardé : copie masquée, tronquée à 8 000 caractères. */
function storedContent(redacted: QaContent): Record<string, unknown> {
  const json = canonicalJson(redacted);
  if (json.length <= QA_LIMITS.storedContentChars) return JSON.parse(json) as Record<string, unknown>;
  return { tronque: true, longueur: json.length, apercu: json.slice(0, QA_LIMITS.storedContentChars) };
}

// ————— Point d'entrée —————

/** Nombre de refus déjà reçus par ce contenu (toutes versions). */
export async function qaRefusalCount(deps: QaDeps, contentType: QaContentType, contentId: string): Promise<number> {
  return deps.prisma.qaCheck.count({ where: { contentType, contentId, verdict: "REJECTED" } });
}

/** Vérifie un contenu avant sa sortie. Ne modifie jamais `req.content`. */
export async function qaCheck(deps: QaDeps, req: QaRequest): Promise<QaResult> {
  const started = Date.now();
  const hash = contentHash(req.content);
  const settings = await readQaSettings(deps);
  const previous = await deps.prisma.qaCheck.count({ where: { contentType: req.contentType, contentId: req.contentId } });
  const attempt = previous + 1;
  const { value: redacted, found } = redactDetailed(req.content);
  const effort = req.effort ?? (req.contentType === "REPORT" ? "medium" : QA_LIMITS.effort);

  let verdict: QaVerdict = "APPROVED";
  let reasons: QaReason[] = [];
  let corrections: QaCorrection[] = [];
  let modelUsed: string = QA_NO_MODEL;
  let costCents = 0;
  let calls = 0;

  const finish = async (): Promise<QaResult> => {
    const durationMs = Math.max(0, Date.now() - started);
    reasons = dedupeReasons(reasons);
    if (verdict === "APPROVED") corrections = [];
    const row = await deps.prisma.qaCheck.create({
      data: {
        contentType: req.contentType,
        contentId: req.contentId,
        teamKey: req.teamKey,
        contentHash: hash,
        verdict,
        reasons: reasons as never,
        corrections: (corrections.length ? corrections : null) as never,
        content: storedContent(redacted) as never,
        modelUsed,
        durationMs,
        attempt,
        checkedBy: "qa-global",
        costCents,
      },
    });
    await recordQaUsage(deps, costCents, calls);
    let needsHuman = false;
    if (verdict === "REJECTED") {
      const refusals = await qaRefusalCount(deps, req.contentType, req.contentId);
      needsHuman = refusals >= settings.maxAttempts;
    }
    deps.logger?.info(
      { qaCheckId: row.id, contentType: req.contentType, teamKey: req.teamKey, verdict, codes: reasons.map((r) => r.code), durationMs, attempt },
      "[qa] vérification",
    );
    return { checkId: row.id, verdict, reasons, corrections, durationMs, attempt, approved: verdict === "APPROVED", needsHuman };
  };

  // 1. Réglage coupé : rien ne sort (jamais approuvé).
  if (!settings.enabled) {
    verdict = "ERROR";
    reasons = [{ code: QA_ENGINE_CODES.disabled, message: "Contrôle qualité coupé dans les réglages : sortie bloquée.", severity: "critical" }];
    return finish();
  }

  // 2. Contexte croisé et contrôles du code.
  const cross = await loadQaContext(deps, { contentType: req.contentType, contentId: req.contentId, teamKey: req.teamKey, content: req.content, ...(req.context ? { context: req.context } : {}) });
  const codeFindings: QaReason[] = [...cross.findings];
  if (found.length)
    codeFindings.push({
      code: "SENSITIVE_DATA",
      message: `Donnée sensible dans le contenu : ${[...new Set(found.map((k) => SENSITIVE_LABELS[k]))].join(", ")} (contrôle du code, masquée ici).`,
      severity: "critical",
    });
  const codeCritical = codeFindings.some((r) => r.severity === "critical");
  if (!cross.copyChecked) {
    verdict = "ERROR";
    reasons = [...codeFindings, { code: QA_ENGINE_CODES.context, message: "Contrôle de copie impossible (lecture des sources de référence) : sortie bloquée.", severity: "critical" }];
    return finish();
  }

  // 3. IA du QA et plafond, vérifiés avant tout appel.
  const llm = await qaLlmOf(deps);
  if (!llm) {
    verdict = codeCritical ? "REJECTED" : "ERROR";
    reasons = [...codeFindings, { code: QA_ENGINE_CODES.unavailable, message: `IA du contrôle qualité absente (clé Anthropic dans Réglages → IA) : ${QA_MODEL} indisponible.`, severity: "critical" }];
    return finish();
  }
  const spent = await qaMonthSpent(deps);
  if (spent >= settings.monthlyBudgetCents) {
    verdict = codeCritical ? "REJECTED" : "ERROR";
    reasons = [...codeFindings, { code: QA_ENGINE_CODES.budget, message: "Plafond mensuel du contrôle qualité atteint : sorties bloquées jusqu'au mois prochain ou à une hausse du plafond.", severity: "critical" }];
    return finish();
  }

  // 4. Sous-vérifications parallèles, toutes dans le même délai.
  const hints = [...cross.hints];
  if (cross.errors.length) {
    hints.push("Une partie du contexte n'a pas pu être chargée : sois d'autant plus prudent.");
    deps.logger?.warn({ contentType: req.contentType, errors: cross.errors.length }, "[qa] contexte incomplet");
  }
  const context = redactDetailed(cross.context).value;
  const parts = splitQaContent(redacted);
  const deadline = Date.now() + settings.timeoutMs;
  const outcomes = await Promise.all(
    parts.map((part, i) =>
      checkPart(
        llm,
        {
          system: QA_SYSTEM_PROMPT,
          user: buildQaUserMessage({
            contentType: req.contentType,
            teamKey: req.teamKey,
            content: part,
            context,
            codeFindings,
            codeHints: hints,
            part: parts.length > 1 ? { index: i + 1, total: parts.length } : null,
          }),
          effort: parts.length > 1 && effort === "low" ? "medium" : effort,
        },
        deadline,
      ),
    ),
  );
  calls = outcomes.length;

  const verdicts: QaVerdict[] = [];
  const all: QaReason[] = [...codeFindings];
  for (const o of outcomes) {
    costCents += o.costCents;
    if (o.kind === "ok") {
      modelUsed = o.model;
      const v = verdictOf(o.parsed);
      verdicts.push(v.verdict);
      all.push(...o.parsed.reasons);
      if (v.extra) all.push(v.extra);
      corrections.push(...o.parsed.corrections);
    } else if (o.kind === "timeout") {
      if (modelUsed === QA_NO_MODEL) modelUsed = QA_MODEL;
      verdicts.push("TIMEOUT");
      all.push({ code: QA_ENGINE_CODES.timeout, message: `Vérification plus longue que ${Math.round(settings.timeoutMs / 1000)} s : sortie bloquée.`, severity: "critical" });
    } else {
      if (o.model) modelUsed = o.model;
      else if (modelUsed === QA_NO_MODEL) modelUsed = QA_MODEL;
      verdicts.push("ERROR");
      all.push(o.reason);
    }
  }
  if (codeCritical) verdicts.push("REJECTED");
  verdict = worstVerdict(verdicts);
  reasons = all;
  corrections = corrections.slice(0, 20);
  return finish();
}

// ————— Approbations —————

/** Dernière approbation pour ce contenu exact (empreinte), sauf si un refus plus récent la remplace. */
export async function findApproval(deps: QaDeps, contentType: QaContentType, contentId: string, content: QaContent): Promise<{ checkId: string } | null> {
  const hash = contentHash(content);
  const last = await deps.prisma.qaCheck.findFirst({
    where: { contentType, contentId, contentHash: hash, verdict: { in: ["APPROVED", "REJECTED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, verdict: true },
  });
  return last && last.verdict === "APPROVED" ? { checkId: last.id } : null;
}

/** Approbation existante pour l'empreinte actuelle, sinon vérification maintenant. N'envoyer que si `approved`. */
export async function requireApproval(
  deps: QaDeps,
  req: { contentType: QaContentType; contentId: string; teamKey: string; content: QaContent; context?: QaContext },
): Promise<QaResult> {
  const found = await findApproval(deps, req.contentType, req.contentId, req.content);
  if (found) {
    const row = await deps.prisma.qaCheck.findUnique({ where: { id: found.checkId }, select: { id: true, reasons: true, durationMs: true, attempt: true } });
    if (row)
      return {
        checkId: row.id,
        verdict: "APPROVED",
        reasons: Array.isArray(row.reasons) ? (row.reasons as unknown as QaReason[]) : [],
        corrections: [],
        durationMs: row.durationMs,
        attempt: row.attempt,
        approved: true,
        needsHuman: false,
      };
  }
  return qaCheck(deps, req);
}
