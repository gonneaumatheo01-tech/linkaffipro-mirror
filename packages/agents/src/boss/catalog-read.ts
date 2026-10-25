/**
 * Entrées du catalogue du Boss : état, rapport, chiffres, demandes au client et validations. Lecture par les
 * fonctions existantes (`agentsOverview` / `overviewLines`, `dailyReportText`, collecteurs de `facts.ts`), réponses
 * par `respondToRequest` / `skipRequest`, décisions par `decideValidation`.
 */
import { decrypt } from "@linkaffipro/core";
import { agentAudit, esc, nowOf } from "../admin/journal";
import { teamAdminOnlyRequest } from "../human/delivery";
import { adminOnlyRequest } from "../human/access";
import { adminFirstName } from "./team/members";
import { requestScopeOf } from "./team/request-scope";
import { BOSS_TOKEN_SECRET_KEY, bossRegisterPort } from "./register-port";
import { agentsOverview, overviewLines } from "../orchestrator/overview-contract";
import { dailyReportText } from "../admin/report-command";
import { currentHumanRequest, sendNextHumanRequest } from "../human/requests";
import { respondToRequest, skipRequest, type HumanRequestRow } from "../human/respond";
import { decideValidation } from "../validation/requests";
import { TEAM_LABELS, type TeamKey } from "../types";
import type { BossAction, BossChat, BossDeps, BossReply, BossSpeaker } from "./contract";
import type { MentionRef } from "./team/addressed";
import { actorRef, defineAction, escLines } from "./catalog-kit";
import { int, oneOf, str } from "./params";
import { resolveTeam } from "./resolve";
import { requestsFacts, resultsFacts, spendFacts, validationsFacts } from "./facts";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

// ------------------------------------------------------------------------------------------- textes de Kevin

/** Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const CATALOG_READ_VARIANTS = {
  notYours: voiceTemplate<{ name: string }>([{ name: "Matheo" }, { name: "l'admin" }], (p) => [
    `Ça, c'est ${p.name} qui décide.`,
    `Celle-là, je la laisse à ${p.name}.`,
    `Là, c'est à ${p.name} de trancher.`,
  ]),
  secretHint: [
    "🔒 Envoie la clé ou le mot de passe dans ton prochain message : je le range sans le lire. Sinon, dis « plus tard ».",
    "🔒 Mets la valeur seule dans ton prochain message, je la range sans la lire. Ou réponds « plus tard ».",
  ],
  noQuestion: ["Je n'ai aucune question pour toi en ce moment.", "Pas de question en cours de mon côté.", "Rien en attente : aucune question ouverte."],
  mediaHint: [
    "Pour celle-là, envoie-moi directement les vidéos ou les photos demandées. Ou dis « plus tard ».",
    "Ici il me faut les vidéos ou les photos elles-mêmes : envoie-les directement, ou réponds « plus tard ».",
  ],
  notOpen: ["Cette question est déjà réglée, je n'ai rien changé.", "Trop tard, la question est fermée : rien n'a bougé."],
  bossNoPort: [
    "Je ne peux pas m'enregistrer d'ici. Colle le jeton dans Réglages → Bots, avec le rôle Boss.",
    "D'ici, je ne peux pas enregistrer le jeton. Va dans Réglages → Bots et colle-le avec le rôle Boss.",
  ],
  tokenRefused: voiceTemplate<{ reason: string }>([{ reason: "jeton invalide" }, { reason: "Unauthorized" }], (p) => [
    `Telegram refuse ce jeton (${p.reason}). Vérifie-le dans @BotFather et renvoie-le.`,
    `Ce jeton ne passe pas : ${p.reason}. Tu peux le revérifier dans @BotFather et me le renvoyer ?`,
  ]),
  bossRegistered: voiceTemplate<{ username: string }>([{ username: "kevcanauxbot" }], (p) => [
    `✅ C'est bon, @${p.username} est enregistré. Envoie-lui /start depuis ton compte, puis écris « commencer ».`,
    `C'est fait, le Boss est @${p.username}. Envoie /start à @${p.username} depuis ton compte, puis écris « commencer ».`,
  ]),
  tokenUnreadable: [
    "Je n'arrive pas à relire ce jeton. Renvoie « jeton boss » suivi du jeton.",
    "Ce jeton est illisible de mon côté : renvoie-le avec « jeton boss » devant.",
  ],
  noValidation: voiceTemplate<{ n: number }>([{ n: 12 }], (p) => [`Je ne trouve aucun post n°${p.n} à valider.`, `Pas de post n°${p.n} en attente chez moi.`]),
  validationDone: voiceTemplate<{ n: number }>([{ n: 12 }], (p) => [`Le post n°${p.n} est déjà réglé.`, `Déjà fait : le post n°${p.n} a été traité.`]),
  publishSummary: voiceTemplate<{ n: number; line: string }>(
    [
      { n: 12, line: "Rencontres · première vidéo de Léa" },
      { n: 3, line: "post introuvable" },
    ],
    (p) => [`Je publie le post n°${p.n} ?\n${p.line}`, `On publie le post n°${p.n} ?\n${p.line}`],
  ),
} satisfies VoiceTable;

const V = CATALOG_READ_VARIANTS;
/** Conversation en cours (rotation des variantes), si le bot l'a donnée. */
const chatOf = (deps: BossDeps) => (deps as { chat?: BossChat | null }).chat?.chatId ?? null;

/** Dépendances d'exécution : le texte reçu tel quel (confirmation stricte d'une demande, jamais inventé par l'IA). */
export type BossExecDeps = BossDeps & {
  inputText?: string;
  /** Phase 26, section 4 : qui parle, où, et les personnes mentionnées (identifiants venus de Telegram). */
  speaker?: BossSpeaker | null;
  chat?: BossChat | null;
  mentions?: MentionRef[];
};

type Empty = Record<string, never>;

/** Équipe facultative : absente → toutes ; inconnue → réponse « je ne connais pas ». */
function optionalTeam(raw: string | undefined): { team: TeamKey | null } | { reply: BossReply } {
  if (!raw) return { team: null };
  const r = resolveTeam(raw, { allowAll: true });
  if (!r.ok) return { reply: r.reply };
  return { team: r.value === "all" ? null : r.value };
}

export const etatGeneral = defineAction<Empty>({
  key: "etat_general",
  description: "Dire où en sont les agents : équipes, posts du jour, à valider, demandes, dépenses, santé",
  theme: "etat",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const ls = overviewLines(await agentsOverview(deps.prisma, { now: nowOf(deps) }));
    return { reply: escLines(ls) };
  },
});

export const rapportDuJour = defineAction<Empty>({
  key: "rapport_du_jour",
  description: "Envoyer le rapport du jour des agents (et le dernier rapport pubs)",
  theme: "etat",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: await dailyReportText(deps) };
  },
});

type TeamOpt = { equipe?: string };

export const depensesDuMois = defineAction<TeamOpt>({
  key: "depenses_du_mois",
  description: "Dire ce qui a été dépensé ce mois, par équipe et par poste, avec les plafonds et la projection",
  theme: "chiffres",
  cls: "immediate",
  spec: { equipe: str("Équipe (facultatif : toutes si absent)", { optional: true }) },
  async execute(deps, p) {
    const t = optionalTeam(p.equipe);
    if ("reply" in t) return t.reply;
    return { reply: escLines((await spendFacts(deps, t.team)).lines) };
  },
});

type ResultsP = { periode: "7j" | "28j"; equipe?: string };

export const resultats = defineAction<ResultsP>({
  key: "resultats",
  description: "Donner les résultats des posts des agents sur 7 ou 28 jours (vues, clics, inscriptions, commissions)",
  theme: "chiffres",
  cls: "immediate",
  spec: { periode: oneOf("7j ou 28j", ["7j", "28j"]), equipe: str("Équipe (facultatif)", { optional: true }) },
  async execute(deps, p) {
    const t = optionalTeam(p.equipe);
    if ("reply" in t) return t.reply;
    return { reply: escLines((await resultsFacts(deps, p.periode, t.team)).lines) };
  },
});

export const demandesOuvertes = defineAction<Empty>({
  key: "demandes_ouvertes",
  description: "Lister les questions ouvertes que les agents m'ont demandé de te poser",
  theme: "demandes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: escLines((await requestsFacts(deps)).lines) };
  },
});

type AnswerP = { reponse: string };

type RequestRights = { kind: string; teamKey?: string | null; onAnswer?: unknown; assigneeTelegramId?: bigint | null; chatId?: bigint | null };

/**
 * Un membre ne répond à une demande, ou ne la passe, que si elle LUI est adressée dans cette conversation ; un
 * responsable aussi pour une demande de son équipe sans responsable désigné posée là (même règle que `team/rights.ts`).
 * Jamais une demande réservée à l'admin (`teamAdminOnlyRequest`, qui reprend `adminOnlyRequest` hors clés), même
 * adressée. L'admin : toujours.
 */
export function speakerMayAnswerRequest(speaker: BossSpeaker | null | undefined, request: RequestRights, chat?: BossChat | null): boolean {
  if (!speaker || speaker.kind === "admin") return true;
  if (teamAdminOnlyRequest(request)) return false;
  if (request.kind !== "SECRET" && adminOnlyRequest(request)) return false;
  const scope = requestScopeOf(request, speaker.telegramUserId, chat);
  if (scope.assignedToSpeaker) return true;
  const manager = speaker.role === "MANAGER" || speaker.role === "ADMIN";
  const r = scope.request;
  return manager && !!r && !r.adminOnly && !r.assignedToOther && !r.otherChat;
}

async function notYours(deps: BossDeps): Promise<BossReply> {
  const name = await adminFirstName(deps).catch(() => "l'admin");
  return { reply: pick(V.notYours({ name: esc(name) }), "read.notYours", chatOf(deps)) };
}

export const SECRET_ANSWER_HINT = CATALOG_READ_VARIANTS.secretHint[0]!;
const secretHint = (deps: BossDeps) => pick(V.secretHint, "read.secretHint", chatOf(deps));

export const repondreDemande = defineAction<AnswerP>({
  key: "repondre_demande",
  description: "Répondre à la question en cours (texte, numéro d'un choix, oui ou non)",
  theme: "demandes",
  cls: "immediate",
  spec: { reponse: str("La réponse de l'admin à la question en cours, telle qu'il l'a donnée", { maxLength: 500 }) },
  async execute(deps: BossExecDeps, p, actor) {
    const current = (await currentHumanRequest(deps)) as (HumanRequestRow & RequestRights) | null;
    if (!current) return { reply: pick(V.noQuestion, "read.noQuestion", chatOf(deps)) };
    if (!speakerMayAnswerRequest(deps.speaker, current, deps.chat)) return notYours(deps);
    if (current.kind === "SECRET") return { reply: secretHint(deps) };
    if (current.kind === "MEDIA") return { reply: pick(V.mediaHint, "read.mediaHint", chatOf(deps)) };
    const r = await respondToRequest(deps, current, p.reponse, actorRef(actor), { deferNext: true, confirmText: deps.inputText ?? p.reponse });
    return {
      reply: esc(r.message),
      followUp: r.closed
        ? async () => {
            await sendNextHumanRequest(deps);
          }
        : undefined,
    };
  },
});

export const plusTard = defineAction<Empty>({
  key: "plus_tard",
  description: "Passer la question en cours (elle sera reposée plus tard)",
  theme: "demandes",
  cls: "immediate",
  spec: {},
  async execute(deps: BossExecDeps, _p, actor) {
    const current = (await currentHumanRequest(deps)) as (HumanRequestRow & RequestRights) | null;
    if (!current) return { reply: pick(V.noQuestion, "read.noQuestion", chatOf(deps)) };
    if (!speakerMayAnswerRequest(deps.speaker, current, deps.chat)) return notYours(deps);
    const r = await skipRequest(deps, current, actorRef(actor), { deferNext: true });
    return {
      reply: esc(r.message),
      followUp: async () => {
        await sendNextHumanRequest(deps);
      },
    };
  },
});

// ------------------------------------------------------------------- entrées cachées (après un OUI de l'admin)

type ConfirmedAnswerP = { demande: string; reponse: string };

/** « C'est ta réponse à : … ? » → OUI : la réponse est donnée à CETTE demande (si elle est toujours ouverte). */
export const repondreDemandeConfirmee = defineAction<ConfirmedAnswerP>({
  key: "repondre_demande_confirmee",
  description: "Donner à une question précise la réponse confirmée par l'admin",
  theme: "demandes",
  cls: "confirm",
  spec: { demande: str("Identifiant de la demande", { maxLength: 60 }), reponse: str("Réponse", { maxLength: 2000 }) },
  async execute(deps, p, actor) {
    const req = (await deps.prisma.humanRequest.findUnique({ where: { id: p.demande } })) as HumanRequestRow | null;
    if (!req || (req.status !== "QUEUED" && req.status !== "PENDING")) return { reply: pick(V.notOpen, "read.notOpen", chatOf(deps)) };
    if (req.kind === "SECRET") return { reply: secretHint(deps) };
    const r = await respondToRequest(deps, req, p.reponse, actorRef(actor), { deferNext: true });
    return {
      reply: esc(r.message),
      followUp: r.closed
        ? async () => {
            await sendNextHumanRequest(deps);
          }
        : undefined,
    };
  },
});

/** Enregistre le Boss par son jeton (port du chantier A) ; ferme la demande SECRET « jeton boss » si elle est ouverte. */
export async function registerBossToken(deps: BossDeps, token: string, actorUserId: string | null): Promise<string> {
  const port = bossRegisterPort();
  if (!port) return pick(V.bossNoPort, "read.bossNoPort", chatOf(deps));
  let username: string;
  try {
    username = (await port(token)).username;
  } catch (err) {
    return pick(V.tokenRefused({ reason: esc(((err as Error).message || "jeton invalide").slice(0, 160)) }), "read.tokenRefused", chatOf(deps));
  }
  const closed = await deps.prisma.humanRequest.updateMany({
    where: { key: BOSS_TOKEN_SECRET_KEY, status: { in: ["QUEUED", "PENDING"] } },
    data: { status: "ANSWERED", answerSummary: "enregistrée", answeredAt: nowOf(deps) },
  });
  if (closed.count)
    await agentAudit(deps, { userId: actorUserId, action: "agents.request.answered", entityType: "HumanRequest", entityId: BOSS_TOKEN_SECRET_KEY, metadata: { key: BOSS_TOKEN_SECRET_KEY, kind: "SECRET", via: "TELEGRAM", summary: "enregistrée" } });
  return pick(V.bossRegistered({ username: esc(username) }), "read.bossRegistered", chatOf(deps));
}

type ReplaceBossP = { jeton: string };

/** Remplacer le Boss actif par un nouveau bot : jeton gardé CHIFFRÉ dans la confirmation, déchiffré ici seulement. */
export const remplacerBoss = defineAction<ReplaceBossP>({
  key: "remplacer_boss",
  description: "Remplacer le bot de Kevin par un nouveau bot (jeton chiffré)",
  theme: "guide",
  cls: "confirm",
  spec: { jeton: str("Jeton chiffré", { maxLength: 2000 }) },
  async execute(deps, p, actor) {
    let token: string;
    try {
      token = decrypt(p.jeton);
    } catch {
      return { reply: pick(V.tokenUnreadable, "read.tokenUnreadable", chatOf(deps)) };
    }
    return { reply: await registerBossToken(deps, token, actor.userId) };
  },
});

/** Entrées cachées : jamais proposées à l'IA, exécutées seulement après un OUI de l'admin. */
export const READ_HIDDEN_ACTIONS: BossAction[] = [repondreDemandeConfirmee, remplacerBoss] as unknown as BossAction[];

export const validationsEnAttente = defineAction<Empty>({
  key: "validations_en_attente",
  description: "Lister les posts qui attendent ta validation",
  theme: "demandes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: escLines((await validationsFacts(deps)).lines) };
  },
});

type NumP = { numero: number };

async function validationLine(deps: BossDeps, n: number): Promise<string> {
  const v = (await deps.prisma.agentValidation.findUnique({ where: { number: n } })) as { teamKey: string; reason: string } | null;
  return v ? `${TEAM_LABELS[v.teamKey as TeamKey] ?? v.teamKey} · ${v.reason.slice(0, 80)}` : "post introuvable";
}

export const validerPost = defineAction<NumP>({
  key: "valider_post",
  check: async (deps, p) => { const v = (await deps.prisma.agentValidation.findUnique({ where: { number: p.numero } })) as { status: string } | null; if (!v) return { reply: pick(V.noValidation({ n: p.numero }), "read.noValidation", chatOf(deps)) }; return v.status === "PENDING" ? null : { reply: pick(V.validationDone({ n: p.numero }), "read.validationDone", chatOf(deps)) }; },
  description: "Valider un post en attente (il sera publié) par son numéro",
  theme: "demandes",
  cls: "confirm",
  spec: { numero: int("Numéro du post à valider", 1, 10_000_000) },
  async summarize(deps, p) {
    return pick(V.publishSummary({ n: p.numero, line: await validationLine(deps, p.numero) }), "read.publishSummary", chatOf(deps));
  },
  async execute(deps, p, actor) {
    return { reply: esc((await decideValidation(deps, { number: p.numero, decision: "approve", via: "TELEGRAM", byUserId: actor.userId })).message) };
  },
});

type RejectP = { numero: number; raison?: string };

export const refuserPost = defineAction<RejectP>({
  key: "refuser_post",
  description: "Refuser un post en attente par son numéro (avec le motif si donné)",
  theme: "demandes",
  cls: "immediate",
  spec: { numero: int("Numéro du post à refuser", 1, 10_000_000), raison: str("Motif (facultatif)", { optional: true }) },
  async execute(deps, p, actor) {
    const r = await decideValidation(deps, { number: p.numero, decision: "reject", rejectReason: p.raison ?? null, via: "TELEGRAM", byUserId: actor.userId });
    return { reply: esc(r.message) };
  },
});

export const corrigerPost = defineAction<NumP>({
  key: "corriger_post",
  description: "Corriger le texte d'un post en attente : je te demande le nouveau texte",
  theme: "demandes",
  cls: "immediate",
  spec: { numero: int("Numéro du post à corriger", 1, 10_000_000) },
  async execute(deps, p, actor) {
    const r = await decideValidation(deps, { number: p.numero, decision: "edit", via: "TELEGRAM", byUserId: actor.userId });
    return { reply: esc(r.message) };
  },
});

export const READ_ACTIONS: BossAction[] = [
  etatGeneral,
  rapportDuJour,
  depensesDuMois,
  resultats,
  demandesOuvertes,
  repondreDemande,
  plusTard,
  validationsEnAttente,
  validerPost,
  refuserPost,
  corrigerPost,
] as unknown as BossAction[];

