/**
 * Entrées du catalogue du Boss par univers : Rencontres (personas, stock, banc d'essai), Casino (thèmes, stock, offre
 * d'un canal), Paris sportifs (catégories, test de connexion au bookmaker, mode de capture, paris du jour, bilan),
 * Algorithme (réglages de la semaine, appliquer, annuler, tests en cours), Ads (recommandations, fait, refuser,
 * seuils), posts et paris de test. Toujours par les fonctions existantes ; aucune nouvelle capacité de publication.
 */
import { agentAudit, esc, nowOf } from "../admin/journal";
import { agentsOverview } from "../orchestrator/overview-contract";
import { startBench } from "../orchestrator/bench";
import { readCasinoThemes } from "../casino/themes";
import { loadCasinoOffer } from "../casino/offer";
import { applyRecommendation, undoRecommendation } from "../algo/contracts";
import { markAdsRecommendation } from "../ads/contracts";
import { loadAdsThresholdsView } from "../agents/ads/analysis";
import { createTestBetMission } from "../sports/contracts";
import { createTestPostMission } from "../missions/test-post";
import { setBetCategoryActive } from "../control/bet-category";
import { currentChannelPlan } from "../control/channel-plan";
import { createCaptureRequest, CAPTURE_REQUEST_PREFIX, type StoredCaptureRequest } from "../providers/screenshot/requests";
import { loadCaptureSettings, setCaptureMode } from "../providers/screenshot/settings";
import { CAPTURE_ERROR_LABELS } from "../providers/screenshot/errors";
import { TEAM_LABELS, type TeamKey } from "../types";
import type { BossAction, BossDeps, BossReply } from "./contract";
import { actorRef, defineAction, escLines, lines, plural } from "./catalog-kit";
import { int, oneOf, str } from "./params";
import { resolveBetCategory, resolveBookmaker, resolveChannel, resolvePersona, resolveTeam, personaRefs } from "./resolve";
import { adsProposed, algoApplied, algoProposed, betSummaryFacts, betsTodayFacts, recommendationLabel, stockFacts, targetNames } from "./facts";

type Empty = Record<string, never>;

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
    if (!refs.length) return { reply: "Aucune persona pour le moment (Conversations → Personas)." };
    const title = new Map((channels as { id: string; title: string }[]).map((c) => [c.id, c.title]));
    const ps = plans as { channelId: string; personaId: string | null; enabled: boolean }[];
    return lines(
      `👤 Personas (${refs.length}) :`,
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
  description: "Dire le stock de médias : vidéos sources et photos par persona (Rencontres), thèmes en manque (Casino)",
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

type PersonaP = { persona: string };

export const bancEssai = defineAction<PersonaP>({
  key: "banc_essai",
  check: async (deps, p) => { const r = await resolvePersona(deps, { actionKey: "banc_essai", params: p, field: "persona" }, p.persona); return r.ok ? null : r.reply; },
  description: "Lancer le banc d'essai vidéo d'une persona (compare les réglages, dépense quelques euros)",
  theme: "rencontres",
  cls: "confirm",
  spec: { persona: str("Prénom de la persona") },
  async summarize(_deps, p) {
    return `Lancer le banc d'essai vidéo de ${p.persona} ?\nÇa dépense quelques euros chez le fournisseur vidéo (dans le plafond du mois).`;
  },
  async execute(deps, p, actor) {
    const pe = await resolvePersona(deps, { actionKey: "banc_essai", params: p, field: "persona" }, p.persona);
    if (!pe.ok) return pe.reply;
    const r = await startBench(deps, { personaId: pe.value.id, byUserId: actor.userId });
    return { reply: esc(r.message) };
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
    return lines(`🎰 Thèmes Casino (${themes.length}) :`, esc(themes.map((t) => `#${t}`).join(" ")), "Pour déposer : envoie la vidéo avec la légende #casino #<thème>.");
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
    if (!offer) return { reply: `${esc(c.value.name)} : aucune campagne liée au plan, donc aucun bouton Offre.` };
    return lines(
      `${esc(c.value.name)} : offre « ${esc(offer.name)} » (campagne ${esc(offer.campaignName)})`,
      offer.buttonReady ? "Bouton Offre prêt ✅" : "Bouton Offre pas prêt : aucune offre Link Affi active avec un lien.",
      offer.facts ? "Fiche de l'offre : écrite." : "Fiche de l'offre : absente (les posts n'en donnent que le nom).",
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
    if (!rows.length) return { reply: "Aucune catégorie de paris." };
    return lines("⚽ Catégories de paris :", ...rows.map((r) => esc(`${r.active ? "✅" : "⏸"} ${r.name}${r.active ? ` (${plural(r.picksPerDay, "pari")} par jour au plus)` : ""}`)));
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
    return `Activer la catégorie de paris « ${c.ok ? c.value.name : p.categorie} » ?\nL'équipe Paris sportifs en proposera dès son prochain passage (simulation inchangée).`;
  },
  async execute(deps, p, actor) {
    const c = await resolveBetCategory(deps, { actionKey: "categorie_paris", params: p, field: "categorie" }, p.categorie);
    if (!c.ok) return c.reply;
    return { reply: esc((await setBetCategoryActive(deps, c.value.id, p.active, actorRef(actor))).message) };
  },
});

type BookmakerP = { bookmaker?: string };

export const testBookmaker = defineAction<BookmakerP>({
  key: "test_bookmaker",
  description: "Lancer un test de connexion au compte bookmaker (Sportaza…) : résultat par message dans une minute",
  theme: "paris",
  cls: "immediate",
  spec: { bookmaker: str("Nom du bookmaker (sportaza…)", { optional: true }) },
  async execute(deps, p, actor) {
    const b = resolveBookmaker(p.bookmaker);
    if (!b.ok) return b.reply;
    const settings = await loadCaptureSettings(deps.prisma);
    await createCaptureRequest(deps.prisma, { kind: "test", target: settings.mode, bookmaker: b.value, notifyAdmin: true, now: nowOf(deps) });
    await agentAudit(deps, { userId: actor.userId, action: "agents.bookmaker_tested", entityType: "Bookmaker", entityId: b.value, metadata: { via: "TELEGRAM", queued: true } });
    return { reply: `Test de connexion à ${esc(b.value)} lancé${settings.mode === "mac" ? " (capture depuis le Mac)" : ""} : je t'envoie le résultat dans une minute.` };
  },
});

/** Dernier test de connexion d'un bookmaker (demandes de capture en base). */
async function lastConnectionTest(deps: BossDeps, bookmaker: string): Promise<StoredCaptureRequest | null> {
  const rows = (await deps.prisma.setting.findMany({ where: { key: { startsWith: CAPTURE_REQUEST_PREFIX } }, take: 300 })) as { value: unknown }[];
  const tests = rows
    .map((r) => r.value as StoredCaptureRequest)
    .filter((v) => v && typeof v === "object" && v.kind === "test" && v.bookmaker === bookmaker)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return tests[0] ?? null;
}

export const connexionBookmaker = defineAction<BookmakerP>({
  key: "connexion_bookmaker",
  description: "Dire si la connexion au compte bookmaker a marché (résultat du dernier test)",
  theme: "paris",
  cls: "immediate",
  spec: { bookmaker: str("Nom du bookmaker (sportaza…)", { optional: true }) },
  async execute(deps, p) {
    const b = resolveBookmaker(p.bookmaker);
    if (!b.ok) return b.reply;
    const t = await lastConnectionTest(deps, b.value);
    if (!t) return { reply: `Aucun test de connexion à ${esc(b.value)} pour le moment. Dis « teste la connexion à ${esc(b.value)} ».` };
    const day = t.createdAt.slice(0, 16).replace("T", " à ");
    if (!t.result) return { reply: `Le dernier test (${day} UTC) n'a pas encore de résultat : le worker ne l'a pas encore fait.` };
    if (t.result.ok) return { reply: `Oui ✅ : connexion à ${esc(b.value)} réussie au dernier test (${day} UTC).` };
    return {
      reply: `Non ❌ : le dernier test (${day} UTC) a échoué : ${esc(CAPTURE_ERROR_LABELS[t.result.kind] ?? t.result.kind)}${t.result.message ? ` (${esc(t.result.message.slice(0, 120))})` : ""}.`,
    };
  },
});

type ModeP = { mode: "serveur" | "mac" };

export const modeCapture = defineAction<ModeP>({
  key: "mode_capture",
  description: "Choisir où se font les captures du bookmaker : sur le serveur ou depuis le Mac",
  theme: "paris",
  cls: "immediate",
  spec: { mode: oneOf("serveur ou mac", ["serveur", "mac"]) },
  async execute(deps, p, actor) {
    const mode = p.mode === "mac" ? "mac" : "server";
    const before = (await loadCaptureSettings(deps.prisma)).mode;
    if (!(await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" } })))
      await deps.prisma.agentTeamConfig.upsert({ where: { teamKey: "sports" }, create: { teamKey: "sports" }, update: {} });
    await setCaptureMode(deps.prisma, mode);
    await agentAudit(deps, { userId: actor.userId, action: "agents.capture_mode_set", entityType: "AgentTeamConfig", entityId: "sports", metadata: { from: before, to: mode, via: "TELEGRAM" } });
    return { reply: mode === "mac" ? "Captures depuis le Mac ✅ (lance « pnpm agents:capture-runner » sur le Mac)." : "Captures sur le serveur ✅." };
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
      `🧠 Algorithme cette semaine : ${plural(o.algoAppliedThisWeek.length, "réglage appliqué", "réglages appliqués")}`,
      proposed.length ? "À appliquer :" : "Aucun réglage en attente.",
      ...proposed.map((r, i) => esc(`${i + 1}. ${recommendationLabel(r, names, r.targetId)}`)),
      applied.length ? `Derniers appliqués (à annuler par « annule le réglage <n> ») :` : null,
      ...applied.slice(0, 5).map((r, i) => esc(`${i + 1}. ${recommendationLabel(r, names, r.targetId)}`)),
    );
  },
});

type RecoP = { numero: number };

async function nth<T>(list: readonly T[], n: number, empty: string): Promise<{ ok: true; value: T } | { ok: false; reply: BossReply }> {
  if (!list.length) return { ok: false, reply: { reply: empty } };
  const item = list[n - 1];
  return item ? { ok: true, value: item } : { ok: false, reply: { reply: `Numéro ${n} inconnu : la liste va de 1 à ${list.length}.` } };
}

export const appliquerReglage = defineAction<RecoP>({
  key: "appliquer_reglage",
  check: async (deps, p) => { const r = await nth(await algoProposed(deps), p.numero, "Aucun réglage proposé en attente."); return r.ok ? null : r.reply; },
  description: "Appliquer un réglage proposé par l'équipe Algorithme (numéro de la liste des réglages de la semaine)",
  theme: "algorithme",
  cls: "confirm",
  spec: { numero: int("Numéro du réglage proposé (1 = le premier de la liste)", 1, 9) },
  async summarize(deps, p) {
    const list = await algoProposed(deps);
    const r = list[p.numero - 1];
    const names = await targetNames(deps, list);
    return `Appliquer le réglage n°${p.numero} de l'équipe Algorithme ?\n${r ? recommendationLabel(r, names, r.targetId) : "réglage introuvable"}`;
  },
  async execute(deps, p, actor) {
    const r = await nth(await algoProposed(deps), p.numero, "Aucun réglage proposé en attente.");
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
    const r = await nth(await algoApplied(deps), p.numero ?? 1, "Aucun réglage appliqué à annuler.");
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
    if (!rows.length) return { reply: "Aucun test A/B en cours." };
    return lines(`🧪 Tests A/B en cours (${rows.length}) :`, ...rows.map((r) => esc(`${TEAM_LABELS[r.teamKey as TeamKey] ?? r.teamKey} · ${r.hypothesis.slice(0, 90)}`)));
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
    if (!list.length) return { reply: "📣 Aucune recommandation pubs ouverte." };
    return lines(
      `📣 Recommandations pubs (${list.length}) :`,
      ...list.map((r, i) => esc(`${i + 1}. ${recommendationLabel(r)}${r.expectedGain ? ` — ${r.expectedGain.slice(0, 90)}` : ""}`)),
      "Dis « fait 1 » quand tu l'as fait chez Meta / TikTok, ou « refuse 1 ».",
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
      const r = await nth(await adsProposed(deps), p.numero, "Aucune recommandation pubs ouverte.");
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
      "📏 Seuils pubs :",
      ...Object.entries(view.thresholds).map(([v, t]) =>
        esc(
          `${label[v] ?? v} : coût par inscription visé ${t.targetCostPerRegistration ?? "—"} €, retour sur dépense minimal ${t.minRoas ?? "—"}, ${t.observationDays} j d'observation, ${t.minSpend} € de dépense minimale`,
        ),
      ),
      "Pour les changer : Agents → Ads → Seuils.",
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------- Tests

type TestPostP = { equipe: string; format?: "video" | "photo" | "texte"; persona?: string };

export const postTest = defineAction<TestPostP>({
  key: "post_test",
  check: async (deps, p) => { const t = resolveTeam(p.equipe); if (!t.ok) return t.reply; if (t.value !== "dating" && t.value !== "casino") return { reply: "Post de test : équipe Rencontres ou Casino." }; if (!p.persona) return null; const pe = await resolvePersona(deps, { actionKey: "post_test", params: p, field: "persona" }, p.persona); return pe.ok ? null : pe.reply; },
  description: "Produire un post de test en simulation sur le canal Test (rencontres ou casino ; vidéo, photo ou texte)",
  theme: "tests",
  cls: "confirm",
  spec: {
    equipe: str("rencontres ou casino"),
    format: oneOf("vidéo, photo ou texte (facultatif)", ["video", "photo", "texte"], true),
    persona: str("Prénom de la persona (Rencontres, facultatif)", { optional: true }),
  },
  async summarize(_deps, p) {
    return `Produire un post de test ${p.format ?? ""} de l'équipe ${p.equipe} ?\nIl part sur le canal Test (simulation) ; une vidéo ou une photo dépense un peu chez le fournisseur.`.replace("  ", " ");
  },
  async execute(deps, p, actor) {
    const t = resolveTeam(p.equipe);
    if (!t.ok) return t.reply;
    if (t.value !== "dating" && t.value !== "casino") return { reply: "Post de test : équipe Rencontres ou Casino (pour Paris sportifs, demande un pari de test)." };
    let personaId: string | null = null;
    if (p.persona) {
      const pe = await resolvePersona(deps, { actionKey: "post_test", params: p, field: "persona" }, p.persona);
      if (!pe.ok) return pe.reply;
      personaId = pe.value.id;
    }
    const format = p.format === "texte" ? "text" : p.format;
    const r = await createTestPostMission(deps, { teamKey: t.value, byUserId: actor.userId, ...(format ? { format } : {}), personaId });
    await agentAudit(deps, { userId: actor.userId, action: "agents.test_post_requested", entityType: "AgentMission", entityId: r.ok ? r.missionId : undefined, metadata: { teamKey: t.value, format: format ?? null, via: "TELEGRAM", ok: r.ok } });
    return { reply: r.ok ? "Post de test lancé en simulation : l'aperçu arrive ici, puis sur le canal Test." : esc(`Post de test refusé : ${r.reason}`) };
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
  async summarize(_deps, p) {
    return `Produire un pari de test${p.categorie ? ` (${p.categorie})` : ""} ?\nCotes d'essai, aucune vraie mise, publié sur le canal Test.`;
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
    return { reply: r.ok ? "Pari de test lancé en simulation : il apparaît dans les paris du jour, puis sur le canal Test." : esc(`Pari de test refusé : ${r.reason}`) };
  },
});

export const UNIVERSE_ACTIONS: BossAction[] = [
  personas,
  stockMedias,
  bancEssai,
  themesCasino,
  offreCanal,
  categoriesParis,
  categorieParis,
  testBookmaker,
  connexionBookmaker,
  modeCapture,
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
