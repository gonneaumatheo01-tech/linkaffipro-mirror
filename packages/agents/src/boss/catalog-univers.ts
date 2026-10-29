/**
 * Entrées du catalogue du Boss par univers : Rencontres (personas, stock, banc d'essai), Casino (thèmes, stock, offre
 * d'un canal), Paris sportifs (catégories, paris du jour, bilan),
 * Algorithme (réglages de la semaine, appliquer, annuler, tests en cours), Ads (recommandations, fait, refuser,
 * seuils), posts et paris de test. Toujours par les fonctions existantes ; aucune nouvelle capacité de publication.
 */
import { agentAudit, esc, nowOf } from "../admin/journal";
import { agentsOverview } from "../orchestrator/overview-contract";
import { readCasinoThemes } from "../casino/themes";
import { loadCasinoOffer } from "../casino/offer";
import { applyRecommendation, undoRecommendation } from "../algo/contracts";
import { markAdsRecommendation } from "../ads/contracts";
import { loadAdsThresholdsView } from "../agents/ads/analysis";
import { createTestBetMission } from "../sports/contracts";
import { createTestPostMission } from "../missions/test-post";
import { setBetCategoryActive } from "../control/bet-category";
import { currentChannelPlan } from "../control/channel-plan";
import { TEAM_LABELS, type TeamKey } from "../types";
import type { BossAction, BossDeps, BossReply } from "./contract";
import { actorRef, defineAction, escLines, lines, plural } from "./catalog-kit";
import { int, oneOf, str } from "./params";
import { resolveBetCategory, resolveChannel, resolvePersona, resolveTeam, personaRefs } from "./resolve";
import { adsProposed, algoApplied, algoProposed, betSummaryFacts, betsTodayFacts, recommendationLabel, stockFacts, targetNames } from "./facts";

import { pick, voiceTemplate, type VoiceTable } from "./voice";

type Empty = Record<string, never>;

/** Textes fixes de ce module (voix de Kevin, `docs/KEVIN-VOIX.md`), 2 à 4 variantes chacun. */
export const CATALOG_UNIVERS_VARIANTS = {
  noPersona: [
    "Aucune persona pour l'instant. Tu en crées une dans Conversations → Personas ?",
    "Pas encore de persona. Ça se crée dans Conversations → Personas.",
  ],
  personasHead: voiceTemplate([{ n: 1 }, { n: 3 }], (p: { n: number }) => [
    `${p.n > 1 ? `Tes ${p.n} personas` : "Ta persona"} :`,
    `${plural(p.n, "persona")} en tout :`,
  ]),
  casinoThemes: voiceTemplate([{ n: 3, tags: "#roulette #blackjack #slots" }], (p: { n: number; tags: string }) => [
    `${plural(p.n, "thème")} casino : ${p.tags}\nPour déposer une vidéo, mets en légende #casino puis le thème (par exemple #casino #roulette).`,
    `Les thèmes casino (${p.n}) : ${p.tags}\nEnvoie la vidéo avec #casino et le thème en légende, par exemple #casino #roulette.`,
  ]),
  offerNone: voiceTemplate([{ canal: "Roulette Pro" }], (p: { canal: string }) => [
    `${p.canal} n'a aucune campagne liée au plan, donc pas de bouton Offre.`,
    `Pas de bouton Offre sur ${p.canal} : aucune campagne n'est liée à son plan.`,
  ]),
  offerHead: voiceTemplate([{ canal: "Roulette Pro", offer: "Bonus 100 %", campaign: "Casino octobre" }], (p: { canal: string; offer: string; campaign: string }) => [
    `Sur ${p.canal}, c'est l'offre « ${p.offer} » (campagne ${p.campaign}).`,
    `${p.canal} met en avant « ${p.offer} », de la campagne ${p.campaign}.`,
  ]),
  offerButtonReady: ["Le bouton Offre est prêt ✅", "Bouton Offre prêt ✅"],
  offerButtonMissing: [
    "Le bouton Offre n'est pas prêt : aucune offre Link Affi active avec un lien.",
    "Pas encore de bouton Offre, il manque une offre Link Affi active avec un lien.",
  ],
  offerFacts: ["La fiche de l'offre est écrite.", "Sa fiche est bien remplie."],
  offerNoFacts: ["Pas de fiche pour l'offre : les posts n'en donnent que le nom.", "La fiche de l'offre manque, les posts ne citent que son nom."],
  noCategory: ["Aucune catégorie de paris.", "Il n'y a aucune catégorie de paris pour l'instant."],
  categoriesHead: ["Catégories de paris :", "Tes catégories de paris :"],
  categorySummary: voiceTemplate([{ name: "corners" }], (p: { name: string }) => [
    `J'active les paris « ${p.name} » ?\nL'équipe Paris sportifs en proposera dès son prochain passage, toujours en test si elle l'est.`,
    `On ajoute la catégorie « ${p.name} » ?\nLes paris arriveront au prochain passage de l'équipe, rien d'autre ne change.`,
  ]),
  algoHead: voiceTemplate([{ n: 0 }, { n: 2 }], (p: { n: number }) => [
    `Cette semaine, l'équipe Algorithme a appliqué ${plural(p.n, "réglage")}.`,
    `Algorithme : ${plural(p.n, "réglage appliqué", "réglages appliqués")} cette semaine.`,
  ]),
  algoToApply: ["À appliquer :", "En attente de ton feu vert :"],
  algoNoneWaiting: ["Aucun réglage en attente.", "Rien en attente de ton côté."],
  algoApplied: ["Derniers appliqués (« annule le réglage 1 » pour revenir en arrière) :", "Déjà appliqués (tu peux dire « annule le réglage 1 ») :"],
  unknownNumber: voiceTemplate([{ n: 5, max: 3 }], (p: { n: number; max: number }) => [
    `Je n'ai pas de numéro ${p.n}, la liste va de 1 à ${p.max}.`,
    `Le numéro ${p.n} n'existe pas : choisis entre 1 et ${p.max}.`,
  ]),
  noProposed: ["Aucun réglage proposé en attente.", "L'équipe Algorithme n'a rien proposé en ce moment."],
  applySummary: voiceTemplate([{ n: 1, line: "posts par jour (Roulette Pro)" }], (p: { n: number; line: string }) => [
    `J'applique le réglage n°${p.n} de l'équipe Algorithme ?\n${p.line}`,
    `On applique le réglage n°${p.n} ?\n${p.line}`,
  ]),
  recoNotFound: ["réglage introuvable", "réglage disparu de la liste"],
  noApplied: ["Aucun réglage appliqué à annuler.", "Rien à annuler, aucun réglage n'a été appliqué."],
  noAbTest: ["Aucun test A/B en cours.", "Pas de test A/B en ce moment."],
  abHead: voiceTemplate([{ n: 1 }, { n: 2 }], (p: { n: number }) => [
    `${plural(p.n, "test A/B")} en cours :`,
    `En ce moment, ${plural(p.n, "test A/B")} :`,
  ]),
  noAds: ["Aucun conseil pubs en attente.", "Rien à te conseiller sur les pubs pour l'instant."],
  adsHead: voiceTemplate([{ n: 1 }, { n: 3 }], (p: { n: number }) => [
    `${plural(p.n, "conseil")} sur tes pubs :`,
    `Sur tes pubs, je te conseille (${p.n}) :`,
  ]),
  adsHow: [
    "Dis « fait 1 » quand tu l'as fait chez Meta ou TikTok, ou « refuse 1 ».",
    "Quand c'est fait chez Meta ou TikTok, écris « fait 1 ». Sinon « refuse 1 ».",
  ],
  thresholdsHead: ["Seuils des pubs :", "Tes seuils pubs :"],
  thresholdsHow: ["Pour les changer : Agents → Ads → Seuils.", "Ça se change dans Agents → Ads → Seuils."],
  testPostTeam: [
    "Un post de test, c'est pour l'équipe Rencontres ou Casino. Pour les paris, demande-moi un pari de test ?",
    "Je fais des posts de test pour Rencontres ou Casino. Pour Paris sportifs, tu veux un pari de test ?",
  ],
  testPostSummary: voiceTemplate(
    [
      { format: "vidéo ", team: "casino" },
      { format: "", team: "rencontres" },
    ],
    (p: { format: string; team: string }) => [
      `Je te fais un post ${p.format}de test ${p.team} sur le canal Test, pour de faux ?\nUne vidéo ou une photo coûte un peu chez le fournisseur.`,
      `Je sors un post ${p.format}de test ${p.team} sur le canal Test ?\nC'est pour de faux ; une vidéo ou une photo coûte un peu chez le fournisseur.`,
    ],
  ),
  testPostOk: [
    "C'est lancé. L'aperçu arrive ici, puis sur le canal Test, pour de faux.",
    "Je m'en occupe : tu vois l'aperçu ici d'abord, puis il part sur le canal Test.",
  ],
  testPostRefused: voiceTemplate([{ reason: "aucune persona active" }], (p: { reason: string }) => [
    `Je ne peux pas faire ce post de test : ${p.reason}.`,
    `Post de test impossible : ${p.reason}.`,
  ]),
  testBetSummary: voiceTemplate([{ cat: "corners" }, { cat: "" }], (p: { cat: string }) => [
    `Je te sors un pari${p.cat ? ` ${p.cat}` : ""} sur le canal Test, pour de faux ?`,
    `Un pari de test${p.cat ? ` ${p.cat}` : ""} sur le canal Test, avec des cotes d'essai et aucune mise ?`,
  ]),
  testBetOk: [
    "C'est lancé. Le pari arrive sur le canal Test dans quelques minutes, pour de faux, aucune mise.",
    "C'est parti : le pari de test arrive sur le canal Test d'ici quelques minutes. Aucune vraie mise.",
  ],
  testBetRefused: voiceTemplate([{ reason: "aucune cote dans la fourchette" }], (p: { reason: string }) => [
    `Je ne peux pas sortir ce pari de test : ${p.reason}.`,
    `Pari de test impossible : ${p.reason}.`,
  ]),
} satisfies VoiceTable;

const V = CATALOG_UNIVERS_VARIANTS;
/** Conversation en cours (rotation des variantes), si le bot l'a donnée. */
const chatOf = (deps: BossDeps) => (deps as { chat?: { chatId?: bigint | null } | null }).chat?.chatId ?? null;
const say = (deps: BossDeps, variants: readonly string[], key: string) => pick(variants, `univers.${key}`, chatOf(deps));

// ---------------------------------------------------------------------------------------------------------------- Rencontres

export const personas = defineAction<Empty>({
  key: "personas",
  description: "Lister les personas (personnages) et leurs canaux",
  theme: "rencontres",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const [refs, plans, channels] = await Promise.all([
      personaRefs(deps),
      deps.prisma.channelAgentPlan.findMany({ where: { personaId: { not: null } }, select: { channelId: true, personaId: true, enabled: true } }),
      deps.prisma.channel.findMany({ select: { id: true, title: true } }),
    ]);
    if (!refs.length) return { reply: say(deps, V.noPersona, "noPersona") };
    const title = new Map((channels as { id: string; title: string }[]).map((c) => [c.id, c.title]));
    const ps = plans as { channelId: string; personaId: string | null; enabled: boolean }[];
    return lines(
      say(deps, V.personasHead({ n: refs.length }), "personasHead"),
      ...refs.slice(0, 10).map((p) => {
        const ch = ps.filter((x) => x.personaId === p.id).map((x) => `${title.get(x.channelId) ?? "?"}${x.enabled ? "" : " (désactivé)"}`);
        return esc(`${p.name}${p.isActive ? "" : " (inactive)"} · ${p.universe} · ${ch.length ? ch.join(", ") : "aucun canal"}`);
      }),
    );
  },
});

type TeamOpt = { equipe?: string };

export const stockMedias = defineAction<TeamOpt>({
  key: "stock_medias",
  description: "Dire le stock de médias : photos par persona (Rencontres), thèmes en manque (Casino)",
  theme: "rencontres",
  cls: "immediate",
  spec: { equipe: str("rencontres ou casino (facultatif : les deux)", { optional: true }) },
  async execute(deps, p) {
    let team: TeamKey | null = null;
    if (p.equipe) {
      const r = resolveTeam(p.equipe, { allowAll: true });
      if (!r.ok) return r.reply;
      team = r.value === "all" ? null : r.value;
    }
    return { reply: escLines((await stockFacts(deps, team)).lines) };
  },
});

// ---------------------------------------------------------------------------------------------------------------- Casino

export const themesCasino = defineAction<Empty>({
  key: "themes_casino",
  description: "Lister les thèmes de l'équipe Casino (mots-clés #casino #<thème> pour déposer des médias)",
  theme: "casino",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const themes = await readCasinoThemes(deps);
    return { reply: say(deps, V.casinoThemes({ n: themes.length, tags: esc(themes.map((t) => `#${t}`).join(" ")) }), "casinoThemes") };
  },
});

type ChannelP = { canal: string };

export const offreCanal = defineAction<ChannelP>({
  key: "offre_canal",
  description: "Dire quelle offre est mise en avant sur un canal (campagne du plan, bouton Offre prêt ou non)",
  theme: "casino",
  cls: "immediate",
  spec: { canal: str("Titre du canal") },
  async execute(deps, p) {
    const c = await resolveChannel(deps, { actionKey: "offre_canal", params: p, field: "canal" }, p.canal);
    if (!c.ok) return c.reply;
    const { plan } = await currentChannelPlan(deps, c.value.id);
    const offer = await loadCasinoOffer(deps.prisma, plan.campaignId);
    if (!offer) return { reply: say(deps, V.offerNone({ canal: esc(c.value.name) }), "offerNone") };
    return lines(
      say(deps, V.offerHead({ canal: esc(c.value.name), offer: esc(offer.name), campaign: esc(offer.campaignName) }), "offerHead"),
      offer.buttonReady ? say(deps, V.offerButtonReady, "offerButtonReady") : say(deps, V.offerButtonMissing, "offerButtonMissing"),
      offer.facts ? say(deps, V.offerFacts, "offerFacts") : say(deps, V.offerNoFacts, "offerNoFacts"),
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------- Paris

export const categoriesParis = defineAction<Empty>({
  key: "categories_paris",
  description: "Lister les catégories de paris (tirs cadrés, corners…) et dire lesquelles sont actives",
  theme: "paris",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const rows = (await deps.prisma.betCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true, active: true, picksPerDay: true } })) as {
      name: string;
      active: boolean;
      picksPerDay: number;
    }[];
    if (!rows.length) return { reply: say(deps, V.noCategory, "noCategory") };
    return lines(
      say(deps, V.categoriesHead, "categoriesHead"),
      ...rows.map((r) => esc(r.active ? `✅ ${r.name} (${plural(r.picksPerDay, "pari")} par jour au plus)` : `• ${r.name} (désactivée)`)),
    );
  },
});

type CategoryP = { categorie: string; active: boolean };

export const categorieParis = defineAction<CategoryP>({
  key: "categorie_paris",
  check: async (deps, p) => { const r = await resolveBetCategory(deps, { actionKey: "categorie_paris", params: p, field: "categorie" }, p.categorie); return r.ok ? null : r.reply; },
  description: "Activer ou désactiver une catégorie de paris (« active les corners »)",
  theme: "paris",
  cls: "confirm",
  spec: {
    categorie: str("Nom de la catégorie (tirs cadrés, corners, buteurs…)"),
    active: { kind: "bool", description: "true = activer, false = désactiver" },
  },
  async classify(_d, p) {
    return p.active ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const c = await resolveBetCategory(deps, { actionKey: "categorie_paris", params: p, field: "categorie" }, p.categorie);
    return say(deps, V.categorySummary({ name: c.ok ? c.value.name : p.categorie }), "categorySummary");
  },
  async execute(deps, p, actor) {
    const c = await resolveBetCategory(deps, { actionKey: "categorie_paris", params: p, field: "categorie" }, p.categorie);
    if (!c.ok) return c.reply;
    return { reply: esc((await setBetCategoryActive(deps, c.value.id, p.active, actorRef(actor))).message) };
  },
});

export const parisDuJour = defineAction<Empty>({
  key: "paris_du_jour",
  description: "Lister les paris du jour (match, pari, cote, état)",
  theme: "paris",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: escLines((await betsTodayFacts(deps)).lines) };
  },
});

type PeriodP = { periode: "7j" | "28j" };

export const bilanParis = defineAction<PeriodP>({
  key: "bilan_paris",
  description: "Donner le bilan des paris sur 7 ou 28 jours (gagnés, perdus, réussite) par catégorie",
  theme: "paris",
  cls: "immediate",
  spec: { periode: oneOf("7j ou 28j", ["7j", "28j"]) },
  async execute(deps, p) {
    return { reply: escLines((await betSummaryFacts(deps, p.periode)).lines) };
  },
});

// ---------------------------------------------------------------------------------------------------------------- Algorithme

export const reglagesSemaine = defineAction<Empty>({
  key: "reglages_semaine",
  description: "Montrer les réglages proposés et appliqués par l'équipe Algorithme cette semaine (numérotés)",
  theme: "algorithme",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const [proposed, applied, o] = await Promise.all([algoProposed(deps), algoApplied(deps), agentsOverview(deps.prisma, { now: nowOf(deps) })]);
    const names = await targetNames(deps, [...proposed, ...applied]);
    return lines(
      say(deps, V.algoHead({ n: o.algoAppliedThisWeek.length }), "algoHead"),
      proposed.length ? say(deps, V.algoToApply, "algoToApply") : say(deps, V.algoNoneWaiting, "algoNoneWaiting"),
      ...proposed.map((r, i) => esc(`${i + 1}. ${recommendationLabel(r, names, r.targetId)}`)),
      applied.length ? say(deps, V.algoApplied, "algoApplied") : null,
      ...applied.slice(0, 5).map((r, i) => esc(`${i + 1}. ${recommendationLabel(r, names, r.targetId)}`)),
    );
  },
});

type RecoP = { numero: number };

async function nth<T>(list: readonly T[], n: number, empty: string): Promise<{ ok: true; value: T } | { ok: false; reply: BossReply }> {
  if (!list.length) return { ok: false, reply: { reply: empty } };
  const item = list[n - 1];
  return item ? { ok: true, value: item } : { ok: false, reply: { reply: pick(V.unknownNumber({ n, max: list.length }), "univers.unknownNumber") } };
}

export const appliquerReglage = defineAction<RecoP>({
  key: "appliquer_reglage",
  check: async (deps, p) => { const r = await nth(await algoProposed(deps), p.numero, pick(V.noProposed, "univers.noProposed")); return r.ok ? null : r.reply; },
  description: "Appliquer un réglage proposé par l'équipe Algorithme (numéro de la liste des réglages de la semaine)",
  theme: "algorithme",
  cls: "confirm",
  spec: { numero: int("Numéro du réglage proposé (1 = le premier de la liste)", 1, 9) },
  async summarize(deps, p) {
    const list = await algoProposed(deps);
    const r = list[p.numero - 1];
    const names = await targetNames(deps, list);
    return say(deps, V.applySummary({ n: p.numero, line: r ? recommendationLabel(r, names, r.targetId) : V.recoNotFound[0]! }), "applySummary");
  },
  async execute(deps, p, actor) {
    const r = await nth(await algoProposed(deps), p.numero, pick(V.noProposed, "univers.noProposed"));
    if (!r.ok) return r.reply;
    return { reply: esc((await applyRecommendation(deps, r.value.id, actorRef(actor))).message) };
  },
});

type UndoP = { numero?: number };

export const annulerReglage = defineAction<UndoP>({
  key: "annuler_reglage",
  description: "Annuler un réglage appliqué par l'équipe Algorithme (le dernier par défaut) : retour à la valeur d'avant",
  theme: "algorithme",
  cls: "immediate",
  spec: { numero: int("Numéro dans la liste des derniers appliqués (absent = le dernier)", 1, 9, true) },
  async execute(deps, p, actor) {
    const r = await nth(await algoApplied(deps), p.numero ?? 1, pick(V.noApplied, "univers.noApplied"));
    if (!r.ok) return r.reply;
    return { reply: esc((await undoRecommendation(deps, r.value.id, actorRef(actor))).message) };
  },
});

export const testsEnCours = defineAction<Empty>({
  key: "tests_en_cours",
  description: "Lister les tests A/B en cours de l'équipe Algorithme",
  theme: "algorithme",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const rows = (await deps.prisma.experiment.findMany({ where: { status: "RUNNING" }, orderBy: { startedAt: "asc" }, take: 10 })) as {
      hypothesis: string;
      teamKey: string;
      endsAt: Date | null;
    }[];
    if (!rows.length) return { reply: say(deps, V.noAbTest, "noAbTest") };
    return lines(say(deps, V.abHead({ n: rows.length }), "abHead"), ...rows.map((r) => esc(`${TEAM_LABELS[r.teamKey as TeamKey] ?? r.teamKey} · ${r.hypothesis.slice(0, 90)}`)));
  },
});

// ---------------------------------------------------------------------------------------------------------------- Ads

export const recommandationsAds = defineAction<Empty>({
  key: "recommandations_ads",
  description: "Lister les recommandations de l'Agent Ads sur les pubs (numérotées) ; je n'agis jamais chez Meta ou TikTok",
  theme: "ads",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const list = await adsProposed(deps);
    if (!list.length) return { reply: say(deps, V.noAds, "noAds") };
    return lines(
      say(deps, V.adsHead({ n: list.length }), "adsHead"),
      ...list.map((r, i) => esc(`${i + 1}. ${recommendationLabel(r)}${r.expectedGain ? ` — ${r.expectedGain.slice(0, 90)}` : ""}`)),
      say(deps, V.adsHow, "adsHow"),
    );
  },
});

type AdsMarkP = { numero: number; commentaire?: string };

function adsMark(key: string, status: "DONE" | "REJECTED", description: string): BossAction<AdsMarkP> {
  return defineAction<AdsMarkP>({
    key,
    description,
    theme: "ads",
    cls: "immediate",
    spec: { numero: int("Numéro de la recommandation pubs", 1, 9), commentaire: str("Commentaire (facultatif)", { optional: true }) },
    async execute(deps, p, actor) {
      const r = await nth(await adsProposed(deps), p.numero, pick(V.noAds, "univers.noAds"));
      if (!r.ok) return r.reply;
      return { reply: esc((await markAdsRecommendation(deps, { id: r.value.id, status, comment: p.commentaire ?? null }, actorRef(actor))).message) };
    },
  });
}

export const adsFait = adsMark("ads_fait", "DONE", "Noter qu'une recommandation pubs est faite (tu l'as faite toi-même chez Meta / TikTok)");
export const adsRefuser = adsMark("ads_refuser", "REJECTED", "Refuser une recommandation pubs");

export const seuilsAds = defineAction<Empty>({
  key: "seuils_ads",
  description: "Montrer les seuils de l'Agent Ads (coût par inscription visé, retour sur dépense minimal) par univers",
  theme: "ads",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const view = await loadAdsThresholdsView(deps.prisma, nowOf(deps));
    const label: Record<string, string> = { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Rencontres" };
    return lines(
      say(deps, V.thresholdsHead, "thresholdsHead"),
      ...Object.entries(view.thresholds).map(([v, t]) =>
        esc(
          `${label[v] ?? v} : coût par inscription visé ${t.targetCostPerRegistration ?? "—"} €, retour sur dépense minimal ${t.minRoas ?? "—"}, ${t.observationDays} j d'observation, ${t.minSpend} € de dépense minimale`,
        ),
      ),
      say(deps, V.thresholdsHow, "thresholdsHow"),
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------- Tests

type TestPostP = { equipe: string; format?: "video" | "photo" | "texte"; persona?: string };

export const postTest = defineAction<TestPostP>({
  key: "post_test",
  check: async (deps, p) => { const t = resolveTeam(p.equipe); if (!t.ok) return t.reply; if (t.value !== "dating" && t.value !== "casino") return { reply: say(deps, V.testPostTeam, "testPostTeam") }; if (!p.persona) return null; const pe = await resolvePersona(deps, { actionKey: "post_test", params: p, field: "persona" }, p.persona); return pe.ok ? null : pe.reply; },
  description: "Produire un post de test en simulation sur le canal Test (rencontres ou casino ; vidéo, photo ou texte)",
  theme: "tests",
  cls: "confirm",
  spec: {
    equipe: str("rencontres ou casino"),
    format: oneOf("vidéo, photo ou texte (facultatif)", ["video", "photo", "texte"], true),
    persona: str("Prénom de la persona (Rencontres, facultatif)", { optional: true }),
  },
  async summarize(deps, p) {
    const format = p.format === "video" ? "vidéo " : p.format ? `${p.format} ` : "";
    return say(deps, V.testPostSummary({ format, team: p.equipe }), "testPostSummary");
  },
  async execute(deps, p, actor) {
    const t = resolveTeam(p.equipe);
    if (!t.ok) return t.reply;
    if (t.value !== "dating" && t.value !== "casino") return { reply: say(deps, V.testPostTeam, "testPostTeam") };
    let personaId: string | null = null;
    if (p.persona) {
      const pe = await resolvePersona(deps, { actionKey: "post_test", params: p, field: "persona" }, p.persona);
      if (!pe.ok) return pe.reply;
      personaId = pe.value.id;
    }
    const format = p.format === "texte" ? "text" : p.format;
    const r = await createTestPostMission(deps, { teamKey: t.value, byUserId: actor.userId, ...(format ? { format } : {}), personaId });
    await agentAudit(deps, { userId: actor.userId, action: "agents.test_post_requested", entityType: "AgentMission", entityId: r.ok ? r.missionId : undefined, metadata: { teamKey: t.value, format: format ?? null, via: "TELEGRAM", ok: r.ok } });
    return { reply: r.ok ? say(deps, V.testPostOk, "testPostOk") : say(deps, V.testPostRefused({ reason: esc(r.reason) }), "testPostRefused") };
  },
});

type TestBetP = { categorie?: string };

export const pariTest = defineAction<TestBetP>({
  key: "pari_test",
  check: async (deps, p) => { if (!p.categorie) return null; const c = await resolveBetCategory(deps, { actionKey: "pari_test", params: p, field: "categorie" }, p.categorie); return c.ok ? null : c.reply; },
  description: "Produire un pari de test en simulation (cotes d'essai, aucune vraie mise, canal Test)",
  theme: "tests",
  cls: "confirm",
  spec: { categorie: str("Catégorie de paris (facultatif)", { optional: true }) },
  async summarize(deps, p) {
    return say(deps, V.testBetSummary({ cat: p.categorie ?? "" }), "testBetSummary");
  },
  async execute(deps, p, actor) {
    let categoryId: string | null = null;
    if (p.categorie) {
      const c = await resolveBetCategory(deps, { actionKey: "pari_test", params: p, field: "categorie" }, p.categorie);
      if (!c.ok) return c.reply;
      categoryId = c.value.id;
    }
    const r = await createTestBetMission(deps, { categoryId, byUserId: actor.userId });
    await agentAudit(deps, { userId: actor.userId, action: "agents.test_bet_requested", entityType: "AgentMission", entityId: r.ok ? r.missionId : undefined, metadata: { teamKey: "sports", categoryId, via: "TELEGRAM", ok: r.ok } });
    return { reply: r.ok ? say(deps, V.testBetOk, "testBetOk") : say(deps, V.testBetRefused({ reason: esc(r.reason) }), "testBetRefused") };
  },
});

export const UNIVERSE_ACTIONS: BossAction[] = [
  personas,
  stockMedias,
  themesCasino,
  offreCanal,
  categoriesParis,
  categorieParis,
  parisDuJour,
  bilanParis,
  reglagesSemaine,
  appliquerReglage,
  annulerReglage,
  testsEnCours,
  recommandationsAds,
  adsFait,
  adsRefuser,
  seuilsAds,
  postTest,
  pariTest,
] as unknown as BossAction[];
