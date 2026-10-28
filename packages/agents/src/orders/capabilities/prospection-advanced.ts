/**
 * Capacités de la prospection avancée (phase 32, chantier C) : « Kevin, montre-moi les alertes des affiliés », « quel
 * est le réseau de @x ? », « combien vaut mon pipeline ? », « applique le calibrage 1 », « active la recherche par
 * compte » arrivent aussi par le planificateur des ordres (phase 33). Toujours sans contacter personne : l'équipe lit,
 * estime et propose ; seul Kevin écrit, à l'admin ou au groupe de l'équipe.
 *
 * Confirmation (règle 6 des ordres, `touches`) : les lectures ne touchent rien ; appliquer ou annuler un calibrage et
 * ACTIVER la recherche par compte réel sont des réglages de toute l'équipe → OUI de l'admin. Couper la recherche par
 * compte est immédiat (on ne fait que réduire). `run` est idempotent par `(ordre, étape)`.
 */
import { nowOf, readSetting, writeSetting } from "../../admin/journal";
import { prospectionAdvancedPort } from "../../prospection/advanced-port";
import {
  accountSearchStateReply,
  affiliatesReply,
  alertsReply,
  applyCalibrationReply,
  calibrationReply,
  disableAccountSearchReply,
  enableAccountSearchReply,
  estimatedVsRealReply,
  networkReply,
  performanceReply,
  pipelineValueReply,
  undoCalibrationReply,
  valueReply,
  type AlertsFilter,
} from "../../prospection/kevin-advanced";
import { accountSearchEnabled } from "../../prospection/discover/sources/account-search";
import type { ProspectionAdvancedKevinDeps } from "../../prospection/kevin-advanced-port";
import { findProspect } from "../../prospection/kevin-read";
import type { AgentsDeps } from "../../types";
import type { BossReply } from "../../boss/contract";
import type { OrderRow, OrderStep } from "../contract";
import { defineCapability, done, ok, readOnly, refuse, settingTouches } from "./kit";

const T = "prospection" as const;
const PAGE = `${(process.env.APP_BASE_URL ?? "https://app.linkaffipro.com").replace(/\/+$/, "")}/agents/prospection/alertes`;

const ad = (deps: AgentsDeps) => deps as unknown as ProspectionAdvancedKevinDeps;

/** Texte Telegram (HTML échappé) → texte simple pour le rapport de l'ordre. */
function plain(r: BossReply): string {
  return (r.reply ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function onceFor(deps: AgentsDeps, order: OrderRow, step: OrderStep): Promise<boolean> {
  const key = `prospection.order.${order.id}.${step.stepKey}`;
  if ((await readSetting(deps, key)) != null) return false;
  await writeSetting(deps, key, { at: nowOf(deps).toISOString() });
  return true;
}

async function report(deps: AgentsDeps) {
  const alertes = await deps.prisma.prospectAlert.count({ where: { status: { in: ["NEW", "SENT"] } } as never }).catch(() => 0);
  const signes = await deps.prisma.prospect.count({ where: { status: { in: ["SIGNED", "ACTIVE"] } } as never });
  return { alertesOuvertes: alertes, affiliesSignes: signes, rechercheParCompte: await accountSearchEnabled(deps) };
}

const FILTERS = ["jour", "lache", "hausse", "affilies", "tout"] as const;

const alertes = defineCapability<{ filtre?: AlertsFilter }>({
  teamKey: T,
  key: "alertes_prospection",
  description: "Montrer les alertes du Veilleur (affilié lâché, canal en hausse, silence, affiliés signés qui ne postent pas ou poussent un concurrent), sans rien changer",
  agents: ["veilleur", "chef-prospection"],
  spec: { filtre: { kind: "enum", description: "jour (par défaut), lache, hausse, affilies ou tout", values: [...FILTERS], optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "alertes", capability: "alertes_prospection", teamKey: T, summary: "te montrer les alertes de la prospection", touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    return done(plain(await alertsReply(ad(deps), (step.params as { filtre?: AlertsFilter }).filtre ?? "jour", order.chatId, PAGE)));
  },
  report: async (deps) => report(deps),
});

type CanalP = { canal: string };

const reseau = defineCapability<CanalP>({
  teamKey: T,
  key: "reseau_prospect",
  description: "Montrer le réseau d'un canal (les autres canaux tenus par la même personne et les preuves), sans rien changer",
  agents: ["veilleur", "evaluateur"],
  spec: { canal: { kind: "string", description: "Canal visé : @nom ou lien t.me", maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    return (await findProspect(deps, p.canal)) ? ok() : refuse(`je ne connais pas ${p.canal} dans les prospects`, []);
  },
  async plan(_deps, p) {
    return [{ stepKey: "reseau", capability: "reseau_prospect", teamKey: T, summary: `te montrer le réseau de ${p.canal}`, touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = await findProspect(deps, (step.params as CanalP).canal);
    if (!p) return done("Je ne retrouve plus ce canal dans les prospects.");
    return done(plain(await networkReply(ad(deps), p, order.chatId)));
  },
  report: async (deps) => report(deps),
});

const valeur = defineCapability<{ canal?: string }>({
  teamKey: T,
  key: "valeur_prospection",
  description: "Donner la valeur estimée par mois d'un canal ou de tout le pipeline (toujours une fourchette avec les hypothèses), sans rien changer",
  agents: ["valorisateur"],
  spec: { canal: { kind: "string", description: "Canal visé (@nom) ; absent = tout le pipeline", optional: true, maxLength: 200 } },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    if (p.canal && !(await findProspect(deps, p.canal))) return refuse(`je ne connais pas ${p.canal} dans les prospects`, []);
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "valeur", capability: "valeur_prospection", teamKey: T, summary: p.canal ? `estimer ce que vaut ${p.canal}` : "estimer la valeur de ton pipeline", touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    const canal = (step.params as { canal?: string }).canal;
    if (!canal) return done(plain(await pipelineValueReply(ad(deps), order.chatId)));
    const p = await findProspect(deps, canal);
    return done(p ? plain(await valueReply(ad(deps), p, order.chatId)) : "Je ne retrouve plus ce canal dans les prospects.");
  },
  report: async (deps) => report(deps),
});

const affilies = defineCapability<{ canal?: string; comparer?: boolean }>({
  teamKey: T,
  key: "affilies_prospection",
  description: "Montrer les affiliés signés et leurs vrais résultats Link Affi (un affilié précis, ou l'estimé contre le réel), sans rien changer",
  agents: ["valorisateur", "pipeline-prospection"],
  spec: {
    canal: { kind: "string", description: "Affilié visé (@nom) ; absent = tous", optional: true, maxLength: 200 },
    comparer: { kind: "bool", description: "true = estimé contre réel", optional: true },
  },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "affilies", capability: "affilies_prospection", teamKey: T, summary: p.canal ? `te montrer les résultats de ${p.canal}` : "te montrer tes affiliés signés", touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as { canal?: string; comparer?: boolean };
    if (p.comparer) return done(plain(await estimatedVsRealReply(ad(deps), order.chatId)));
    if (!p.canal) return done(plain(await affiliatesReply(ad(deps), order.chatId)));
    const row = await findProspect(deps, p.canal);
    return done(row ? plain(await performanceReply(ad(deps), row, order.chatId)) : "Je ne retrouve plus ce canal dans les prospects.");
  },
  report: async (deps) => report(deps),
});

type CalibP = { action: "voir" | "appliquer" | "annuler"; choix?: string };

const calibrage = defineCapability<CalibP>({
  teamKey: T,
  key: "calibrage_prospection",
  description: "Calibrage des estimations à partir des vrais résultats : voir les choix numérotés, en appliquer (dans les bornes, suivi 30 jours) ou annuler le dernier",
  agents: ["valorisateur", "chef-prospection"],
  spec: {
    action: { kind: "enum", description: "voir, appliquer ou annuler", values: ["voir", "appliquer", "annuler"] },
    choix: { kind: "string", description: "Numéros à appliquer (« 1 et 3 »)", optional: true, maxLength: 60 },
  },
  limits: { modes: ["simulation", "real"] },
  async check(_deps, p) {
    if (p.action === "appliquer" && !p.choix) return refuse("il me faut les numéros des réglages à appliquer", []);
    return ok();
  },
  async plan(_deps, p) {
    const summary = p.action === "voir" ? "te montrer les réglages d'estimation proposés" : p.action === "annuler" ? "annuler le dernier calibrage" : `appliquer les réglages d'estimation ${p.choix}`;
    return [{ stepKey: `calibrage-${p.action}`, capability: "calibrage_prospection", teamKey: T, summary, touches: p.action === "voir" ? readOnly() : settingTouches([]), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as CalibP;
    if (p.action === "voir") return done(plain(await calibrationReply(ad(deps), order.chatId)));
    if (!(await onceFor(deps, order, step))) return done("C'est déjà fait.");
    return done(plain(p.action === "annuler" ? await undoCalibrationReply(ad(deps), order.chatId) : await applyCalibrationReply(ad(deps), p.choix ?? "", order.chatId)));
  },
  report: async (deps) => report(deps),
});

type AccountP = { action: "activer" | "couper" | "etat" };

const rechercheCompte = defineCapability<AccountP>({
  teamKey: T,
  key: "recherche_compte_prospection",
  description:
    "Recherche de canaux dans Telegram par un compte réel, en lecture seule (aucune adhésion, aucun message, 100 recherches par jour et par compte) : activer (toujours confirmé par l'admin), couper, ou voir l'état",
  agents: ["sourceur", "chef-prospection"],
  spec: { action: { kind: "enum", description: "activer, couper ou etat", values: ["activer", "couper", "etat"] } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    const summary = p.action === "activer" ? "activer la recherche par compte réel, en lecture seule" : p.action === "couper" ? "couper la recherche par compte réel" : "te dire où en est la recherche par compte réel";
    // Activer : réglage de toute l'équipe → OUI de l'admin. Couper : on réduit, tout de suite.
    const touches = p.action === "activer" ? settingTouches([]) : p.action === "couper" ? { channelIds: [], setting: true } : readOnly();
    return [{ stepKey: `compte-${p.action}`, capability: "recherche_compte_prospection", teamKey: T, summary, touches, params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as AccountP;
    if (p.action === "etat") return done(plain(await accountSearchStateReply(ad(deps), order.chatId)));
    if (p.action === "couper") return done(plain(await disableAccountSearchReply(ad(deps), order.chatId, order.createdById)));
    return done(plain(await enableAccountSearchReply(ad(deps), order.chatId, order.createdById)));
  },
  report: async (deps) => report(deps),
});

/** Réseaux recalculés tout de suite (lecture des prospects, aucune écriture hors réseaux). */
const reseauxRecalcul = defineCapability<Record<string, never>>({
  teamKey: T,
  key: "recalculer_reseaux",
  description: "Recalculer tout de suite les réseaux de canaux (mêmes contacts, signatures, groupes liés), sans contacter personne",
  agents: ["veilleur"],
  spec: {},
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan() {
    return [{ stepKey: "reseaux", capability: "recalculer_reseaux", teamKey: T, summary: "recalculer les réseaux de canaux", touches: readOnly(), params: {} }];
  },
  async run(deps, order, step) {
    if (!(await onceFor(deps, order, step))) return done("C'est déjà fait.");
    const r = await prospectionAdvancedPort(ad(deps)).rebuildNetworks(ad(deps));
    return done(`Réseaux recalculés : ${r.networks} réseaux, ${r.members} canaux regroupés.`);
  },
  report: async (deps) => report(deps),
});

export const PROSPECTION_ADVANCED_CAPABILITIES = [alertes, reseau, valeur, affilies, calibrage, rechercheCompte, reseauxRecalcul];
