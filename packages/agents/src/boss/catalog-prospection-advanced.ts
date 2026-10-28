/**
 * Phase 32, chantier C — entrées du catalogue de Kevin pour la prospection avancée (section 6 du prompt), raccourcis
 * instantanés ; les demandes libres passent aussi par les ordres (`orders/capabilities/prospection-advanced.ts`) :
 * - alertes : `prospection_alertes` (« qui a lâché son bookmaker ? », « canaux en hausse », « alertes du jour »),
 *   `prospection_alertes_couper` (« plus d'alertes de ce type », « remets les alertes de hausse ») ;
 * - réseaux : `prospection_reseau` (« réseau de @x »), `prospection_fusion` (« @a et @b c'est la même personne »),
 *   `prospection_separer` (« sépare @x ») ;
 * - valeur : `prospection_valeur` (« combien vaut @x ? »), `prospection_valeur_pipeline` (« valeur du pipeline ») ;
 * - affiliés : `prospection_affilies` (« mes affiliés »), `prospection_performance` (« performance de @x »),
 *   `prospection_rattacher` (« @x = affilié 1234 », aussi par le chemin rapide), `prospection_estime_reel` ;
 * - calibrage : `prospection_calibrage` (« calibrage »), `prospection_calibrage_appliquer` (« applique 1 et 3 »),
 *   `prospection_calibrage_annuler` (« annule le calibrage ») ;
 * - compte réel : `prospection_recherche_compte` (« active la recherche par compte » → récapitulatif → OUI ;
 *   « coupe la recherche par compte » ; état) ;
 * - `prospection_valeur_question` (« où est la valeur de mon pipeline ? », « quels affiliés sous-performent et
 *   pourquoi ? ») : Opus sur les chiffres du code, QA Global.
 * Lectures permises à un membre présenté ; rattacher, fusionner, séparer, couper des alertes : admin et responsables ;
 * calibrage et recherche par compte : admin seul (la recherche se confirme toujours par OUI).
 */
import { adminTelegramId } from "../admin/journal";
import { answerAdvancedQuestion } from "../prospection/kevin-advanced-answer";
import {
  accountSearchConfirmSummary,
  accountSearchStateReply,
  alertsReply,
  affiliatesReply,
  applyCalibrationReply,
  calibrationReply,
  disableAccountSearchReply,
  enableAccountSearchReply,
  estimatedVsRealReply,
  linkAffiliateReply,
  muteAlertsReply,
  networkReply,
  offerAccountSearchOnce,
  performanceReply,
  pipelineValueReply,
  prospectsIn,
  undoCalibrationReply,
  valueReply,
  type AlertsFilter,
} from "../prospection/kevin-advanced";
import type { ProspectionAdvancedKevinDeps } from "../prospection/kevin-advanced-port";
import { PROSPECTION_ADVANCED_KEVIN_VARIANTS as A } from "../prospection/kevin-advanced-texts";
import { prospectionAdvancedPort } from "../prospection/advanced-port";
import { findProspect, handle } from "../prospection/kevin-read";
import { PROSPECTION_KEVIN_VARIANTS as V, usernameOf } from "../prospection/kevin-texts";
import { esc } from "../admin/journal";
import type { BossAction, BossDeps, BossReply } from "./contract";
import { defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { prospectionPageUrl } from "./catalog-prospection";
import { oneOf, str } from "./params";
import { pick } from "./voice";
import { BOSS_ADMIN_ONLY_KEYS, BOSS_READ_KEYS } from "./team/rights";

async function chatKeyOf(deps: BossDeps): Promise<string | null> {
  const d = deps as BossExecDeps;
  if (d.chat) return d.chat.chatId.toString();
  return (await adminTelegramId(deps))?.toString() ?? null;
}

const inputOf = (deps: BossDeps) => (deps as BossExecDeps).inputText ?? "";
const ad = (deps: BossDeps) => deps as unknown as ProspectionAdvancedKevinDeps;
const canalSpec = str("Canal visé : @nom, lien t.me/… ou titre", { maxLength: 200 });

/** Proposition unique de la recherche par compte réel, après une lecture faite par l'admin en privé. */
function withOffer(deps: BossDeps, r: BossReply): BossReply {
  const d = deps as BossExecDeps;
  const privateAdmin = !d.chat || d.chat.type !== "group";
  const speaker = d.speaker;
  if (!privateAdmin || (speaker && speaker.kind !== "admin")) return r;
  const prev = r.followUp;
  return {
    ...r,
    followUp: async () => {
      await prev?.();
      await offerAccountSearchOnce(ad(deps)).catch(() => false);
    },
  };
}

async function oneProspect(deps: BossDeps, raw: string | undefined) {
  const chatId = await chatKeyOf(deps);
  const ref = raw ?? inputOf(deps);
  if (!usernameOf(ref) && !(raw && raw.trim().length >= 3)) return { ok: false as const, reply: { reply: pick(V.askChannel, "prospection.askChannel", chatId) } as BossReply };
  const p = await findProspect(deps, ref);
  if (!p) return { ok: false as const, reply: { reply: esc(pick(V.unknownChannel({ name: `@${usernameOf(ref) ?? ref.trim().slice(0, 40)}` }), "prospection.unknownChannel", chatId)) } as BossReply };
  return { ok: true as const, p };
}

const alertesPage = () => `${prospectionPageUrl()}/alertes`;

// ------------------------------------------------------------------------------------------------ alertes

const ALERT_FILTERS = ["jour", "lache", "hausse", "affilies", "tout"] as const;

export const prospectionAlertes = defineAction<{ filtre?: AlertsFilter }>({
  key: "prospection_alertes",
  description:
    "Les alertes du Veilleur sur les prospects et les affiliés signés (« alertes du jour », « qui a lâché son bookmaker ? » = lache, « canaux en hausse » = hausse, « alertes de mes affiliés » = affilies)",
  theme: "equipes",
  cls: "immediate",
  spec: { filtre: oneOf("jour (par défaut), lache, hausse, affilies ou tout", ALERT_FILTERS, true) },
  async execute(deps, p) {
    const text = inputOf(deps).toLowerCase();
    const filtre: AlertsFilter = p.filtre ?? (/l[aâ]ch|bookmaker/.test(text) ? "lache" : /hausse|monte/.test(text) ? "hausse" : "jour");
    return withOffer(deps, await alertsReply(ad(deps), filtre, await chatKeyOf(deps), alertesPage()));
  },
});

export const prospectionAlertesCouper = defineAction<{ type?: string; action?: "couper" | "remettre" }>({
  key: "prospection_alertes_couper",
  description: "Couper ou remettre un type d'alerte de la prospection (« plus d'alertes de ce type », « plus d'alertes de hausse », « remets les alertes de silence »)",
  theme: "equipes",
  cls: "immediate",
  spec: {
    type: str("Le type d'alerte tel que dit (« hausse », « silence », « concurrent »…) ; absent = celui de la dernière alerte", { optional: true, maxLength: 80 }),
    action: oneOf("couper (par défaut) ou remettre", ["couper", "remettre"], true),
  },
  async execute(deps, p) {
    const said = `${p.type ?? ""} ${p.type ? "" : inputOf(deps).replace(/plus d.alertes?|de ce type|ce type/gi, "")}`;
    return muteAlertsReply(ad(deps), said, p.action === "remettre", await chatKeyOf(deps));
  },
});

// ------------------------------------------------------------------------------------------------ réseaux

export const prospectionReseau = defineAction<{ canal: string }>({
  key: "prospection_reseau",
  description: "Le réseau d'un canal : les autres canaux tenus par la même personne, avec les preuves (« réseau de @x »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec },
  async execute(deps, p) {
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    return withOffer(deps, await networkReply(ad(deps), r.p, await chatKeyOf(deps)));
  },
});

export const prospectionFusion = defineAction<{ canaux?: string }>({
  key: "prospection_fusion",
  description: "Regrouper des canaux tenus par la même personne en un réseau (« @a et @b c'est la même personne »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canaux: str("Les canaux cités, tels que dits (« @a et @b »)", { optional: true, maxLength: 300 }) },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    const { found, unknown } = await prospectsIn(ad(deps), `${p.canaux ?? ""} ${inputOf(deps)}`);
    if (unknown.length) return { reply: esc(pick(V.unknownChannel({ name: unknown[0]! }), "prospection.unknownChannel", chatId)) };
    if (found.length < 2) return { reply: pick(A.mergeNeedTwo, "prospection.merge.needTwo", chatId) };
    const res = await prospectionAdvancedPort(ad(deps)).mergeProspects(ad(deps), found.map((x) => x.id), "client");
    if (!res.ok) return { reply: esc(res.message ?? pick(A.notReady, "prospection.notReady", chatId)) };
    const names = found.map(handle);
    return { reply: esc(pick(A.mergeDone({ names: `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` }), "prospection.merge.done", chatId)) };
  },
});

export const prospectionSeparer = defineAction<{ canal: string }>({
  key: "prospection_separer",
  description: "Sortir un canal de son réseau quand ce n'est pas la même personne (« sépare @x »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec },
  async execute(deps, p) {
    const chatId = await chatKeyOf(deps);
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    const res = await prospectionAdvancedPort(ad(deps)).splitProspect(ad(deps), r.p.id, "client");
    if (!res.ok) return { reply: esc(res.message ?? pick(A.notReady, "prospection.notReady", chatId)) };
    return { reply: esc(pick(A.splitDone({ name: handle(r.p) }), "prospection.split.done", chatId)) };
  },
});

// ------------------------------------------------------------------------------------------------ valeur

export const prospectionValeur = defineAction<{ canal: string }>({
  key: "prospection_valeur",
  description: "Ce qu'un canal pourrait rapporter par mois avec ton offre, en fourchette avec les hypothèses (« combien vaut @x ? »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec },
  async execute(deps, p) {
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    return withOffer(deps, await valueReply(ad(deps), r.p, await chatKeyOf(deps)));
  },
});

export const prospectionValeurPipeline = defineAction<Record<string, never>>({
  key: "prospection_valeur_pipeline",
  description: "La valeur estimée de tout le pipeline, par étape (« valeur du pipeline », « combien vaut ce qui est en négo ? »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return withOffer(deps, await pipelineValueReply(ad(deps), await chatKeyOf(deps)));
  },
});

// ------------------------------------------------------------------------------------------------ affiliés

export const prospectionAffilies = defineAction<Record<string, never>>({
  key: "prospection_affilies",
  description: "Mes affiliés signés et actifs, rattachés ou non à Link Affi, avec leurs derniers résultats (« mes affiliés »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return withOffer(deps, await affiliatesReply(ad(deps), await chatKeyOf(deps)));
  },
});

export const prospectionPerformance = defineAction<{ canal: string }>({
  key: "prospection_performance",
  description: "Les vrais résultats Link Affi d'un affilié signé, mois par mois, face à son estimation (« performance de @x »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec },
  async execute(deps, p) {
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    return performanceReply(ad(deps), r.p, await chatKeyOf(deps));
  },
});

export const prospectionRattacher = defineAction<{ canal: string; affilie?: string }>({
  key: "prospection_rattacher",
  description: "Rattacher un canal signé à son numéro d'affilié Link Affi pour suivre ses vrais résultats (« @x = affilié 1234 »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec, affilie: str("Numéro d'affilié Link Affi", { optional: true, maxLength: 40 }) },
  async execute(deps, p, actor) {
    const id = p.affilie ?? /affili[ée]e?\s*(?:n°|#)?\s*([A-Za-z0-9-]{1,40})/i.exec(inputOf(deps))?.[1] ?? null;
    return linkAffiliateReply(ad(deps), p.canal, id, await chatKeyOf(deps), actor.userId ?? null);
  },
});

export const prospectionEstimeReel = defineAction<Record<string, never>>({
  key: "prospection_estime_reel",
  description: "Estimé contre réel : ce que j'avais estimé pour chaque affilié rattaché et ce qu'il fait vraiment (« estimé vs réel »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return estimatedVsRealReply(ad(deps), await chatKeyOf(deps));
  },
});

// ------------------------------------------------------------------------------------------------ calibrage

export const prospectionCalibrage = defineAction<Record<string, never>>({
  key: "prospection_calibrage",
  description: "Les réglages d'estimation proposés à partir des vrais résultats, en choix numérotés (« calibrage »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return calibrationReply(ad(deps), await chatKeyOf(deps));
  },
});

export const prospectionCalibrageAppliquer = defineAction<{ choix?: string }>({
  key: "prospection_calibrage_appliquer",
  description: "Appliquer des réglages d'estimation proposés, par leurs numéros (« applique 1 et 3 » après « calibrage »)",
  theme: "equipes",
  cls: "immediate",
  spec: { choix: str("Numéros choisis, tels que dits (« 1 et 3 », « tout »)", { optional: true, maxLength: 60 }) },
  async execute(deps, p) {
    return applyCalibrationReply(ad(deps), p.choix ?? inputOf(deps), await chatKeyOf(deps));
  },
});

export const prospectionCalibrageAnnuler = defineAction<Record<string, never>>({
  key: "prospection_calibrage_annuler",
  description: "Revenir aux réglages d'estimation d'avant le dernier calibrage (« annule le calibrage »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return undoCalibrationReply(ad(deps), await chatKeyOf(deps));
  },
});

// ------------------------------------------------------------------------------------------------ compte réel

type AccountP = { action: "activer" | "couper" | "etat" };

export const prospectionRechercheCompte = defineAction<AccountP>({
  key: "prospection_recherche_compte",
  description:
    "Recherche de canaux dans Telegram par un compte réel, en lecture seule (rien rejoint ni écrit) : activer (à confirmer), couper, ou voir l'état (« active la recherche par compte », « coupe la recherche par compte »)",
  theme: "equipes",
  cls: "immediate",
  spec: { action: oneOf("activer, couper ou etat", ["activer", "couper", "etat"]) },
  async classify(_deps, p) {
    // Activer se confirme toujours par OUI (règle 5) ; couper ou lire l'état : tout de suite.
    return p.action === "activer" ? "confirm" : "immediate";
  },
  async summarize(deps) {
    return accountSearchConfirmSummary(await chatKeyOf(deps));
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    if (p.action === "activer") return enableAccountSearchReply(ad(deps), chatId, actor.userId ?? null);
    if (p.action === "couper") return disableAccountSearchReply(ad(deps), chatId, actor.userId ?? null);
    return accountSearchStateReply(ad(deps), chatId);
  },
});

// ------------------------------------------------------------------------------------------------ questions

export const prospectionValeurQuestion = defineAction<{ question: string }>({
  key: "prospection_valeur_question",
  description: "Question libre sur la valeur estimée ou les affiliés signés (« où est la valeur de mon pipeline ? », « quels affiliés sous-performent et pourquoi ? »)",
  theme: "equipes",
  cls: "immediate",
  spec: { question: str("La question telle que posée", { maxLength: 500 }) },
  async execute(deps, p) {
    const r = await answerAdvancedQuestion(ad(deps), p.question || inputOf(deps), await chatKeyOf(deps));
    return { reply: r.reply };
  },
});

export const PROSPECTION_ADVANCED_ACTIONS: BossAction[] = [
  prospectionAlertes,
  prospectionAlertesCouper,
  prospectionReseau,
  prospectionFusion,
  prospectionSeparer,
  prospectionValeur,
  prospectionValeurPipeline,
  prospectionAffilies,
  prospectionPerformance,
  prospectionRattacher,
  prospectionEstimeReel,
  prospectionCalibrage,
  prospectionCalibrageAppliquer,
  prospectionCalibrageAnnuler,
  prospectionRechercheCompte,
  prospectionValeurQuestion,
] as unknown as BossAction[];

/** Lectures qu'un membre présenté fait lui-même. */
export const PROSPECTION_ADVANCED_READ_ACTION_KEYS = [
  "prospection_alertes",
  "prospection_reseau",
  "prospection_valeur",
  "prospection_valeur_pipeline",
  "prospection_affilies",
  "prospection_performance",
  "prospection_estime_reel",
  "prospection_calibrage",
  "prospection_valeur_question",
] as const;
/** Réservées à l'admin : calibrage (appliquer, annuler), recherche par compte réel. */
export const PROSPECTION_ADVANCED_ADMIN_ACTION_KEYS = ["prospection_calibrage_appliquer", "prospection_calibrage_annuler", "prospection_recherche_compte"] as const;

for (const k of PROSPECTION_ADVANCED_READ_ACTION_KEYS) BOSS_READ_KEYS.add(k);
for (const k of PROSPECTION_ADVANCED_ADMIN_ACTION_KEYS) BOSS_ADMIN_ONLY_KEYS.add(k);
