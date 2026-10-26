/** Phase 30 — codes posés par le moteur du QA lui-même (jamais par le modèle) et modèle « aucun ». */
export const QA_ENGINE_CODES = {
  disabled: "QA_DISABLED",
  unavailable: "QA_MODEL_UNAVAILABLE",
  timeout: "QA_TIMEOUT",
  budget: "QA_BUDGET",
  refusal: "QA_REFUSAL",
  invalidOutput: "QA_INVALID_OUTPUT",
  wrongModel: "QA_WRONG_MODEL",
  context: "QA_CONTEXT",
  tooLong: "QA_TOO_LONG",
} as const;

/** Modèle écrit dans `QaCheck.modelUsed` quand aucun appel n'a été fait (réglage coupé, plafond, clé absente). */
export const QA_NO_MODEL = "aucun";

/** Fable 5.1, sous son nom ou sa version datée (« claude-fable-5-1-AAAAMMJJ ») : aucun autre modèle n'est accepté. */
export function isQaModel(model: string | null | undefined): boolean {
  return typeof model === "string" && /^claude-fable-5-1(?:-\d{8})?$/.test(model);
}
