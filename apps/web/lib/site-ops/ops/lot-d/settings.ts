/**
 * Phase 34, lot D — cœurs de Réglages des agents (`/agents/settings`, ADMIN) : clés des fournisseurs (enregistrer,
 * vérifier, retirer), modèles d'IA et canal Médiathèque, plafonds du mois de toutes les équipes. La valeur d'une clé
 * n'est jamais renvoyée, ni dans un aperçu, ni dans un message, ni dans le journal (chiffrée par `saveSecret`).
 */
import { deleteSecret, saveSecret, verifySecret, type ProviderKey, type TeamKey } from "@linkaffipro/agents";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { parseAgentsSettingsForm, parseBudgetFields, parseSecretValue } from "@/lib/agents/forms";
import { loadAgentsGeneralSettings, loadTeamConfig } from "@/lib/agents/queries";
import { saveAgentsGeneralSettings, saveTeamBudgets } from "@/lib/agents/save";
import { isKnownSecretKey, secretInfo } from "@/lib/agents/secrets";
import { PROVIDER_LABELS, TEAM_KEYS, TEAM_NAMES, TEAM_PROVIDERS } from "@/lib/agents/teams";
import { adminOnly, engineActor, errorText, euros, fail, formOf, ok, preview, str, uid, type CoreRun, type Fail } from "./kit";
import { resolveChannel, resolveTeam } from "./resolve";

const UNKNOWN_KEY = "Clé inconnue : rechargez la page.";

function keyOf(fd: FormData): string | null {
  const v = fd.get("key");
  const key = typeof v === "string" ? v : "";
  return isKnownSecretKey(key) ? key : null;
}

/** Enregistre une clé (chiffrée par le moteur, jamais renvoyée ni journalisée en clair). */
export const runSaveSecret: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const key = keyOf(fd);
  if (!key) return fail(UNKNOWN_KEY, "invalid", "key");
  const raw = fd.get("value");
  const parsed = parseSecretValue(typeof raw === "string" ? raw : "");
  if (!parsed.ok) return fail(parsed.error, "invalid", "value");
  if (opts.dryRun) return preview(`Clé ${secretInfo(key).label} : enregistrée chiffrée, jamais réaffichée.`);
  try {
    const { last4 } = await saveSecret(buildAgentsDeps(), key, parsed.data, engineActor(actor));
    return ok(`Clé ${secretInfo(key).label} enregistrée (se termine par ${last4}).`);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
};

/** Vérifie une clé enregistrée (appel gratuit au fournisseur). */
export const runVerifySecret: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const key = keyOf(fd);
  if (!key) return fail(UNKNOWN_KEY, "invalid", "key");
  if (opts.dryRun) return preview(`Vérification de la clé ${secretInfo(key).label} (sans dépense).`);
  try {
    const r = await verifySecret(buildAgentsDeps(), key);
    if (!r) return fail(`Aucune vérification n'existe encore pour la clé ${secretInfo(key).label}.`, "unavailable");
    return r.ok ? ok(`Clé ${secretInfo(key).label} : ${r.message}`) : fail(`Clé ${secretInfo(key).label} : ${r.message}`, "conflict");
  } catch (err) {
    return fail(`Vérification impossible : ${errorText(err)}.`, "unavailable");
  }
};

/** Retire une clé (le fournisseur ne sert plus jusqu'à ce qu'une clé soit recollée). */
export const runDeleteSecret: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const key = keyOf(fd);
  if (!key) return fail(UNKNOWN_KEY, "invalid", "key");
  if (opts.dryRun)
    return preview(`Retrait de la clé ${secretInfo(key).label}.`, { impact: `${secretInfo(key).label} ne servira plus jusqu'à une nouvelle clé.` });
  try {
    await deleteSecret(buildAgentsDeps(), key, engineActor(actor));
  } catch (err) {
    return fail(`Suppression impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(`Clé ${secretInfo(key).label} retirée.`);
};

/** Modèles d'IA (rapide, écriture) et canal Médiathèque. */
export const runSaveGeneralSettings: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsed = parseAgentsSettingsForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  if (opts.dryRun)
    return preview(
      `IA rapide ${parsed.data.fast}, IA d'écriture ${parsed.data.strong}, ${parsed.data.libraryChannelId ? "canal Médiathèque choisi" : "aucun canal Médiathèque"}.`,
    );
  try {
    const before = await loadAgentsGeneralSettings();
    const r = await saveAgentsGeneralSettings(parsed.data, before, uid(actor), actor.via);
    if (!r.ok) return fail(r.error, "not_found");
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok("Réglages enregistrés.");
};

/**
 * Plafonds du mois de toutes les équipes (champs `<équipe>.budget_<fournisseur>`, en euros ; vide = aucun plafond).
 * Tout est lu et vérifié avant d'écrire : une erreur sur une équipe n'enregistre rien. Seules les équipes changées
 * sont écrites (`agents.budgets_saved`).
 */
export const runSaveBudgets: CoreRun = async (fd, actor, opts = {}) => {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const parsedAll: Array<{ team: TeamKey; budgets: Partial<Record<ProviderKey, number>> }> = [];
  for (const team of TEAM_KEYS) {
    const sub = new FormData();
    for (const p of TEAM_PROVIDERS[team]) {
      const v = fd.get(`${team}.budget_${p}`);
      if (typeof v === "string") sub.set(`budget_${p}`, v);
    }
    const parsed = parseBudgetFields(sub, TEAM_PROVIDERS[team], PROVIDER_LABELS);
    if (!parsed.ok) return fail(parsed.error);
    parsedAll.push({ team, budgets: parsed.data });
  }
  try {
    const changed: typeof parsedAll = [];
    const lines: string[] = [];
    for (const { team, budgets } of parsedAll) {
      const before = (await loadTeamConfig(team)).budgets;
      if (JSON.stringify(before) === JSON.stringify(budgets)) continue;
      changed.push({ team, budgets });
      for (const p of TEAM_PROVIDERS[team])
        if (before[p] !== budgets[p])
          lines.push(
            `${TEAM_NAMES[team]}, ${PROVIDER_LABELS[p]} : ${before[p] === undefined ? "aucun" : euros(before[p]!)} → ${budgets[p] === undefined ? "aucun" : euros(budgets[p]!)}`,
          );
    }
    if (opts.dryRun) return preview(lines.length ? lines.join(" ; ") : "Aucun plafond ne change.", {}, { changes: lines.length });
    for (const c of changed) await saveTeamBudgets(c.team, c.budgets, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok("Plafonds enregistrés.");
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Fail };

/** Noms courants des clés (« fal », « cotes ») → clé enregistrée. */
const SECRET_ALIASES: Record<string, string> = {
  fal: "providers.fal.apiKey",
  "fal.ai": "providers.fal.apiKey",
  falai: "providers.fal.apiKey",
  cotes: "providers.odds.apiKey",
  odds: "providers.odds.apiKey",
  sportsgameodds: "providers.odds.apiKey",
  "cotes sportives": "providers.odds.apiKey",
  football: "providers.apifootball.apiKey",
  apifootball: "providers.apifootball.apiKey",
  "api-football": "providers.apifootball.apiKey",
  "api football": "providers.apifootball.apiKey",
  statistiques: "providers.apifootball.apiKey",
};

export function secretKeyOf(raw: unknown): string | null {
  const s = str(raw).trim();
  if (isKnownSecretKey(s)) return s;
  const n = s.toLowerCase().replace(/^(la |le )?(cl[ée] )?(de |d')?/, "").trim();
  return SECRET_ALIASES[n] ?? null;
}

export function kevinSecretForm(input: In, withValue: boolean): Prepared {
  const key = secretKeyOf(input.key ?? input.cle ?? input.fournisseur);
  if (!key) return { ok: false, result: fail("Quelle clé ? fal.ai ou cotes sportives.", "invalid", "key") };
  return { ok: true, fd: formOf({ key, ...(withValue ? { value: str(input.value) } : {}) }) };
}

export async function kevinGeneralSettingsForm(input: In): Promise<Prepared> {
  const cur = await loadAgentsGeneralSettings();
  let libraryChannelId = cur.libraryChannelId;
  if (input.libraryChannel !== undefined) {
    if (input.libraryChannel === null || input.libraryChannel === "") libraryChannelId = null;
    else {
      const c = await resolveChannel(input.libraryChannel);
      if (!c.ok) return c;
      libraryChannelId = c.id;
    }
  }
  return {
    ok: true,
    fd: formOf({
      modelFast: input.modelFast ?? cur.models.fast,
      modelStrong: input.modelStrong ?? cur.models.strong,
      libraryChannelId: libraryChannelId ?? undefined,
    }),
  };
}

const PROVIDER_ALIASES: Record<string, ProviderKey> = {
  video: "video",
  videos: "video",
  vidéo: "video",
  vidéos: "video",
  image: "image",
  images: "image",
  photo: "image",
  photos: "image",
  llm: "llm",
  ia: "llm",
  ecriture: "llm",
  écriture: "llm",
  odds: "odds",
  cotes: "odds",
  screenshot: "screenshot",
  captures: "screenshot",
  capture: "screenshot",
};

/**
 * « Monte le budget photo à 20 € » : formulaire complet de la page (plafonds actuels de toutes les équipes) avec le
 * seul poste demandé changé. `equipe` facultative quand le poste n'existe que dans une équipe (photo → Rencontres).
 * `euros` vide ou null = plafond retiré.
 */
export async function kevinBudgetsForm(input: In): Promise<Prepared> {
  const provider = PROVIDER_ALIASES[str(input.poste ?? input.provider).trim().toLowerCase()];
  if (!provider) return { ok: false, result: fail("Quel poste ? photo, IA d'écriture, cotes ou captures.", "invalid", "poste") };
  // Vidéos IA retirées le 29 octobre 2026 : plus de plafond vidéo.
  if (provider === "video") return { ok: false, result: fail("Les vidéos IA ne sont plus produites : il n'y a plus de plafond vidéo.", "invalid", "poste") };
  let team: TeamKey | null = null;
  if (input.equipe ?? input.team) {
    const t = await resolveTeam(input.equipe ?? input.team);
    if (!t.ok) return t;
    if (t.team === "all") return { ok: false, result: fail("Une seule équipe à la fois.", "invalid", "equipe") };
    team = t.team;
  } else {
    const owners = TEAM_KEYS.filter((k) => TEAM_PROVIDERS[k].includes(provider));
    if (owners.length !== 1)
      return { ok: false, result: fail(`Pour quelle équipe ? ${owners.map((k) => TEAM_NAMES[k]).join(", ")}.`, "invalid", "equipe") };
    team = owners[0]!;
  }
  if (!TEAM_PROVIDERS[team].includes(provider))
    return { ok: false, result: fail(`L'équipe ${TEAM_NAMES[team]} n'a pas de poste « ${PROVIDER_LABELS[provider]} ».`, "invalid", "poste") };
  const form: In = {};
  for (const k of TEAM_KEYS) {
    const cur = (await loadTeamConfig(k)).budgets;
    for (const p of TEAM_PROVIDERS[k]) if (cur[p] !== undefined) form[`${k}.budget_${p}`] = cur[p]! / 100;
  }
  const v = input.euros;
  if (v === null || v === undefined || v === "") delete form[`${team}.budget_${provider}`];
  else form[`${team}.budget_${provider}`] = v;
  return { ok: true, fd: formOf(form) };
}
