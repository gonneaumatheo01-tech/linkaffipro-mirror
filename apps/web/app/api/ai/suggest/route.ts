import { z } from "zod";
import { prisma, audit, toJsonValue } from "@linkaffipro/db";
import { AI_KINDS, AI_LANGUAGES, AI_LENGTHS, AI_OBJECTIVES, AI_SURFACES, AI_TONES, AiError, createAnthropicClient, suggest, type AiRequest } from "@linkaffipro/ai";
import { apiUser } from "@/lib/ai/api-user";
import { loadAiApiKey, loadAiConfig, saveAiConfig } from "@/lib/ai/config";
import { loadBestExamples } from "@/lib/ai/examples";
import { monthCostEur, userDailyCount } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum(AI_KINDS as [string, ...string[]]),
  text: z.string().max(8000),
  quality: z.boolean().optional(),
  context: z
    .object({
      vertical: z.enum(["CASINO", "SPORTS", "DATING"]).nullish(),
      categoryId: z.string().max(64).nullish(),
      categoryName: z.string().max(80).nullish(),
      language: z.enum(AI_LANGUAGES as [string, ...string[]]).nullish(),
      objective: z.enum(AI_OBJECTIVES as [string, ...string[]]).nullish(),
      tone: z.enum(AI_TONES as [string, ...string[]]).nullish(),
      length: z.enum(AI_LENGTHS as [string, ...string[]]).nullish(),
      hasMedia: z.boolean().nullish(),
      surface: z.enum(AI_SURFACES as [string, ...string[]]).nullish(),
    })
    .default({}),
});

const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** État de l'assistant pour le bouton (clé présente ? plafond ?). Jamais la clé. */
export async function GET() {
  const user = await apiUser();
  if (!user) return Response.json({ error: "Non connecté." }, { status: 401 });
  const config = await loadAiConfig();
  if (!config.apiKeyEncrypted) return Response.json({ ready: false, reason: "no_key" });
  const spent = await monthCostEur();
  if (spent >= config.monthlyCapEur) return Response.json({ ready: false, reason: "cap", message: `Plafond mensuel atteint (${fmt(spent)} € sur ${fmt(config.monthlyCapEur)} €).` });
  return Response.json({ ready: true, hasQuality: config.qualityModel !== config.defaultModel });
}

/**
 * POST /api/ai/suggest : { kind, text, context, quality? } → { id, versions, model, costEur }.
 * 401 non connecté · 400 corps invalide · 428 clé absente · 402 plafond mensuel · 429 limite par utilisateur ou débit Anthropic · 502 réponse IA inexploitable.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return Response.json({ error: "Non connecté." }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Demande invalide." }, { status: 400 });
  }
  if (!body.text.trim()) return Response.json({ error: "Écrivez d'abord un brouillon (ou une idée)." }, { status: 400 });

  const config = await loadAiConfig();
  const apiKey = await loadAiApiKey(config);
  if (!apiKey) return Response.json({ error: "Clé absente : un administrateur doit coller la clé Anthropic dans Réglages → IA.", code: "no_key" }, { status: 428 });

  const [spent, todayCount] = await Promise.all([monthCostEur(), userDailyCount(user.id)]);
  if (spent >= config.monthlyCapEur)
    return Response.json({ error: `Plafond mensuel atteint (${fmt(spent)} € sur ${fmt(config.monthlyCapEur)} €). Un administrateur peut le relever dans Réglages → IA.`, code: "cap" }, { status: 402 });
  if (todayCount >= config.perUserDailyLimit)
    return Response.json({ error: `Limite atteinte : ${config.perUserDailyLimit} suggestions par jour et par personne. Réessayez demain ou demandez à un administrateur de relever la limite.`, code: "limit" }, { status: 429 });

  const ctx = body.context;
  const examples = body.kind === "translate" ? [] : await loadBestExamples({ vertical: ctx.vertical ?? null, categoryId: ctx.categoryId ?? null, excludeText: body.text });
  const model = body.quality ? config.qualityModel : config.defaultModel;
  const request: AiRequest = {
    kind: body.kind as AiRequest["kind"],
    text: body.text,
    context: {
      vertical: ctx.vertical ?? null,
      categoryName: ctx.categoryName ?? null,
      language: (ctx.language ?? null) as AiRequest["context"]["language"],
      objective: (ctx.objective ?? null) as AiRequest["context"]["objective"],
      tone: (ctx.tone ?? null) as AiRequest["context"]["tone"],
      length: (ctx.length ?? null) as AiRequest["context"]["length"],
      hasMedia: ctx.hasMedia ?? false,
      surface: (ctx.surface ?? null) as AiRequest["context"]["surface"],
    },
    examples,
    riskNotice: config.riskNotice,
    model,
  };

  try {
    const result = await suggest(request, createAnthropicClient(apiKey));
    const row = await prisma.aiSuggestion.create({
      data: {
        userId: user.id,
        kind: body.kind,
        context: toJsonValue({ ...request.context, categoryId: ctx.categoryId ?? null, examplesCount: examples.length, quality: Boolean(body.quality) }),
        input: body.text,
        outputs: toJsonValue(result.versions),
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        costEur: result.costEur,
      },
      select: { id: true },
    });
    await audit({ userId: user.id, action: "ai.suggestion_created", entityType: "AiSuggestion", entityId: row.id, metadata: { kind: body.kind, model: result.model, costEur: result.costEur, surface: ctx.surface ?? null, vertical: ctx.vertical ?? null, rejected: result.rejected.length } });
    return Response.json({ id: row.id, versions: result.versions, model: result.model, costEur: result.costEur });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("api", "Erreur inattendue de l'assistant.");
    if (e.code === "auth") await saveAiConfig({ lastError: e.message }).catch(() => undefined);
    await audit({ userId: user.id, action: "ai.suggestion_failed", metadata: { kind: body.kind, model, code: e.code } });
    const status = e.code === "rate_limit" ? 429 : e.code === "network" ? 503 : e.code === "unsupported" ? 400 : 502;
    return Response.json({ error: e.message, code: e.code }, { status });
  }
}
