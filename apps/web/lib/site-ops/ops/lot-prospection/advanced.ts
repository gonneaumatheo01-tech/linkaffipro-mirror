/**
 * Phase 32 (règle de la phase 34) — cœurs uniques des pages avancées de la Prospection, appelés par le site ET par
 * Kevin : alertes (vue, couper / rétablir un canal, couper / rétablir un type), réseaux (fusionner, séparer),
 * rattachement d'un affilié signé à son identifiant Link Affi, calibrage (appliquer des choix, annuler le dernier),
 * recherche par compte réel (la COUPER seulement : l'activation passe par Kevin avec confirmation).
 * AUCUNE de ces actions ne contacte un canal ou une personne, aucune n'écrit dans Link Affi.
 * Mêmes validations et textes pour le site et Kevin ; essai à blanc (`dryRun`) qui ne fait que lire ; journal
 * (`AuditLog`, métadonnée `via`) à chaque geste réussi, et `ProspectEvent` sur la chronologie du canal.
 * Fusion, séparation et rattachement appellent les fonctions des chantiers A / B (`@linkaffipro/agents`) ; le calibrage
 * appelle `applyCalibration` / `undoCalibration` quand le paquet les exporte (sinon « pas encore disponible »).
 * Module SANS « use server » et sans `next/*`.
 */
import { ACCOUNT_SEARCH, CALIBRATION_SOURCE, linkAffiliate, mergeProspects, splitProspect, type ProspectionKevinDeps } from "@linkaffipro/agents";
import { audit, prisma } from "@linkaffipro/db";
import {
  ALERT_KINDS,
  ALERT_KIND_LABELS,
  MUTED_KINDS_KEY,
  alertKindLabel,
  calibrationProposals,
  isAlertKind,
  mutedKindsOf,
  parseChoiceNumbers,
  safeAffiliateId,
} from "@/lib/agents/prospection/advanced";
import { buildProspectionDeps } from "@/lib/agents/prospection/deps";
import { channelName, safeProspectId } from "@/lib/agents/prospection/display";
import { visibleRegionWhere } from "@/lib/agents/prospection/filters";
import { loadScope } from "@/lib/agents/prospection/queries";
import { errorText, fail, forbidden, formOf, ok, preview, str, type CoreRun, type Fail } from "../lot-d/kit";
import { resolveProspect } from "./cores";

export const ADMIN_ONLY_CALIBRATION = "Appliquer ou annuler un calibrage est réservé aux administrateurs.";
export const ALERT_NOT_FOUND = "Cette alerte n'existe pas (ou son canal est hors de votre périmètre de pays).";
export const CANAL_NOT_FOUND = "Ce canal n'est pas dans la liste (introuvable, ou hors de votre périmètre de pays).";
export const MERGE_MAX = 20;
const AFFILIATE_STATUSES = ["SIGNED", "ACTIVE", "CHURNED"];

type Lite = { id: string; title: string; username: string | null; channelUrl: string; status: string; networkId: string | null; watchMuted: boolean };
const liteSelect = { id: true, title: true, username: true, channelUrl: true, status: true, networkId: true, watchMuted: true } as const;
const named = (p: { title: string; username: string | null; channelUrl: string }) => (p.username ? `@${p.username}` : `« ${channelName(p)} »`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Dépendances des fonctions de l'équipe (aucun messager : le site n'envoie rien à personne). */
const deps = () => buildProspectionDeps() as unknown as ProspectionKevinDeps;

async function visible(id: string | null): Promise<{ ok: true; p: Lite } | { ok: false; result: Fail }> {
  if (!id) return { ok: false, result: fail("Canal inconnu.", "invalid", "prospectId") };
  const p = await prisma.prospect.findFirst({ where: { AND: [{ id }, visibleRegionWhere(await loadScope())] }, select: liteSelect });
  return p ? { ok: true, p } : { ok: false, result: fail(CANAL_NOT_FOUND, "not_found") };
}

async function event(prospectId: string, type: string, payload: Record<string, unknown>): Promise<void> {
  await prisma.prospectEvent.create({ data: { prospectId, type, payload: payload as never } });
}

// ------------------------------------------------------------------------------------------------- alertes

/** « Vu » sur une alerte (elle sort de la liste à voir ; rien n'est envoyé). */
export const runAlertSeen: CoreRun = async (fd, actor, opts = {}) => {
  const id = safeProspectId(fd.get("alertId"));
  if (!id) return fail("Alerte inconnue.", "invalid", "alertId");
  const a = await prisma.prospectAlert.findFirst({
    where: { id, prospect: visibleRegionWhere(await loadScope()) },
    select: { id: true, kind: true, status: true, prospectId: true, prospect: { select: { title: true, username: true, channelUrl: true } } },
  });
  if (!a) return fail(ALERT_NOT_FOUND, "not_found");
  if (a.status === "SEEN") return fail("Cette alerte est déjà marquée vue.", "conflict");
  const what = `« ${alertKindLabel(a.kind)} » sur ${named(a.prospect)}`;
  if (opts.dryRun) return preview(`Marquer vue l'alerte ${what}.`);
  try {
    await prisma.prospectAlert.update({ where: { id: a.id }, data: { status: "SEEN", seenAt: new Date() } });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: "agents.prospection_alert_seen", entityType: "ProspectAlert", entityId: a.id, metadata: { kind: a.kind, prospectId: a.prospectId, via: actor.via } });
  return ok(`Alerte ${what} marquée vue.`);
};

/** « Plus pour ce canal » (`action = mute`) ou rétablir ses alertes (`action = unmute`). */
export const runAlertsChannel: CoreRun = async (fd, actor, opts = {}) => {
  const action = str(fd.get("action")).trim() || "mute";
  if (action !== "mute" && action !== "unmute") return fail("Couper ou rétablir les alertes ?", "invalid", "action");
  const v = await visible(safeProspectId(fd.get("prospectId")));
  if (!v.ok) return v.result;
  const { p } = v;
  if (action === "mute" && p.watchMuted) return fail(`Les alertes de ${named(p)} sont déjà coupées.`, "conflict");
  if (action === "unmute" && !p.watchMuted) return fail(`Les alertes de ${named(p)} ne sont pas coupées.`, "conflict");
  if (opts.dryRun)
    return preview(
      action === "mute"
        ? `Ne plus recevoir d'alerte pour ${named(p)} (le canal reste suivi, ses chiffres restent à jour).`
        : `Recevoir de nouveau les alertes de ${named(p)}.`,
    );
  let muted = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.prospect.update({ where: { id: p.id }, data: { watchMuted: action === "mute" } });
      if (action === "mute") muted = (await tx.prospectAlert.updateMany({ where: { prospectId: p.id, status: { in: ["NEW", "SENT"] } }, data: { status: "MUTED" } })).count;
    });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await event(p.id, action === "mute" ? "ALERTS_MUTED" : "ALERTS_UNMUTED", { by: "client", via: actor.via, userId: actor.userId });
  await audit({ userId: actor.userId, action: action === "mute" ? "agents.prospection_alerts_channel_muted" : "agents.prospection_alerts_channel_unmuted", entityType: "Prospect", entityId: p.id, metadata: { muted, via: actor.via } });
  return ok(action === "mute" ? `Plus d'alerte pour ${named(p)}.` : `Les alertes de ${named(p)} reprennent.`);
};

/** Couper (`action = mute`) ou rétablir (`unmute`) un type d'alerte pour tous les canaux. */
export const runAlertsKind: CoreRun = async (fd, actor, opts = {}) => {
  const kind = str(fd.get("kind")).trim();
  if (!isAlertKind(kind)) return fail("Type d'alerte inconnu.", "invalid", "kind");
  const action = str(fd.get("action")).trim() || "mute";
  if (action !== "mute" && action !== "unmute") return fail("Couper ou rétablir ce type d'alerte ?", "invalid", "action");
  const row = await prisma.setting.findUnique({ where: { key: MUTED_KINDS_KEY }, select: { value: true } });
  const current = mutedKindsOf(row?.value);
  const label = `« ${ALERT_KIND_LABELS[kind]} »`;
  if (action === "mute" && current.includes(kind)) return fail(`Les alertes ${label} sont déjà coupées.`, "conflict");
  if (action === "unmute" && !current.includes(kind)) return fail(`Les alertes ${label} ne sont pas coupées.`, "conflict");
  if (opts.dryRun) return preview(action === "mute" ? `Ne plus recevoir les alertes ${label}, pour tous les canaux.` : `Recevoir de nouveau les alertes ${label}.`);
  const next = action === "mute" ? [...current, kind] : current.filter((k) => k !== kind);
  let muted = 0;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: MUTED_KINDS_KEY }, create: { key: MUTED_KINDS_KEY, value: next as never }, update: { value: next as never } });
      if (action === "mute") muted = (await tx.prospectAlert.updateMany({ where: { kind, status: "NEW" }, data: { status: "MUTED" } })).count;
    });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: action === "mute" ? "agents.prospection_alert_kind_muted" : "agents.prospection_alert_kind_unmuted", entityType: "Setting", entityId: MUTED_KINDS_KEY, metadata: { kind, muted, via: actor.via } });
  return ok(action === "mute" ? `Alertes ${label} coupées.` : `Alertes ${label} rétablies.`);
};

// ------------------------------------------------------------------------------------------------- réseaux

/** Fusionner des canaux en un réseau (« c'est la même personne »). Deux canaux au moins. */
export const runNetworkMerge: CoreRun = async (fd, actor, opts = {}) => {
  const ids = [...new Set(fd.getAll("ids").flatMap((x) => str(x).split(/[\s,;]+/)).map((x) => safeProspectId(x)).filter((x): x is string => Boolean(x)))];
  // Formulaire du site : @noms ou liens t.me séparés par des virgules (« et » accepté).
  const handles = fd.getAll("names").flatMap((x) => str(x).split(/[\s,;]+|\bet\b/)).map((x) => x.trim()).filter(Boolean);
  for (const n of handles.slice(0, MERGE_MAX + 1)) {
    const r = await resolveProspect(n);
    if (!r.ok) return r.result;
    if (!ids.includes(r.id)) ids.push(r.id);
  }
  if (ids.length < 2) return fail("Choisissez au moins deux canaux à regrouper.", "invalid", "ids");
  if (ids.length > MERGE_MAX) return fail(`${MERGE_MAX} canaux au plus dans un même réseau.`, "invalid", "ids");
  const found = await prisma.prospect.findMany({ where: { AND: [{ id: { in: ids } }, visibleRegionWhere(await loadScope())] }, select: liteSelect });
  if (found.length !== ids.length) return fail(CANAL_NOT_FOUND, "not_found");
  const names = found.map(named).join(", ");
  if (new Set(found.map((p) => p.networkId)).size === 1 && found[0]!.networkId) return fail(`${capital(names)} sont déjà dans le même réseau.`, "conflict");
  if (opts.dryRun) return preview(`Regrouper ${names} en un seul réseau (la même personne) : une seule ligne dans la liste du matin, un seul accord à négocier.`);
  let r;
  try {
    r = await mergeProspects(deps(), ids, "client");
  } catch (err) {
    return fail(`Regroupement impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(capital(r.message ?? "regroupement impossible") + ".", "conflict");
  await audit({ userId: actor.userId, action: "agents.prospection_network_merged", entityType: "ProspectNetwork", entityId: r.networkId ?? ids.join(","), metadata: { ids, via: actor.via } });
  return ok(`${capital(names)} regroupés en un réseau.`, r.networkId ? { networkId: r.networkId } : undefined);
};

/** Sortir un canal de son réseau (l'équipe ne le regroupera plus jamais avec ces canaux). */
export const runNetworkSplit: CoreRun = async (fd, actor, opts = {}) => {
  const v = await visible(safeProspectId(fd.get("prospectId")));
  if (!v.ok) return v.result;
  const { p } = v;
  if (!p.networkId) return fail(`${capital(named(p))} n'est dans aucun réseau.`, "conflict");
  if (opts.dryRun) return preview(`Sortir ${named(p)} de son réseau : l'équipe ne le regroupera plus avec ces canaux.`);
  let r;
  try {
    r = await splitProspect(deps(), p.id, "client");
  } catch (err) {
    return fail(`Séparation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(capital(r.message ?? "séparation impossible") + ".", "conflict");
  await audit({ userId: actor.userId, action: "agents.prospection_network_split", entityType: "Prospect", entityId: p.id, metadata: { networkId: p.networkId, via: actor.via } });
  return ok(`${capital(named(p))} sorti de son réseau.`);
};

// ------------------------------------------------------------------------------------------------- affiliés signés

/** « @x = affilié 1234 » : rattache un canal signé à son identifiant d'affilié Link Affi (lecture seule ensuite). */
export const runAffiliateLink: CoreRun = async (fd, actor, opts = {}) => {
  const v = await visible(safeProspectId(fd.get("prospectId")));
  if (!v.ok) return v.result;
  const { p } = v;
  const affiliateId = safeAffiliateId(fd.get("affiliateId"));
  if (!affiliateId) return fail("Identifiant d'affilié Link Affi : des chiffres ou des lettres (64 caractères au plus).", "invalid", "affiliateId");
  if (!AFFILIATE_STATUSES.includes(p.status)) return fail(`${capital(named(p))} n'est pas signé : notez d'abord qu'il a signé.`, "conflict");
  const taken = await prisma.prospect.findFirst({ where: { linkAffiAffiliateId: affiliateId, id: { not: p.id } }, select: { title: true, username: true, channelUrl: true } });
  if (taken) return fail(`L'affilié ${affiliateId} est déjà rattaché à ${named(taken)}.`, "conflict");
  if (opts.dryRun) return preview(`Rattacher ${named(p)} à l'affilié Link Affi ${affiliateId} : ses vrais résultats seront lus chaque mois (lecture seule).`);
  let r;
  try {
    r = await linkAffiliate(deps(), p.id, affiliateId, "client");
  } catch (err) {
    return fail(`Rattachement impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(capital(r.message ?? "rattachement impossible") + ".", "conflict");
  await audit({ userId: actor.userId, action: "agents.prospection_affiliate_linked", entityType: "Prospect", entityId: p.id, metadata: { affiliateId, via: actor.via } });
  return ok(`${capital(named(p))} rattaché à l'affilié Link Affi ${affiliateId}.`);
};

// ------------------------------------------------------------------------------------------------- calibrage

type CalibrationFns = {
  applyCalibration?: (deps: ProspectionKevinDeps, choices: string[], by: "client" | "system") => Promise<{ ok: boolean; message?: string | null; applied?: number }>;
  undoCalibration?: (deps: ProspectionKevinDeps, by: "client" | "system") => Promise<{ ok: boolean; message?: string | null; undone?: number }>;
};

/** Fonctions du chantier B, si le paquet les exporte déjà (sinon null : « pas encore disponible »). */
async function calibrationFn<K extends keyof CalibrationFns>(name: K): Promise<NonNullable<CalibrationFns[K]> | null> {
  const mod = (await import("@linkaffipro/agents")) as unknown as CalibrationFns;
  const fn = mod[name];
  return typeof fn === "function" ? (fn as NonNullable<CalibrationFns[K]>) : null;
}

const NOT_READY = "Le calibrage n'est pas encore branché : réessayez après la prochaine mise à jour.";

async function openProposals() {
  const rows = await prisma.recommendation.findMany({
    where: { teamKey: "prospection", source: CALIBRATION_SOURCE, status: "PROPOSED" },
    select: { id: true, targetId: true, field: true, before: true, after: true, evidence: true, expectedGain: true, createdAt: true },
    take: 50,
  });
  return calibrationProposals(rows);
}

/** Appliquer des propositions de calibrage (identifiants, ou numéros de la liste : la plus ancienne = 1). Administrateurs. */
export const runCalibrationApply: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY_CALIBRATION);
  const proposals = await openProposals();
  if (!proposals.length) return fail("Aucune proposition de calibrage en cours.", "conflict");
  const asked = fd.getAll("ids").flatMap((x) => str(x).split(/[\s,;]+/)).filter(Boolean);
  const numbers = parseChoiceNumbers(fd.getAll("numbers").map(str));
  const chosen = proposals.filter((p) => asked.includes(p.id) || numbers.includes(p.number));
  const unknown = numbers.filter((n) => !proposals.some((p) => p.number === n));
  if (unknown.length) return fail(`Pas de proposition n° ${unknown.join(", ")} (il y en a ${proposals.length}).`, "not_found", "numbers");
  if (!chosen.length) return fail("Cochez au moins une proposition.", "invalid", "ids");
  const summary = chosen.map((c) => `${c.number}. ${c.what} (${c.target}) : ${c.change}`).join(" ; ");
  if (opts.dryRun) return preview(`Appliquer ${chosen.length > 1 ? "les choix" : "le choix"} ${summary}. Annulable en un clic.`);
  const fn = await calibrationFn("applyCalibration");
  if (!fn) return fail(NOT_READY, "unavailable");
  let r;
  try {
    r = await fn(deps(), chosen.map((c) => c.id), "client");
  } catch (err) {
    return fail(`Calibrage impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(capital(r.message ?? "calibrage impossible") + ".", "conflict");
  await audit({ userId: actor.userId, action: "agents.prospection_calibration_applied", entityType: "Recommendation", entityId: chosen.map((c) => c.id).join(","), metadata: { numbers: chosen.map((c) => c.number), via: actor.via } });
  return ok(`Calibrage appliqué : ${chosen.map((c) => `choix ${c.number}`).join(", ")}. « Annuler le dernier calibrage » revient en arrière.`);
};

/** Annuler le dernier calibrage appliqué (retour aux coefficients d'avant). Administrateurs. */
export const runCalibrationUndo: CoreRun = async (_fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY_CALIBRATION);
  const last = await prisma.recommendation.findFirst({ where: { teamKey: "prospection", source: CALIBRATION_SOURCE, status: "APPLIED" }, orderBy: { appliedAt: "desc" }, select: { id: true, appliedAt: true } });
  if (!last) return fail("Aucun calibrage appliqué à annuler.", "conflict");
  if (opts.dryRun) return preview(`Annuler le calibrage appliqué le ${last.appliedAt ? last.appliedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "?"} : les estimations reprennent les coefficients d'avant.`);
  const fn = await calibrationFn("undoCalibration");
  if (!fn) return fail(NOT_READY, "unavailable");
  let r;
  try {
    r = await fn(deps(), "client");
  } catch (err) {
    return fail(`Annulation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(capital(r.message ?? "annulation impossible") + ".", "conflict");
  await audit({ userId: actor.userId, action: "agents.prospection_calibration_undone", entityType: "Recommendation", entityId: last.id, metadata: { via: actor.via } });
  return ok("Dernier calibrage annulé : les estimations reprennent les coefficients d'avant.");
};

// ------------------------------------------------------------------------------------------------- compte réel

/**
 * Couper la recherche par compte réel. Tout le monde peut la couper (elle ne fait que réduire un risque) ; la
 * rallumer passe par Kevin, avec confirmation de l'administrateur.
 */
export const runAccountSearchStop: CoreRun = async (_fd, actor, opts = {}) => {
  const key = ACCOUNT_SEARCH.enabled.key;
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  if (row?.value !== true) return fail("La recherche par compte réel est déjà coupée.", "conflict");
  if (opts.dryRun) return preview("Couper la recherche par compte réel : plus aucune recherche dans Telegram avec un compte. Pour la rallumer, demandez à Kevin.");
  try {
    await prisma.setting.update({ where: { key }, data: { value: false } });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: "agents.prospection_account_search_stopped", entityType: "Setting", entityId: key, metadata: { via: actor.via } });
  return ok("Recherche par compte réel coupée. Pour la rallumer, demandez à Kevin.");
};

// ------------------------------------------------------------------------------------------------- entrées de Kevin

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Alerte désignée par Kevin : identifiant, ou numéro dans la liste des alertes à voir (la plus récente = 1). */
export async function kevinAlertSeenForm(input: Record<string, unknown>): Promise<Prepared> {
  const raw = str(input.alerte ?? input.alertId ?? input.id).trim();
  const id = safeProspectId(raw);
  if (id) return { ok: true, fd: formOf({ alertId: id }) };
  const n = Number(raw.replace(/[^\d]/g, ""));
  if (!Number.isInteger(n) || n < 1) return { ok: false, result: fail("Quelle alerte ? Donnez son numéro dans la liste des alertes à voir (« la 2 »).", "invalid", "alerte") };
  const list = await prisma.prospectAlert.findMany({
    where: { status: { in: ["NEW", "SENT"] }, prospect: visibleRegionWhere(await loadScope()) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: n,
    select: { id: true },
  });
  const hit = list[n - 1];
  if (!hit) return { ok: false, result: fail(`Pas d'alerte n° ${n} à voir.`, "not_found", "alerte") };
  return { ok: true, fd: formOf({ alertId: hit.id }) };
}

const actionOf = (v: unknown) => (/retabl|reactiv|remet|unmute|reprend/.test(plain(str(v))) ? "unmute" : "mute");

export async function kevinAlertsChannelForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveProspect(input.canal ?? input.prospect ?? input.prospectId);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ prospectId: r.id, action: actionOf(input.action) }) };
}

/** Mots de Kevin → type d'alerte (« affilié lâché », « canaux en hausse », « contact changé »…). */
export const KIND_WORDS: Array<[RegExp, (typeof ALERT_KINDS)[number]]> = [
  [/lache|abandon|drop/, "AFFILIATE_DROPPED"],
  [/change de marque|switch/, "AFFILIATE_SWITCHED"],
  [/nouvelle marque|new affiliate/, "NEW_AFFILIATE"],
  [/hausse|monte|croissance|etoile|growth/, "GROWTH_SPIKE"],
  [/baisse|declin|decline/, "DECLINE"],
  [/concurrent|competitor/, "AFFILIATE_PUSHES_COMPETITOR"],
  [/risque|garanti|risky/, "AFFILIATE_RISKY_CLAIM"],
  [/ne poste pas|pas nos liens|not posting/, "AFFILIATE_NOT_POSTING"],
  [/affilie.*(silence|publie plus)/, "AFFILIATE_SILENT"],
  [/silence|publie plus|silent/, "WENT_SILENT"],
  [/vend de la pub|pub|ads/, "STARTED_SELLING_ADS"],
  [/place de marche|marketplace/, "MARKETPLACE_LISTED"],
  [/contact/, "CONTACT_CHANGED"],
  [/niveau en hausse|tier up|monte de niveau/, "TIER_UP"],
  [/niveau en baisse|tier down|baisse de niveau/, "TIER_DOWN"],
];

export function alertKindFromWords(v: unknown): string | null {
  const raw = str(v).trim();
  if (isAlertKind(raw.toUpperCase())) return raw.toUpperCase();
  const p = plain(raw);
  for (const k of ALERT_KINDS) if (plain(ALERT_KIND_LABELS[k]) === p) return k;
  // Les niveaux d'abord (« niveau en hausse » ne doit pas devenir « en forte hausse »).
  if (/niveau/.test(p)) return /hausse|monte/.test(p) ? "TIER_UP" : /baisse/.test(p) ? "TIER_DOWN" : null;
  for (const [re, k] of KIND_WORDS) if (re.test(p)) return k;
  return null;
}

export async function kevinAlertsKindForm(input: Record<string, unknown>): Promise<Prepared> {
  const kind = alertKindFromWords(input.type ?? input.kind);
  if (!kind) return { ok: false, result: fail(`Quel type d'alerte ? ${ALERT_KINDS.map((k) => ALERT_KIND_LABELS[k].toLowerCase()).join(", ")}.`, "invalid", "type") };
  return { ok: true, fd: formOf({ kind, action: actionOf(input.action) }) };
}

export async function kevinNetworkMergeForm(input: Record<string, unknown>): Promise<Prepared> {
  const raw = Array.isArray(input.canaux) ? input.canaux : str(input.canaux ?? input.ids).split(/[\s,;]+|\bet\b/).filter((x) => x.trim());
  if (raw.length < 2) return { ok: false, result: fail("Quels canaux regrouper ? Donnez au moins deux @noms.", "invalid", "canaux") };
  const ids: string[] = [];
  for (const c of raw.slice(0, MERGE_MAX)) {
    const r = await resolveProspect(c);
    if (!r.ok) return r;
    ids.push(r.id);
  }
  return { ok: true, fd: formOf({ ids }) };
}

export async function kevinNetworkSplitForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveProspect(input.canal ?? input.prospect ?? input.prospectId);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ prospectId: r.id }) };
}

export async function kevinAffiliateLinkForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveProspect(input.canal ?? input.prospect ?? input.prospectId);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ prospectId: r.id, affiliateId: input.affilie ?? input.affiliateId }) };
}

export async function kevinCalibrationApplyForm(input: Record<string, unknown>): Promise<Prepared> {
  const numbers = parseChoiceNumbers(input.choix ?? input.numeros ?? input.numbers);
  const ids = Array.isArray(input.ids) ? input.ids.map(str) : [];
  if (!numbers.length && !ids.length) return { ok: false, result: fail("Quels choix appliquer ? Donnez leurs numéros (« 1 et 3 »).", "invalid", "choix") };
  return { ok: true, fd: formOf({ numbers: numbers.map(String), ids }) };
}

export async function kevinEmptyForm(): Promise<Prepared> {
  return { ok: true, fd: new FormData() };
}
