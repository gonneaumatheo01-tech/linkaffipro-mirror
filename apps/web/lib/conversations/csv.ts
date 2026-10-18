/**
 * Exports CSV de la rubrique Conversations (séparateur point-virgule, Excel français, `toCsv` de `lib/members/csv`) :
 * la boîte de réception filtrée (une ligne par conversation, AUCUN texte de conversation : seulement qui, où, quand et
 * les chiffres) et les chiffres d'une période (par persona puis par source). Règles pures (testées).
 */
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { statusLabel } from "@/lib/status-badges";
import type { InboxExportRow } from "./inbox";
import {
  assistantNoun,
  botStatusLabel,
  closedReasonLabel,
  personName,
  personaLabel,
  sourceLabel,
} from "./labels";
import type { ConversationStats, FigureRow } from "./stats";

const AUTHOR_LABELS: Record<string, string> = {
  MEMBER: "La personne",
  TEAM: "L'équipe",
  SYSTEM: "Message automatique",
};

/** Auteur du dernier message : « L'assistante » / « L'assistant » selon la persona, comme la colonne « Qui répond ». */
function authorLabel(author: string, gender: string | null): string {
  return author === "ASSISTANT" ? `L'${assistantNoun(gender)}` : (AUTHOR_LABELS[author] ?? "");
}

export const INBOX_CSV_HEADERS = [
  "Personne",
  "Pseudo Telegram",
  "Bot (pseudo)",
  "Persona",
  "Source",
  "Étape",
  "Qui répond",
  "Raison de la fermeture",
  "Langue",
  "Messages de la personne",
  "Liens envoyés",
  "Liens ouverts",
  "Inscription (Paris)",
  "Premier dépôt (Paris)",
  "Coût de l'IA (€)",
  "Commencée le (Paris)",
  "Dernier message le (Paris)",
  "Dernier message de",
  "Sans réponse",
];

/** Contenu du fichier de la boîte de réception. */
export function inboxCsv(rows: readonly InboxExportRow[]): string {
  return toCsv(
    INBOX_CSV_HEADERS,
    rows.map((r) => [
      personName(r.member),
      // Sans « @ » : un texte qui commence par @ serait préfixé d'une apostrophe (protection contre les formules).
      r.member.username && !r.member.anonymizedAt ? r.member.username : "",
      r.botUsername,
      personaLabel(r.personaName),
      sourceLabel(r.source),
      statusLabel("conversationStage", r.stage),
      r.status === "BOT"
        ? botStatusLabel(r.personaGender)
        : statusLabel("conversationStatus", r.status),
      r.status === "CLOSED" ? (closedReasonLabel(r.closedReason) ?? "") : "",
      r.language ?? "",
      r.memberMessages,
      r.linksSent,
      r.linksOpened,
      csvDate(r.registeredAt),
      csvDate(r.ftdAt),
      csvNumber(r.costEur, 4),
      csvDate(r.createdAt),
      csvDate(r.last?.at ?? null),
      r.last ? authorLabel(r.last.author, r.personaGender) : "",
      r.unread ? "oui" : "non",
    ]),
  );
}

export const STATS_CSV_HEADERS = [
  "Regroupement",
  "Nom",
  "Conversations commencées",
  "Réponses",
  "Taux de réponse (%)",
  "Liens envoyés",
  "Liens ouverts",
  "Inscriptions",
  "Premiers dépôts",
  "Coût de l'IA (€)",
  "Coût de l'IA par inscription (€)",
];

function statsLine(group: string, r: FigureRow): unknown[] {
  return [
    group,
    r.label,
    r.conversations,
    r.replies,
    r.replyRate === null ? "" : csvNumber(r.replyRate * 100, 1),
    r.linksSent,
    r.linksOpened,
    r.registrations,
    r.ftds,
    csvNumber(r.costEur, 4),
    r.costPerRegistration === null ? "" : csvNumber(r.costPerRegistration, 2),
  ];
}

/** Contenu du fichier des chiffres : le total, puis une ligne par persona et une ligne par source. */
export function statsCsv(stats: ConversationStats, periodText: string): string {
  return toCsv(STATS_CSV_HEADERS, [
    statsLine(`Total (${periodText})`, stats.total),
    ...stats.byPersona.map((r) => statsLine("Persona", r)),
    ...stats.bySource.map((r) => statsLine("Source", r)),
  ]);
}
