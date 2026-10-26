/**
 * Phase 29 (règle de la phase 34) — cœurs uniques de la page Agents → Analyses, appelés par le site ET par Kevin :
 * - Sources de la veille : « Activer », « Désactiver », « Supprimer » (administrateurs ; supprimer efface aussi les
 *   entrées de veille de la source, les règles publicitaires restent) ;
 * - Recommandations du marché : « Accepter » / « Refuser » (managers compris, comme l'Agent Ads) : le client note sa
 *   décision ; rien n'est jamais changé chez Meta, TikTok, sur les canaux ni les budgets (aucune action externe).
 *   Accepter écrit l'état `APPLIED` + `appliedBy HUMAN` (« Acceptée »), comme « garder » une proposition chez Kevin ;
 *   refuser écrit `REJECTED`.
 * Mêmes validations et mêmes textes pour le site et Kevin ; essai à blanc (`dryRun`) qui ne fait que lire ; journal
 * (`AuditLog`, métadonnée `via`) à chaque geste réussi. Module SANS « use server » et sans `next/*`.
 */
import { MARKET_ANALYSIS_SOURCE, recommendationNotApproved } from "@linkaffipro/agents";
import { audit, prisma } from "@linkaffipro/db";
import { canDecideRecommendation, canManageSources, cleanRecComment, REC_DECISIONS, safeAnalysesId } from "@/lib/agents/analyses";
import { errorText, fail, forbidden, formOf, ok, preview, str, type CoreRun, type Fail } from "../lot-d/kit";

export const ADMIN_ONLY_SOURCES = "Activer, désactiver ou supprimer une source de la veille est réservé aux administrateurs.";
export const DELETE_WORD_ERROR = "Pour confirmer, tapez SUPPRIMER en majuscules dans le champ.";

const sourceSelect = { id: true, name: true, url: true, isActive: true, origin: true, errorCount: true, lastError: true, lastScrapedAt: true } as const;

async function checkedSource(fd: FormData, actor: Parameters<CoreRun>[1]) {
  if (!canManageSources(actor.role)) return { ok: false as const, result: forbidden(ADMIN_ONLY_SOURCES) };
  const id = safeAnalysesId(fd.get("sourceId"));
  if (!id) return { ok: false as const, result: fail("Source inconnue.", "invalid", "sourceId") };
  const source = await prisma.trendSource.findUnique({ where: { id }, select: sourceSelect });
  if (!source) return { ok: false as const, result: fail("Cette source n'existe plus.", "not_found") };
  return { ok: true as const, source };
}

const named = (s: { name: string; url: string }) => `« ${s.name} »`;

export const runActivateSource: CoreRun = async (fd, actor, opts = {}) => {
  const c = await checkedSource(fd, actor);
  if (!c.ok) return c.result;
  const { source } = c;
  if (source.isActive && source.errorCount === 0) return fail(`La source ${named(source)} est déjà active.`, "conflict");
  const found = source.origin === "discovered" && !source.lastScrapedAt ? " Elle a été trouvée par la veille : vous l'ajoutez à ce qui est lu." : "";
  const again = source.errorCount > 0 ? " Le compteur d'échecs repart de zéro." : "";
  if (opts.dryRun) return preview(`Activer la source ${named(source)} (${source.url}) : elle est lue dès le prochain passage de la veille, une heure au plus.${found}${again}`);
  try {
    await prisma.trendSource.update({
      where: { id: source.id },
      data: { isActive: true, errorCount: 0, lastError: null, nextScrapeAt: new Date() },
    });
  } catch (err) {
    return fail(`Activation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: "agents.analysts_source_activated",
    entityType: "TrendSource",
    entityId: source.id,
    metadata: { name: source.name, url: source.url, origin: source.origin, previousErrors: source.errorCount, via: actor.via },
  });
  return ok(`Source ${named(source)} activée : elle sera lue au prochain passage de la veille.`);
};

export const runDeactivateSource: CoreRun = async (fd, actor, opts = {}) => {
  const c = await checkedSource(fd, actor);
  if (!c.ok) return c.result;
  const { source } = c;
  if (!source.isActive) return fail(`La source ${named(source)} est déjà désactivée.`, "conflict");
  if (opts.dryRun) return preview(`Désactiver la source ${named(source)} : elle n'est plus lue ; ses entrées de veille restent.`);
  try {
    await prisma.trendSource.update({ where: { id: source.id }, data: { isActive: false, nextScrapeAt: null } });
  } catch (err) {
    return fail(`Désactivation impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: "agents.analysts_source_deactivated",
    entityType: "TrendSource",
    entityId: source.id,
    metadata: { name: source.name, url: source.url, via: actor.via },
  });
  return ok(`Source ${named(source)} désactivée : elle n'est plus lue, ses entrées restent.`);
};

/**
 * Supprimer une source (administrateurs). Site : le mot SUPPRIMER tapé dans le champ ; Kevin : le mot SUPPRIMER écrit
 * par l'admin (confirmation `delete` de son déroulé, avant l'appel).
 */
export const runDeleteSource: CoreRun = async (fd, actor, opts = {}) => {
  const c = await checkedSource(fd, actor);
  if (!c.ok) return c.result;
  const { source } = c;
  const entries = await prisma.trendEntry.count({ where: { sourceId: source.id } });
  const impact =
    entries === 0
      ? "Aucune entrée de veille à effacer."
      : `${entries} entrée${entries > 1 ? "s" : ""} de veille effacée${entries > 1 ? "s" : ""} avec elle ; les règles publicitaires et les rapports restent.`;
  if (opts.dryRun) return preview(`Supprimer la source ${named(source)} (${source.url}).`, { impact });
  if (actor.via === "WEB" && str(fd.get("confirm")).trim() !== "SUPPRIMER") return fail(DELETE_WORD_ERROR, "invalid", "confirm");
  try {
    await prisma.trendSource.delete({ where: { id: source.id } });
  } catch (err) {
    return fail(`Suppression impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: "agents.analysts_source_deleted",
    entityType: "TrendSource",
    entityId: source.id,
    metadata: { name: source.name, url: source.url, origin: source.origin, entries, via: actor.via },
  });
  return ok(`Source ${named(source)} supprimée. ${impact}`);
};

/** « Accepter » (`APPLIED`) ou « Refuser » (`REJECTED`) une recommandation du marché, avec un commentaire facultatif. */
export const runDecideMarketRecommendation: CoreRun = async (fd, actor, opts = {}) => {
  const status = fd.get("status");
  const id = safeAnalysesId(fd.get("id"));
  if ((status !== "APPLIED" && status !== "REJECTED") || !id) return fail("Recommandation inconnue.");
  const rec = await prisma.recommendation.findUnique({ where: { id }, select: { id: true, source: true, status: true, field: true, targetId: true } });
  if (!rec || rec.source !== MARKET_ANALYSIS_SOURCE) return fail("Recommandation introuvable.", "not_found");
  if (!canDecideRecommendation(String(rec.status))) return fail("Cette recommandation a déjà été décidée : rechargez la page.", "conflict");
  const comment = cleanRecComment(fd.get("comment"));
  // Phase 30 : « Accepter » seulement une recommandation approuvée par le QA Global (refuser reste toujours possible).
  if (status === "APPLIED") {
    const full = await prisma.recommendation.findUnique({ where: { id: rec.id } });
    const notApproved = full ? await recommendationNotApproved({ prisma } as never, full as never) : "Recommandation introuvable.";
    if (notApproved) return fail(notApproved, "conflict");
  }
  if (opts.dryRun)
    return preview(
      status === "APPLIED"
        ? "Accepter la recommandation : elle est notée comme retenue ; rien n'est changé chez Meta, TikTok, sur les canaux ni les budgets."
        : "Refuser la recommandation.",
    );
  const now = new Date();
  try {
    await prisma.recommendation.update({
      where: { id: rec.id },
      data:
        status === "APPLIED"
          ? { status: "APPLIED", appliedAt: now, appliedBy: "HUMAN", appliedById: actor.userId ?? null, comment }
          : { status: "REJECTED", rejectedAt: now, comment },
    });
  } catch (err) {
    return fail(`Impossible pour l'instant : ${errorText(err)}.`, "unavailable");
  }
  await audit({
    userId: actor.userId,
    action: status === "APPLIED" ? "agents.analysts_recommendation_accepted" : "agents.analysts_recommendation_rejected",
    entityType: "Recommendation",
    entityId: rec.id,
    metadata: { field: rec.field, targetId: rec.targetId, comment, via: actor.via },
  });
  return ok(REC_DECISIONS[status].done);
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

/** Source désignée par Kevin : identifiant, adresse, ou nom (« BlackHatWorld »), sans ambiguïté. */
export async function resolveSource(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; result: Fail }> {
  const s = str(raw).trim();
  if (!s) return { ok: false, result: fail("Quelle source ? Donnez son nom ou son adresse.", "invalid", "source") };
  const id = safeAnalysesId(s);
  if (id) {
    const byId = await prisma.trendSource.findUnique({ where: { id }, select: { id: true } });
    if (byId) return { ok: true, id: byId.id };
  }
  const bare = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
  const found = await prisma.trendSource.findMany({
    where: { OR: [{ name: { contains: s, mode: "insensitive" } }, { url: { contains: bare, mode: "insensitive" } }] },
    select: { id: true, name: true },
    take: 6,
  });
  const exact = found.filter((f) => f.name.toLowerCase() === s.toLowerCase());
  const list = exact.length === 1 ? exact : found;
  if (list.length === 0) return { ok: false, result: fail(`Aucune source « ${s} » dans la veille.`, "not_found", "source") };
  if (list.length > 1)
    return { ok: false, result: fail(`Plusieurs sources correspondent (${list.map((f) => f.name).join(", ")}) : laquelle ?`, "invalid", "source") };
  return { ok: true, id: list[0]!.id };
}

export async function kevinSourceForm(input: Record<string, unknown>): Promise<Prepared> {
  const r = await resolveSource(input.source ?? input.sourceId ?? input.nom ?? input.url);
  if (!r.ok) return r;
  return { ok: true, fd: formOf({ sourceId: r.id }) };
}

const DECISION_WORDS: Record<string, "APPLIED" | "REJECTED"> = {
  APPLIED: "APPLIED",
  accepter: "APPLIED",
  accepte: "APPLIED",
  garder: "APPLIED",
  oui: "APPLIED",
  REJECTED: "REJECTED",
  refuser: "REJECTED",
  refuse: "REJECTED",
  non: "REJECTED",
};

/** Recommandation désignée par Kevin : identifiant, ou numéro dans la liste « à décider » (plus récente = 1). */
export async function kevinRecommendationForm(input: Record<string, unknown>): Promise<Prepared> {
  const decision = DECISION_WORDS[str(input.decision ?? input.status).trim()] ?? DECISION_WORDS[str(input.decision ?? input.status).trim().toLowerCase()];
  if (!decision) return { ok: false, result: fail("Accepter ou refuser ?", "invalid", "decision") };
  let id = safeAnalysesId(input.id);
  if (!id) {
    const n = Number(str(input.numero).replace(/[^\d]/g, ""));
    if (!Number.isInteger(n) || n < 1) return { ok: false, result: fail("Quelle recommandation ? Donnez son numéro (« la 2 »).", "invalid", "numero") };
    const open = await prisma.recommendation.findMany({
      where: { source: MARKET_ANALYSIS_SOURCE, status: "PROPOSED" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
      take: 50,
    });
    const hit = open[n - 1];
    if (!hit) return { ok: false, result: fail(`Pas de recommandation n° ${n} à décider.`, "not_found", "numero") };
    id = hit.id;
  }
  return { ok: true, fd: formOf({ id, status: decision, comment: input.commentaire ?? input.comment }) };
}
