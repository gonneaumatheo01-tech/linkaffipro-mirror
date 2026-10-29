/**
 * Phase 34, lot D — cœurs des fiches d'équipe (`/agents`, `/agents/<équipe>`) : mission de test, réglages de l'équipe,
 * plan d'un canal, post de test Rencontres. Appelés par les actions du site (formulaire tel quel) et par
 * Kevin (paramètres convertis en formulaire, valeurs actuelles gardées pour ce qu'il ne change pas).
 */
import { createTestMission, createTestPostMission } from "@linkaffipro/agents";
import { audit, prisma } from "@linkaffipro/db";
import { parseCasinoPlanThemesForm, parseCasinoTeamForm } from "@/lib/agents/casino";
import { readCasinoSettingsRaw, writeCasinoSettings } from "@/lib/agents/casino-save";
import { parseTestPostForm } from "@/lib/agents/dating";
import { buildAgentsDeps } from "@/lib/agents/deps";
import { parseChannelPlanForm, parseTeamSettingsForm } from "@/lib/agents/forms";
import { saveChannelPlan, saveTeamSettings } from "@/lib/agents/save";
import { parseSportsSettingsForm } from "@/lib/agents/sports";
import { writeSportsSettings } from "@/lib/agents/sports-save";
import { PROVIDER_LABELS, TEAM_PROVIDERS, TEST_MISSION_TEAMS, parseTeamParam, teamName } from "@/lib/agents/teams";
import { errorText, fail, formOf, listText, ok, preview, str, truthy, uid, type CoreRun, type SiteOpResult } from "./kit";
import { resolveCampaign, resolveChannel, resolvePersona, resolveTeam } from "./resolve";

// ------------------------------------------------------------------------------------------------- mission de test

/** « Créer une mission de test » : un post texte sur le canal Test, en simulation (ADMIN et MANAGER). */
export const runCreateTestMission: CoreRun = async (fd, actor, opts = {}) => {
  const team = parseTeamParam(fd.get("team"));
  if (!team || !TEST_MISSION_TEAMS.includes(team)) return fail("Équipe inconnue.", "invalid", "team");
  if (opts.dryRun)
    return preview(`Mission de test pour l'équipe ${teamName(team)} : un post sur le canal Test, en simulation.`, {}, { team });
  try {
    const r = await createTestMission(buildAgentsDeps(), team, actor.userId);
    return r.ok
      ? ok(`Mission de test créée pour l'équipe ${teamName(team)} : l'aperçu arrivera sur Telegram et dans Validations.`, {
          missionId: r.missionId,
        })
      : fail(`Mission de test refusée : ${r.reason}`, "conflict");
  } catch (err) {
    return fail(`Mission de test impossible : ${errorText(err)}.`, "unavailable");
  }
};

// ------------------------------------------------------------------------------------------- réglages de l'équipe

const SETTINGS_OK = "Réglages de l'équipe enregistrés : le Grand Chef les applique à son prochain passage.";

/**
 * Réglages d'une équipe : consignes, mots interdits, longueur, heures calmes (ADMIN et MANAGER) ; plafonds et, pour
 * Casino (seuil, rotation), Paris sportifs (passages, écart, délai,
 * appels) : ADMIN seulement (ignorés pour un responsable, comme sur le site).
 */
export const runSaveTeamSettings: CoreRun = async (fd, actor, opts = {}) => {
  const team = parseTeamParam(fd.get("team"));
  if (!team) return fail("Équipe inconnue.", "invalid", "team");
  const isAdmin = actor.role === "ADMIN";
  const parsed = parseTeamSettingsForm(fd, isAdmin ? TEAM_PROVIDERS[team] : [], PROVIDER_LABELS);
  if (!parsed.ok) return fail(parsed.error);
  const casino = isAdmin && team === "casino" ? parseCasinoTeamForm(fd) : null;
  if (casino && !casino.ok) return fail(casino.error);
  const sports = isAdmin && team === "sports" ? parseSportsSettingsForm(fd) : null;
  if (sports && !sports.ok) return fail(sports.error);
  if (opts.dryRun) {
    const d = parsed.data;
    const parts = [
      `${d.forbiddenWords.length} mot${d.forbiddenWords.length > 1 ? "s" : ""} interdit${d.forbiddenWords.length > 1 ? "s" : ""}`,
      `${d.maxTextLength} caractères au plus`,
      d.quietHours.length ? `heures calmes ${d.quietHours.map((q) => `${q.start}-${q.end}`).join(", ")}` : "aucune heure calme",
    ];
    if (isAdmin)
      parts.push(
        Object.keys(d.budgets).length
          ? `plafonds : ${Object.entries(d.budgets)
              .map(([p, c]) => `${PROVIDER_LABELS[p as keyof typeof PROVIDER_LABELS]} ${(c ?? 0) / 100} €`)
              .join(", ")}`
          : "aucun plafond",
      );
    return preview(`Équipe ${teamName(team)} : ${parts.join(", ")}.`);
  }
  try {
    await saveTeamSettings(team, { ...parsed.data, budgets: isAdmin ? parsed.data.budgets : null }, uid(actor), actor.via);
    if (casino?.ok) {
      const { settings } = await readCasinoSettingsRaw();
      if (settings.lowStock !== casino.data.lowStock || settings.rotationDays !== casino.data.rotationDays)
        await writeCasinoSettings({ ...settings, ...casino.data }, uid(actor), "agents.casino_settings_saved", {
          from: { lowStock: settings.lowStock, rotationDays: settings.rotationDays },
          to: casino.data,
          via: actor.via,
        });
    }
    if (sports?.ok) await writeSportsSettings(sports.data, uid(actor), actor.via);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(SETTINGS_OK);
};

// ------------------------------------------------------------------------------------------------ plan d'un canal

/** Plan d'un canal (ADMIN et MANAGER) : `saveChannelPlanFor` du moteur, comme le Boss. */
export const runSaveChannelPlan: CoreRun = async (fd, actor, opts = {}) => {
  const team = parseTeamParam(fd.get("team"));
  if (!team) return fail("Équipe inconnue.", "invalid", "team");
  const parsed = parseChannelPlanForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  // Rencontres : plus de vidéos IA depuis le 29 octobre 2026 (part de vidéos ramenée à 0).
  if (team === "dating") {
    parsed.data.mix = { ...parsed.data.mix, video: 0 };
    if (parsed.data.mix.photo + parsed.data.mix.text === 0) return fail("Mélange : donnez une part aux photos ou aux textes (l'équipe Rencontres ne fait plus de vidéos).");
  }
  if (team === "casino") {
    const { settings } = await readCasinoSettingsRaw();
    const themes = parseCasinoPlanThemesForm(fd, settings.themes);
    if (!themes.ok) return fail(themes.error);
    parsed.data.themes = themes.data;
  }
  if (opts.dryRun) {
    const p = parsed.data;
    return preview(
      `Plan ${p.enabled ? "activé" : "désactivé"} : ${p.postsPerDay} post${p.postsPerDay > 1 ? "s" : ""} par jour entre ${p.windowStart} et ${p.windowEnd}, ${p.minSpacingMinutes} min d'écart, mélange ${p.mix.video} vidéo / ${p.mix.photo} photo / ${p.mix.text} texte.`,
    );
  }
  try {
    const r = await saveChannelPlan(team, parsed.data, uid(actor), actor.via);
    if (!r.ok) return fail(r.error);
  } catch (err) {
    return fail(`Enregistrement impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok("Plan du canal enregistré.");
};

// ------------------------------------------------------------------------------------------ post de test Rencontres

const FORMAT_WORDS = { video: "vidéo", photo: "photo", text: "texte" } as const;

/** « Produire un post de test » (équipe Rencontres, ADMIN et MANAGER) : mission en simulation vers le canal Test. */
export const runCreateTestPost: CoreRun = async (fd, actor, opts = {}) => {
  const parsed = parseTestPostForm(fd);
  if (!parsed.ok) return fail(parsed.error);
  const { format, personaId } = parsed.data;
  if (opts.dryRun) return preview(`Post de test (${FORMAT_WORDS[format]}) en simulation sur le canal Test.`);
  try {
    const r = await createTestPostMission(buildAgentsDeps(), { teamKey: "dating", byUserId: actor.userId, format, personaId });
    await audit({
      userId: actor.userId,
      action: "agents.test_post_requested",
      entityType: "AgentMission",
      entityId: r.ok ? r.missionId : undefined,
      metadata: { teamKey: "dating", format, personaId, ok: r.ok, reason: r.ok ? null : r.reason, via: actor.via },
    });
    if (!r.ok) return fail(`Post de test refusé : ${r.reason}`, "conflict");
  } catch (err) {
    return fail(`Post de test impossible : ${errorText(err)}.`, "unavailable");
  }
  return ok(
    `Post de test (${FORMAT_WORDS[format]}) lancé en simulation : l'aperçu arrivera sur Telegram et dans Validations, puis sur le canal Test.`,
  );
};

// ------------------------------------------------------------------------------------------- entrées de Kevin

type In = Record<string, unknown>;
type Prepared = { ok: true; fd: FormData } | { ok: false; result: Extract<SiteOpResult, { ok: false }> };

/** Équipe donnée en clair (« casino ») → clé. */
async function teamKeyOf(input: In): Promise<{ ok: true; team: string } | { ok: false; result: Extract<SiteOpResult, { ok: false }> }> {
  const t = await resolveTeam(input.team ?? input.equipe);
  if (!t.ok) return t;
  if (t.team === "all") return { ok: false, result: fail("Une seule équipe à la fois.", "invalid", "team") };
  return { ok: true, team: t.team };
}

export async function kevinTestMissionForm(input: In): Promise<Prepared> {
  const t = await teamKeyOf(input);
  return t.ok ? { ok: true, fd: formOf({ team: t.team }) } : t;
}

export async function kevinTestPostForm(input: In): Promise<Prepared> {
  let personaId: string | undefined;
  if (input.persona) {
    const p = await resolvePersona(input.persona);
    if (!p.ok) return p;
    personaId = p.id;
  }
  const format = str(input.format).replace(/^texte$/, "text").replace(/^vid[ée]o$/, "video");
  return { ok: true, fd: formOf({ format, personaId }) };
}

/**
 * Réglages d'une équipe par Kevin : on part des valeurs actuelles (formulaire tel que la page le montre) et on ne
 * change que ce qu'il donne. Mots interdits : `forbiddenWords` remplace la liste, `addForbiddenWords` /
 * `removeForbiddenWords` ajoutent ou retirent. Plafonds : `budgets` en euros par poste (`image`, `llm`…).
 */
export async function kevinTeamSettingsForm(input: In): Promise<Prepared> {
  const t = await teamKeyOf(input);
  if (!t.ok) return t;
  const team = t.team as Parameters<typeof teamName>[0] & keyof typeof TEAM_PROVIDERS;
  const { loadTeamConfig } = await import("@/lib/agents/queries");
  const { quietHoursText } = await import("@/lib/agents/config");
  const cfg = await loadTeamConfig(team);
  let words = Array.isArray(input.forbiddenWords) ? input.forbiddenWords.map(str) : cfg.forbiddenWords;
  if (Array.isArray(input.addForbiddenWords)) words = [...words, ...input.addForbiddenWords.map(str)];
  if (Array.isArray(input.removeForbiddenWords)) {
    const drop = new Set(input.removeForbiddenWords.map((w) => str(w).trim().toLowerCase()));
    words = words.filter((w) => !drop.has(w.trim().toLowerCase()));
  }
  const form: In = {
    team,
    styleGuidelines: input.styleGuidelines !== undefined ? str(input.styleGuidelines) : cfg.styleGuidelines,
    forbiddenWords: words.join("\n"),
    maxTextLength: input.maxTextLength ?? cfg.maxTextLength,
    quietHours: input.quietHours !== undefined ? listText(input.quietHours) : quietHoursText(cfg.quietHours),
  };
  const budgets = input.budgets && typeof input.budgets === "object" ? (input.budgets as Record<string, unknown>) : {};
  for (const p of TEAM_PROVIDERS[team]) {
    const given = budgets[p];
    const cur = cfg.budgets[p];
    if (given !== undefined && given !== null && given !== "") form[`budget_${p}`] = given;
    else if (cur !== undefined) form[`budget_${p}`] = cur / 100;
  }
  if (team === "casino") {
    const { settings } = await readCasinoSettingsRaw();
    form.casinoLowStock = input.casinoLowStock ?? settings.lowStock;
    form.casinoRotationDays = input.casinoRotationDays ?? settings.rotationDays;
  }
  if (team === "sports") {
    const { loadSportsSettings } = await import("@/lib/agents/sports-queries");
    const { runHoursText } = await import("@/lib/agents/sports");
    const s = await loadSportsSettings();
    form.sportsRunHours = input.sportsRunHours !== undefined ? listText(input.sportsRunHours) : runHoursText(s.runHours);
    form.sportsMaxOddsDriftPct = input.sportsMaxOddsDriftPct ?? s.maxOddsDriftPct;
    form.sportsMinMinutesBeforeKickoff = input.sportsMinMinutesBeforeKickoff ?? s.minMinutesBeforeKickoff;
    form.sportsMaxApiCallsPerMonth = input.sportsMaxApiCallsPerMonth ?? s.maxApiCallsPerMonth;
  }
  return { ok: true, fd: formOf(form) };
}

const VERTICAL_TEAM: Record<string, string> = { DATING: "dating", CASINO: "casino", SPORTS: "sports" };
const DEFAULT_PLAN = { enabled: false, postsPerDay: 3, windowStart: "09:00", windowEnd: "22:00", minSpacingMinutes: 90 };

/**
 * Plan d'un canal par Kevin : canal par nom, persona et campagne par nom ; valeurs actuelles du plan (ou valeurs de
 * départ de la page) pour le reste. Casino : `themes` = `[{ theme, weight }]` ou liste de thèmes (poids 1).
 */
export async function kevinChannelPlanForm(input: In): Promise<Prepared> {
  const c = await resolveChannel(input.channel ?? input.channelId ?? input.canal);
  if (!c.ok) return c;
  const ch = await prisma.channel.findUnique({
    where: { id: c.id },
    select: { vertical: true, agentPlan: true },
  });
  let team = ch?.agentPlan?.teamKey ?? (ch?.vertical ? VERTICAL_TEAM[ch.vertical] : undefined);
  if (input.team ?? input.equipe) {
    const t = await teamKeyOf(input);
    if (!t.ok) return t;
    team = t.team;
  }
  if (!team) return { ok: false, result: fail(`Le canal « ${c.name} » n'a pas d'univers : à quelle équipe le confier ?`, "invalid", "team") };
  const plan = ch?.agentPlan ?? null;
  const { DATING_DEFAULT_MIX } = await import("@/lib/agents/dating");
  const { CASINO_DEFAULT_MIX } = await import("@/lib/agents/casino");
  const curMix = (plan?.mix as unknown as { video?: number; photo?: number; text?: number } | null) ??
    (team === "dating" ? DATING_DEFAULT_MIX : team === "casino" ? CASINO_DEFAULT_MIX : { video: 0, photo: 0, text: 1 });
  const mixIn = input.mix && typeof input.mix === "object" ? (input.mix as Record<string, unknown>) : {};
  const mix = {
    video: team === "dating" ? 0 : (mixIn.video ?? curMix.video ?? 0),
    photo: mixIn.photo ?? curMix.photo ?? 0,
    text: mixIn.text ?? mixIn.texte ?? curMix.text ?? 0,
  };
  let personaId: string | null = plan?.personaId ?? null;
  if (input.persona !== undefined) {
    if (input.persona === null || input.persona === "") personaId = null;
    else {
      const p = await resolvePersona(input.persona);
      if (!p.ok) return p;
      personaId = p.id;
    }
  }
  let campaignId: string | null = plan?.campaignId ?? null;
  if (input.campaign !== undefined) {
    if (input.campaign === null || input.campaign === "") campaignId = null;
    else {
      const k = await resolveCampaign(input.campaign);
      if (!k.ok) return k;
      campaignId = k.id;
    }
  }
  const enabled = input.enabled !== undefined ? truthy(input.enabled) === true : (plan?.enabled ?? DEFAULT_PLAN.enabled);
  const form: In = {
    team,
    channelId: c.id,
    enabled,
    postsPerDay: input.postsPerDay ?? plan?.postsPerDay ?? DEFAULT_PLAN.postsPerDay,
    windowStart: input.windowStart ?? plan?.windowStart ?? DEFAULT_PLAN.windowStart,
    windowEnd: input.windowEnd ?? plan?.windowEnd ?? DEFAULT_PLAN.windowEnd,
    minSpacingMinutes: input.minSpacingMinutes ?? plan?.minSpacingMinutes ?? DEFAULT_PLAN.minSpacingMinutes,
    mix_video: mix.video,
    mix_photo: mix.photo,
    mix_text: mix.text,
    personaId: personaId ?? undefined,
    campaignId: campaignId ?? undefined,
  };
  const current: unknown[] = plan && Array.isArray(plan.themes) ? (plan.themes as unknown[]) : [];
  const themesIn = input.themes !== undefined ? (Array.isArray(input.themes) ? input.themes : [input.themes]) : current;
  if (team === "casino") {
    const { settings } = await readCasinoSettingsRaw();
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^#/, "").trim().toLowerCase();
    for (const t of themesIn) {
      const raw = typeof t === "string" ? t : str((t as { theme?: unknown })?.theme);
      const weight = typeof t === "string" ? 1 : ((t as { weight?: unknown })?.weight ?? 1);
      if (!raw) continue;
      const theme = settings.themes.find((x) => x.key === norm(raw) || norm(x.label) === norm(raw))?.key;
      if (!theme)
        return {
          ok: false,
          result: fail(`Le thème « ${raw} » n'existe pas. Thèmes : ${settings.themes.map((x) => x.label).join(", ")}.`, "not_found"),
        };
      form[`ptheme_${theme}`] = true;
      form[`pweight_${theme}`] = weight;
    }
  } else form.themes = themesIn.filter((t): t is string => typeof t === "string").join("\n");
  return { ok: true, fd: formOf(form) };
}
