/**
 * Phase 32, chantier B — rattachement d'un affilié signé à son identifiant Link Affi (règle 6).
 *
 * - « @x = affilié 1234 » (Kevin, site) → `linkAffiliate` : prospect signé (SIGNED, ACTIVE, CHURNED) seulement, un
 *   identifiant n'est rattaché qu'à un seul prospect, `ProspectEvent LINKAFFI_LINKED`, `AuditLog`.
 * - À la signature, Kevin demande l'identifiant (`askLinkAffiId`) : correspondances numérotées tirées des affiliés
 *   récents de Link Affi quand le lecteur est branché (`deps.linkAffiReader.recentAffiliates`, lecture seule), question
 *   ouverte gardée 7 jours (`Setting prospection.link_ask`) ; réponse « 2 » → `answerLinkChoice`.
 * - Sans identifiant : pas de résultats ni de calibrage pour ce prospect ; rappel le lundi (une fois par semaine,
 *   3 fois au plus, `linkAffiAskCount`) par `runLinkReminders`.
 * Le nom d'un affilié (Link Affi) n'est gardé que dans la question ouverte, effacée à la réponse ou après 7 jours.
 */
import { agentAudit, agentEvent, esc } from "../../admin/journal";
import { pick } from "../../boss/voice";
import { LINK_REMINDER } from "../contract-advanced";
import type { ProspectStatus } from "../contract";
import type { ProspectionKevinDeps } from "../kevin-port";
import { handleOf } from "../score/format";
import { DAY_MS, objectOf, prospectionNow, rawProspectionSetting } from "../score/settings";
import { LINK_VARIANTS } from "./texts";

type Deps = ProspectionKevinDeps;

/** Statuts qui peuvent être rattachés (signés, actifs, arrêtés). */
export const LINKABLE_STATUSES: readonly ProspectStatus[] = ["SIGNED", "ACTIVE", "CHURNED"];
/** Question ouverte de rattachement (une seule à la fois, la dernière gagne). */
export const LINK_ASK_KEY = "prospection.link_ask";
export const LINK_ASK_TTL_MS = 7 * DAY_MS;
/** Choix proposés au plus. */
export const LINK_CHOICES_MAX = 5;

type ProspectLite = { id: string; username: string | null; title: string; status: ProspectStatus; linkAffiAffiliateId: string | null; signedAt: Date | null; linkAffiAskCount?: number | null; linkAffiAskedAt?: Date | null };

/** Identifiant d'affilié lisible (« 1234 », « affilié 1234 », uuid) ; null si illisible. Pur. */
export function parseAffiliateId(text: string): string | null {
  const t = text
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/^.*?\baffili[ée]e?\s*(n°|no|#)?\s*/iu, "")
    .trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(t) ? t : null;
}

export type LinkResult = { ok: boolean; message: string };

/** « @x = affilié 1234 » : rattache un prospect signé à son identifiant Link Affi. */
export async function linkAffiliate(deps: Deps, prospectId: string, affiliateId: string, by: "client" | "system"): Promise<LinkResult> {
  const say = (entry: readonly string[], key: string) => pick(entry, `prospection.link.${key}`);
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as ProspectLite | null;
  if (!p) return { ok: false, message: say(LINK_VARIANTS.unknown, "unknown") };
  const handle = esc(handleOf(p));
  const id = parseAffiliateId(affiliateId);
  if (!id) return { ok: false, message: say(LINK_VARIANTS.badId, "badId") };
  if (!LINKABLE_STATUSES.includes(p.status)) return { ok: false, message: say(LINK_VARIANTS.notSigned({ handle }), "notSigned") };
  if (p.linkAffiAffiliateId === id) return { ok: true, message: say(LINK_VARIANTS.alreadyLinked({ handle, id: esc(id) }), "already") };
  const other = (await deps.prisma.prospect.findFirst({ where: { linkAffiAffiliateId: id, NOT: { id: p.id } } })) as unknown as ProspectLite | null;
  if (other) return { ok: false, message: say(LINK_VARIANTS.idTaken({ id: esc(id), other: esc(handleOf(other)) }), "taken") };

  const now = prospectionNow(deps);
  await deps.prisma.prospect.update({ where: { id: p.id }, data: { linkAffiAffiliateId: id, linkAffiLinkedAt: now } });
  await deps.prisma.prospectEvent.create({ data: { prospectId: p.id, type: "LINKAFFI_LINKED", payload: { affiliateId: id, previous: p.linkAffiAffiliateId, by }, createdAt: now } });
  if (by === "client") await agentAudit(deps, { action: "prospection.linkaffi.linked", entityType: "Prospect", entityId: p.id, metadata: { affiliateId: id, previous: p.linkAffiAffiliateId } });
  await agentEvent(deps, "prospection.linkaffi.linked", { prospectId: p.id, by });
  const ask = await readLinkAsk(deps);
  if (ask?.prospectId === p.id) await clearLinkAsk(deps);
  return { ok: true, message: say(LINK_VARIANTS.linked({ handle, id: esc(id) }), "linked") };
}

// ————— Question ouverte —————

export type LinkCandidate = { affiliateId: string; name: string | null; firstCampaignAt: string | null };
type LinkAsk = { prospectId: string; candidates: LinkCandidate[]; at: string };

export async function readLinkAsk(deps: Pick<Deps, "prisma">): Promise<LinkAsk | null> {
  const v = objectOf(await rawProspectionSetting(deps, LINK_ASK_KEY));
  if (typeof v.prospectId !== "string" || typeof v.at !== "string" || !Array.isArray(v.candidates)) return null;
  const candidates = (v.candidates as unknown[])
    .map(objectOf)
    .filter((c) => typeof c.affiliateId === "string")
    .map((c) => ({ affiliateId: String(c.affiliateId), name: typeof c.name === "string" ? c.name : null, firstCampaignAt: typeof c.firstCampaignAt === "string" ? c.firstCampaignAt : null }));
  return { prospectId: v.prospectId, candidates, at: v.at };
}

async function clearLinkAsk(deps: Pick<Deps, "prisma">): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: LINK_ASK_KEY } });
}

const shortDate = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" }) : null);

/** Affiliés récents de Link Affi pas encore rattachés (lecture seule) ; vide sans lecteur ou en cas d'erreur. */
async function candidatesFor(deps: Deps): Promise<LinkCandidate[]> {
  const reader = deps.linkAffiReader;
  if (!reader) return [];
  try {
    const recent = await reader.recentAffiliates(LINK_CHOICES_MAX * 3);
    const linked = (await deps.prisma.prospect.findMany({ where: { linkAffiAffiliateId: { in: recent.map((r) => r.affiliateId) } } })) as unknown as Array<{ linkAffiAffiliateId: string | null }>;
    const taken = new Set(linked.map((l) => l.linkAffiAffiliateId));
    return recent
      .filter((r) => !taken.has(r.affiliateId))
      .slice(0, LINK_CHOICES_MAX)
      .map((r) => ({ affiliateId: r.affiliateId, name: r.name, firstCampaignAt: r.firstCampaignAt }));
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[prospection] affiliés récents illisibles");
    return [];
  }
}

/**
 * Question de rattachement d'un prospect signé (texte de Kevin, non envoyé ici) : correspondances numérotées si le
 * lecteur Link Affi est branché, sinon la forme à écrire. Ouvre la question (`prospection.link_ask`) et pose
 * `linkAffiAskedAt`. Null si le prospect est introuvable ou déjà rattaché.
 */
export async function askLinkAffiId(deps: Deps, prospectId: string, opts: { chatKey?: string | null } = {}): Promise<{ text: string; candidates: LinkCandidate[] } | null> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as ProspectLite | null;
  if (!p || p.linkAffiAffiliateId) return null;
  const handle = esc(handleOf(p));
  const candidates = await candidatesFor(deps);
  const say = (entry: readonly string[], key: string) => pick(entry, `prospection.link.${key}`, opts.chatKey);
  const lines = [say(LINK_VARIANTS.askIntro({ handle }), "askIntro")];
  if (candidates.length) {
    lines.push(say(LINK_VARIANTS.askChoices, "askChoices"));
    candidates.forEach((c, i) => {
      const since = shortDate(c.firstCampaignAt);
      lines.push(`${i + 1}. ${esc(c.name ?? `affilié ${c.affiliateId}`)}${c.name ? ` (n°${shortAffiliateId(c.affiliateId)})` : ""}${since ? `, première campagne le ${since}` : ""}`);
    });
    lines.push(say(LINK_VARIANTS.askHow({ handle }), "askHow"));
  } else lines.push(say(LINK_VARIANTS.askHowNoList({ handle }), "askHowNoList"));
  const now = prospectionNow(deps);
  const value = JSON.parse(JSON.stringify({ prospectId: p.id, candidates, at: now.toISOString() }));
  await deps.prisma.setting.upsert({ where: { key: LINK_ASK_KEY }, create: { key: LINK_ASK_KEY, value }, update: { value } });
  await deps.prisma.prospect.update({ where: { id: p.id }, data: { linkAffiAskedAt: now } });
  return { text: lines.join("\n"), candidates };
}

/** Identifiant court affiché (un uuid est raccourci à ses 8 premiers caractères). */
function shortAffiliateId(id: string): string {
  return esc(/^[0-9a-f]{8}-/i.test(id) ? `${id.slice(0, 8)}…` : id);
}

/**
 * Réponse « 2 » à la question ouverte de rattachement (moins de 7 jours) : rattache l'affilié choisi. Null s'il n'y a
 * pas de question ouverte ou si le message n'est pas un numéro seul (Kevin le traite alors normalement).
 */
export async function answerLinkChoice(deps: Deps, text: string): Promise<string | null> {
  const m = /^\s*(\d{1,2})\s*$/.exec(text.replace(/\u00a0/g, " "));
  if (!m) return null;
  const ask = await readLinkAsk(deps);
  if (!ask || !ask.candidates.length) return null;
  if (prospectionNow(deps).getTime() - Date.parse(ask.at) > LINK_ASK_TTL_MS) {
    await clearLinkAsk(deps);
    return null;
  }
  const n = Number(m[1]);
  if (n < 1 || n > ask.candidates.length) return pick(LINK_VARIANTS.choiceOutOfRange({ n: ask.candidates.length }), "prospection.link.range");
  const r = await linkAffiliate(deps, ask.prospectId, ask.candidates[n - 1]!.affiliateId, "client");
  return r.message;
}

// ————— Rappel hebdomadaire —————

/** Signés sans identifiant à rappeler maintenant (une fois par semaine, 3 fois au plus), les plus anciens d'abord. */
export async function signedWithoutLink(deps: Pick<Deps, "prisma">, now: Date): Promise<ProspectLite[]> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: ["SIGNED", "ACTIVE"] }, linkAffiAffiliateId: null }, orderBy: { signedAt: "asc" } })) as unknown as ProspectLite[];
  const limit = now.getTime() - LINK_REMINDER.everyDays * DAY_MS + 60 * 60_000;
  return rows.filter((p) => (p.linkAffiAskCount ?? 0) < LINK_REMINDER.max && (!p.linkAffiAskedAt || p.linkAffiAskedAt.getTime() <= limit));
}

/** Rappel hebdomadaire du rattachement des signés sans identifiant Link Affi (3 fois au plus). */
export async function runLinkReminders(deps: Deps, now: Date): Promise<{ sent: number; prospects: number }> {
  if (!deps.admin) return { sent: 0, prospects: 0 };
  const due = await signedWithoutLink(deps, now);
  if (!due.length) return { sent: 0, prospects: 0 };
  const [first, ...others] = due;
  const ask = await askLinkAffiId(deps, first!.id);
  if (!ask) return { sent: 0, prospects: 0 };
  const lines = [ask.text];
  const more = others.slice(0, 6).map((p) => esc(handleOf(p)));
  if (more.length) lines.push(pick(LINK_VARIANTS.askOthers({ handles: more.length > 1 ? `${more.slice(0, -1).join(", ")} et ${more.at(-1)}` : more[0]! }), "prospection.link.others"));
  const res = await deps.admin.send(lines.join("\n"));
  if (!res) return { sent: 0, prospects: 0 };
  const asked = [first!, ...others.slice(0, 6)];
  for (const p of asked) await deps.prisma.prospect.update({ where: { id: p.id }, data: { linkAffiAskCount: { increment: 1 }, linkAffiAskedAt: now } });
  await agentEvent(deps, "prospection.linkaffi.reminder", { prospects: asked.length });
  return { sent: 1, prospects: asked.length };
}
