/**
 * Entrées du catalogue du Boss : équipes (pause, reprise, niveau, simulation ↔ vrai, plafonds, quota) et plan par
 * canal (activer, désactiver, persona, mélange). Exécution par les fonctions existantes (`setTeamPaused`,
 * `setAutonomyLevel`, `setSimulation`, `setTeamBudget`, `updateChannelPlan`, `setTeamPostsPerDay`). Bornes vérifiées
 * par le code à chaque exécution (y compris après OUI).
 */
import { esc } from "../admin/journal";
import { setAutonomyLevel, setSimulation, setTeamPaused, AUTONOMY_LABELS, isPausedAll } from "../admin/team";
import { setTeamBudget } from "../admin/budget";
import { teamPlanSummary } from "../admin/confirm-summary";
import { PROVIDER_LABELS } from "../orchestrator/budgets";
import { loadTeamSettings } from "../missions/settings";
import { loadAlgoTeam } from "../algo/settings";
import { currentChannelPlan, setTeamPostsPerDay, updateChannelPlan } from "../control/channel-plan";
import { TEAM_LABELS, type ProviderKey, type TeamKey } from "../types";
import type { BossAction, BossActionClass, BossDeps, BossReply } from "./contract";
import { actorRef, defineAction, eur, fromResult, lines, plural } from "./catalog-kit";
import { bool, int, num, oneOf, str } from "./params";
import { checkCap, checkLevel, checkQuota, resolveChannel, resolvePersona, resolveTeam, teamOf, type ChannelRef } from "./resolve";
import { stateFacts } from "./facts";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

// ------------------------------------------------------------------------------------------- textes de Kevin

const TEAM_SAMPLES = ["Rencontres", "Paris sportifs"];
const posts = (n: number) => plural(n, "post");

/** Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const CATALOG_TEAMS_VARIANTS = {
  oneTeamOnly: ["Une équipe à la fois : laquelle ?", "Je fais ça équipe par équipe. On commence par laquelle ?", "Une seule équipe à la fois, dis-moi laquelle."],
  teamState: voiceTemplate<{ facts: string[]; algo: boolean; channels: string[]; postsPerDay: number; caps: string | null }>(
    [
      { facts: ["Équipe Casino : au travail, pour de faux, niveau 1.", "3 posts aujourd'hui, 1 à valider."], algo: false, channels: ["Roulette Pro", "Test"], postsPerDay: 4, caps: "IA texte 10 €" },
      { facts: ["Équipe Algorithme : au travail, niveau 0."], algo: true, channels: [], postsPerDay: 0, caps: null },
      { facts: ["Équipe Rencontres : en pause."], algo: false, channels: [], postsPerDay: 1, caps: null },
    ],
    (p: { facts: string[]; algo: boolean; channels: string[]; postsPerDay: number; caps: string | null }) => {
      const where = p.channels.length ? p.channels.join(", ") : "aucun pour l'instant";
      const work = p.algo
        ? "Elle ne publie rien : elle propose des réglages aux autres équipes et les applique."
        : `Canaux activés : ${where}. ${posts(p.postsPerDay)} par jour au plus.`;
      const work2 = p.algo
        ? "Elle ne poste rien elle-même, elle règle le travail des autres équipes."
        : `Elle tourne sur ${p.channels.length ? where : "aucun canal pour l'instant"}, ${posts(p.postsPerDay)} par jour au plus.`;
      const caps = p.caps ? `Plafonds : ${p.caps}.` : "Aucun plafond réglé.";
      const caps2 = p.caps ? `Côté dépenses, plafonds à ${p.caps}.` : "Pas de plafond de dépense.";
      return [[...p.facts, work, caps].join("\n"), [...p.facts, work2, caps2].join("\n")];
    },
  ),
  channelNoPlan: voiceTemplate<{ name: string; channel: string; team: string | null }>(
    [
      { name: "<b>Roulette Pro</b>", channel: "Roulette Pro", team: "Casino" },
      { name: "<b>Test</b>", channel: "Test", team: null },
    ],
    (p: { name: string; channel: string; team: string | null }) => {
      const go = p.team ? `\nC'est un canal ${p.team} : dis « active ${p.channel} » pour les lancer.` : "";
      const go2 = p.team ? `\nIl est pour l'équipe ${p.team}. Je les lance ? Dis « active ${p.channel} ».` : "";
      return [`Les agents ne travaillent pas sur ${p.name} pour l'instant.${go}`, `Rien de prévu par les agents sur ${p.name}.${go2}`];
    },
  ),
  channelState: voiceTemplate<{ name: string; isTest: boolean; enabled: boolean; team: string | null; postsPerDay: number; start: string; end: string; video: number; photo: number; text: number; persona: string | null; needsPersona: boolean }>(
    [
      { name: "<b>Roulette Pro</b>", isTest: false, enabled: true, team: "Casino", postsPerDay: 3, start: "09:00", end: "22:00", video: 1, photo: 2, text: 1, persona: null, needsPersona: false },
      { name: "<b>Test</b>", isTest: true, enabled: false, team: "Rencontres", postsPerDay: 1, start: "10:00", end: "20:00", video: 0, photo: 1, text: 0, persona: null, needsPersona: true },
      { name: "<b>Léa en privé</b>", isTest: false, enabled: true, team: null, postsPerDay: 2, start: "08:00", end: "23:00", video: 1, photo: 1, text: 1, persona: "Léa", needsPersona: false },
    ],
    (p: { name: string; isTest: boolean; enabled: boolean; team: string | null; postsPerDay: number; start: string; end: string; video: number; photo: number; text: number; persona: string | null; needsPersona: boolean }) => {
      const test = p.isTest ? " (canal Test)" : "";
      const team = p.team ? ` pour l'équipe ${p.team}` : "";
      const state = p.enabled ? `Sur ${p.name}${test}, les agents tournent${team}.` : `Sur ${p.name}${test}, les agents sont à l'arrêt${team}.`;
      const state2 = p.enabled ? `Les agents bossent sur ${p.name}${test}${team}.` : `Les agents sont arrêtés sur ${p.name}${test}${team}.`;
      const rhythm = `${posts(p.postsPerDay)} par jour entre ${p.start} et ${p.end}, avec vidéo ${p.video} / photo ${p.photo} / texte ${p.text}.`;
      const rhythm2 = `Rythme : ${posts(p.postsPerDay)} par jour de ${p.start} à ${p.end}. Mélange vidéo ${p.video} / photo ${p.photo} / texte ${p.text}.`;
      const persona = p.persona ? `Persona : ${p.persona}.` : p.needsPersona ? "Pas encore de persona, il en faut une pour lancer le canal." : null;
      const persona2 = p.persona ? `C'est ${p.persona} qui incarne le canal.` : p.needsPersona ? "Il manque une persona : sans elle, je ne peux pas l'activer." : null;
      const join = (...ls: (string | null)[]) => ls.filter((l): l is string => !!l).join("\n");
      return [join(state, rhythm, persona), join(state2, rhythm2, persona2)];
    },
  ),
  stillPausedAll: [
    "Attention, la pause générale tient toujours : dis « reprends tout » pour la lever.",
    "Par contre, tout est encore en pause générale. Dis « reprends tout » pour la lever.",
  ],
  levelSummary: voiceTemplate<{ team: string; from: number; to: number; label: string }>(
    [
      { team: "Casino", from: 0, to: 1, label: "je valide les nouveautés" },
      { team: "Rencontres", from: 1, to: 2, label: "autonomie totale" },
    ],
    (p: { team: string; from: number; to: number; label: string }) => [
      `Je passe l'équipe ${p.team} du niveau ${p.from} au niveau ${p.to} (${p.label}) ?\nPlus le niveau est haut, moins tu valides avant publication.`,
      `On met ${p.team} au niveau ${p.to} (${p.label}) au lieu du niveau ${p.from} ?\nÀ ce niveau, tu valides moins de posts avant qu'ils partent.`,
    ],
  ),
  levelAlready: voiceTemplate<{ team: string; level: number }>(
    TEAM_SAMPLES.map((team, i) => ({ team, level: i + 1 })),
    (p: { team: string; level: number }) => [`${p.team} est déjà au niveau ${p.level}, rien à changer.`, `Rien à faire : l'équipe ${p.team} est déjà au niveau ${p.level}.`],
  ),
  realSummary: voiceTemplate<{ team: string; channels: string[]; level: number; postsPerDay: number; caps: string | null }>(
    [
      { team: "Casino", channels: ["Roulette Pro", "Blackjack VIP", "Slots", "Poker"], level: 1, postsPerDay: 4, caps: "IA texte 10 €" },
      { team: "Rencontres", channels: ["Léa en privé"], level: 0, postsPerDay: 2, caps: null },
      { team: "Paris sportifs", channels: [], level: 0, postsPerDay: 3, caps: null },
    ],
    (p: { team: string; channels: string[]; level: number; postsPerDay: number; caps: string | null }) => {
      const n = p.channels.length;
      const where = n ? `${plural(n, "canal", "canaux")} (${p.channels.slice(0, 3).join(", ")})` : "aucun canal activé pour l'instant";
      const caps = p.caps ? `, plafonds : ${p.caps}` : "";
      return [
        `Je passe l'équipe ${p.team} en vrai ? Ses posts partiront sur les vrais canaux : ${where}.\nNiveau ${p.level}, ${posts(p.postsPerDay)} par jour au plus${caps}.`,
        `On passe ${p.team} en vrai ? Fini le canal Test, ses posts iront sur ${where}.\nNiveau ${p.level}, ${posts(p.postsPerDay)} par jour au plus${caps}.`,
      ];
    },
  ),
  modeAlready: voiceTemplate<{ team: string; sim: boolean }>(
    [
      { team: "Casino", sim: true },
      { team: "Rencontres", sim: false },
    ],
    (p: { team: string; sim: boolean }) =>
      p.sim
        ? [`${p.team} tourne déjà pour de faux, sur le canal Test.`, `Rien à changer : l'équipe ${p.team} est déjà en test.`]
        : [`${p.team} est déjà en vrai.`, `Rien à changer : l'équipe ${p.team} publie déjà sur les vrais canaux.`],
  ),
  capSummary: voiceTemplate<{ provider: string; team: string; from: string | null; to: string }>(
    [
      { provider: "vidéo", team: "Rencontres", from: "100 €", to: "150 €" },
      { provider: "IA texte", team: "Casino", from: null, to: "20 €" },
    ],
    (p: { provider: string; team: string; from: string | null; to: string }) =>
      p.from
        ? [
            `Je monte le plafond ${p.provider} de l'équipe ${p.team} de ${p.from} à ${p.to} par mois ?\nElle pourra dépenser jusqu'à ce montant chez le fournisseur.`,
            `On passe le plafond ${p.provider} de ${p.team} de ${p.from} à ${p.to} par mois ?\nL'équipe pourra dépenser jusque-là chez le fournisseur.`,
          ]
        : [
            `Je mets un plafond ${p.provider} de ${p.to} par mois à l'équipe ${p.team} ? Elle n'en a aucun aujourd'hui.\nElle pourra dépenser jusqu'à ce montant chez le fournisseur.`,
            `On fixe le plafond ${p.provider} de ${p.team} à ${p.to} par mois ? Il n'y en a aucun pour l'instant.\nL'équipe pourra dépenser jusque-là chez le fournisseur.`,
          ],
  ),
  capDone: voiceTemplate<{ provider: string; team: string; amount: string }>(
    [{ provider: "vidéo", team: "Rencontres", amount: "150 €" }],
    (p: { provider: string; team: string; amount: string }) => [
      `✅ Fait : le plafond ${p.provider} de ${p.team} passe à ${p.amount} par mois.`,
      `C'est réglé, ${p.team} peut dépenser ${p.amount} par mois en ${p.provider}.`,
      `Fait. Plafond ${p.provider} de l'équipe ${p.team} : ${p.amount} par mois.`,
    ],
  ),
  quotaChannelSummary: voiceTemplate<{ name: string; from: number; to: number }>(
    [
      { name: "Roulette Pro", from: 2, to: 4 },
      { name: "Test", from: 1, to: 1 },
    ],
    (p: { name: string; from: number; to: number }) => [
      `Je passe ${p.name} de ${posts(p.from)} à ${posts(p.to)} par jour ?\nPlus de posts, c'est plus de production, et plus de dépense pour les vidéos.`,
      `On monte ${p.name} à ${posts(p.to)} par jour au lieu de ${p.from} ?\nÇa fait plus de production, et plus de dépense s'il y a des vidéos.`,
    ],
  ),
  quotaTeamSummary: voiceTemplate<{ team: string; n: number }>(
    [
      { team: "Casino", n: 3 },
      { team: "Rencontres", n: 1 },
    ],
    (p: { team: string; n: number }) => [
      `Je mets ${posts(p.n)} par jour sur chaque canal activé de l'équipe ${p.team} ?\nPlus de posts, c'est plus de production, et plus de dépense pour les vidéos.`,
      `On passe tous les canaux activés de ${p.team} à ${posts(p.n)} par jour ?\nÇa fait plus de production, et plus de dépense s'il y a des vidéos.`,
    ],
  ),
  quotaTeamDone: voiceTemplate<{ team: string; n: number; changed: number }>(
    [
      { team: "Casino", n: 3, changed: 2 },
      { team: "Rencontres", n: 1, changed: 1 },
    ],
    (p: { team: string; n: number; changed: number }) => [
      `✅ Fait : ${posts(p.n)} par jour sur ${plural(p.changed, "canal", "canaux")} de l'équipe ${p.team}.`,
      `C'est réglé, ${p.team} passe à ${posts(p.n)} par jour sur ${plural(p.changed, "canal", "canaux")}.`,
    ],
  ),
  quotaChannelDone: voiceTemplate<{ name: string; n: number }>(
    [
      { name: "Roulette Pro", n: 4 },
      { name: "Test", n: 1 },
    ],
    (p: { name: string; n: number }) => [`✅ Fait : ${p.name} passe à ${posts(p.n)} par jour.`, `C'est réglé, ${posts(p.n)} par jour sur ${p.name}.`],
  ),
  planSummary: voiceTemplate<{ name: string; plan: { postsPerDay: number; start: string; end: string } | null }>(
    [
      { name: "Roulette Pro", plan: { postsPerDay: 3, start: "09:00", end: "22:00" } },
      { name: "Test", plan: null },
    ],
    (p: { name: string; plan: { postsPerDay: number; start: string; end: string } | null }) => {
      const detail = p.plan
        ? `${posts(p.plan.postsPerDay)} par jour entre ${p.plan.start} et ${p.plan.end}. Le mode de l'équipe (test ou vrai) et son niveau ne changent pas.`
        : "Le canal recevra les posts de son équipe.";
      return [`Je lance les agents sur ${p.name} ?\n${detail}`, `On remet les agents au travail sur ${p.name} ?\n${detail}`];
    },
  ),
  planAlready: voiceTemplate<{ name: string; on: boolean }>(
    [
      { name: "Roulette Pro", on: true },
      { name: "Test", on: false },
    ],
    (p: { name: string; on: boolean }) =>
      p.on
        ? [`Les agents tournent déjà sur ${p.name}.`, `Rien à changer, ${p.name} est déjà activé.`]
        : [`Les agents sont déjà arrêtés sur ${p.name}.`, `Rien à changer, ${p.name} est déjà désactivé.`],
  ),
  planDone: voiceTemplate<{ name: string; on: boolean }>(
    [
      { name: "Roulette Pro", on: true },
      { name: "Test", on: false },
    ],
    (p: { name: string; on: boolean }) =>
      p.on
        ? [`Ok, les agents bossent de nouveau sur ${p.name}.`, `C'est lancé, les agents travaillent sur ${p.name}.`, `Fait, les agents reprennent ${p.name}.`]
        : [`Fait, les agents s'arrêtent sur ${p.name}.`, `Ok, plus d'agents sur ${p.name} pour l'instant.`, `C'est arrêté : les agents ne touchent plus à ${p.name}.`],
  ),
  personaSummary: voiceTemplate<{ persona: string; channel: string }>(
    [{ persona: "Léa", channel: "Léa en privé" }],
    (p: { persona: string; channel: string }) => [
      `Je donne la persona ${p.persona} au canal ${p.channel} ?\nSes prochains posts seront faits pour ce personnage.`,
      `On met ${p.persona} sur ${p.channel} ?\nLes prochains posts du canal seront écrits pour elle.`,
    ],
  ),
  personaDone: voiceTemplate<{ persona: string; channel: string }>(
    [{ persona: "Léa", channel: "Léa en privé" }],
    (p: { persona: string; channel: string }) => [`✅ Fait : ${p.channel} a maintenant ${p.persona} comme persona.`, `C'est réglé, ${p.persona} incarne ${p.channel}.`],
  ),
  mixSummary: voiceTemplate<{ channel: string; video: number; photo: number; text: number }>(
    [{ channel: "Léa en privé", video: 2, photo: 1, text: 1 }],
    (p: { channel: string; video: number; photo: number; text: number }) => [
      `Je règle ${p.channel} sur vidéo ${p.video} / photo ${p.photo} / texte ${p.text} ?\nPlus de vidéos, c'est plus de dépense chez le fournisseur.`,
      `On passe le mélange de ${p.channel} à vidéo ${p.video} / photo ${p.photo} / texte ${p.text} ?\nPlus il y a de vidéos, plus ça coûte chez le fournisseur.`,
    ],
  ),
  mixDone: voiceTemplate<{ channel: string; video: number; photo: number; text: number }>(
    [{ channel: "Léa en privé", video: 2, photo: 1, text: 1 }],
    (p: { channel: string; video: number; photo: number; text: number }) => [
      `✅ Fait : ${p.channel} passe à vidéo ${p.video} / photo ${p.photo} / texte ${p.text}.`,
      `C'est réglé, mélange vidéo ${p.video} / photo ${p.photo} / texte ${p.text} sur ${p.channel}.`,
    ],
  ),
} satisfies VoiceTable;

const V = CATALOG_TEAMS_VARIANTS;
/** Conversation en cours (rotation des variantes), si le bot l'a donnée. */
const chatOf = (deps: BossDeps) => (deps as { chat?: { chatId: bigint } | null }).chat?.chatId ?? null;

/** Contrôles avant confirmation : nom retrouvé (sinon question ou « je ne trouve pas »). */
async function teamCheck(deps: BossDeps, raw: string): Promise<BossReply | null> {
  const r = resolveTeam(raw);
  if (!r.ok) return r.reply;
  return r.value === "all" ? { reply: pick(V.oneTeamOnly, "teams.oneTeamOnly", chatOf(deps)) } : null;
}
async function channelCheck(deps: BossDeps, actionKey: string, params: object, field: string, raw: string): Promise<BossReply | null> {
  const r = await resolveChannel(deps, { actionKey, params: params as Record<string, unknown>, field }, raw);
  return r.ok ? null : r.reply;
}
async function personaCheck(deps: BossDeps, actionKey: string, params: object, raw: string): Promise<BossReply | null> {
  const r = await resolvePersona(deps, { actionKey, params: params as Record<string, unknown>, field: "persona" }, raw);
  return r.ok ? null : r.reply;
}

const TEAM_DESC = "Équipe nommée par l'admin : rencontres (dating), casino, paris sportifs, algorithme";

type TeamP = { equipe: string };

async function team(params: TeamP, allowAll = false): Promise<{ ok: true; team: TeamKey | "all" } | { ok: false; reply: BossReply }> {
  const r = resolveTeam(params.equipe, { allowAll });
  return r.ok ? { ok: true, team: r.value } : { ok: false, reply: r.reply };
}

async function oneTeam(params: TeamP, deps?: BossDeps): Promise<{ ok: true; team: TeamKey } | { ok: false; reply: BossReply }> {
  const r = await team(params);
  if (!r.ok) return r;
  if (r.team === "all") return { ok: false, reply: { reply: pick(V.oneTeamOnly, "teams.oneTeamOnly", deps ? chatOf(deps) : null) } };
  return { ok: true, team: r.team };
}

export const etatEquipe = defineAction<TeamP>({
  key: "etat_equipe",
  description: "Dire où en est une équipe (pause, simulation ou vrai, niveau, posts du jour, canaux, quota)",
  theme: "etat",
  cls: "immediate",
  spec: { equipe: str(TEAM_DESC) },
  async execute(deps, p) {
    const t = await oneTeam(p, deps);
    if (!t.ok) return t.reply;
    const [facts, plan] = await Promise.all([stateFacts(deps, t.team), teamPlanSummary(deps, t.team)]);
    const text = pick(
      V.teamState({
        facts: facts.lines.slice(1).map(esc),
        algo: t.team === "algo",
        channels: plan.channels.slice(0, 6).map(esc),
        postsPerDay: plan.postsPerDay,
        caps: plan.caps ? esc(plan.caps) : null,
      }),
      "teams.teamState",
      chatOf(deps),
    );
    return lines(...text.split("\n"));
  },
});

type ChannelP = { canal: string };

export const etatCanal = defineAction<ChannelP>({
  key: "etat_canal",
  description: "Dire où en est un canal (plan activé ou non, posts par jour, persona, mélange vidéo / photo / texte)",
  theme: "canaux",
  cls: "immediate",
  spec: { canal: str("Titre du canal (ou prénom de sa persona)") },
  async execute(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "etat_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const { team: t, plan, exists } = await currentChannelPlan(deps, c.value.id);
    const persona = plan.personaId ? ((await deps.prisma.persona.findUnique({ where: { id: plan.personaId }, select: { name: true } })) as { name: string } | null) : null;
    const name = `<b>${esc(c.value.name)}</b>`;
    if (!exists)
      return { reply: pick(V.channelNoPlan({ name, channel: esc(c.value.name), team: t ? TEAM_LABELS[t] : null }), "teams.channelNoPlan", chatOf(deps)) };
    return {
      reply: pick(
        V.channelState({
          name,
          isTest: !!c.value.isTest,
          enabled: plan.enabled,
          team: t ? TEAM_LABELS[t] : null,
          postsPerDay: plan.postsPerDay,
          start: plan.windowStart,
          end: plan.windowEnd,
          video: plan.mix.video,
          photo: plan.mix.photo,
          text: plan.mix.text,
          persona: persona ? esc(persona.name) : null,
          needsPersona: !persona && t === "dating",
        }),
        "teams.channelState",
        chatOf(deps),
      ),
    };
  },
});

export const pause = defineAction<TeamP>({
  key: "pause",
  description: "Mettre en pause une équipe (rencontres, casino, paris sportifs, algorithme) ou tout",
  theme: "equipes",
  cls: "immediate",
  spec: { equipe: str(`${TEAM_DESC}, ou « tout »`) },
  async execute(deps, p, actor) {
    const t = await team(p, true);
    if (!t.ok) return t.reply;
    return fromResult(await setTeamPaused(deps, t.team, true, actorRef(actor), "pause demandée à Kevin"));
  },
});

export const reprise = defineAction<TeamP>({
  key: "reprise",
  description: "Faire reprendre le travail à une équipe en pause, ou lever la pause générale",
  theme: "equipes",
  cls: "immediate",
  spec: { equipe: str(`${TEAM_DESC}, ou « tout »`) },
  async execute(deps, p, actor) {
    const t = await team(p, true);
    if (!t.ok) return t.reply;
    const r = await setTeamPaused(deps, t.team, false, actorRef(actor));
    const still = t.team !== "all" && (await isPausedAll(deps)) ? `\n${pick(V.stillPausedAll, "teams.stillPausedAll", chatOf(deps))}` : "";
    return { reply: esc(r.message) + still };
  },
});

type LevelP = { equipe: string; niveau: number };

async function currentLevel(deps: BossDeps, t: TeamKey): Promise<0 | 1 | 2> {
  return (await loadTeamSettings(deps.prisma, t)).autonomyLevel;
}

export const niveau = defineAction<LevelP>({
  key: "niveau",
  check: (d, p) => teamCheck(d, p.equipe),
  description: "Changer le niveau d'autonomie d'une équipe : 0 je valide tout, 1 je valide les nouveautés, 2 autonomie totale",
  theme: "equipes",
  cls: "confirm",
  spec: { equipe: str(TEAM_DESC), niveau: int("Niveau voulu : 0, 1 ou 2", 0, 2) },
  refine: (p) => checkLevel(p.niveau),
  async classify(deps, p): Promise<BossActionClass> {
    const t = teamOf(p.equipe);
    if (!t || t === "all") return "immediate";
    return p.niveau <= (await currentLevel(deps, t)) ? "immediate" : "confirm";
  },
  async summarize(deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    const now = await currentLevel(deps, t);
    return pick(V.levelSummary({ team: TEAM_LABELS[t], from: now, to: p.niveau, label: AUTONOMY_LABELS[p.niveau as 0 | 1 | 2] }), "teams.levelSummary", chatOf(deps));
  },
  async execute(deps, p, actor) {
    const t = await oneTeam(p, deps);
    if (!t.ok) return t.reply;
    const err = checkLevel(p.niveau);
    if (err) return { reply: err };
    if ((await currentLevel(deps, t.team)) === p.niveau) return { reply: pick(V.levelAlready({ team: TEAM_LABELS[t.team], level: p.niveau }), "teams.levelAlready", chatOf(deps)) };
    return fromResult(await setAutonomyLevel(deps, t.team, p.niveau as 0 | 1 | 2, actorRef(actor)));
  },
});

type SimP = { equipe: string; mode: "simulation" | "vrai" };

export const simulation = defineAction<SimP>({
  key: "simulation",
  check: (d, p) => teamCheck(d, p.equipe),
  description: "Passer une équipe en vrai (posts sur les vrais canaux) ou la remettre en simulation (canal Test)",
  theme: "equipes",
  cls: "confirm",
  spec: { equipe: str(TEAM_DESC), mode: oneOf("« vrai » = vrais canaux, « simulation » = canal Test", ["simulation", "vrai"]) },
  async classify(_deps, p) {
    return p.mode === "simulation" ? "immediate" : "confirm";
  },
  async summarize(deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    const s = await teamPlanSummary(deps, t);
    return pick(V.realSummary({ team: TEAM_LABELS[t], channels: s.channels, level: s.level, postsPerDay: s.postsPerDay, caps: s.caps || null }), "teams.realSummary", chatOf(deps));
  },
  async execute(deps, p, actor) {
    const t = await oneTeam(p, deps);
    if (!t.ok) return t.reply;
    const s = await teamPlanSummary(deps, t.team);
    const wantSim = p.mode === "simulation";
    if (s.simulation === wantSim) return { reply: pick(V.modeAlready({ team: TEAM_LABELS[t.team], sim: wantSim }), "teams.modeAlready", chatOf(deps)) };
    return fromResult(await setSimulation(deps, t.team, wantSim, actorRef(actor)));
  },
});

const POSTES: Record<string, ProviderKey> = { image: "image", ia: "llm", cotes: "odds", captures: "screenshot" };
type CapP = { equipe: string; poste: "image" | "ia" | "cotes" | "captures"; euros: number };

async function currentCap(deps: BossDeps, t: TeamKey, provider: ProviderKey): Promise<number | undefined> {
  return (await loadTeamSettings(deps.prisma, t)).monthlyBudgetCents[provider];
}

export const plafond = defineAction<CapP>({
  key: "plafond",
  check: (d, p) => teamCheck(d, p.equipe),
  description: "Changer le plafond mensuel d'une équipe pour un poste (image, IA, cotes, captures), en euros",
  theme: "equipes",
  cls: "confirm",
  spec: {
    equipe: str(`${TEAM_DESC} (vidéo et image : rencontres ; cotes : paris sportifs)`),
    poste: oneOf("Poste de dépense", ["image", "ia", "cotes", "captures"]),
    euros: num("Nouveau plafond mensuel en euros (0 = aucune dépense)", 0, 100_000),
  },
  refine: (p) => checkCap(p.euros),
  async classify(deps, p) {
    const t = teamOf(p.equipe);
    if (!t || t === "all") return "immediate";
    const cur = await currentCap(deps, t, POSTES[p.poste]!);
    // Sans plafond, la dépense n'a pas de limite : en poser un est une baisse.
    return cur !== undefined && Math.round(p.euros * 100) > cur ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const t = teamOf(p.equipe) as TeamKey;
    const provider = POSTES[p.poste]!;
    const cur = await currentCap(deps, t, provider);
    return pick(
      V.capSummary({ provider: PROVIDER_LABELS[provider], team: TEAM_LABELS[t], from: cur === undefined ? null : eur(cur), to: eur(Math.round(p.euros * 100)) }),
      "teams.capSummary",
      chatOf(deps),
    );
  },
  async execute(deps, p, actor) {
    const t = await oneTeam(p, deps);
    if (!t.ok) return t.reply;
    const err = checkCap(p.euros);
    if (err) return { reply: err };
    const provider = POSTES[p.poste]!;
    await setTeamBudget(deps, t.team, provider, Math.round(p.euros * 100), actorRef(actor));
    return { reply: pick(V.capDone({ provider: PROVIDER_LABELS[provider], team: TEAM_LABELS[t.team], amount: eur(Math.round(p.euros * 100)) }), "teams.capDone", chatOf(deps)) };
  },
});

type QuotaP = { cible: string; posts_par_jour: number };

/** Équipe ou canal visé par « quota » (pur côté équipe, base pour le canal). */
async function quotaTarget(deps: BossDeps, p: QuotaP): Promise<{ ok: true; team: TeamKey } | { ok: true; channel: ChannelRef } | { ok: false; reply: BossReply }> {
  const t = teamOf(p.cible);
  if (t && t !== "all") return { ok: true, team: t };
  const c = await resolveChannel(deps, { actionKey: "quota_posts", params: p, field: "cible" }, p.cible);
  return c.ok ? { ok: true, channel: c.value } : { ok: false, reply: c.reply };
}

async function maxPosts(deps: BossDeps): Promise<number> {
  return (await loadAlgoTeam(deps.prisma)).settings.maxPostsPerDay;
}

export const quotaPosts = defineAction<QuotaP>({
  key: "quota_posts",
  check: async (deps, p) => { const err = checkQuota(p.posts_par_jour, await maxPosts(deps)); if (err) return { reply: err }; const t = await quotaTarget(deps, p); return t.ok ? null : t.reply; },
  description: "Changer le nombre de posts par jour d'un canal (ou de tous les canaux d'une équipe)",
  theme: "canaux",
  cls: "confirm",
  spec: {
    cible: str("Titre du canal, prénom de la persona du canal, ou nom de l'équipe"),
    posts_par_jour: int("Nombre de posts par jour voulu", 0, 48),
  },
  async classify(deps, p) {
    const target = await quotaTarget(deps, p);
    if (!target.ok) return "immediate";
    if ("team" in target) {
      const s = await teamPlanSummary(deps, target.team);
      const n = Math.max(1, s.channels.length);
      return p.posts_par_jour * n > s.postsPerDay ? "confirm" : "immediate";
    }
    const { plan } = await currentChannelPlan(deps, target.channel.id);
    return p.posts_par_jour > plan.postsPerDay ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const target = await quotaTarget(deps, p);
    if (target.ok && "channel" in target) {
      const { plan } = await currentChannelPlan(deps, target.channel.id);
      return pick(V.quotaChannelSummary({ name: target.channel.name, from: plan.postsPerDay, to: p.posts_par_jour }), "teams.quotaChannelSummary", chatOf(deps));
    }
    const t = target.ok && "team" in target ? target.team : "dating";
    return pick(V.quotaTeamSummary({ team: TEAM_LABELS[t], n: p.posts_par_jour }), "teams.quotaTeamSummary", chatOf(deps));
  },
  async execute(deps, p, actor) {
    const err = checkQuota(p.posts_par_jour, await maxPosts(deps));
    if (err) return { reply: err };
    const target = await quotaTarget(deps, p);
    if (!target.ok) return target.reply;
    if ("team" in target) {
      const r = await setTeamPostsPerDay(deps, target.team, p.posts_par_jour, actorRef(actor));
      if (!r.ok) return { reply: esc(r.error) };
      return { reply: pick(V.quotaTeamDone({ team: TEAM_LABELS[target.team], n: p.posts_par_jour, changed: r.changed }), "teams.quotaTeamDone", chatOf(deps)) };
    }
    const r = await updateChannelPlan(deps, target.channel.id, { postsPerDay: p.posts_par_jour }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: pick(V.quotaChannelDone({ name: esc(target.channel.name), n: p.posts_par_jour }), "teams.quotaChannelDone", chatOf(deps)) };
  },
});

type PlanP = { canal: string; actif: boolean };

export const planCanal = defineAction<PlanP>({
  key: "plan_canal",
  check: (deps, p) => channelCheck(deps, "plan_canal", p, "canal", p.canal),
  description: "Activer ou désactiver le travail des agents sur un canal",
  theme: "canaux",
  cls: "confirm",
  spec: { canal: str("Titre du canal (ou prénom de sa persona)"), actif: bool("true = activer, false = désactiver") },
  async classify(_d, p) {
    return p.actif ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "plan_canal", params: p, field: "canal" }, p.canal);
    const name = c.ok ? c.value.name : p.canal;
    const plan = c.ok ? (await currentChannelPlan(deps, c.value.id)).plan : null;
    return pick(
      V.planSummary({ name, plan: plan ? { postsPerDay: plan.postsPerDay, start: plan.windowStart, end: plan.windowEnd } : null }),
      "teams.planSummary",
      chatOf(deps),
    );
  },
  async execute(deps, p, actor) {
    const c = await resolveChannel(deps, { actionKey: "plan_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const { plan } = await currentChannelPlan(deps, c.value.id);
    if (plan.enabled === p.actif) return { reply: pick(V.planAlready({ name: esc(c.value.name), on: p.actif }), "teams.planAlready", chatOf(deps)) };
    const r = await updateChannelPlan(deps, c.value.id, { enabled: p.actif }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: pick(V.planDone({ name: esc(c.value.name), on: p.actif }), "teams.planDone", chatOf(deps)) };
  },
});

type PersonaP = { canal: string; persona: string };

export const personaCanal = defineAction<PersonaP>({
  key: "persona_canal",
  check: async (deps, p) => (await channelCheck(deps, "persona_canal", p, "canal", p.canal)) ?? personaCheck(deps, "persona_canal", p, p.persona),
  description: "Choisir la persona (le personnage) d'un canal Rencontres",
  theme: "canaux",
  cls: "confirm",
  spec: { canal: str("Titre du canal"), persona: str("Prénom de la persona") },
  async summarize(deps, p) {
    return pick(V.personaSummary({ persona: p.persona, channel: p.canal }), "teams.personaSummary", chatOf(deps));
  },
  async execute(deps, p, actor) {
    const c = await resolveChannel(deps, { actionKey: "persona_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const pe = await resolvePersona(deps, { actionKey: "persona_canal", params: p, field: "persona" }, p.persona);
    if (!pe.ok) return pe.reply;
    const r = await updateChannelPlan(deps, c.value.id, { personaId: pe.value.id }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: pick(V.personaDone({ persona: esc(pe.value.name), channel: esc(c.value.name) }), "teams.personaDone", chatOf(deps)) };
  },
});

type MixP = { canal: string; video: number; photo: number; texte: number };

export const melangeCanal = defineAction<MixP>({
  key: "melange_canal",
  async check(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "melange_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    // Rencontres : plus de vidéos IA depuis le 29 octobre 2026.
    if (p.video > 0 && (await currentChannelPlan(deps, c.value.id)).team === "dating")
      return { reply: "L'équipe Rencontres ne fait plus de vidéos. Donne-moi juste les parts de photos et de textes." };
    return null;
  },
  description: "Changer le mélange vidéo / photo / texte des posts d'un canal (parts relatives ; pas de vidéo pour un canal Rencontres)",
  theme: "canaux",
  cls: "confirm",
  spec: {
    canal: str("Titre du canal"),
    video: int("Part de vidéos", 0, 100),
    photo: int("Part de photos", 0, 100),
    texte: int("Part de textes", 0, 100),
  },
  refine: (p) => (p.video + p.photo + p.texte > 0 ? null : "mélange vide"),
  async classify(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "melange_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return "immediate";
    const { plan } = await currentChannelPlan(deps, c.value.id);
    const share = (m: { video: number; photo: number; text: number }) => m.video / Math.max(1, m.video + m.photo + m.text);
    // Plus de vidéos = plus de dépense : à confirmer.
    return share({ video: p.video, photo: p.photo, text: p.texte }) > share(plan.mix) ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    return pick(V.mixSummary({ channel: p.canal, video: p.video, photo: p.photo, text: p.texte }), "teams.mixSummary", chatOf(deps));
  },
  async execute(deps, p, actor) {
    const c = await resolveChannel(deps, { actionKey: "melange_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const r = await updateChannelPlan(deps, c.value.id, { mix: { video: p.video, photo: p.photo, text: p.texte } }, actorRef(actor));
    if (!r.ok) return { reply: esc(r.error) };
    return { reply: pick(V.mixDone({ channel: esc(c.value.name), video: p.video, photo: p.photo, text: p.texte }), "teams.mixDone", chatOf(deps)) };
  },
});

export const TEAM_ACTIONS: BossAction[] = [
  etatEquipe,
  etatCanal,
  pause,
  reprise,
  niveau,
  simulation,
  plafond,
  quotaPosts,
  planCanal,
  personaCanal,
  melangeCanal,
] as unknown as BossAction[];

