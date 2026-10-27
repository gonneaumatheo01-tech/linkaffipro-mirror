/**
 * Phase 31, chantier D — entrées du catalogue de Kevin pour l'équipe Prospection (section 5 du prompt), raccourcis
 * instantanés ; les demandes libres passent aussi par les ordres (`orders/capabilities/prospection.ts`) :
 * - `prospects_top` (« montre les prospects », « qui contacter ? », « top du jour », « encore 10 ») : les prochains
 *   canaux, sans doublon du matin (envoyés par la file, avec leurs boutons) ;
 * - `prospects_filtre` (« prospects FR casino libres », « les A sans concurrent », « les plus gros en Italie »,
 *   « ceux qui vendent de la pub en Espagne », « canaux crash/Aviator ») : liste compacte ;
 * - `prospect_detail` (« détail @x », « dossier @x », « pourquoi @x est A ? ») : fiche, score expliqué, dossier ;
 * - `prospect_statut` (« j'ai contacté @x », « @x a signé CPA 100 », « blacklist @x », « plus tard @x »…), `prospect_note` ;
 * - `prospect_ajout` (« ajoute t.me/xxx ») : canal ajouté à la main, lu en priorité, Kevin répond quand c'est prêt ;
 * - `prospects_relances`, `prospects_stats`, `prospection_cherche` (lot dédié, retour aux premiers bons canaux),
 *   `prospection_offres`, `prospection_pause`, `prospection_export` (lien vers l'export du site) ;
 * - `prospection_question` (« compare FR et IT en casino, lesquels d'abord ? ») : Opus sur les chiffres du code, QA Global.
 * L'équipe ne contacte jamais personne : Kevin n'écrit qu'à l'admin et au groupe de l'équipe. Un MEMBER du groupe lit
 * seulement (droits de `team/rights.ts`).
 */
import { adminTelegramId, agentAudit, esc, writeSetting } from "../admin/journal";
import { PROSPECTION_LIMITS, PROSPECTION_SETTINGS, type ProspectStatus } from "../prospection/contract";
import { answerProspectionQuestion } from "../prospection/kevin-answer";
import { createOffer, disableOffer } from "../prospection/kevin-offers";
import { prospectionPort, type ProspectionKevinDeps } from "../prospection/kevin-port";
import {
  activeOffers,
  emptyFilter,
  findProspect,
  handle,
  offerLine,
  prospectDetailLines,
  prospectionEnabled,
  prospectionStats,
  prospectLine,
  queryProspects,
  relanceLine,
  relancesDue,
  statsLines,
  type ProspectFilter,
} from "../prospection/kevin-read";
import {
  channelRefIn,
  countriesOf,
  countriesText,
  dealText,
  parseDeal,
  parseOfferText,
  PROSPECT_STATUS_WORDS,
  PROSPECTION_KEVIN_VARIANTS as V,
  STATUS_OF_WORD,
  statusWordOf,
  subtypesOf,
  usernameOf,
  verticalOf,
  type StatusWord,
} from "../prospection/kevin-texts";
import { queueProspection, rememberProspectionRequest, rememberProspectWatch, requestWhat } from "../prospection/jobs";
import type { BossAction, BossDeps, BossReply } from "./contract";
import { actorRef, defineAction } from "./catalog-kit";
import type { BossExecDeps } from "./catalog-read";
import { bool, int, oneOf, str } from "./params";
import { pick } from "./voice";
import { BOSS_ADMIN_ONLY_KEYS, BOSS_READ_KEYS } from "./team/rights";

/** Conversation de la demande (privé de l'admin par défaut). */
async function chatKeyOf(deps: BossDeps): Promise<string | null> {
  const d = deps as BossExecDeps;
  if (d.chat) return d.chat.chatId.toString();
  return (await adminTelegramId(deps))?.toString() ?? null;
}

const inputOf = (deps: BossDeps) => (deps as BossExecDeps).inputText ?? "";
const pd = (deps: BossDeps) => deps as unknown as ProspectionKevinDeps;
const LIST_MAX = 15;

/** Liste demandée par le client : lignes non vides, déjà échappées. */
function kevinListLines(ls: ReadonlyArray<string | null | undefined>): BossReply {
  return { reply: ls.filter((l): l is string => typeof l === "string" && l.length > 0).join("\n") };
}

async function disabledReply(deps: BossDeps): Promise<BossReply | null> {
  return (await prospectionEnabled(deps)) ? null : { reply: pick(V.disabled, "prospection.disabled", await chatKeyOf(deps)) };
}

const canalSpec = str("Canal visé : @nom, lien t.me/… ou titre", { maxLength: 200 });
const VERTICALS = ["casino", "paris_sportifs", "les_deux"] as const;
const VERTICAL_OF: Record<string, "CASINO" | "SPORTS" | null> = { casino: "CASINO", paris_sportifs: "SPORTS", les_deux: null };

// ------------------------------------------------------------------------------------------------ Top et listes

type TopP = { nombre?: number };

export const prospectsTop = defineAction<TopP>({
  key: "prospects_top",
  description: "Les prochains canaux Telegram d'affiliés à contacter, avec leurs boutons (« montre les prospects », « qui contacter ? », « top du jour », « encore 10 »)",
  theme: "equipes",
  cls: "immediate",
  spec: { nombre: int("Combien de canaux (10 par défaut)", 1, 20, true) },
  async execute(deps, p) {
    const off = await disabledReply(deps);
    if (off) return off;
    const chatId = await chatKeyOf(deps);
    const count = p.nombre ?? PROSPECTION_SETTINGS.dailyTopCount.value;
    const job = { type: "prospection.daily-top" as const, requested: { chatId, count } };
    if (pd(deps).prospection?.enqueue) {
      await queueProspection(pd(deps), job);
      return { reply: pick(V.topQueued, "prospection.topQueued", chatId) };
    }
    // Sans file (outils, tests) : la liste part tout de suite, avec ses boutons ; rien à ajouter.
    await queueProspection(pd(deps), job);
    return {};
  },
});

type FilterP = { pays?: string; verticale?: string; niveau?: string; sans_concurrent?: boolean; vend_pub?: boolean; vend_vip?: boolean; avec_contact?: boolean; sous_type?: string; plus_gros?: boolean; nombre?: number };

/** Filtre lu dans les paramètres de l'IA, complété par la phrase (pur). */
export function filterFrom(p: FilterP, text: string): ProspectFilter {
  const f = emptyFilter();
  f.countries = countriesOf(p.pays ?? "").length ? countriesOf(p.pays ?? "") : countriesOf(text);
  const v = p.verticale ? VERTICAL_OF[p.verticale] : verticalOf(text);
  f.vertical = v === "BOTH" ? null : (v ?? null);
  const tiers = (p.niveau ?? (/\bles ([abc])\b/i.exec(text)?.[1] ?? "")).toUpperCase().match(/[ABC]/g);
  f.tiers = tiers ? [...new Set(tiers)] : [];
  const low = text.toLowerCase();
  if (p.sans_concurrent || /sans concurren|libres?\b|aucune marque/.test(low)) f.competition = ["FREE"];
  if (p.vend_pub || /vend(ent)? de la pub|vend(ent)? leurs? posts|pub a vendre/.test(low)) f.openness.push("ads");
  if (p.vend_vip || /\bvip\b/.test(low)) f.openness.push("vip");
  if (p.avec_contact || /avec (un )?contact|joignables?/.test(low)) f.withContact = true;
  f.subtypes = subtypesOf(`${p.sous_type ?? ""} ${text}`).filter((s) => s !== "bonus" || !!p.sous_type);
  if (p.plus_gros || /plus gros|les gros|plus grosse audience|plus de vues/.test(low)) f.sort = "audience";
  return f;
}

function filterWhat(f: ProspectFilter): string {
  const parts = [f.countries.length ? `en ${countriesText(f.countries)}` : null, f.vertical ? (f.vertical === "CASINO" ? "casino" : "paris sportifs") : null].filter(Boolean);
  return parts.join(", ");
}

export const prospectsFiltre = defineAction<FilterP>({
  key: "prospects_filtre",
  description:
    "Chercher dans les prospects par pays, thème, niveau, concurrence, ouverture ou contact (« prospects FR casino libres », « les A sans concurrent », « les plus gros en Italie », « ceux qui vendent de la pub en Espagne », « canaux crash/Aviator »)",
  theme: "equipes",
  cls: "immediate",
  spec: {
    pays: str("Pays cités, tels que dits (« France », « FR IT »)", { optional: true, maxLength: 120 }),
    verticale: oneOf("casino, paris_sportifs ou les_deux", VERTICALS, true),
    niveau: str("Niveaux voulus : A, B, C (« A », « A et B »)", { optional: true, maxLength: 10 }),
    sans_concurrent: bool("Seulement ceux qui ne poussent aucune marque", true),
    vend_pub: bool("Seulement ceux qui vendent de la pub", true),
    vend_vip: bool("Seulement ceux qui vendent un VIP", true),
    avec_contact: bool("Seulement ceux qui ont un contact public", true),
    sous_type: str("Sous-type : crash, aviator, slots, roulette, live, foot, tennis…", { optional: true, maxLength: 60 }),
    plus_gros: bool("Trier par audience (les plus gros d'abord)", true),
    nombre: int("Combien au plus (15 par défaut)", 1, 30, true),
  },
  async execute(deps, p) {
    const off = await disabledReply(deps);
    if (off) return off;
    const chatId = await chatKeyOf(deps);
    const f = filterFrom(p, inputOf(deps));
    const rows = await queryProspects(deps, f);
    if (!rows.length) return { reply: pick(V.noResults, "prospection.noResults", chatId) };
    const max = Math.min(p.nombre ?? LIST_MAX, PROSPECTION_LIMITS.exportInlineMaxRows);
    const head = pick(V.listHead({ count: rows.length, what: filterWhat(f) }), "prospection.listHead", chatId);
    const more = rows.length > max ? pick(V.listMore({ more: rows.length - max, url: prospectionPageUrl() }), "prospection.listMore", chatId) : null;
    return kevinListLines([esc(head), ...rows.slice(0, max).map(prospectLine), more ? esc(more) : null]);
  },
});

// ------------------------------------------------------------------------------------------------ fiche, statut, note

async function oneProspect(deps: BossDeps, raw: string | undefined) {
  const chatId = await chatKeyOf(deps);
  const ref = raw ?? inputOf(deps);
  if (!usernameOf(ref) && !(raw && raw.trim().length >= 3)) return { ok: false as const, reply: { reply: pick(V.askChannel, "prospection.askChannel", chatId) } };
  const p = await findProspect(deps, ref);
  if (!p) return { ok: false as const, reply: { reply: esc(pick(V.unknownChannel({ name: `@${usernameOf(ref) ?? ref.trim().slice(0, 40)}` }), "prospection.unknownChannel", chatId)) } };
  return { ok: true as const, p };
}

export const prospectDetail = defineAction<{ canal: string }>({
  key: "prospect_detail",
  description: "La fiche d'un prospect : score expliqué, audience, marques, contact et dossier (« détail @x », « dossier @x », « pourquoi @x est A ? »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec },
  async execute(deps, p) {
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    return { reply: (await prospectDetailLines(deps, r.p)).join("\n") };
  },
});

const STATUS_WORDS = ["contacte", "repondu", "negocie", "signe", "actif", "arrete", "ignore", "blacklist", "plus_tard", "relance"] as const;

type StatusP = { canal: string; statut?: string; deal?: string; cpa?: number; revshare?: number; jours?: number };

function statusOf(p: StatusP, text: string): StatusWord | null {
  return (p.statut as StatusWord | undefined) ?? statusWordOf(text);
}

export const prospectStatut = defineAction<StatusP>({
  key: "prospect_statut",
  description:
    "Mettre à jour un prospect après un contact (« j'ai contacté @x », « @x a répondu », « on négocie avec @x », « @x a signé CPA 100 », « @x est actif », « @x a arrêté », « ignore @x », « blacklist @x », « plus tard @x »)",
  theme: "equipes",
  cls: "immediate",
  spec: {
    canal: canalSpec,
    statut: oneOf("contacte, repondu, negocie, signe, actif, arrete, ignore, blacklist, plus_tard ou relance", STATUS_WORDS, true),
    deal: oneOf("Type de deal signé : cpa, revshare ou hybride", ["cpa", "revshare", "hybride"], true),
    cpa: int("Montant du CPA en euros", 1, 100000, true),
    revshare: int("Part du revenu en %", 1, 100, true),
    jours: int("Plus tard : dans combien de jours (7 par défaut)", 1, 180, true),
  },
  async classify(deps, p) {
    // Écarter pour de bon est sans retour : OUI de l'admin.
    return statusOf(p, inputOf(deps)) === "blacklist" ? "confirm" : "immediate";
  },
  async summarize(deps, p) {
    const r = await findProspect(deps, p.canal);
    return pick(V.confirmBlacklist({ name: r ? handle(r) : p.canal }), "prospection.confirmBlacklist", await chatKeyOf(deps));
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    const text = inputOf(deps);
    const word = statusOf(p, text);
    if (!word) return { reply: pick(V.askChannel, "prospection.askChannel", chatId) };
    const name = handle(r.p);
    const port = prospectionPort(pd(deps));
    if (word === "plus_tard") {
      const days = p.jours ?? Number(/dans (\d{1,3}) jours?/.exec(text)?.[1] ?? 7);
      const res = await port.snoozeProspect(pd(deps), r.p.id, days);
      if (!res.ok) return { reply: res.message ? esc(res.message) : pick(V.statusRefused({ name, from: PROSPECT_STATUS_WORDS[r.p.status], to: "plus tard" }), "prospection.statusRefused", chatId) };
      return { reply: esc(pick(V.snoozed({ name, days }), "prospection.snoozed", chatId)) };
    }
    // « Relancé » : le canal reste contacté, la date de contact repart d'aujourd'hui.
    const to: ProspectStatus = word === "relance" ? "CONTACTED" : STATUS_OF_WORD[word];
    const deal = parseDeal(text);
    const dealType = p.deal === "cpa" ? "CPA" : p.deal === "revshare" ? "REVSHARE" : p.deal === "hybride" ? "HYBRID" : deal.dealType;
    const cpa = p.cpa ?? deal.cpa;
    const rev = p.revshare ?? deal.revshare;
    const dealTerms = to === "SIGNED" && (cpa !== null || rev !== null) ? { ...(cpa !== null ? { cpa } : {}), ...(rev !== null ? { revshare: rev } : {}), currency: "EUR" } : null;
    const res = await port.transitionProspect(pd(deps), r.p.id, to, { by: "client", ...(to === "SIGNED" ? { dealType: dealType ?? null, dealTerms } : {}) });
    if (!res.ok) return { reply: res.message ? esc(res.message) : esc(pick(V.statusRefused({ name, from: PROSPECT_STATUS_WORDS[r.p.status], to: PROSPECT_STATUS_WORDS[to] }), "prospection.statusRefused", chatId)) };
    await agentAudit(deps, { userId: actor.userId, action: "prospection.prospect.status", entityType: "Prospect", entityId: r.p.id, metadata: { via: "TELEGRAM", from: r.p.status, to } });
    const what = to === "SIGNED" && dealTerms ? `${PROSPECT_STATUS_WORDS[to]} (${dealText(dealTerms)})` : PROSPECT_STATUS_WORDS[to];
    return { reply: esc(pick(V.statusDone({ name, what }), "prospection.statusDone", chatId)) };
  },
});

export const prospectNote = defineAction<{ canal: string; note: string }>({
  key: "prospect_note",
  description: "Ajouter une note sur la fiche d'un prospect (« note @x : veut des créatives mardi »)",
  theme: "equipes",
  cls: "immediate",
  spec: { canal: canalSpec, note: str("La note, telle que dite", { maxLength: 500 }) },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    const r = await oneProspect(deps, p.canal);
    if (!r.ok) return r.reply;
    const note = p.note.trim();
    if (!note) return { reply: pick(V.noteEmpty, "prospection.noteEmpty", chatId) };
    await prospectionPort(pd(deps)).addProspectNote(pd(deps), r.p.id, note.slice(0, 500), "client");
    await agentAudit(deps, { userId: actor.userId, action: "prospection.prospect.note", entityType: "Prospect", entityId: r.p.id, metadata: { via: "TELEGRAM" } });
    return { reply: esc(pick(V.noteDone({ name: handle(r.p) }), "prospection.noteDone", chatId)) };
  },
});

// ------------------------------------------------------------------------------------------------ ajout à la main

export const prospectAjout = defineAction<{ lien?: string }>({
  key: "prospect_ajout",
  description: "Ajouter à la main un canal Telegram à étudier comme futur affilié (« ajoute t.me/xxx », « regarde @xxx pour la prospection »)",
  theme: "equipes",
  cls: "immediate",
  spec: { lien: str("Lien t.me/… ou @nom du canal", { optional: true, maxLength: 200 }) },
  async execute(deps, p, actor) {
    const off = await disabledReply(deps);
    if (off) return off;
    const chatId = await chatKeyOf(deps);
    const ref = channelRefIn(p.lien ?? "") ?? channelRefIn(inputOf(deps));
    if (!ref) return { reply: pick(V.addNoLink, "prospection.addNoLink", chatId) };
    // Un lien d'invitation privé n'est jamais ouvert (il faudrait rejoindre le canal).
    if (ref.private) return { reply: pick(V.addPrivate, "prospection.addPrivate", chatId) };
    const known = ref.username ? await findProspect(deps, `@${ref.username}`) : null;
    if (known && known.status !== "DISCOVERED") return { reply: esc(pick(V.addKnown({ name: handle(known), status: PROSPECT_STATUS_WORDS[known.status] }), "prospection.addKnown", chatId)) };
    const r = await prospectionPort(pd(deps)).addManualProspect(pd(deps), { url: ref.url }, "client");
    const id = r.prospectId ?? known?.id ?? null;
    if (!id) return { reply: r.reason ? esc(r.reason) : pick(V.addNoLink, "prospection.addNoLink", chatId) };
    const name = `@${ref.username}`;
    await rememberProspectWatch(pd(deps), id, { chatId, name });
    await queueProspection(pd(deps), { type: "prospection.enrich", prospectId: id }, { jobId: `prospection.enrich:${id}`, priority: 1 });
    await agentAudit(deps, { userId: actor.userId, action: "prospection.prospect.added", entityType: "Prospect", entityId: id, metadata: { via: "TELEGRAM" } });
    return { reply: esc(pick(V.addQueued({ name }), "prospection.addQueued", chatId)) };
  },
});

// ------------------------------------------------------------------------------------------------ relances, chiffres

export const prospectsRelances = defineAction<Record<string, never>>({
  key: "prospects_relances",
  description: "Les canaux contactés à relancer et les négos qui traînent (« qui relancer ? », « relances »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const chatId = await chatKeyOf(deps);
    const due = await relancesDue(deps);
    if (!due.length) return { reply: pick(V.relancesNone, "prospection.relancesNone", chatId) };
    return kevinListLines([esc(pick(V.relancesHead({ count: due.length }), "prospection.relancesHead", chatId)), ...due.slice(0, LIST_MAX).map(relanceLine)]);
  },
});

export const prospectsStats = defineAction<Record<string, never>>({
  key: "prospects_stats",
  description: "Les chiffres de la prospection : pipeline, signés du mois, taux de réponse (« stats prospection », « pipeline », « combien de signés ce mois ? », « taux de réponse »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: statsLines(await prospectionStats(deps)).join("\n") };
  },
});

export const prospectionQuestion = defineAction<{ question: string }>({
  key: "prospection_question",
  description: "Question libre qui compare ou classe les prospects (« compare FR et IT en casino, lesquels d'abord ? », « où je devrais chercher en premier ? »)",
  theme: "equipes",
  cls: "immediate",
  spec: { question: str("La question telle que posée", { maxLength: 500 }) },
  async execute(deps, p) {
    const r = await answerProspectionQuestion(pd(deps), p.question || inputOf(deps), await chatKeyOf(deps));
    return { reply: r.reply };
  },
});

// ------------------------------------------------------------------------------------------------ recherche, offres, pause, export

type SearchP = { pays?: string; verticale?: string };

export const prospectionCherche = defineAction<SearchP>({
  key: "prospection_cherche",
  description: "Lancer une recherche dédiée de canaux d'affiliés dans un pays et un thème (« cherche des canaux casino en Pologne », « plus de paris en Grèce »)",
  theme: "equipes",
  cls: "immediate",
  spec: { pays: str("Pays cités, tels que dits", { optional: true, maxLength: 120 }), verticale: oneOf("casino ou paris_sportifs", ["casino", "paris_sportifs"], true) },
  async execute(deps, p, actor) {
    const off = await disabledReply(deps);
    if (off) return off;
    const chatId = await chatKeyOf(deps);
    const text = inputOf(deps);
    const v = p.verticale ? VERTICAL_OF[p.verticale] : verticalOf(text);
    if (v !== "CASINO" && v !== "SPORTS") return { reply: pick(V.searchNeedVertical, "prospection.searchNeedVertical", chatId) };
    const countries = countriesOf(p.pays ?? "").length ? countriesOf(p.pays ?? "") : countriesOf(text);
    const requestId = `req${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const what = requestWhat(v, countries);
    await rememberProspectionRequest(pd(deps), requestId, { chatId, countries, vertical: v, what });
    await prospectionPort(pd(deps)).requestDiscovery(pd(deps), { countries, vertical: v, requestId });
    await agentAudit(deps, { userId: actor.userId, action: "prospection.search.requested", entityType: "Setting", entityId: requestId, metadata: { via: "TELEGRAM", countries, vertical: v } });
    return { reply: esc(pick(V.searchQueued({ name: "", count: 0, what }), "prospection.searchQueued", chatId)) };
  },
});

type OffersP = { action: "voir" | "ajouter" | "desactiver"; marque?: string; pays?: string; verticale?: string; cpa?: number; revshare?: number };

export const prospectionOffres = defineAction<OffersP>({
  key: "prospection_offres",
  description: "Mes offres pour les affiliés : voir (« mes offres »), ajouter (« ajoute une offre : Winamax, FR BE, CPA 120 »), désactiver (« désactive l'offre Winamax »)",
  theme: "equipes",
  cls: "immediate",
  spec: {
    action: oneOf("voir, ajouter ou desactiver", ["voir", "ajouter", "desactiver"]),
    marque: str("Marque de l'offre", { optional: true, maxLength: 60 }),
    pays: str("Pays acceptés, tels que dits (« FR BE »)", { optional: true, maxLength: 120 }),
    verticale: oneOf("casino, paris_sportifs ou les_deux", VERTICALS, true),
    cpa: int("CPA en euros", 1, 100000, true),
    revshare: int("Part du revenu en %", 1, 100, true),
  },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    if (p.action === "voir") {
      const offers = await activeOffers(deps);
      if (!offers.length) return { reply: pick(V.offersNone, "prospection.offersNone", chatId) };
      return kevinListLines([esc(pick(V.offersHead({ count: offers.length }), "prospection.offersHead", chatId)), ...offers.map(offerLine)]);
    }
    if (p.action === "desactiver") {
      const brand = p.marque ?? inputOf(deps).replace(/^.*offre\s+/i, "").trim();
      if (!brand) return { reply: pick(V.offerNeedBrand, "prospection.offerNeedBrand", chatId) };
      return { reply: esc(await disableOffer(deps, brand, actorRef(actor), chatId)) };
    }
    const parsed = parseOfferText(inputOf(deps));
    const brand = (p.marque ?? parsed.brand ?? "").trim();
    if (!brand) return { reply: pick(V.offerNeedBrand, "prospection.offerNeedBrand", chatId) };
    const countries = countriesOf(p.pays ?? "").length ? countriesOf(p.pays ?? "") : parsed.countries;
    if (!countries.length) return { reply: esc(pick(V.offerNeedCountries({ brand }), "prospection.offerNeedCountries", chatId)) };
    const vertical = p.verticale ? (VERTICAL_OF[p.verticale] ?? "BOTH") : parsed.vertical;
    const dealTypes = p.cpa !== undefined || p.revshare !== undefined ? { ...(p.cpa !== undefined ? { cpa: p.cpa } : {}), ...(p.revshare !== undefined ? { revshare: p.revshare } : {}) } : parsed.dealTypes;
    const r = await createOffer(deps, { brand, countries, vertical, dealTypes }, actorRef(actor), chatId);
    return { reply: esc(r.reply) };
  },
});

export const prospectionPause = defineAction<{ action: "pause" | "reprise" }>({
  key: "prospection_pause",
  description: "Mettre en pause ou relancer la recherche d'affiliés (« pause la prospection », « reprends la prospection »)",
  theme: "equipes",
  cls: "immediate",
  spec: { action: oneOf("pause ou reprise", ["pause", "reprise"]) },
  async execute(deps, p, actor) {
    const chatId = await chatKeyOf(deps);
    const on = await prospectionEnabled(deps);
    const want = p.action === "reprise";
    if (on === want) return { reply: pick(want ? V.alreadyRunning : V.alreadyPaused, `prospection.already.${p.action}`, chatId) };
    await writeSetting(deps, PROSPECTION_SETTINGS.enabled.key, want);
    await agentAudit(deps, { userId: actor.userId, action: want ? "prospection.resumed" : "prospection.paused", entityType: "Setting", entityId: PROSPECTION_SETTINGS.enabled.key, metadata: { via: "TELEGRAM" } });
    return { reply: pick(want ? V.resumed : V.paused, `prospection.${p.action}`, chatId) };
  },
});

/** Page Prospection du site (variable `APP_BASE_URL`, sinon l'adresse du site). */
export function prospectionPageUrl(base = process.env.APP_BASE_URL): string {
  return `${(base ?? "https://app.linkaffipro.com").replace(/\/+$/, "")}/agents/prospection`;
}

export const prospectionExport = defineAction<Record<string, never>>({
  key: "prospection_export",
  description: "Exporter les prospects en fichier tableur, par le site (« export prospects », « envoie-moi la liste en fichier »)",
  theme: "equipes",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const rows = await queryProspects(deps, { ...emptyFilter(), statuses: ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "SKIPPED"] });
    // Pas de fichier dans Telegram : le lien vers l'export du site (filtres et colonnes au complet).
    return { reply: esc(pick(V.exportLink({ url: `${prospectionPageUrl()}?export=csv`, count: rows.length }), "prospection.export", await chatKeyOf(deps))) };
  },
});

export const PROSPECTION_ACTIONS: BossAction[] = [
  prospectsTop,
  prospectsFiltre,
  prospectDetail,
  prospectStatut,
  prospectNote,
  prospectAjout,
  prospectsRelances,
  prospectsStats,
  prospectionQuestion,
  prospectionCherche,
  prospectionOffres,
  prospectionPause,
  prospectionExport,
] as unknown as BossAction[];

/** Lectures qu'un membre présenté fait lui-même ; tout ce qui change le pipeline, les offres ou la recherche : non. */
export const PROSPECTION_READ_ACTION_KEYS = ["prospects_top", "prospects_filtre", "prospect_detail", "prospects_relances", "prospects_stats", "prospection_question", "prospection_export"] as const;
/** Réservées à l'admin : offres, pause de l'équipe. */
export const PROSPECTION_ADMIN_ACTION_KEYS = ["prospection_offres", "prospection_pause"] as const;

for (const k of PROSPECTION_READ_ACTION_KEYS) BOSS_READ_KEYS.add(k);
for (const k of PROSPECTION_ADMIN_ACTION_KEYS) BOSS_ADMIN_ONLY_KEYS.add(k);
