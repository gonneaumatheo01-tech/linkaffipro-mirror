import { audit, prisma } from "@linkaffipro/db";
import { createTestTurnDeps, estimateCostEur, runTurn } from "@linkaffipro/chat";
import { apiUser } from "@/lib/ai/api-user";
import { loadAssistantApiKey, loadAssistantConfig } from "@/lib/assistant/config";
import { monthCostEur } from "@/lib/assistant/usage";
import { loadPersonaTurnInput } from "@/lib/personas/queries";
import {
  TEST_AUDIT_ACTION,
  TEST_LIMITS,
  TEST_OFFER_BASE_URL,
  buildTestTurnInput,
  testClosed,
  testRequestSchema,
  testResponseFrom,
  testStateFrom,
  type TestRequest,
} from "@/lib/personas/test-turn";
import { TEST_SLOT_WINDOW_MS, testSlotStore } from "@/lib/personas/test-limit";
import { veniceClientFor } from "@/lib/personas/venice-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fail(status: number, error: string, code: string) {
  return Response.json({ error, code }, { status });
}

/**
 * POST /api/assistant/test : bouton « Tester » d'une persona (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6) :
 * { personaId, message, history (40 au plus), state } → réponse de l'assistante (`TestResponse`).
 * Conversation simulée : la persona ENREGISTRÉE, le vrai moteur et le vrai client Venice (clé des réglages), plafond
 * mensuel vérifié avant chaque appel, coût enregistré dans `AiConversationUsage` (motif TEST, sans conversation) ;
 * envoi en mémoire (aucun appel à Telegram), lien d'offre factice (rien n'est créé en base, aucun suivi).
 * 401 non connecté · 400 demande invalide · 404 persona introuvable · 409 conversation d'essai fermée · 428 clé absente
 * · 402 plafond atteint · 429 limite de 30 messages d'essai par heure et par personne.
 * Limite : le journal (`persona.tested`, écrit après chaque essai) est relu d'abord ; puis une place est RÉSERVÉE juste
 * avant l'appel à l'IA (`testSlotStore`, atomique) : des demandes simultanées ne peuvent pas dépasser la limite.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return fail(401, "Non connecté.", "auth");
  let body: TestRequest;
  try {
    body = testRequestSchema.parse(await req.json());
  } catch {
    return fail(400, "Demande invalide : cliquez sur « Recommencer ».", "invalid");
  }
  const message = body.message.trim();
  if (!message) return fail(400, "Écrivez d'abord un message.", "empty");
  const state = testStateFrom(body.state);
  if (testClosed(state))
    return fail(
      409,
      "Cette conversation d'essai est fermée : cliquez sur « Recommencer ».",
      "closed",
    );

  const now = new Date();
  const limitReached = () =>
    fail(
      429,
      `Limite atteinte : ${TEST_LIMITS.perHour} messages d'essai par heure. Réessayez un peu plus tard.`,
      "limit",
    );
  const recent = await prisma.auditLog.count({
    where: {
      userId: user.id,
      action: TEST_AUDIT_ACTION,
      createdAt: { gte: new Date(now.getTime() - TEST_SLOT_WINDOW_MS) },
    },
  });
  if (recent >= TEST_LIMITS.perHour) return limitReached();

  const persona = await loadPersonaTurnInput(body.personaId);
  if (!persona) return fail(404, "Persona introuvable : rechargez la page.", "not_found");

  const config = await loadAssistantConfig();
  const apiKey = await loadAssistantApiKey(config);
  if (!apiKey)
    return fail(
      428,
      "Collez d'abord la clé Venice dans Réglages → IA de conversation (administrateurs).",
      "no_key",
    );
  const spent = await monthCostEur(now);
  if (spent >= config.monthlyCapEur)
    return fail(
      402,
      `Plafond mensuel atteint (${fmt(spent)} € sur ${fmt(config.monthlyCapEur)} €) : un administrateur peut le relever dans Réglages → IA de conversation.`,
      "cap",
    );

  // Place réservée avant l'appel (les essais en cours comptent déjà) : jamais plus de 30 par heure, même en parallèle.
  const slot = await testSlotStore().reserve(
    user.id,
    now.getTime(),
    TEST_LIMITS.perHour,
    TEST_SLOT_WINDOW_MS,
  );
  if (!slot.allowed) return limitReached();

  const personaId = body.personaId;
  const deps = createTestTurnDeps({
    llm: veniceClientFor(apiKey),
    capReached: async () => (await monthCostEur()) >= config.monthlyCapEur,
    recordUsage: async (u) => {
      await prisma.aiConversationUsage.create({
        data: {
          personaId,
          conversationId: null,
          purpose: "TEST",
          model: u.model.slice(0, 200),
          inputTokens: Math.max(0, Math.round(u.inputTokens)),
          outputTokens: Math.max(0, Math.round(u.outputTokens)),
          costEur: u.costEur,
          ok: u.ok,
          error: u.error?.slice(0, 200) ?? null,
          attempt: u.attempt,
          requestId: u.requestId?.slice(0, 200) ?? null,
        },
      });
    },
    costEur: (model, usage, costUsd) => estimateCostEur(model, usage, costUsd, config.models),
    startAt: now,
    offerBaseUrl: TEST_OFFER_BASE_URL,
  });
  const input = buildTestTurnInput({
    persona: persona.input,
    config,
    history: body.history,
    message,
    state,
  });
  let result;
  try {
    result = await runTurn(input, deps);
  } catch (err) {
    console.error("[assistant] essai d'une persona :", err instanceof Error ? err.message : err);
    await audit({
      userId: user.id,
      action: TEST_AUDIT_ACTION,
      entityType: "Persona",
      entityId: personaId,
      metadata: { outcome: "crashed" },
    });
    return fail(502, "L'essai n'a pas pu aboutir : réessayez dans un instant.", "crashed");
  }
  const response = testResponseFrom({
    result,
    state,
    offerButtonText: persona.input.offerButtonText,
    usages: deps.usages,
    // Refus et bandeau accordés à la persona testée (« l'assistant » pour une persona masculine).
    gender: persona.input.gender,
  });
  // Journal de l'équipe (sans aucun texte) : il sert aussi à compter la limite par heure.
  await audit({
    userId: user.id,
    action: TEST_AUDIT_ACTION,
    entityType: "Persona",
    entityId: personaId,
    metadata: {
      outcome: result.outcome,
      model: result.model,
      costEur: response.costEur,
      parts: result.sent.length,
      offer: Boolean(result.offerSent),
      rejected: result.rejected.length,
      stage: result.newStage,
    },
  });
  return Response.json(response);
}
