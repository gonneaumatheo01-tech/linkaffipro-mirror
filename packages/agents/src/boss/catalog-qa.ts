/**
 * Phase 30, chantier C — entrées du catalogue de Kevin pour le contrôle qualité global (section 5 du prompt) :
 * - `qa_status` (« comment va le contrôle qualité ? ») : taux d'acceptation du jour et des 7 jours, temps moyen,
 *   derniers refus, état (en marche, en pause faute de modèle, coupé) ;
 * - `qa_history` (« montre-moi les refus de cette semaine », « combien de refus cette semaine ? ») : compte, motifs
 *   les plus fréquents et liste numérotée (5 au plus) ;
 * - `qa_detail` (« pourquoi le post 42 a été refusé ? », « pourquoi le short 3 a été bloqué ? », « pourquoi le 2 ? »)
 *   : dernier contrôle du contenu, motifs, corrections demandées, tentative.
 * Tout est en LECTURE (aucune IA, aucune écriture hors le relevé numéroté de la conversation) : permis à tout membre
 * présenté. Jamais le contenu vérifié ni un secret : seulement les motifs, masqués (`qa/kevin-view.ts`).
 */
import { adminTelegramId } from "../admin/journal";
import { QA_TYPE_OF_PARAM, QA_TYPE_PARAM, qaDetailReply, qaHistoryReply, qaStatusReply, type QaTypeParam } from "../qa/kevin-view";
import type { BossAction, BossDeps } from "./contract";
import { defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { int, oneOf, str } from "./params";
import { teamOf } from "./resolve";
import { BOSS_READ_KEYS } from "./team/rights";

/** Conversation de la demande (privé de l'admin par défaut). */
async function chatKeyOf(deps: BossDeps): Promise<string | null> {
  const d = deps as BossExecDeps;
  if (d.chat) return d.chat.chatId.toString();
  if (d.speaker && d.speaker.kind === "member") return `member.${d.speaker.telegramUserId.toString()}`;
  return (await adminTelegramId(deps))?.toString() ?? null;
}

const typeSpec = oneOf("Type de contenu cité : post, short, rapport, reponse (une réponse de Kevin), recommandation, alerte, regle (règle publicitaire)", QA_TYPE_PARAM, true);

type Empty = Record<string, never>;

export const qaStatus = defineAction<Empty>({
  key: "qa_status",
  description: "Dire comment va le contrôle qualité global (« comment va le contrôle qualité ? ») : part des contenus acceptés aujourd'hui et sur 7 jours, derniers refus, temps moyen, en marche ou en pause",
  theme: "etat",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: (await qaStatusReply(deps, await chatKeyOf(deps))).text };
  },
});

type HistoryP = { jours?: number; type?: QaTypeParam; equipe?: string };

export const qaHistory = defineAction<HistoryP>({
  key: "qa_history",
  description: "Les refus du contrôle qualité sur une période (« montre-moi les refus de cette semaine », « combien de refus cette semaine ? », « les shorts refusés aujourd'hui ») : nombre, motifs, liste numérotée",
  theme: "etat",
  cls: "immediate",
  spec: {
    jours: int("Nombre de jours (1 = aujourd'hui, 7 = cette semaine, par défaut 7)", 1, 30, true),
    type: typeSpec,
    equipe: str("Équipe citée, telle que dite (« casino », « montage »)", { optional: true, maxLength: 40 }),
  },
  async execute(deps, p) {
    const raw = p.equipe?.trim().toLowerCase() ?? "";
    const team = raw ? (/montage|short/.test(raw) ? "montage" : /analyst|march/.test(raw) ? "analystes" : /^ads?$|pub/.test(raw) ? "ads" : teamOf(raw)) : null;
    const reply = await qaHistoryReply(deps, await chatKeyOf(deps), {
      ...(p.jours ? { days: p.jours } : {}),
      contentType: p.type ? QA_TYPE_OF_PARAM[p.type] : null,
      teamKey: team && team !== "all" ? team : null,
    });
    return { reply: reply.text };
  },
});

type DetailP = { type?: QaTypeParam; numero?: number; rang?: number };

export const qaDetail = defineAction<DetailP>({
  key: "qa_detail",
  description: "Pourquoi un contenu a été refusé ou bloqué par le contrôle qualité (« pourquoi le post 42 a été refusé ? », « pourquoi le short 3 a été bloqué ? », « pourquoi le 2 ? » après la liste des refus) : motifs, corrections demandées, tentative",
  theme: "etat",
  cls: "immediate",
  spec: {
    type: typeSpec,
    numero: int("Numéro du contenu cité (« le post 42 », « le short 3 »)", 1, 1_000_000, true),
    rang: int("Numéro dans la dernière liste des refus (« pourquoi le 2 ? »)", 1, 20, true),
  },
  async execute(deps, p) {
    return { reply: (await qaDetailReply(deps, await chatKeyOf(deps), { type: p.type ?? null, numero: p.numero ?? null, rang: p.rang ?? null })).text };
  },
});

export const QA_ACTIONS: BossAction[] = [qaStatus, qaHistory, qaDetail] as unknown as BossAction[];

/** Lectures : permises à tout membre présenté. */
export const QA_READ_ACTION_KEYS = ["qa_status", "qa_history", "qa_detail"] as const;

for (const k of QA_READ_ACTION_KEYS) BOSS_READ_KEYS.add(k);
