/**
 * Phase 31 (règle de la phase 34) — cœurs uniques de la page Agents → Prospection, appelés par le site ET par Kevin :
 * - canaux trouvés : changer le statut d'un canal (contacté, a répondu, en discussion, signé avec ses conditions,
 *   actif, a arrêté, pas intéressé, reprendre, plus tard ; « ne plus montrer » : administrateurs), plusieurs canaux à
 *   la fois (« marquer contactés », « ignorer »), note, ajout d'un canal à la main ;
 * - offres du client aux affiliés : créer / modifier, activer / désactiver ;
 * - marques et repères : proposer un ajout (tous), valider ou refuser (administrateurs) ;
 * - sources : pause / reprise (administrateurs) ; réglages de l'équipe (administrateurs).
 * AUCUNE de ces actions ne contacte un canal ou une personne : elles notent ce que le client a fait lui-même.
 * Un canal hors Europe (hors périmètre) n'est jamais trouvé ici. Mêmes validations et textes pour le site et Kevin ;
 * essai à blanc (`dryRun`) qui ne fait que lire ; journal (`AuditLog`, métadonnée `via`) à chaque geste réussi.
 * Module SANS « use server » et sans `next/*`.
 */
import { canTransition, PROSPECTION_SETTINGS, snoozeProspect, transitionProspect, addProspectNote, addManualProspect } from "@linkaffipro/agents";
import { audit, prisma } from "@linkaffipro/db";
import {
  DICT_ADDITIONS_KEY,
  DICT_PROPOSALS_KEY,
  additionsOf,
  alreadyKnown,
  applyProposal,
  knownLists,
  parseProposalForm,
  proposalText,
  proposalsOf,
  type DictProposal,
} from "@/lib/agents/prospection/dict";
import { buildProspectionDeps } from "@/lib/agents/prospection/deps";
import { channelName, safeProspectId, type ProspectStatusKey } from "@/lib/agents/prospection/display";
import { visibleRegionWhere } from "@/lib/agents/prospection/filters";
import { dealText, parseOfferForm } from "@/lib/agents/prospection/offers";
import { loadDictionaries, loadProspectionSettings, loadScope } from "@/lib/agents/prospection/queries";
import { parseSettingsForm, settingsChanges } from "@/lib/agents/prospection/settings";
import { DISCOVERY_SOURCES, DISCOVERY_SOURCE_LABELS, PAUSE_DAYS, pausesOf } from "@/lib/agents/prospection/sources";
import { statusLabel } from "@/lib/status-badges";
import { errorText, fail, forbidden, formOf, ok, preview, str, truthy, type CoreRun, type Fail } from "../lot-d/kit";

export const BLACKLIST_ADMIN_ONLY = "Mettre un canal à « ne plus montrer » est réservé aux administrateurs.";
export const ADMIN_ONLY_SOURCES = "Mettre en pause ou reprendre une source est réservé aux administrateurs.";
export const ADMIN_ONLY_SETTINGS = "Les réglages de la prospection sont réservés aux administrateurs.";
export const ADMIN_ONLY_DICT = "Valider ou refuser un ajout aux marques et repères est réservé aux administrateurs.";
export const NOT_FOUND = "Ce canal n'est pas dans la liste (introuvable, ou hors de votre périmètre de pays).";
export const BULK_MAX = 200;
export const NOTE_MAX = 1000;

/** Statuts qu'une personne peut donner (les autres sont posés par l'équipe : lecture, note). « LATER » = plus tard. */
export const CLIENT_TARGETS = ["CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE", "CHURNED", "SKIPPED", "QUALIFIED", "BLACKLISTED"] as const;
export const LATER = "LATER";

const prospectSelect = { id: true, title: true, username: true, channelUrl: true, status: true } as const;
type ProspectLite = { id: string; title: string; username: string | null; channelUrl: string; status: string };

const named = (p: ProspectLite) => (p.username ? `@${p.username}` : `« ${channelName(p)} »`);
const label = (s: string) => `« ${statusLabel("prospectStatus", s)} »`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function visibleProspect(id: string | null): Promise<{ ok: true; p: ProspectLite } | { ok: false; result: Fail }> {
  if (!id) return { ok: false, result: fail("Canal inconnu.", "invalid", "prospectId") };
  const scope = await loadScope();
  const p = await prisma.prospect.findFirst({ where: { AND: [{ id }, visibleRegionWhere(scope)] }, select: prospectSelect });
  if (!p) return { ok: false, result: fail(NOT_FOUND, "not_found") };
  return { ok: true, p };
}

function amount(raw: FormDataEntryValue | null, max: number): number | null | "bad" {
  const s = str(raw).replace(/\s|€|%/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : "bad";
}

/** Conditions d'un canal signé : type (prime par joueur, part du revenu, mixte) et montants, tous facultatifs. */
export function parseDeal(fd: FormData): { ok: true; dealType: "CPA" | "REVSHARE" | "HYBRID" | null; dealTerms: Record<string, unknown> | null } | { ok: false; result: Fail } {
  const t = str(fd.get("dealType")).toUpperCase();
  const dealType = t === "CPA" || t === "REVSHARE" || t === "HYBRID" ? t : null;
  if (t && !dealType) return { ok: false, result: fail("Type d'accord inconnu : prime par joueur, part du revenu ou mixte.", "invalid", "dealType") };
  const cpa = amount(fd.get("cpa"), 10_000);
  const revshare = amount(fd.get("revshare"), 100);
  if (cpa === "bad") return { ok: false, result: fail("Prime par joueur : un montant en euros de 0 à 10 000.", "invalid", "cpa") };
  if (revshare === "bad") return { ok: false, result: fail("Part du revenu : un pourcentage de 0 à 100.", "invalid", "revshare") };
  const notes = str(fd.get("dealNotes")).trim().slice(0, 300) || null;
  const terms: Record<string, unknown> = {};
  if (cpa !== null) terms.cpa = cpa;
  if (revshare !== null) terms.revshare = revshare;
  if (notes) terms.notes = notes;
  if (Object.keys(terms).length) terms.currency = "EUR";
  const inferred = dealType ?? (cpa !== null && revshare !== null ? "HYBRID" : cpa !== null ? "CPA" : revshare !== null ? "REVSHARE" : null);
  return { ok: true, dealType: inferred, dealTerms: Object.keys(terms).length ? terms : null };
}

function dealSummary(dealType: string | null, terms: Record<string, unknown> | null): string {
  if (!dealType && !terms) return "";
  const t = terms ?? {};
  const d = dealText(dealType === "HYBRID" && t.cpa !== undefined && t.revshare !== undefined ? { hybrid: { cpa: t.cpa, revshare: t.revshare } } : t);
  return d === "Aucune condition" ? "" : ` (${d.toLowerCase()})`;
}

/** Changer le statut d'un canal, ou « plus tard » (`status = LATER`, `days`). */
export const runProspectStatus: CoreRun = async (fd, actor, opts = {}) => {
  const to = str(fd.get("status")).trim().toUpperCase();
  if (to !== LATER && !(CLIENT_TARGETS as readonly string[]).includes(to)) return fail("Statut inconnu.", "invalid", "status");
  if (to === "BLACKLISTED" && actor.role !== "ADMIN") return forbidden(BLACKLIST_ADMIN_ONLY);
  const v = await visibleProspect(safeProspectId(fd.get("prospectId")));
  if (!v.ok) return v.result;
  const { p } = v;

  if (to === LATER) {
    const raw = str(fd.get("days")).trim();
    const days = raw ? Number(raw) : 7;
    if (!Number.isInteger(days) || days < 1 || days > 90) return fail("Plus tard : un nombre de jours de 1 à 90.", "invalid", "days");
    if (p.status === "BLACKLISTED") return fail("Ce canal est à ne plus montrer.", "conflict");
    if (opts.dryRun) return preview(`Remettre ${named(p)} à plus tard : il revient dans la liste du matin dans ${days} jour${days > 1 ? "s" : ""}.`);
    const r = await snoozeProspect(buildProspectionDeps(), p.id, days, "client");
    if (!r.ok) return fail(capital(r.reason) + ".", "conflict");
    await audit({ userId: actor.userId, action: "agents.prospect_snoozed", entityType: "Prospect", entityId: p.id, metadata: { days, until: r.until.toISOString(), via: actor.via } });
    return ok(`${capital(named(p))} revient dans ${days} jour${days > 1 ? "s" : ""}.`);
  }

  if (!canTransition(p.status as never, to as never, "client"))
    return fail(p.status === "BLACKLISTED" ? "Ce canal est à ne plus montrer : son statut ne change plus." : `Impossible de passer ${named(p)} de ${label(p.status)} à ${label(to)}.`, "conflict");
  const deal = to === "SIGNED" ? parseDeal(fd) : ({ ok: true, dealType: null, dealTerms: null } as const);
  if (!deal.ok) return deal.result;
  const summary = `${capital(named(p))} : ${label(p.status)} → ${label(to)}${dealSummary(deal.dealType, deal.dealTerms)}.`;
  if (opts.dryRun)
    return preview(
      to === "BLACKLISTED" ? `${summary} Il ne sera plus jamais montré.` : `${summary} Rien n'est envoyé au canal : vous notez ce que vous avez fait.`,
    );
  let r;
  try {
    r = await transitionProspect(buildProspectionDeps(), p.id, to as never, {
      by: "client",
      payload: { via: actor.via, userId: actor.userId },
      ...(deal.dealType ? { dealType: deal.dealType } : {}),
      ...(deal.dealTerms ? { dealTerms: deal.dealTerms } : {}),
    });
  } catch (err) {
    return fail(`Changement impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(capital(r.reason) + ".", "conflict");
  await audit({
    userId: actor.userId,
    action: "agents.prospect_status_changed",
    entityType: "Prospect",
    entityId: p.id,
    metadata: { from: p.status, to, dealType: deal.dealType, dealTerms: (deal.dealTerms ?? null) as never, via: actor.via },
  });
  return ok(summary);
};

export const BULK_TARGETS = ["CONTACTED", "SKIPPED"] as const;

/** Plusieurs canaux à la fois : « marquer contactés » (`CONTACTED`) ou « ignorer » (`SKIPPED`, pas intéressé). */
export const runBulkProspectStatus: CoreRun = async (fd, actor, opts = {}) => {
  const to = str(fd.get("status")).trim().toUpperCase();
  if (!(BULK_TARGETS as readonly string[]).includes(to)) return fail("Choisissez « marquer contactés » ou « ignorer ».", "invalid", "status");
  const ids = [...new Set(fd.getAll("ids").map((x) => safeProspectId(x)).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return fail("Cochez au moins un canal.", "invalid", "ids");
  if (ids.length > BULK_MAX) return fail(`${BULK_MAX} canaux à la fois au plus.`, "invalid", "ids");
  const scope = await loadScope();
  const found = await prisma.prospect.findMany({ where: { AND: [{ id: { in: ids } }, visibleRegionWhere(scope)] }, select: prospectSelect });
  const movable = found.filter((p) => canTransition(p.status as never, to as never, "client"));
  const skipped = ids.length - movable.length;
  const verb = to === "CONTACTED" ? "marqué contacté" : "ignoré (pas intéressé)";
  const plural = (n: number) => (n > 1 ? "s" : "");
  if (!movable.length) return fail(`Aucun des canaux cochés ne peut être ${verb}.`, "conflict");
  const extra = skipped ? ` ${skipped} laissé${plural(skipped)} tel${plural(skipped)} quel${plural(skipped)} (statut qui ne le permet pas, ou hors liste).` : "";
  if (opts.dryRun)
    return preview(`${movable.length} canal${movable.length > 1 ? "ux" : ""} ${verb}${plural(movable.length)} : ${movable.slice(0, 5).map(named).join(", ")}${movable.length > 5 ? "…" : ""}.${extra} Rien n'est envoyé aux canaux.`);
  const deps = buildProspectionDeps();
  const done: string[] = [];
  for (const p of movable) {
    try {
      const r = await transitionProspect(deps, p.id, to as never, { by: "client", payload: { via: actor.via, userId: actor.userId, bulk: true } });
      if (r.ok) done.push(p.id);
    } catch {
      /* un canal en échec n'arrête pas les autres */
    }
  }
  if (!done.length) return fail("Changement impossible pour l'instant : réessayez dans un instant.", "unavailable");
  await audit({ userId: actor.userId, action: "agents.prospects_bulk_status", entityType: "Prospect", metadata: { to, ids: done, count: done.length, via: actor.via } });
  const left = ids.length - done.length;
  return ok(`${done.length} canal${done.length > 1 ? "ux" : ""} ${verb}${plural(done.length)}.${left ? ` ${left} laissé${plural(left)} tel${plural(left)} quel${plural(left)}.` : ""}`);
};

/** Note sur un canal (« veut des visuels mardi »). */
export const runProspectNote: CoreRun = async (fd, actor, opts = {}) => {
  const note = str(fd.get("note")).replace(/\s+/g, " ").trim();
  if (!note) return fail("Écrivez la note.", "invalid", "note");
  if (note.length > NOTE_MAX) return fail(`La note fait ${NOTE_MAX} caractères au plus.`, "invalid", "note");
  const v = await visibleProspect(safeProspectId(fd.get("prospectId")));
  if (!v.ok) return v.result;
  if (opts.dryRun) return preview(`Ajouter une note sur ${named(v.p)} : « ${note.slice(0, 120)}${note.length > 120 ? "…" : ""} ».`);
  const r = await addProspectNote(buildProspectionDeps(), v.p.id, note, "client");
  if (!r.ok) return fail(capital(r.reason) + ".", "invalid", "note");
  await audit({ userId: actor.userId, action: "agents.prospect_note_added", entityType: "Prospect", entityId: v.p.id, metadata: { noteId: r.id, length: note.length, via: actor.via } });
  return ok(`Note ajoutée sur ${named(v.p)}.`);
};

/** Lien public accepté pour un ajout à la main : `@nom`, `t.me/nom`, `t.me/s/nom`. Jamais un lien d'invitation privé. */
export function manualUrl(raw: string): { ok: true; url: string; username: string } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Collez le lien public du canal (t.me/nom ou @nom)." };
  if (/t(?:elegram)?\.me\/(\+|joinchat\/)/i.test(s) || /^\+/.test(s))
    return { ok: false, error: "C'est un lien d'invitation privé : l'équipe ne lit que les canaux publics (t.me/nom)." };
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?([A-Za-z0-9_]{4,64})\/?(?:\d+)?(?:[?#].*)?$/i) ?? s.match(/^@?([A-Za-z0-9_]{4,64})$/);
  if (!m) return { ok: false, error: "Lien non reconnu : collez l'adresse t.me/nom du canal, ou @nom." };
  const username = m[1]!.toLowerCase();
  return { ok: true, url: `https://t.me/${username}`, username };
}

/** Ajouter un canal à la main (source « ajouté à la main ») : il est lu en priorité, sans jamais le rejoindre. */
export const runAddManualProspect: CoreRun = async (fd, actor, opts = {}) => {
  const u = manualUrl(str(fd.get("url")));
  if (!u.ok) return fail(u.error, "invalid", "url");
  const existing = await prisma.prospect.findFirst({ where: { OR: [{ username: u.username }, { channelUrl: u.url }] }, select: { ...prospectSelect, region: true } });
  if (existing) {
    const scope = await loadScope();
    const visible = await prisma.prospect.count({ where: { AND: [{ id: existing.id }, visibleRegionWhere(scope)] } });
    return fail(
      visible ? `@${u.username} est déjà dans la liste (${label(existing.status)}).` : `@${u.username} est déjà connu : son audience est hors de votre périmètre de pays.`,
      "conflict",
      "url",
    );
  }
  if (opts.dryRun) return preview(`Ajouter @${u.username} (${u.url}) : l'équipe lit sa page publique en priorité, puis le note. Personne n'est contacté.`);
  let r;
  try {
    r = await addManualProspect(buildProspectionDeps(), { url: u.url }, "client");
  } catch (err) {
    return fail(`Ajout impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  if (!r.ok) return fail(r.reason, "invalid", "url");
  await audit({ userId: actor.userId, action: "agents.prospect_added", entityType: "Prospect", entityId: r.prospectId, metadata: { url: u.url, created: r.created, via: actor.via } });
  return ok(`@${u.username} ajouté : il sera lu et noté d'ici quelques minutes.`, { prospectId: r.prospectId });
};

// ------------------------------------------------------------------------------------------------- offres

/** Créer ou modifier une offre du client aux affiliés. */
export const runSaveOffer: CoreRun = async (fd, actor, opts = {}) => {
  const parsed = parseOfferForm(fd);
  if (!parsed.ok) return fail(parsed.error, "invalid", parsed.field);
  const o = parsed.offer;
  const before = o.id ? await prisma.affiliateOffer.findUnique({ where: { id: o.id } }) : null;
  if (o.id && !before) return fail("Cette offre n'existe plus.", "not_found");
  if (!o.id) {
    const same = await prisma.affiliateOffer.findFirst({ where: { brand: { equals: o.brand, mode: "insensitive" }, vertical: o.vertical, isActive: true }, select: { id: true } });
    if (same) return fail(`Une offre ${o.brand} active existe déjà pour ce marché : modifiez-la plutôt.`, "conflict", "brand");
  }
  const summary = `${o.brand} — ${o.countries.join(", ")} — ${dealText(o.dealTypes)}`;
  if (opts.dryRun) return preview(`${o.id ? "Modifier" : "Créer"} l'offre ${summary}. Elle sert à noter les canaux qui y correspondent.`);
  const data = {
    brand: o.brand,
    vertical: o.vertical,
    countries: o.countries,
    dealTypes: o.dealTypes as never,
    trackingHint: o.trackingHint,
    notes: o.notes,
  };
  let id: string;
  try {
    id = o.id ? (await prisma.affiliateOffer.update({ where: { id: o.id }, data, select: { id: true } })).id : (await prisma.affiliateOffer.create({ data, select: { id: true } })).id;
  } catch (err) {
    return fail(`Enregistrement impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: o.id ? "agents.prospection_offer_updated" : "agents.prospection_offer_created",
    entityType: "AffiliateOffer",
    entityId: id,
    metadata: { brand: o.brand, vertical: o.vertical, countries: o.countries, dealTypes: o.dealTypes as never, via: actor.via },
  });
  return ok(`Offre ${o.brand} ${o.id ? "modifiée" : "créée"} : ${dealText(o.dealTypes).toLowerCase()}.`, { offerId: id });
};

/** Activer / désactiver une offre (une offre désactivée ne sert plus à noter les canaux ; rien n'est effacé). */
export const runToggleOffer: CoreRun = async (fd, actor, opts = {}) => {
  const id = safeProspectId(fd.get("offerId"));
  if (!id) return fail("Offre inconnue.", "invalid", "offerId");
  const active = truthy(fd.get("active"));
  if (active === null) return fail("Activer ou désactiver ?", "invalid", "active");
  const offer = await prisma.affiliateOffer.findUnique({ where: { id }, select: { id: true, brand: true, isActive: true } });
  if (!offer) return fail("Cette offre n'existe plus.", "not_found");
  if (offer.isActive === active) return fail(`L'offre ${offer.brand} est déjà ${active ? "active" : "désactivée"}.`, "conflict");
  if (opts.dryRun) return preview(active ? `Réactiver l'offre ${offer.brand}.` : `Désactiver l'offre ${offer.brand} : elle ne sert plus à noter les canaux ; rien n'est effacé.`);
  try {
    await prisma.affiliateOffer.update({ where: { id }, data: { isActive: active } });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: active ? "agents.prospection_offer_activated" : "agents.prospection_offer_deactivated", entityType: "AffiliateOffer", entityId: id, metadata: { brand: offer.brand, via: actor.via } });
  return ok(`Offre ${offer.brand} ${active ? "réactivée" : "désactivée"}.`);
};

// ------------------------------------------------------------------------------------------------- dictionnaires

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Proposer un ajout aux marques et repères (validé ensuite par un administrateur ; jamais d'ajout silencieux). */
export const runProposeDict: CoreRun = async (fd, actor, opts = {}) => {
  const parsed = parseProposalForm(fd);
  if (!parsed.ok) return fail(parsed.error, "invalid", parsed.field);
  const { view, proposals } = await loadDictionaries();
  if (alreadyKnown(parsed.proposal, knownLists(view), proposals)) return fail(`« ${parsed.proposal.value} » est déjà connu ou déjà proposé.`, "conflict", "value");
  const text = proposalText(parsed.proposal);
  if (opts.dryRun) return preview(`Proposer : ${text}. Un administrateur valide avant que l'équipe s'en serve.`);
  const row = await prisma.setting.findUnique({ where: { key: DICT_PROPOSALS_KEY }, select: { value: true } });
  const list = proposalsOf(row?.value);
  const proposal: DictProposal = {
    ...parsed.proposal,
    id: newId(),
    status: "PENDING",
    proposedBy: actor.userId,
    proposedVia: actor.via,
    proposedAt: new Date().toISOString(),
    decidedBy: null,
    decidedAt: null,
  };
  const value = [...list, proposal].slice(-500) as never;
  await prisma.setting.upsert({ where: { key: DICT_PROPOSALS_KEY }, create: { key: DICT_PROPOSALS_KEY, value }, update: { value } });
  await audit({ userId: actor.userId, action: "agents.prospection_dict_proposed", entityType: "Setting", entityId: DICT_PROPOSALS_KEY, metadata: { proposalId: proposal.id, kind: proposal.kind, value: proposal.value, via: actor.via } });
  return ok(`Proposition enregistrée : ${text}. Elle attend la validation d'un administrateur.`, { proposalId: proposal.id });
};

/** Valider (ajouté à `prospection.dict_additions`) ou refuser une proposition. Administrateurs. */
export const runDecideDict: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY_DICT);
  const id = str(fd.get("proposalId")).trim();
  const decision = str(fd.get("decision")).trim().toUpperCase();
  if (decision !== "APPROVED" && decision !== "REJECTED") return fail("Valider ou refuser ?", "invalid", "decision");
  const rows = await prisma.setting.findMany({ where: { key: { in: [DICT_PROPOSALS_KEY, DICT_ADDITIONS_KEY] } }, select: { key: true, value: true } });
  const list = proposalsOf(rows.find((r) => r.key === DICT_PROPOSALS_KEY)?.value);
  const p = list.find((x) => x.id === id);
  if (!p) return fail("Proposition introuvable.", "not_found", "proposalId");
  if (p.status !== "PENDING") return fail("Cette proposition a déjà été décidée : rechargez la page.", "conflict");
  const text = proposalText(p);
  if (opts.dryRun) return preview(decision === "APPROVED" ? `Valider : ${text}. L'équipe s'en sert dès sa prochaine lecture.` : `Refuser : ${text}.`);
  const decided: DictProposal = { ...p, status: decision, decidedBy: actor.userId, decidedAt: new Date().toISOString() };
  const nextList = list.map((x) => (x.id === id ? decided : x)) as never;
  const ops = [prisma.setting.upsert({ where: { key: DICT_PROPOSALS_KEY }, create: { key: DICT_PROPOSALS_KEY, value: nextList }, update: { value: nextList } })];
  if (decision === "APPROVED") {
    const additions = applyProposal(additionsOf(rows.find((r) => r.key === DICT_ADDITIONS_KEY)?.value), decided) as never;
    ops.push(prisma.setting.upsert({ where: { key: DICT_ADDITIONS_KEY }, create: { key: DICT_ADDITIONS_KEY, value: additions }, update: { value: additions } }));
  }
  try {
    await prisma.$transaction(ops);
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: decision === "APPROVED" ? "agents.prospection_dict_approved" : "agents.prospection_dict_rejected", entityType: "Setting", entityId: DICT_PROPOSALS_KEY, metadata: { proposalId: id, kind: p.kind, value: p.value, via: actor.via } });
  return ok(decision === "APPROVED" ? `Ajout validé : ${text}.` : `Proposition refusée : ${text}.`);
};

// ------------------------------------------------------------------------------------------------- sources

/** Mettre en pause (1, 7 ou 30 jours) ou reprendre une source de découverte. Administrateurs. */
export const runSourcePause: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY_SOURCES);
  const source = str(fd.get("source")).trim();
  if (!(DISCOVERY_SOURCES as readonly string[]).includes(source) && !/^[a-z0-9._:-]{2,80}$/i.test(source)) return fail("Source inconnue.", "invalid", "source");
  const action = str(fd.get("action")).trim();
  if (action !== "pause" && action !== "resume") return fail("Mettre en pause ou reprendre ?", "invalid", "action");
  const name = DISCOVERY_SOURCE_LABELS[source] ?? source;
  const row = await prisma.setting.findUnique({ where: { key: PROSPECTION_SETTINGS.sourcePauses.key }, select: { value: true } });
  const pauses = pausesOf(row?.value);
  const now = Date.now();
  const current = pauses[source] && Date.parse(pauses[source]!.until) > now ? pauses[source]! : null;
  if (action === "resume") {
    if (!current) return fail(`La source « ${name} » n'est pas en pause.`, "conflict");
    if (opts.dryRun) return preview(`Reprendre la source « ${name} » : elle repart au prochain passage de nuit.`);
    delete pauses[source];
  } else {
    if (!(DISCOVERY_SOURCES as readonly string[]).includes(source)) return fail("Source inconnue.", "invalid", "source");
    const days = Number(str(fd.get("days")).trim() || "7");
    if (!(PAUSE_DAYS as readonly number[]).includes(days)) return fail(`Durée de pause : ${PAUSE_DAYS.join(", ")} jours.`, "invalid", "days");
    if (opts.dryRun) return preview(`Mettre la source « ${name} » en pause ${days} jour${days > 1 ? "s" : ""} : elle ne cherche plus de canaux pendant ce temps.`);
    pauses[source] = { until: new Date(now + days * 86_400_000).toISOString(), reason: "Mise en pause par l'équipe" };
  }
  const value = pauses as never;
  try {
    await prisma.setting.upsert({ where: { key: PROSPECTION_SETTINGS.sourcePauses.key }, create: { key: PROSPECTION_SETTINGS.sourcePauses.key, value }, update: { value } });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: action === "pause" ? "agents.prospection_source_paused" : "agents.prospection_source_resumed", entityType: "Setting", entityId: PROSPECTION_SETTINGS.sourcePauses.key, metadata: { source, until: pauses[source]?.until ?? null, via: actor.via } });
  return ok(action === "pause" ? `Source « ${name} » en pause jusqu'au ${new Date(pauses[source]!.until).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.` : `Source « ${name} » reprise.`);
};

// ------------------------------------------------------------------------------------------------- réglages

/** Réglages de l'équipe (administrateurs) : seuls les champs donnés changent. */
export const runSaveSettings: CoreRun = async (fd, actor, opts = {}) => {
  if (actor.role !== "ADMIN") return forbidden(ADMIN_ONLY_SETTINGS);
  const current = await loadProspectionSettings();
  const parsed = parseSettingsForm(fd, current);
  if (!parsed.ok) return fail(parsed.error, "invalid", parsed.field);
  const changes = settingsChanges(current, parsed.values);
  if (!changes.length) return fail("Rien à changer : les réglages sont déjà ceux-là.", "conflict");
  if (opts.dryRun) return preview(`Réglages de la prospection : ${changes.join(" ; ")}.`);
  try {
    await prisma.$transaction(
      Object.entries(parsed.values).map(([key, v]) => prisma.setting.upsert({ where: { key }, create: { key, value: v as never }, update: { value: v as never } })),
    );
  } catch (err) {
    return fail(`Enregistrement impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({ userId: actor.userId, action: "agents.prospection_settings_saved", entityType: "Setting", entityId: "prospection", metadata: { changes, keys: Object.keys(parsed.values), via: actor.via } });
  return ok(`Réglages enregistrés : ${changes.join(" ; ")}.`);
};

// ------------------------------------------------------------------------------------------------- entrées de Kevin

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

/** Canal désigné par Kevin : identifiant, @nom, lien t.me ou titre (sans ambiguïté), parmi les canaux visibles. */
export async function resolveProspect(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const s = str(raw).trim();
  if (!s) return { ok: false, result: fail("Quel canal ? Donnez son @nom ou son lien t.me.", "invalid", "canal") };
  const scope = await loadScope();
  const visible = visibleRegionWhere(scope);
  const id = safeProspectId(s);
  if (id) {
    const byId = await prisma.prospect.findFirst({ where: { AND: [{ id }, visible] }, select: { id: true } });
    if (byId) return { ok: true, id: byId.id };
  }
  const handle = s.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t|telegram)\.me\/(s\/)?/i, "").replace(/^@/, "").replace(/\/.*$/, "").toLowerCase();
  if (/^[a-z0-9_]{3,64}$/.test(handle)) {
    const byName = await prisma.prospect.findFirst({ where: { AND: [{ username: handle }, visible] }, select: { id: true } });
    if (byName) return { ok: true, id: byName.id };
  }
  const found = await prisma.prospect.findMany({ where: { AND: [{ title: { contains: s, mode: "insensitive" } }, visible] }, select: { id: true, title: true, username: true }, take: 6 });
  const exact = found.filter((f) => f.title.toLowerCase() === s.toLowerCase());
  const list = exact.length === 1 ? exact : found;
  if (!list.length) return { ok: false, result: fail(`Aucun canal « ${s} » dans la liste.`, "not_found", "canal") };
  if (list.length > 1)
    return { ok: false, result: fail(`Plusieurs canaux correspondent (${list.map((f) => (f.username ? `@${f.username}` : f.title)).join(", ")}) : lequel ?`, "invalid", "canal") };
  return { ok: true, id: list[0]!.id };
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Mots de Kevin → statut (« contacté », « a répondu », « on négocie », « signé », « ignore », « plus tard »…). */
export const STATUS_WORDS: Array<[RegExp, ProspectStatusKey | typeof LATER]> = [
  [/^(plus tard|later|snooze|reporter|remettre a plus tard)$/, LATER],
  [/^(contacte|contacted|contact|ecrit)$/, "CONTACTED"],
  [/^(a repondu|repondu|responded|reponse)$/, "RESPONDED"],
  [/^(negocie|en discussion|discussion|negociation|negotiating|on negocie)$/, "NEGOTIATING"],
  [/^(signe|signed|a signe)$/, "SIGNED"],
  [/^(actif|active)$/, "ACTIVE"],
  [/^(arrete|a arrete|churned|stop)$/, "CHURNED"],
  [/^(ignore|ignorer|pas interesse|skip|skipped|non)$/, "SKIPPED"],
  [/^(reprendre|a contacter|requalifier|qualified)$/, "QUALIFIED"],
  [/^(blacklist|ne plus montrer|ne plus jamais montrer|blacklisted)$/, "BLACKLISTED"],
];

export function statusFromWords(v: unknown): string | null {
  const raw = str(v).trim();
  if ((CLIENT_TARGETS as readonly string[]).includes(raw.toUpperCase()) || raw.toUpperCase() === LATER) return raw.toUpperCase();
  const s = plain(raw);
  for (const [re, st] of STATUS_WORDS) if (re.test(s)) return st;
  return null;
}

const DEAL_WORDS: Record<string, string> = { cpa: "CPA", prime: "CPA", "prime par joueur": "CPA", revshare: "REVSHARE", "part du revenu": "REVSHARE", revenue: "REVSHARE", hybride: "HYBRID", mixte: "HYBRID", hybrid: "HYBRID" };

export async function kevinStatusForm(input: Record<string, unknown>): Promise<Prepared> {
  const status = statusFromWords(input.statut ?? input.status);
  if (!status) return { ok: false, result: fail("Quel statut ? Contacté, a répondu, en discussion, signé, actif, a arrêté, pas intéressé, reprendre, plus tard ou ne plus montrer.", "invalid", "statut") };
  const r = await resolveProspect(input.canal ?? input.prospect ?? input.prospectId ?? input.id);
  if (!r.ok) return r;
  const dealRaw = plain(str(input.type_accord ?? input.dealType));
  return {
    ok: true,
    fd: formOf({
      prospectId: r.id,
      status,
      dealType: DEAL_WORDS[dealRaw] ?? (dealRaw ? dealRaw.toUpperCase() : undefined),
      cpa: input.prime_par_joueur ?? input.cpa,
      revshare: input.part_du_revenu ?? input.revshare,
      dealNotes: input.notes_accord,
      days: input.jours ?? input.days,
    }),
  };
}

export async function kevinBulkForm(input: Record<string, unknown>): Promise<Prepared> {
  const action = plain(str(input.action ?? input.statut));
  const status = /contact/.test(action) ? "CONTACTED" : /ignor|pas interess|skip/.test(action) ? "SKIPPED" : str(input.action).toUpperCase();
  const raw = Array.isArray(input.canaux) ? input.canaux : str(input.canaux ?? input.ids).split(/[\s,;]+/).filter(Boolean);
  if (!raw.length) return { ok: false, result: fail("Quels canaux ? Donnez leurs @noms.", "invalid", "canaux") };
  const ids: string[] = [];
  for (const c of raw.slice(0, BULK_MAX)) {
    const r = await resolveProspect(c);
    if (!r.ok) return r;
    ids.push(r.id);
  }
  return { ok: true, fd: formOf({ status, ids }) };
}

export async function kevinNoteForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveProspect(input.canal ?? input.prospect ?? input.prospectId);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ prospectId: r.id, note: input.note ?? input.texte }) };
}

export async function kevinAddForm(input: Record<string, unknown>): Promise<Prepared> {
  return { ok: true, fd: formOf({ url: input.lien ?? input.url ?? input.canal }) };
}

/** Offre désignée par Kevin : identifiant ou nom de marque (une seule offre de ce nom). */
async function resolveOffer(raw: unknown, opts: { activeOnly?: boolean } = {}): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const s = str(raw).trim();
  if (!s) return { ok: false, result: fail("Quelle offre ? Donnez le nom de la marque.", "invalid", "offre") };
  const id = safeProspectId(s);
  if (id) {
    const byId = await prisma.affiliateOffer.findUnique({ where: { id }, select: { id: true } });
    if (byId) return { ok: true, id: byId.id };
  }
  const found = await prisma.affiliateOffer.findMany({ where: { brand: { equals: s, mode: "insensitive" }, ...(opts.activeOnly ? { isActive: true } : {}) }, select: { id: true, vertical: true }, take: 5 });
  if (!found.length) return { ok: false, result: fail(`Aucune offre « ${s} ».`, "not_found", "offre") };
  if (found.length > 1) return { ok: false, result: fail(`Plusieurs offres ${s} (une par marché) : précisez paris sportifs ou casino.`, "invalid", "offre") };
  return { ok: true, id: found[0]!.id };
}

const VERTICAL_WORDS: Record<string, string> = { paris: "SPORTS", "paris sportifs": "SPORTS", sport: "SPORTS", sports: "SPORTS", casino: "CASINO", "les deux": "BOTH", both: "BOTH", tous: "BOTH" };

export async function kevinOfferForm(input: Record<string, unknown>): Promise<Prepared> {
  let offerId: string | undefined;
  if (input.offre ?? input.offerId) {
    const r = await resolveOffer(input.offre ?? input.offerId);
    if (!r.ok) return r;
    offerId = r.id;
  }
  const current = offerId ? await prisma.affiliateOffer.findUnique({ where: { id: offerId } }) : null;
  const deal = (current?.dealTypes ?? {}) as Record<string, unknown>;
  const hybrid = (deal.hybrid ?? {}) as Record<string, unknown>;
  const vRaw = plain(str(input.marche ?? input.vertical));
  const countries = input.pays ?? input.countries ?? current?.countries;
  return {
    ok: true,
    fd: formOf({
      offerId,
      brand: input.marque ?? input.brand ?? current?.brand,
      vertical: VERTICAL_WORDS[vRaw] ?? (vRaw ? vRaw.toUpperCase() : current?.vertical),
      countries: Array.isArray(countries) ? countries : str(countries).split(/[\s,;]+/).filter(Boolean),
      cpa: input.prime_par_joueur ?? input.cpa ?? deal.cpa,
      revshare: input.part_du_revenu ?? input.revshare ?? deal.revshare,
      hybridCpa: input.mixte_prime ?? hybrid.cpa,
      hybridRevshare: input.mixte_part ?? hybrid.revshare,
      trackingHint: input.motif_lien ?? current?.trackingHint,
      notes: input.notes ?? current?.notes,
    }),
  };
}

export async function kevinToggleOfferForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveOffer(input.offre ?? input.offerId ?? input.marque);
  if (!r.ok) return r;
  const a = truthy(input.active ?? input.activer);
  return { ok: true, fd: formOf({ offerId: r.id, active: a === null ? undefined : a ? "on" : "off" }) };
}

const KIND_WORDS: Record<string, string> = {
  marque: "brand",
  brand: "brand",
  bookmaker: "brand",
  casino: "brand",
  parametre: "affiliate_param",
  "repere de lien": "affiliate_param",
  chemin: "path_marker",
  raccourcisseur: "shortener",
  "code promo": "promo_word",
  "mot code promo": "promo_word",
  contact: "contact_label",
  "mot de contact": "contact_label",
};

export async function kevinProposeForm(input: Record<string, unknown>): Promise<Prepared> {
  const k = plain(str(input.genre ?? input.kind));
  return {
    ok: true,
    fd: formOf({
      kind: KIND_WORDS[k] ?? str(input.genre ?? input.kind),
      value: input.valeur ?? input.value,
      country: input.pays ?? input.country,
      brandType: input.type_marque ?? input.brandType,
      brandStatus: input.licence ?? input.brandStatus,
      language: input.langue ?? input.language,
      note: input.note,
    }),
  };
}

/** Proposition désignée par Kevin : identifiant, ou numéro dans la liste « à valider » (la plus ancienne = 1). */
export async function kevinDecideForm(input: Record<string, unknown>): Promise<Prepared> {
  const d = plain(str(input.decision));
  const decision = /^(valider|valide|oui|accepter|approved)$/.test(d) ? "APPROVED" : /^(refuser|refuse|non|rejected)$/.test(d) ? "REJECTED" : null;
  if (!decision) return { ok: false, result: fail("Valider ou refuser ?", "invalid", "decision") };
  let id = str(input.id).trim();
  if (!id) {
    const n = Number(str(input.numero).replace(/[^\d]/g, ""));
    if (!Number.isInteger(n) || n < 1) return { ok: false, result: fail("Quelle proposition ? Donnez son numéro (« la 2 »).", "invalid", "numero") };
    const row = await prisma.setting.findUnique({ where: { key: DICT_PROPOSALS_KEY }, select: { value: true } });
    const pending = proposalsOf(row?.value).filter((p) => p.status === "PENDING");
    const hit = pending[n - 1];
    if (!hit) return { ok: false, result: fail(`Pas de proposition n° ${n} à valider.`, "not_found", "numero") };
    id = hit.id;
  }
  return { ok: true, fd: formOf({ proposalId: id, decision }) };
}

const SOURCE_WORDS: Array<[RegExp, string]> = [
  [/annuaire/, "directories"],
  [/recherche|internet|web|google/, "web_search"],
  [/reseau|social|reddit|x |twitter|tiktok|instagram/, "social"],
  [/graphe|cite|repris|transfer|dossier/, "graph"],
  [/analyst|veille/, "analysts"],
  [/main|manuel/, "manual"],
];

export async function kevinSourceForm(input: Record<string, unknown>): Promise<Prepared> {
  const raw = str(input.source).trim();
  const p = plain(raw);
  const source = (DISCOVERY_SOURCES as readonly string[]).includes(raw) ? raw : (SOURCE_WORDS.find(([re]) => re.test(`${p} `))?.[1] ?? raw);
  const a = plain(str(input.action));
  const action = /reprend|resume|relance|active/.test(a) ? "resume" : /pause|stop|arret/.test(a) ? "pause" : a;
  return { ok: true, fd: formOf({ source, action, days: input.jours ?? input.days }) };
}

const SETTING_PARAM_NAMES: Record<string, string> = {
  nombre_du_top: "dailyTopCount",
  heure_du_top: "dailyTopHour",
  posts_30j_min: "minPosts30d",
  vues_min: "minMedianViews",
  profondeur: "graphMaxDepth",
  note_minimale: "qualifiedThreshold",
  note_niveau_b: "tierBThreshold",
  note_niveau_a: "tierAThreshold",
  relance_jours: "reminderDays",
  rappel_discussion_jours: "negotiationReminderDays",
  rappels_par_jour: "remindersDailyCap",
  decouvertes_par_jour: "discoveryDailyCap",
  lectures_par_jour: "enrichDailyCap",
  dossiers_par_semaine: "dossierWeeklyCap",
  budget_mensuel_euros: "monthlyBudget",
};

export async function kevinSettingsForm(input: Record<string, unknown>): Promise<Prepared> {
  const o: Record<string, unknown> = {};
  for (const [k, name] of Object.entries(SETTING_PARAM_NAMES)) if (input[k] !== undefined && input[k] !== null) o[name] = input[k];
  for (const [k, name] of [["activee", "enabled"], ["rappels_week_end", "remindersWeekend"], ["idees_de_message", "pitchDrafts"]] as const) {
    const b = truthy(input[k]);
    if (b !== null) o[name] = b ? "on" : "off";
  }
  if (input.poids && typeof input.poids === "object") for (const [k, v] of Object.entries(input.poids as Record<string, unknown>)) o[`weight_${k}`] = v;
  if (input.marches !== undefined) o.verticals = (Array.isArray(input.marches) ? input.marches : str(input.marches).split(/[\s,;]+/)).map((v) => VERTICAL_WORDS[plain(str(v))] ?? str(v).toUpperCase());
  if (input.pays !== undefined) {
    const current = await loadScope();
    const list = (Array.isArray(input.pays) ? input.pays : str(input.pays).split(/[\s,;]+/)).map((c) => str(c).toUpperCase()).filter(Boolean);
    const mode = plain(str(input.pays_mode));
    o.countries = mode === "ajouter" ? [...current, ...list] : mode === "retirer" ? current.filter((c) => !list.includes(c)) : list;
  }
  return { ok: true, fd: formOf(o) };
}
