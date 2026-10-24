// Passage à un humain (Casino / Paris sportifs, phase 25) : motifs repérés par le code dans les messages de la
// personne, en 6 langues, AVANT tout appel au modèle (demande d'argent, réclamation, insulte ; l'âge déclaré est
// cherché par `detectMinorIn`). La sortie du modèle (`handoff`) complète ces règles pour la question hors fiche.
import type { NeedsHumanReason } from "@linkaffipro/core";
import { wordsForm } from "./text-utils";

/** Demande d'argent : remboursement, prêt, avance, retrait bloqué ou pas reçu. */
const MONEY_PATTERNS: readonly string[] = [
  // français (« prêt » seul n'est pas retenu : « t'es prêt ? »)
  "rembours\\w*",
  "un pret",
  "faire un pret",
  "me preter",
  "prete moi",
  "pretez moi",
  "une avance",
  "fais moi un virement",
  "envoie moi (?:de l argent|des sous|de la thune|des thunes)",
  "j ai besoin d argent",
  "besoin de (?:sous|thunes?|fric)",
  "mon retrait",
  "mes retraits",
  "retrait (?:bloque|en attente|refuse|annule)",
  "pas recu mon (?:argent|retrait|virement|paiement)",
  "(?:recuperer|rendre|rendez|rends) (?:moi )?mon argent",
  "gains? bloques?",
  // anglais
  "refund\\w*",
  "lend me",
  "a loan",
  "borrow money",
  "send me money",
  "need money",
  "my withdrawal",
  "withdrawal (?:is )?(?:blocked|stuck|pending|denied|refused)",
  "(?:get|give me) my money back",
  "chargeback",
  // espagnol
  "reembols\\w*",
  "devolucion",
  "prestame",
  "un prestamo",
  "mi retiro",
  "retiro (?:bloqueado|pendiente|rechazado)",
  "mandame dinero",
  "necesito dinero",
  "devuelve(?:me)? mi dinero",
  // portugais
  "estorno",
  "me empresta",
  "um emprestimo",
  "meu saque",
  "saque (?:bloqueado|pendente|recusado)",
  "manda(?:r)? dinheiro",
  "preciso de dinheiro",
  "devolve(?:r)? (?:o )?meu dinheiro",
  // allemand
  "erstattung",
  "ruckerstattung",
  "geld zuruck",
  "leih mir",
  "ein darlehen",
  "einen kredit",
  "meine auszahlung",
  "auszahlung (?:blockiert|gesperrt|hangt|abgelehnt)",
  "schick mir geld",
  "brauche geld",
  // italien
  "rimbors\\w*",
  "prestami",
  "un prestito",
  "il mio prelievo",
  "prelievo (?:bloccato|in sospeso|rifiutato)",
  "mandami (?:dei )?soldi",
  "ho bisogno di soldi",
  "ridammi i (?:miei )?soldi",
];

/** Réclamation : arnaque, plainte, vol, compte bloqué. */
const COMPLAINT_PATTERNS: readonly string[] = [
  // français
  "arnaque\\w*",
  "escro\\w*",
  "(?:une |porter |deposer )plainte",
  "reclamation",
  "voleurs?",
  "vous m avez vole",
  "c est du vol",
  "un avocat",
  "mon avocat",
  "compte (?:bloque|suspendu|ferme|banni|supprime)",
  "je vais vous signaler",
  // anglais
  "scam\\w*",
  "fraud\\w*",
  "complaint",
  "report you",
  "you stole",
  "thieves",
  "my lawyer",
  "a lawyer",
  "account (?:is )?(?:blocked|suspended|closed|banned|locked)",
  // espagnol
  "estafa\\w*",
  "fraude",
  "una queja",
  "reclamacion",
  "denuncia\\w*",
  "ladrones",
  "me robaron",
  "abogado",
  "cuenta (?:bloqueada|suspendida|cerrada)",
  // portugais
  "e golpe",
  "golpista\\w*",
  "reclamacao",
  "ladroes",
  "me roubaram",
  "advogado",
  "conta (?:bloqueada|suspensa|encerrada)",
  // allemand
  "betrug\\w*",
  "abzocke\\w*",
  "beschwerde",
  "anzeige erstatten",
  "diebe",
  "anwalt",
  "konto (?:gesperrt|blockiert|geschlossen)",
  // italien
  "truff\\w*",
  "frode",
  "un reclamo",
  "ladri",
  "mi avete rubato",
  "avvocato",
  "conto (?:bloccato|sospeso|chiuso)",
];

/** Insultes (6 langues). */
const INSULT_PATTERNS: readonly string[] = [
  // français
  "connard\\w*",
  "connasse\\w*",
  "salope\\w*",
  "fils de pute",
  "pute",
  "fdp",
  "ntm",
  "nique ta (?:mere|race)",
  "encule\\w*",
  "(?:ta|ferme ta) gueule",
  "ftg",
  "batard\\w*",
  "sale (?:chienne|merde|conne?)",
  "va te faire",
  "abruti\\w*",
  "debile",
  "cretin\\w*",
  "tocard\\w*",
  // anglais
  "fuck (?:you|off|u)",
  "bitch\\w*",
  "asshole\\w*",
  "bastard\\w*",
  "cunt\\w*",
  "motherfucker\\w*",
  "shut up",
  "stfu",
  "idiot\\w*",
  "moron\\w*",
  "retard\\w*",
  // espagnol
  "hijo de puta",
  "puta",
  "cabron\\w*",
  "pendejo\\w*",
  "gilipollas",
  "imbecil\\w*",
  "vete a la mierda",
  "zorra",
  // portugais
  "filho da puta",
  "vai se foder",
  "vai tomar no cu",
  "otario\\w*",
  "vadia",
  "arrombad\\w*",
  // allemand
  "fick dich",
  "arschloch\\w*",
  "hurensohn\\w*",
  "schlampe\\w*",
  "wichser\\w*",
  "halt die fresse",
  "missgeburt\\w*",
  // italien
  "vaffanculo",
  "stronz[oaie]",
  "figlio di puttana",
  "coglion\\w*",
  "testa di cazzo",
  "puttana",
  "cretino",
];

const toRe = (list: readonly string[]) => new RegExp(`\\b(?:${list.join("|")})\\b`);
const MONEY_RE = toRe(MONEY_PATTERNS);
const COMPLAINT_RE = toRe(COMPLAINT_PATTERNS);
const INSULT_RE = toRe(INSULT_PATTERNS);

/** Motifs repérables par le code (le mineur a sa propre détection, la question hors fiche vient du modèle). */
export type CodeHandoffReason = Extract<NeedsHumanReason, "money" | "complaint" | "insult">;

/** Motif repéré dans un message (le plus grave d'abord : argent, réclamation, insulte), sinon null. */
export function detectHandoff(text: string | null | undefined): CodeHandoffReason | null {
  const w = wordsForm(text ?? "");
  if (!w) return null;
  if (MONEY_RE.test(w)) return "money";
  if (COMPLAINT_RE.test(w)) return "complaint";
  if (INSULT_RE.test(w)) return "insult";
  return null;
}

/** Motif le plus grave repéré dans les messages du tour, sinon null. */
export function detectHandoffIn(texts: readonly string[]): CodeHandoffReason | null {
  const found = new Set(texts.map(detectHandoff).filter((r): r is CodeHandoffReason => r !== null));
  for (const r of ["money", "complaint", "insult"] as const) if (found.has(r)) return r;
  return null;
}
