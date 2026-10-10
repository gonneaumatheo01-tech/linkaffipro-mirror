import { AiError } from "./errors";
import { estimateCostEur } from "./models";
import { parseTranslations, parseVersions } from "./parse";
import { buildSystemBlocks, buildUserMessage, maxLengthFor, resolveRiskNotice } from "./prompt";
import type { AiClient, AiRequest, AiResult, AiUsage, AiVersion } from "./types";
import { validateVersion } from "./validate";

const MAX_TOKENS = 4096;

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cachedTokens: a.cachedTokens + b.cachedTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens };
}

/**
 * Produit les versions pour une demande : prompt → appel → parsing strict → validation côté code.
 * Sortie invalide ou aucune version valable : un seul nouvel essai (avec rappel du format), puis erreur lisible.
 */
export async function suggest(req: AiRequest, client: AiClient): Promise<AiResult> {
  if (!req.text.trim()) throw new AiError("unsupported", "Écrivez d'abord un brouillon (ou une idée).");
  const notice = resolveRiskNotice(req.riskNotice);
  const max = maxLengthFor(req.context);
  const system = buildSystemBlocks(req);
  const baseUser = buildUserMessage(req);
  let usage: AiUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
  let lastError: AiError | null = null;
  const rejected: AiResult["rejected"] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const user = attempt === 0 ? baseUser : `${baseUser}\n\nRAPPEL : ta réponse précédente n'était pas exploitable (${lastError?.message ?? "format invalide"}). Réponds uniquement avec le JSON demandé, en conservant tous les repères {…} et tous les liens du brouillon.`;
    const res = await client.createMessage({ model: req.model, maxTokens: MAX_TOKENS, system, user });
    usage = addUsage(usage, res.usage);
    let candidates: AiVersion[];
    try {
      candidates = req.kind === "translate" ? parseTranslations(res.text) : parseVersions(res.text);
    } catch (err) {
      lastError = err instanceof AiError ? err : new AiError("invalid_output", "Réponse inexploitable.");
      continue;
    }
    const kept: AiVersion[] = [];
    for (const v of candidates) {
      const out = validateVersion(v, { source: req.text, context: req.context, notice, max, checkSource: req.kind !== "idea" });
      if (out.ok) kept.push(out.version);
      else rejected.push({ text: v.text, reason: out.reason });
    }
    if (kept.length > 0) return { versions: kept, usage, costEur: estimateCostEur(req.model, usage), model: req.model, rejected };
    lastError = new AiError("no_valid_version", rejected.at(-1)?.reason ?? "aucune version valable");
  }
  throw new AiError(lastError?.code === "invalid_output" ? "invalid_output" : "no_valid_version", `L'IA n'a pas donné de version utilisable (${lastError?.message ?? "format invalide"}). Réessayez ou modifiez le brouillon.`);
}
