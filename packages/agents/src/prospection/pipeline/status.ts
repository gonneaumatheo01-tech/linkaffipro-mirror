/**
 * Phase 31, chantier C — statuts d'un prospect et transitions autorisées (section 5 du prompt).
 *
 * Qui peut faire quoi (`by`) :
 * - « système » : les étapes de la chaîne (lecture, score) et le retour d'un « pas intéressé » après 60 jours ;
 * - « client » : tout ce qui se décide par un bouton ou une phrase à Kevin (contacté, a répondu, on négocie, signé,
 *   actif, arrêté, pas intéressé, à ne plus montrer, reprendre).
 *
 * Table (au départ de → vers) :
 * - lecture : DISCOVERED → ENRICHING, UNREADABLE, ENRICH_FAILED, QUALIFIED, DISQUALIFIED ; ENRICHING → idem ;
 *   ENRICH_FAILED → DISCOVERED, ENRICHING, UNREADABLE, QUALIFIED, DISQUALIFIED ; UNREADABLE → DISCOVERED (système) ;
 * - score : QUALIFIED ↔ DISQUALIFIED (système, nouveau score) ;
 * - client depuis une liste : QUALIFIED → CONTACTED, RESPONDED, NEGOTIATING, SIGNED, SKIPPED, BLACKLISTED ;
 *   DISQUALIFIED → CONTACTED, SIGNED, SKIPPED, BLACKLISTED (le client peut passer outre un niveau D) ;
 * - suivi : CONTACTED → RESPONDED, NEGOTIATING, SIGNED, SKIPPED (abandon), BLACKLISTED ;
 *   RESPONDED → NEGOTIATING, SIGNED, SKIPPED, BLACKLISTED ; NEGOTIATING → SIGNED, SKIPPED, BLACKLISTED ;
 *   SIGNED → ACTIVE, CHURNED, BLACKLISTED ; ACTIVE → CHURNED, BLACKLISTED ; CHURNED → ACTIVE, CONTACTED, BLACKLISTED ;
 * - retour : SKIPPED → QUALIFIED (système après 60 jours ; client à tout moment), CONTACTED (client), BLACKLISTED ;
 * - BLACKLISTED est terminal (plus jamais montré).
 * Rester dans le même statut n'est pas une transition (« Plus tard » = `snoozeProspect`, le statut ne change pas).
 *
 * Phase 32 (réseaux) : un statut posé par le CLIENT sur un canal membre d'un réseau (`Prospect.networkId`) se propage
 * aux autres membres (contacté, a répondu, en négo, signé, arrêté, pas intéressé, à ne plus montrer), chacun par sa
 * propre transition (mêmes règles, `ProspectEvent` STATUS_CHANGED avec `via: "network"`), et se pose au niveau du
 * réseau (`ProspectNetwork.status`). « Actif » ne se propage pas (il dépend des résultats de chaque canal), le système
 * ne propage jamais. `propagate: false` coupe la propagation (appel depuis la propagation elle-même).
 */
import { PROSPECTION_LIMITS, type DealType, type ProspectionDeps, type ProspectStatus } from "../contract";
import { DAY_MS, prospectionNow } from "../score/settings";

export type TransitionActor = "client" | "system";
type Who = TransitionActor | "both";

const T = (to: ProspectStatus, by: Who = "client") => ({ to, by });

export const STATUS_TRANSITIONS: Readonly<Record<ProspectStatus, ReadonlyArray<{ to: ProspectStatus; by: Who }>>> = {
  DISCOVERED: [T("ENRICHING", "system"), T("UNREADABLE", "system"), T("ENRICH_FAILED", "system"), T("QUALIFIED", "system"), T("DISQUALIFIED", "system"), T("BLACKLISTED")],
  ENRICHING: [T("DISCOVERED", "system"), T("UNREADABLE", "system"), T("ENRICH_FAILED", "system"), T("QUALIFIED", "system"), T("DISQUALIFIED", "system"), T("BLACKLISTED")],
  ENRICH_FAILED: [T("DISCOVERED", "system"), T("ENRICHING", "system"), T("UNREADABLE", "system"), T("QUALIFIED", "system"), T("DISQUALIFIED", "system"), T("BLACKLISTED")],
  UNREADABLE: [T("DISCOVERED", "system"), T("BLACKLISTED")],
  QUALIFIED: [
    T("DISQUALIFIED", "system"),
    T("CONTACTED"),
    T("RESPONDED"),
    T("NEGOTIATING"),
    T("SIGNED"),
    T("SKIPPED"),
    T("BLACKLISTED"),
  ],
  DISQUALIFIED: [T("QUALIFIED", "system"), T("CONTACTED"), T("SIGNED"), T("SKIPPED"), T("BLACKLISTED")],
  CONTACTED: [T("RESPONDED"), T("NEGOTIATING"), T("SIGNED"), T("SKIPPED"), T("BLACKLISTED")],
  RESPONDED: [T("NEGOTIATING"), T("SIGNED"), T("SKIPPED"), T("BLACKLISTED")],
  NEGOTIATING: [T("SIGNED"), T("SKIPPED"), T("BLACKLISTED")],
  SIGNED: [T("ACTIVE", "both"), T("CHURNED", "both"), T("BLACKLISTED")],
  ACTIVE: [T("CHURNED", "both"), T("BLACKLISTED")],
  CHURNED: [T("ACTIVE", "both"), T("CONTACTED"), T("BLACKLISTED")],
  SKIPPED: [T("QUALIFIED", "both"), T("CONTACTED"), T("BLACKLISTED")],
  BLACKLISTED: [],
};

/** La transition est-elle permise pour cet acteur ? (Pur ; le délai de 60 jours est vérifié par `transitionProspect`.) */
export function canTransition(from: ProspectStatus, to: ProspectStatus, by: TransitionActor): boolean {
  if (from === to) return false;
  return (STATUS_TRANSITIONS[from] ?? []).some((t) => t.to === to && (t.by === "both" || t.by === by));
}

export type TransitionOptions = {
  by: TransitionActor;
  payload?: Record<string, unknown>;
  dealType?: DealType;
  dealTerms?: Record<string, unknown>;
  snoozeDays?: number;
  /** Phase 32 : propager aux autres canaux du réseau (par défaut : oui pour le client). */
  propagate?: boolean;
};

/** Statuts propagés aux membres d'un réseau quand le client les pose sur l'un d'eux. */
export const NETWORK_PROPAGATED_STATUSES: readonly ProspectStatus[] = ["CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "CHURNED", "SKIPPED", "BLACKLISTED"];

export type TransitionResult = { ok: true; from: ProspectStatus; to: ProspectStatus; propagated?: string[] } | { ok: false; reason: string };

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export async function transitionProspect(deps: ProspectionDeps, prospectId: string, to: ProspectStatus, opts: TransitionOptions): Promise<TransitionResult> {
  const now = prospectionNow(deps);
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as {
    id: string;
    status: ProspectStatus;
    statusChangedAt: Date | null;
    updatedAt?: Date | null;
    networkId?: string | null;
  } | null;
  if (!p) return { ok: false, reason: "prospect introuvable" };
  const from = p.status;
  if (from === to) return { ok: false, reason: "déjà dans ce statut" };
  if (!canTransition(from, to, opts.by)) return { ok: false, reason: from === "BLACKLISTED" ? "ce canal est à ne plus montrer" : "changement de statut non permis" };
  if (opts.by === "system" && from === "SKIPPED" && to === "QUALIFIED") {
    const since = p.statusChangedAt ?? p.updatedAt ?? null;
    if (since && now.getTime() - since.getTime() < PROSPECTION_LIMITS.skippedReturnDays * DAY_MS) return { ok: false, reason: `retour possible après ${PROSPECTION_LIMITS.skippedReturnDays} jours` };
  }

  const data: Record<string, unknown> = { status: to, statusChangedAt: now };
  if (to === "CONTACTED") data.contactedAt = now;
  if (to === "RESPONDED") data.respondedAt = now;
  if (to === "SIGNED") {
    data.signedAt = now;
    if (opts.dealType) data.dealType = opts.dealType;
    if (opts.dealTerms) data.dealTerms = json(opts.dealTerms);
  }
  // Retour dans les listes : de nouveau présentable.
  if (to === "QUALIFIED") data.presentedAt = null;
  data.snoozedUntil = opts.snoozeDays && opts.snoozeDays > 0 ? new Date(now.getTime() + opts.snoozeDays * DAY_MS) : null;

  await deps.prisma.prospect.update({ where: { id: prospectId }, data });
  await deps.prisma.prospectEvent.create({
    data: {
      prospectId,
      type: "STATUS_CHANGED",
      payload: json({ ...(opts.payload ?? {}), from, to, by: opts.by, ...(opts.dealType ? { dealType: opts.dealType } : {}), ...(opts.dealTerms ? { dealTerms: opts.dealTerms } : {}) }),
      createdAt: now,
    },
  });

  // Phase 32 : propagation aux autres canaux du réseau.
  if (p.networkId && opts.by === "client" && opts.propagate !== false && NETWORK_PROPAGATED_STATUSES.includes(to)) {
    const propagated = await propagateToNetwork(deps, p.networkId, prospectId, to, opts);
    if (propagated.length) return { ok: true, from, to, propagated };
  }
  return { ok: true, from, to };
}

async function propagateToNetwork(deps: ProspectionDeps, networkId: string, fromProspectId: string, to: ProspectStatus, opts: TransitionOptions): Promise<string[]> {
  const members = (await deps.prisma.prospect.findMany({ where: { networkId } })) as Array<{ id: string; status: ProspectStatus }>;
  const done: string[] = [];
  for (const m of members) {
    if (m.id === fromProspectId || m.status === to) continue;
    const r = await transitionProspect(deps, m.id, to, {
      by: opts.by,
      payload: { ...(opts.payload ?? {}), via: "network", networkId, fromProspectId },
      ...(opts.dealType ? { dealType: opts.dealType } : {}),
      ...(opts.dealTerms ? { dealTerms: opts.dealTerms } : {}),
      propagate: false,
    });
    if (r.ok) done.push(m.id);
  }
  await deps.prisma.prospectNetwork.update({ where: { id: networkId }, data: { status: to } }).catch(() => undefined);
  return done;
}

/** « Plus tard » : le statut ne change pas, le prospect revient après `days` jours. */
export async function snoozeProspect(deps: ProspectionDeps, prospectId: string, days: number, by: TransitionActor = "client"): Promise<{ ok: true; until: Date } | { ok: false; reason: string }> {
  const now = prospectionNow(deps);
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as { status: ProspectStatus } | null;
  if (!p) return { ok: false, reason: "prospect introuvable" };
  if (p.status === "BLACKLISTED") return { ok: false, reason: "ce canal est à ne plus montrer" };
  const until = new Date(now.getTime() + Math.max(1, days) * DAY_MS);
  await deps.prisma.prospect.update({ where: { id: prospectId }, data: { snoozedUntil: until } });
  await deps.prisma.prospectEvent.create({ data: { prospectId, type: "SNOOZED", payload: { status: p.status, days, until: until.toISOString(), by }, createdAt: now } });
  return { ok: true, until };
}

/** Note du client (ou d'un agent) sur un prospect, avec un `ProspectEvent` NOTE. */
export async function addProspectNote(
  deps: ProspectionDeps,
  prospectId: string,
  note: string,
  authorType: "client" | "system" | "agent" | string = "client",
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const text = note.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!text) return { ok: false, reason: "note vide" };
  const p = await deps.prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!p) return { ok: false, reason: "prospect introuvable" };
  const now = prospectionNow(deps);
  const row = (await deps.prisma.prospectNote.create({ data: { prospectId, note: text, authorType, createdAt: now } })) as { id: string };
  await deps.prisma.prospectEvent.create({ data: { prospectId, type: "NOTE", payload: { noteId: row.id, by: authorType }, createdAt: now } });
  return { ok: true, id: row.id };
}

/** Retour des « pas intéressé » de plus de 60 jours dans les listes (système). Rend le nombre de prospects revenus. */
export async function returnSkippedProspects(deps: ProspectionDeps): Promise<number> {
  const now = prospectionNow(deps);
  const limit = new Date(now.getTime() - PROSPECTION_LIMITS.skippedReturnDays * DAY_MS);
  const rows = (await deps.prisma.prospect.findMany({ where: { status: "SKIPPED", statusChangedAt: { lte: limit } }, take: 200 })) as Array<{ id: string }>;
  let n = 0;
  for (const r of rows) if ((await transitionProspect(deps, r.id, "QUALIFIED", { by: "system", payload: { reason: "retour après 60 jours" } })).ok) n++;
  return n;
}
