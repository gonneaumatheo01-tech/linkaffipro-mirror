/**
 * Capacités de l'équipe Prospection (phase 31) : « Kevin, trouve-moi de nouveaux affiliés en Pologne », « dis à la
 * prospection de faire une pause », « mets mon offre Winamax » arrivent aussi par le planificateur des ordres
 * (phase 33). L'équipe cherche, lit, note et classe des canaux Telegram PUBLICS ; elle ne contacte JAMAIS personne
 * (aucune capacité n'envoie un message à un tiers : seul Kevin écrit, à l'admin ou au groupe de l'équipe).
 * `run` est idempotent par `(ordre, étape)` : une recherche déjà lancée pour cet ordre n'est pas relancée.
 */
import { nowOf, readSetting, writeSetting } from "../../admin/journal";
import { PROSPECTION_SETTINGS } from "../../prospection/contract";
import { rememberProspectionRequest, queueProspection, requestWhat } from "../../prospection/jobs";
import { createOffer, disableOffer } from "../../prospection/kevin-offers";
import { prospectionPort, type ProspectionKevinDeps } from "../../prospection/kevin-port";
import { activeOffers, prospectionEnabled, prospectionStats, statsLines } from "../../prospection/kevin-read";
import { countriesOf, countriesText, dealText, parseOfferText, verticalOf } from "../../prospection/kevin-texts";
import type { AgentsDeps } from "../../types";
import type { OrderRow, OrderStep } from "../contract";
import { alt, defineCapability, done, failed, ok, orderActor, readOnly, refuse } from "./kit";

const T = "prospection" as const;
const ALL = ["chef-prospection", "sourceur", "enrichisseur", "evaluateur", "pipeline-prospection"];

/** Repère d'une étape déjà faite (`Setting prospection.order.<ordre>.<étape>`) : jamais deux fois. */
const stepKeyOf = (order: OrderRow, step: OrderStep) => `prospection.order.${order.id}.${step.stepKey}`;

async function onceFor(deps: AgentsDeps, order: OrderRow, step: OrderStep): Promise<boolean> {
  const key = stepKeyOf(order, step);
  if ((await readSetting(deps, key)) != null) return false;
  await writeSetting(deps, key, { at: nowOf(deps).toISOString() });
  return true;
}

async function report(deps: AgentsDeps) {
  const s = await prospectionStats(deps);
  return { aContacter: s.aContacter, signes: s.signes, signesCeMois: s.signesCeMois, trouves7Jours: s.trouves7Jours, qualifies7Jours: s.qualifies7Jours };
}

type SearchP = { pays?: string[]; verticale?: "casino" | "paris_sportifs" };

const chercher = defineCapability<SearchP>({
  teamKey: T,
  key: "chercher_prospects",
  description: "Chercher de nouveaux canaux Telegram d'affiliés (casino ou paris sportifs) dans des pays d'Europe : lot de recherche dédié, sans jamais contacter personne",
  agents: ["sourceur", "chef-prospection"],
  spec: {
    pays: { kind: "list", description: "Pays visés, tels que dits (« Pologne », « FR ») ; absent = toute l'Europe", optional: true, maxItems: 10 },
    verticale: { kind: "enum", description: "casino ou paris_sportifs", values: ["casino", "paris_sportifs"], optional: true },
  },
  limits: { modes: ["simulation", "real"] },
  async check(deps, p) {
    if (!(await prospectionEnabled(deps)))
      return refuse("la prospection est en pause", [alt("Relancer la prospection", T, "pause_prospection", { action: "reprise" })]);
    if (!p.verticale)
      return refuse("il me faut le thème : casino ou paris sportifs", [
        alt("Chercher des canaux casino", T, "chercher_prospects", { ...p, verticale: "casino" }),
        alt("Chercher des canaux de paris sportifs", T, "chercher_prospects", { ...p, verticale: "paris_sportifs" }),
      ]);
    return ok();
  },
  async plan(_deps, p) {
    const vertical = p.verticale === "casino" ? "CASINO" : "SPORTS";
    const countries = countriesOf((p.pays ?? []).join(" "));
    return [{ stepKey: "chercher", capability: "chercher_prospects", teamKey: T, summary: `chercher des canaux ${requestWhat(vertical, countries)}`, touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as SearchP;
    const vertical = p.verticale === "casino" ? "CASINO" : "SPORTS";
    const countries = countriesOf((p.pays ?? []).join(" "));
    const what = requestWhat(vertical, countries);
    if (!(await onceFor(deps, order, step))) return done(`La recherche de canaux ${what} est déjà lancée.`);
    const d = deps as ProspectionKevinDeps;
    const requestId = `ord${order.id.slice(-12)}${step.stepKey}`;
    await rememberProspectionRequest(d, requestId, { chatId: order.chatId, countries, vertical, what });
    await prospectionPort(d).requestDiscovery(d, { countries, vertical, requestId });
    return done(`C'est lancé, je cherche des canaux ${what}. Je te préviens dès que les premiers bons arrivent.`);
  },
  report: async (deps) => report(deps),
});

const top = defineCapability<{ nombre?: number }>({
  teamKey: T,
  key: "top_prospects",
  description: "Envoyer les prochains canaux d'affiliés à contacter (meilleurs d'abord, sans doublon du matin), avec leurs boutons",
  agents: ["pipeline-prospection", "evaluateur"],
  spec: { nombre: { kind: "int", description: "Combien de canaux (10 par défaut)", min: 1, max: 20, optional: true } },
  limits: { modes: ["simulation", "real"] },
  async check(deps) {
    return (await prospectionEnabled(deps)) ? ok() : refuse("la prospection est en pause", [alt("Relancer la prospection", T, "pause_prospection", { action: "reprise" })]);
  },
  async plan(_deps, p) {
    return [{ stepKey: "top", capability: "top_prospects", teamKey: T, summary: `t'envoyer ${p.nombre ?? PROSPECTION_SETTINGS.dailyTopCount.value} canaux à contacter`, touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    if (!(await onceFor(deps, order, step))) return done("La liste est déjà partie.");
    const count = (step.params as { nombre?: number }).nombre ?? PROSPECTION_SETTINGS.dailyTopCount.value;
    await queueProspection(deps as ProspectionKevinDeps, { type: "prospection.daily-top", requested: { chatId: order.chatId, count } });
    return done("Je te prépare la liste, elle arrive dans une minute.");
  },
  report: async (deps) => report(deps),
});

const pause = defineCapability<{ action: "pause" | "reprise" }>({
  teamKey: T,
  key: "pause_prospection",
  description: "Mettre en pause ou relancer toute la recherche d'affiliés (découverte, lecture, liste du matin)",
  agents: ALL,
  spec: { action: { kind: "enum", description: "pause ou reprise", values: ["pause", "reprise"] } },
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan(_deps, p) {
    return [{ stepKey: "pause", capability: "pause_prospection", teamKey: T, summary: p.action === "pause" ? "mettre la prospection en pause" : "relancer la prospection", touches: readOnly(), params: { ...p } }];
  },
  async run(deps, _order, step) {
    const want = (step.params as { action: string }).action === "reprise";
    // Idempotent : poser deux fois la même valeur ne change rien.
    await writeSetting(deps, PROSPECTION_SETTINGS.enabled.key, want);
    return done(want ? "C'est reparti, je recommence à chercher des canaux." : "Ok, la prospection est en pause.");
  },
  async report(deps) {
    return { enMarche: await prospectionEnabled(deps) };
  },
});

type OfferP = { action: "ajouter" | "desactiver" | "voir"; texte?: string; marque?: string };

const offre = defineCapability<OfferP>({
  teamKey: T,
  key: "offre_affilie",
  description: "Gérer les offres proposées aux affiliés (marque, pays acceptés, CPA et/ou revshare) : ajouter, désactiver, voir",
  agents: ["evaluateur", "chef-prospection"],
  spec: {
    action: { kind: "enum", description: "ajouter, desactiver ou voir", values: ["ajouter", "desactiver", "voir"] },
    texte: { kind: "string", description: "L'offre telle que dite (« Winamax, FR BE, CPA 120 »)", optional: true, maxLength: 200 },
    marque: { kind: "string", description: "Marque de l'offre", optional: true, maxLength: 60 },
  },
  limits: { modes: ["simulation", "real"] },
  async check(_deps, p) {
    if (p.action === "ajouter") {
      const o = parseOfferText(`${p.marque ?? ""}, ${p.texte ?? ""}`);
      if (!(p.marque ?? o.brand)) return refuse("il me manque la marque de l'offre", []);
      if (!o.countries.length) return refuse("il me manque les pays acceptés de l'offre", []);
    }
    if (p.action === "desactiver" && !p.marque) return refuse("il me manque la marque à désactiver", [alt("Voir mes offres", T, "offre_affilie", { action: "voir" })]);
    return ok();
  },
  async plan(_deps, p) {
    const o = parseOfferText(`${p.marque ?? ""}, ${p.texte ?? ""}`);
    const summary =
      p.action === "voir" ? "te montrer tes offres" : p.action === "desactiver" ? `désactiver l'offre ${p.marque}` : `ajouter l'offre ${p.marque ?? o.brand} (${countriesText(o.countries)}, ${dealText(o.dealTypes)})`;
    return [{ stepKey: `offre-${p.action}`, capability: "offre_affilie", teamKey: T, summary, touches: readOnly(), params: { ...p } }];
  },
  async run(deps, order, step) {
    const p = step.params as OfferP;
    if (p.action === "voir") {
      const offers = await activeOffers(deps);
      return done(offers.length ? offers.map((o) => `${o.brand} : ${dealText(o.dealTypes)}`).join("\n") : "Tu n'as pas encore d'offre.");
    }
    if (!(await onceFor(deps, order, step))) return done("C'est déjà fait.");
    if (p.action === "desactiver") return done((await disableOffer(deps, p.marque!, orderActor(order), order.chatId)).replace(/<[^>]+>/g, ""));
    const o = parseOfferText(`${p.marque ?? ""}, ${p.texte ?? ""}`);
    const brand = (p.marque ?? o.brand ?? "").trim();
    if (!brand || !o.countries.length) return failed("Il me manque la marque ou les pays de l'offre.");
    const r = await createOffer(deps, { ...o, brand, vertical: verticalOf(p.texte ?? "") ?? o.vertical }, orderActor(order), order.chatId);
    return done(r.reply);
  },
  async report(deps) {
    return { offresActives: (await activeOffers(deps)).length };
  },
});

const chiffres = defineCapability<Record<string, never>>({
  teamKey: T,
  key: "chiffres_prospection",
  description: "Chiffres de la prospection : canaux à contacter par niveau, contactés, réponses, signés du mois",
  agents: ALL,
  spec: {},
  limits: { modes: ["simulation", "real"] },
  async check() {
    return ok();
  },
  async plan() {
    return [{ stepKey: "chiffres", capability: "chiffres_prospection", teamKey: T, summary: "te donner les chiffres de la prospection", touches: readOnly(), params: {} }];
  },
  async run(deps) {
    return done(statsLines(await prospectionStats(deps)).join("\n").replace(/&amp;/g, "&"));
  },
  report: async (deps) => report(deps),
});

export const PROSPECTION_CAPABILITIES = [chercher, top, pause, offre, chiffres];
