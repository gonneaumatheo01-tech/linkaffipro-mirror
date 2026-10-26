/**
 * Capacités de l'équipe Contrôle qualité global (phase 30) : « Kevin, demande au contrôle qualité ce qu'il a refusé
 * cette semaine » arrive aussi par le planificateur des ordres (phase 33). LECTURE SEULE : le contrôle qualité accepte
 * ou bloque tout seul ce qui sort ; personne ne lui ordonne d'accepter un contenu (règle 3 : blocage = blocage), et il
 * ne modifie jamais rien (règle 6). Aucune écriture, aucune IA.
 */
import type { QA_TEAM_KEY } from "../../qa/contract";
import { QA_TYPE_OF_PARAM, QA_TYPE_PARAM, qaAgentCard, qaDetailReply, qaHistoryReply, qaStatusReply, type QaTypeParam } from "../../qa/kevin-view";
import type { AgentsDeps } from "../../types";
import { defineCapability, done, ok, readOnly } from "./kit";

const T = "qa" as const satisfies typeof QA_TEAM_KEY;
const AGENTS = ["qa"];

const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

type QaP = { jours?: number; type?: QaTypeParam; numero?: number };

const typeField = { kind: "enum", description: "post, short, rapport, reponse, recommandation, alerte ou regle (absent = tout)", values: QA_TYPE_PARAM, optional: true } as const;

function readCap(key: string, description: string, spec: Record<string, unknown>, read: (deps: AgentsDeps, p: QaP, chatId: string | null) => Promise<string>) {
  return defineCapability<QaP>({
    teamKey: T,
    key,
    description,
    agents: AGENTS,
    spec: spec as never,
    limits: { modes: ["simulation", "real"] },
    async check() {
      return ok();
    },
    async plan(_deps, p) {
      return [{ stepKey: key, capability: key, teamKey: T, summary: description.split(" (")[0]!.toLowerCase(), touches: readOnly(), params: { ...p } }];
    },
    async run(deps, order, step) {
      return done(plain(await read(deps, step.params as QaP, order.chatId)));
    },
    async report(deps) {
      const card = await qaAgentCard(deps);
      return card.facts;
    },
  });
}

export const QA_CAPABILITIES = [
  readCap("etat", "État du contrôle qualité global : part des contenus acceptés, derniers refus, temps moyen, en marche ou en pause", {}, async (deps, _p, chat) => (await qaStatusReply(deps, chat)).text),
  readCap(
    "refus",
    "Refus du contrôle qualité sur une période (nombre, motifs les plus fréquents, liste numérotée)",
    { jours: { kind: "int", description: "Nombre de jours (7 par défaut)", min: 1, max: 30, optional: true }, type: typeField },
    async (deps, p, chat) => (await qaHistoryReply(deps, chat, { ...(p.jours ? { days: p.jours } : {}), contentType: p.type ? QA_TYPE_OF_PARAM[p.type] : null })).text,
  ),
  readCap(
    "pourquoi",
    "Pourquoi un contenu a été refusé ou bloqué par le contrôle qualité (motifs, corrections demandées, tentative)",
    { type: typeField, numero: { kind: "int", description: "Numéro du post ou du short cité", min: 1, max: 1_000_000, optional: true } },
    async (deps, p, chat) => (await qaDetailReply(deps, chat, { type: p.type ?? null, numero: p.numero ?? null })).text,
  ),
];
