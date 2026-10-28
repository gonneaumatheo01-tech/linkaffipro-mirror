/**
 * Phase 34, lot D — cœurs de la fiche Paris sportifs (phase 23) : catégories de paris (tous les champs du
 * formulaire) et pari de test. Pari de test : ADMIN et MANAGER ; les catégories : ADMIN.
 */
import { createTestBetMission } from "@linkaffipro/agents";
import { audit } from "@linkaffipro/db";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { loadChannelPlans, loadPlanChoices } from "@/lib/agents/queries";
import {
  bookmakerLabel,
  parseBetCategoryForm,
  parseTestBetForm,
} from "@/lib/agents/sports";
import { loadBetCategories } from "@/lib/agents/sports-queries";
import { loadCategoryKeys, saveBetCategory } from "@/lib/agents/sports-save";
import {
  errorText,
  fail,
  forbidden,
  formOf,
  listText,
  ok,
  preview,
  str,
  truthy,
  uid,
  type CoreRun,
  type Fail,
  type SiteOpActor,
} from "./kit";
import { resolveBetCategory, resolveCampaign, resolveChannel } from "./resolve";

const reserved = (actor: SiteOpActor, what: string): Fail | null =>
  actor.role === "ADMIN" ? null : forbidden(`${what} : réservé aux administrateurs.`);

/** Crée ou modifie une catégorie de paris (ADMIN). */
export const runSaveBetCategory: CoreRun = async (fd, actor, opts = {}) => {
  const denied = reserved(actor, "Les catégories de paris");
  if (denied) return denied;
  const [plans, choices, takenKeys] = await Promise.all([loadChannelPlans("sports"), loadPlanChoices("sports"), loadCategoryKeys()]);
  const parsed = parseBetCategoryForm(fd, {
    channelIds: plans.map((c) => c.id),
    campaignIds: choices.campaigns.map((c) => c.id),
    takenKeys,
  });
  if (!parsed.ok) return fail(parsed.error);
  const d = parsed.data;
  if (opts.dryRun)
    return preview(
      `${d.id ? "Catégorie" : "Nouvelle catégorie"} « ${d.name} » ${d.active ? "active" : "inactive"} : cotes de ${String(d.minOdds).replace(".", ",")} à ${String(d.maxOdds).replace(".", ",")}, ${d.picksPerDay} pari${d.picksPerDay > 1 ? "s" : ""} par jour au plus, ${d.leagues.length} ligue${d.leagues.length > 1 ? "s" : ""}, bookmakers ${d.bookmakers.map(bookmakerLabel).join(", ")}.`,
    );
  try {
    const r = await saveBetCategory(d, uid(actor), actor.via);
    if (!r.ok) return fail(r.error, "not_found");
    return ok(
      !d.id
        ? `Catégorie « ${d.name} » créée${d.active ? "" : " (inactive : cochez « Active » pour qu'elle serve)"}.`
        : r.changed.length
          ? `Catégorie « ${d.name} » enregistrée.`
          : `Catégorie « ${d.name} » inchangée.`,
      { id: r.id },
    );
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
};

/** « Produire un pari de test » : faux fournisseur de cotes, page locale, simulation, canal Test (ADMIN et MANAGER). */
export const runCreateTestBet: CoreRun = async (fd, actor, opts = {}) => {
  const categories = await loadBetCategories();
  const parsed = parseTestBetForm(
    fd,
    categories.map((c) => c.id),
  );
  if (!parsed.ok) return fail(parsed.error);
  if (opts.dryRun) return preview("Pari de test en simulation (cotes d'essai, aucune vraie mise), sur le canal Test.");
  try {
    const r = await createTestBetMission(buildAgentsDeps(), { categoryId: parsed.data.categoryId, byUserId: actor.userId });
    await audit({
      userId: actor.userId,
      action: "agents.test_bet_requested",
      entityType: "AgentMission",
      entityId: r.ok ? r.missionId : undefined,
      metadata: { teamKey: "sports", categoryId: parsed.data.categoryId, ok: r.ok, reason: r.ok ? null : r.reason, via: actor.via },
    });
    if (!r.ok) return fail(`Pari de test refusé : ${r.reason}`, "conflict");
  } catch (err) {
    return fail(`Pari de test impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(
    "Pari de test lancé en simulation (cotes d'essai, aucune vraie mise) : il apparaît dans « Paris du jour », puis sur le canal Test.",
  );
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

/** Bookmaker en clair (« Sportaza », « 5 Gringos ») → clé du moteur (« sportaza », « 5gringos »). */
export function bookmakerKeyOf(raw: unknown): string {
  return str(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(mon |le |la )?(compte )?/, "")
    .replace(/\s+/g, "");
}

const decimal = (v: unknown) => (typeof v === "string" ? v.replace(",", ".") : v);

/**
 * Catégorie de paris par Kevin, TOUS les champs du formulaire : `categorie` = catégorie existante (nom, clé ou
 * identifiant ; absente = nouvelle catégorie nommée `name`), puis `name`, `sport`, `marketTypes`, `leagues`,
 * `bookmakers`, `minOdds`, `maxOdds`, `picksPerDay`, `channels` (noms), `campaign` (nom), `minMinutesBeforeKickoff`,
 * `maxOddsDriftPct`, `active`, `sortOrder`. Ce qui n'est pas donné garde sa valeur actuelle.
 */
export async function kevinBetCategoryForm(input: In): Promise<Prepared> {
  let current: Awaited<ReturnType<typeof loadBetCategories>>[number] | null = null;
  const target = input.categorie ?? input.category ?? input.id;
  if (target) {
    const r = await resolveBetCategory(target);
    if (!r.ok) {
      if (r.result.code !== "not_found" || input.name === undefined) return r;
    } else current = (await loadBetCategories()).find((c) => c.id === r.id) ?? null;
  }
  let channelIds: string[] | undefined = current?.channelIds;
  if (input.channels !== undefined) {
    channelIds = [];
    for (const n of Array.isArray(input.channels) ? input.channels : [input.channels]) {
      const c = await resolveChannel(n);
      if (!c.ok) return c;
      channelIds.push(c.id);
    }
  }
  let campaignId: string | null | undefined = current?.campaignId;
  if (input.campaign !== undefined) {
    if (input.campaign === null || input.campaign === "") campaignId = null;
    else {
      const k = await resolveCampaign(input.campaign);
      if (!k.ok) return k;
      campaignId = k.id;
    }
  }
  const pick = <T>(k: string, cur: T | undefined) => (input[k] !== undefined ? input[k] : cur);
  const list = (k: string, cur: string[] | undefined) => (input[k] !== undefined ? listText(input[k]) : cur?.join("\n"));
  const active = input.active !== undefined ? truthy(input.active) === true : (current?.active ?? false);
  const bookmakers = input.bookmakers !== undefined
    ? (Array.isArray(input.bookmakers) ? input.bookmakers : str(input.bookmakers).split(/[,;\n]/)).map(bookmakerKeyOf).filter(Boolean)
    : current?.bookmakers;
  return {
    ok: true,
    fd: formOf({
      id: current?.id,
      key: current?.key,
      name: pick("name", current?.name),
      sport: pick("sport", current?.sport),
      marketTypes: list("marketTypes", current?.marketTypes),
      leagues: list("leagues", current?.leagues),
      bookmakers,
      minOdds: decimal(pick("minOdds", current?.minOdds)),
      maxOdds: decimal(pick("maxOdds", current?.maxOdds)),
      picksPerDay: pick("picksPerDay", current?.picksPerDay),
      channelIds,
      campaignId: campaignId ?? undefined,
      minMinutesBeforeKickoff: pick("minMinutesBeforeKickoff", current?.minMinutesBeforeKickoff),
      maxOddsDriftPct: decimal(pick("maxOddsDriftPct", current?.maxOddsDriftPct)),
      sortOrder: pick("sortOrder", current?.sortOrder),
      active,
    }),
  };
}

export async function kevinTestBetForm(input: In): Promise<Prepared> {
  if (!input.categorie && !input.category) return { ok: true, fd: formOf({}) };
  const r = await resolveBetCategory(input.categorie ?? input.category);
  return r.ok ? { ok: true, fd: formOf({ categoryId: r.id }) } : r;
}
