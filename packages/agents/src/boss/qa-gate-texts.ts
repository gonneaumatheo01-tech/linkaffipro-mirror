/**
 * Phase 30, chantier B — textes fixes de Kevin autour du QA Global (branchements) : phrases imposées par le prompt
 * (pause du contrôle, réponse retenue), demande au client après 3 refus et ses suites. Contrôlés par `voiceCheck`
 * (`boss/voice.test.ts` lit toutes les tables `*_VARIANTS` de `boss/`).
 */
import type { VoiceTable } from "./voice";

/** Phrase exacte du prompt (règle 1) : le QA est indisponible, rien ne sort. */
export const QA_PAUSED_TEXT = "Le contrôle qualité est en pause, je reprends dès que possible.";
/** Phrase exacte du prompt : réponse de Kevin refusée 3 fois par le QA. */
export const QA_RESPONSE_HELD_TEXT = "Je préfère vérifier avant de te répondre, je reviens vers toi.";

/** Proposition encore sans approbation du QA (jamais montrée comme prête, jamais appliquée). */
export const QA_REC_PENDING_TEXT = "Cette proposition est encore en vérification : je te la montre dès qu'elle est validée.";
/** Proposition refusée par le QA (close avec le motif, jamais appliquée). */
export const QA_REC_REFUSED_TEXT = "Le contrôle qualité a refusé cette proposition : elle ne sera pas appliquée.";
/** Libellé court affiché à la place d'une proposition pas encore approuvée. */
export const QA_REC_PENDING_LABEL = "en vérification";

export const QA_GATE_VARIANTS = {
  paused: [QA_PAUSED_TEXT],
  responseHeld: [QA_RESPONSE_HELD_TEXT],
  /** Demande au client (une à la fois) : `{label}` = « un post sur Casino VIP », `{motif}` = motif court. */
  decisionQuestion: [
    "Le contrôle qualité a refusé 3 fois {label}.\nMotif : {motif}.\nJe le publie quand même avec ton accord, ou je laisse tomber ?",
    "Le contrôle qualité bloque toujours {label}, 3 refus.\nMotif : {motif}.\nTu tranches : je le publie avec ton accord, ou je laisse tomber ?",
  ],
  decisionYes: ["C'est noté : il part avec ton accord.", "D'accord, je le laisse passer avec ton accord."],
  decisionNo: ["D'accord, je laisse tomber.", "Compris, je le retire."],
  shortChecking: ["Je le fais passer au contrôle qualité, je te l'envoie juste après.", "Il passe d'abord au contrôle qualité, je te l'envoie dans la foulée."],
  recPending: [QA_REC_PENDING_TEXT],
  recRejected: [QA_REC_REFUSED_TEXT],
} satisfies VoiceTable;

/** Libellés des boutons de la demande au client. */
export const QA_DECISION_BUTTON_YES = "Publier quand même";
