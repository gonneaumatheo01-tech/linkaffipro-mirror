/**
 * Phase 26, section 4 — l'équipe de Kevin : membres présentés (`TeamMember`), responsabilités, disponibilité, notes
 * datées, choix du responsable d'une demande ou d'une validation, mentions (`@username` ou lien `tg://user?id=`),
 * profil de l'admin (prénom affiché dans le groupe) et personnes vues dans le groupe (identifiant, prénom, nom
 * d'utilisateur : jamais le texte de leurs messages).
 */
import { esc, nowOf, readSetting, writeSetting, adminTelegramId } from "../../admin/journal";
import type { AgentsDeps } from "../../types";
import type { TeamMemberKind, TeamMemberTeam, TeamResponsibilities } from "../contract";
import { parisDay } from "../../rules/time";
import type { VoiceTable } from "../voice";

/** Textes de Kevin de ce module (charte `docs/KEVIN-VOIX.md`, contrôlés par `voice.test.ts`). */
export const TEAM_MEMBERS_VARIANTS = {
  aiLimit: [
    "On a beaucoup parlé aujourd'hui : je garde les commandes simples jusqu'à demain.",
    "On a beaucoup échangé aujourd'hui. Jusqu'à demain, je ne prends plus que les commandes simples.",
    "Grosse journée de messages : d'ici demain, je ne réponds plus qu'aux commandes simples.",
  ],
} satisfies VoiceTable;

export const TEAM_MEMBER_TEAMS: readonly TeamMemberTeam[] = ["dating", "casino", "sports", "algo", "ads"];
export const TEAM_MEMBER_KINDS: readonly TeamMemberKind[] = ["media", "secret", "choice", "validation"];

export const MEMBER_TEAM_LABELS: Record<TeamMemberTeam, string> = {
  dating: "Rencontres",
  casino: "Casino",
  sports: "Paris sportifs",
  algo: "Algorithme",
  ads: "Pubs",
};
export const MEMBER_KIND_LABELS: Record<TeamMemberKind, string> = {
  media: "les vidéos et photos",
  secret: "les clés et mots de passe",
  choice: "les choix",
  validation: "les posts à valider",
};

/** `Setting` : prénom et nom d'utilisateur de l'admin vus par Kevin (mention dans le groupe). */
export const BOSS_ADMIN_PROFILE_SETTING = "boss.adminProfile";
/** `Setting` : personnes vues dans le groupe (identifiant, prénom, nom d'utilisateur ; 80 au plus). */
export const BOSS_GROUP_SEEN_SETTING = "boss.group.seen";
/** `Setting` : présentations en attente (« voici @lea » alors que Léa n'a encore jamais écrit). */
export const BOSS_PENDING_INTROS_SETTING = "boss.group.pendingIntros";
const SEEN_MAX = 80;

export type TeamMemberRole = "ADMIN" | "MANAGER" | "MEMBER";
export type MemberNote = { at: string; text: string; by: string | null };

export type TeamMemberRow = {
  id: string;
  telegramUserId: bigint;
  username: string | null;
  firstName: string;
  role: TeamMemberRole;
  roleLabel: string | null;
  responsibilities: unknown;
  available: boolean;
  awayUntil: Date | null;
  notes: unknown;
  startedPrivateAt: Date | null;
  introducedByTelegramId: bigint | null;
  removedAt: Date | null;
  createdAt: Date;
};

const isTeam = (v: unknown): v is TeamMemberTeam => typeof v === "string" && (TEAM_MEMBER_TEAMS as readonly string[]).includes(v);
const isKind = (v: unknown): v is TeamMemberKind => typeof v === "string" && (TEAM_MEMBER_KINDS as readonly string[]).includes(v);

/** Responsabilités valides d'une ligne `TeamMember` (pur). */
export function responsibilitiesOf(v: unknown): TeamResponsibilities {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const teams = Array.isArray(o.teams) ? [...new Set(o.teams.filter(isTeam))] : [];
  const kinds = Array.isArray(o.kinds) ? [...new Set(o.kinds.filter(isKind))] : [];
  return { teams, kinds };
}

/** Notes datées d'un membre (pur). */
export function notesOf(v: unknown): MemberNote[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n) => ({ at: String(n.at ?? ""), text: String(n.text ?? "").slice(0, 300), by: typeof n.by === "string" ? n.by : null }))
    .filter((n) => n.text.length > 0);
}

/** Le membre couvre-t-il cette équipe et cette nature ? Sans équipe notée : toutes ; sans nature notée : toutes (pur). */
export function covers(resp: TeamResponsibilities, team: TeamMemberTeam | null, kind: TeamMemberKind | null): boolean {
  if (resp.teams.length === 0 && resp.kinds.length === 0) return false;
  const teamOk = team === null ? resp.teams.length === 0 : resp.teams.length === 0 || resp.teams.includes(team);
  const kindOk = kind === null || resp.kinds.length === 0 || resp.kinds.includes(kind);
  return teamOk && kindOk;
}

/** Disponible maintenant : présent dans l'équipe, pas marqué indisponible, pas absent jusqu'à une date future (pur). */
export function isMemberAvailable(m: Pick<TeamMemberRow, "removedAt" | "available" | "awayUntil">, now: Date): boolean {
  if (m.removedAt) return false;
  if (!m.available) return false;
  return !(m.awayUntil && m.awayUntil.getTime() > now.getTime());
}

/** Nature d'une demande au client → nature de responsabilité (pur). */
export function kindForRequest(kind: string): TeamMemberKind {
  if (kind === "SECRET") return "secret";
  if (kind === "MEDIA") return "media";
  return "choice";
}

/** Équipe d'une demande ou d'une validation (`teamKey`) → équipe de responsabilité, ou null (pur). */
export function teamForKey(teamKey: string | null | undefined): TeamMemberTeam | null {
  return isTeam(teamKey) ? teamKey : null;
}

export async function activeTeamMembers(deps: Pick<AgentsDeps, "prisma">): Promise<TeamMemberRow[]> {
  return (await deps.prisma.teamMember.findMany({ where: { removedAt: null }, orderBy: { createdAt: "asc" } })) as TeamMemberRow[];
}

/** Membre présenté (non retiré) par son identifiant Telegram, ou null. */
export async function findTeamMember(deps: Pick<AgentsDeps, "prisma">, telegramUserId: bigint): Promise<TeamMemberRow | null> {
  const m = (await deps.prisma.teamMember.findUnique({ where: { telegramUserId } })) as TeamMemberRow | null;
  return m && !m.removedAt ? m : null;
}

export type ResponsiblePick = {
  /** Membre choisi ; null = l'admin. */
  assignee: TeamMemberRow | null;
  /** Membres qui couvrent le sujet mais sont indisponibles (Kevin le dit). */
  unavailable: TeamMemberRow[];
};

/**
 * Responsable d'une demande ou d'une validation : le premier membre disponible (présenté le plus tôt ; un membre
 * « MEMBER » passe avant un responsable, plus général) dont les responsabilités couvrent l'équipe et la nature, sinon
 * l'admin (null).
 */
export function pickResponsibleFrom(members: readonly TeamMemberRow[], team: TeamMemberTeam | null, kind: TeamMemberKind | null, now: Date): ResponsiblePick {
  const candidates = members
    .filter((m) => !m.removedAt && covers(responsibilitiesOf(m.responsibilities), team, kind))
    .sort((a, b) => {
      // Le plus précis d'abord : équipe nommée avant « toutes les équipes », nature nommée avant « tout ».
      const ra = responsibilitiesOf(a.responsibilities);
      const rb = responsibilitiesOf(b.responsibilities);
      const sa = (ra.teams.length ? 0 : 2) + (ra.kinds.length ? 0 : 1);
      const sb = (rb.teams.length ? 0 : 2) + (rb.kinds.length ? 0 : 1);
      return sa - sb || a.createdAt.getTime() - b.createdAt.getTime();
    });
  const unavailable: TeamMemberRow[] = [];
  for (const m of candidates) {
    if (isMemberAvailable(m, now)) return { assignee: m, unavailable };
    unavailable.push(m);
  }
  return { assignee: null, unavailable };
}

export async function pickResponsible(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  input: { teamKey: string | null | undefined; kind: TeamMemberKind },
): Promise<ResponsiblePick> {
  const members = await activeTeamMembers(deps);
  return pickResponsibleFrom(members, teamForKey(input.teamKey), input.kind, nowOf(deps));
}

/** Mention HTML : `@username` si connu, sinon lien `tg://user?id=` (Telegram notifie la personne) (pur). */
export function mentionHtml(p: { telegramUserId: bigint | string; username?: string | null; firstName?: string | null }): string {
  if (p.username && /^[A-Za-z0-9_]{3,40}$/.test(p.username)) return `@${p.username}`;
  return `<a href="tg://user?id=${String(p.telegramUserId)}">${esc(p.firstName?.trim() || "toi")}</a>`;
}

export type AdminProfile = { firstName: string | null; username: string | null };

export async function readAdminProfile(deps: Pick<AgentsDeps, "prisma">): Promise<AdminProfile> {
  const v = (await readSetting(deps, BOSS_ADMIN_PROFILE_SETTING)) as Partial<AdminProfile> | undefined;
  return {
    firstName: typeof v?.firstName === "string" && v.firstName.trim() ? v.firstName.trim().slice(0, 40) : null,
    username: typeof v?.username === "string" && v.username.trim() ? v.username.trim() : null,
  };
}

/** Mémorise le prénom et le nom d'utilisateur de l'admin (seulement s'ils changent). Ne lève jamais. */
export async function rememberAdminProfile(deps: Pick<AgentsDeps, "prisma" | "logger">, p: AdminProfile): Promise<void> {
  try {
    const cur = await readAdminProfile(deps);
    const next = { firstName: p.firstName?.trim() || cur.firstName, username: p.username?.trim() || cur.username };
    if (next.firstName === cur.firstName && next.username === cur.username) return;
    await writeSetting(deps, BOSS_ADMIN_PROFILE_SETTING, next);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] profil de l'admin non mémorisé");
  }
}

/** Prénom de l'admin pour les phrases (« Ça, c'est Mathéo qui décide ») ; « l'admin » s'il est inconnu. */
export async function adminFirstName(deps: Pick<AgentsDeps, "prisma">): Promise<string> {
  return (await readAdminProfile(deps)).firstName ?? "l'admin";
}

/** Mention de l'admin dans le groupe. */
export async function adminMention(deps: Pick<AgentsDeps, "prisma">): Promise<string> {
  const [id, profile] = await Promise.all([adminTelegramId(deps), readAdminProfile(deps)]);
  if (!id) return esc(profile.firstName ?? "l'admin");
  return mentionHtml({ telegramUserId: id, username: profile.username, firstName: profile.firstName ?? "admin" });
}

/** Mention du responsable (membre) ou de l'admin (null). */
export async function responsibleMention(deps: Pick<AgentsDeps, "prisma">, m: TeamMemberRow | null): Promise<string> {
  return m ? mentionHtml(m) : adminMention(deps);
}

// ------------------------------------------------------------------------------------------- personnes vues

export type SeenPerson = {
  id: string;
  firstName: string | null;
  username: string | null;
  at: string;
  /** Jour (Paris) du dernier « je ne te connais pas encore ». */
  unknownDay?: string | null;
  /** Jour (Paris) du dernier avertissement « clé effacée » à une personne non présentée. */
  secretDay?: string | null;
};

function seenList(v: unknown): SeenPerson[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is SeenPerson => !!p && typeof p === "object" && typeof (p as SeenPerson).id === "string" && /^\d+$/.test((p as SeenPerson).id));
}

export async function readSeenPeople(deps: Pick<AgentsDeps, "prisma">): Promise<SeenPerson[]> {
  return seenList(await readSetting(deps, BOSS_GROUP_SEEN_SETTING));
}

/**
 * Note qu'une personne a écrit dans le groupe (identifiant, prénom, nom d'utilisateur, jamais le texte). Rend sa fiche.
 * Ne lève jamais.
 */
export async function rememberSeenPerson(
  deps: Pick<AgentsDeps, "prisma" | "now" | "logger">,
  p: { id: bigint; firstName?: string | null; username?: string | null },
): Promise<SeenPerson | null> {
  try {
    const list = await readSeenPeople(deps);
    const id = p.id.toString();
    const prev = list.find((x) => x.id === id);
    // Nom d'utilisateur tel que Telegram le montre MAINTENANT (null s'il n'en a plus) : jamais un ancien nom gardé,
    // qu'une autre personne aurait pu prendre depuis.
    const username = p.username === undefined ? (prev?.username ?? null) : p.username?.trim() || null;
    const entry: SeenPerson = {
      id,
      firstName: p.firstName?.trim() || prev?.firstName || null,
      username,
      at: nowOf(deps).toISOString(),
      unknownDay: prev?.unknownDay ?? null,
      secretDay: prev?.secretDay ?? null,
    };
    const u = username?.toLowerCase() ?? null;
    // Un nom d'utilisateur n'appartient qu'à une personne : retiré des autres fiches.
    const clash = !!u && list.some((x) => x.id !== id && x.username?.toLowerCase() === u);
    const changed = clash || !prev || prev.firstName !== entry.firstName || prev.username !== entry.username || parisDay(new Date(prev.at)) !== parisDay(nowOf(deps));
    const others = list.filter((x) => x.id !== id).map((x) => (u && x.username?.toLowerCase() === u ? { ...x, username: null } : x));
    if (changed) await writeSetting(deps, BOSS_GROUP_SEEN_SETTING, [entry, ...others].slice(0, SEEN_MAX));
    return entry;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] personne vue non notée");
    return null;
  }
}

async function claimDaily(deps: Pick<AgentsDeps, "prisma" | "now" | "logger">, id: bigint, field: "unknownDay" | "secretDay"): Promise<boolean> {
  try {
    const day = parisDay(nowOf(deps));
    const list = await readSeenPeople(deps);
    const sid = id.toString();
    const prev = list.find((x) => x.id === sid);
    if (prev?.[field] === day) return false;
    const entry: SeenPerson = { ...(prev ?? { id: sid, firstName: null, username: null }), at: nowOf(deps).toISOString(), [field]: day };
    await writeSetting(deps, BOSS_GROUP_SEEN_SETTING, [entry, ...list.filter((x) => x.id !== sid)].slice(0, SEEN_MAX));
    return true;
  } catch {
    return false;
  }
}

/**
 * « Je ne te connais pas encore » au plus une fois par jour et par personne : rend vrai la première fois du jour (et
 * le note). Ne lève jamais (faux sur un doute).
 */
export async function claimUnknownReply(deps: Pick<AgentsDeps, "prisma" | "now" | "logger">, id: bigint): Promise<boolean> {
  return claimDaily(deps, id, "unknownDay");
}

/**
 * Clé collée dans le groupe par une personne non présentée : le message est toujours effacé, mais Kevin ne le dit
 * qu'une fois par jour et par personne (sinon : silence total). Ne lève jamais (faux sur un doute).
 */
export async function claimSecretNotice(deps: Pick<AgentsDeps, "prisma" | "now" | "logger">, id: bigint): Promise<boolean> {
  return claimDaily(deps, id, "secretDay");
}

// ------------------------------------------------------------------------------------------- coût : limite par membre

/** Messages d'un membre envoyés à l'IA (interprète) par jour au plus ; l'admin n'a que le plafond mensuel. */
export const BOSS_MEMBER_AI_DAILY_LIMIT = 30;
/** `Setting` : `{ day, counts: { <telegramUserId>: n } }` (jour de Paris). */
export const BOSS_MEMBER_AI_SETTING = "boss.team.aiTurns";
export const BOSS_MEMBER_AI_LIMIT_REPLY = TEAM_MEMBERS_VARIANTS.aiLimit[0]!;

/**
 * Compte un message d'un membre envoyé à l'IA ; rend faux si sa limite du jour est atteinte (rien n'est compté). Sur
 * une erreur de lecture : vrai (la limite mensuelle du Boss s'applique toujours).
 */
export async function claimMemberAiTurn(
  deps: Pick<AgentsDeps, "prisma" | "now" | "logger">,
  id: bigint,
  limit = BOSS_MEMBER_AI_DAILY_LIMIT,
): Promise<boolean> {
  try {
    const day = parisDay(nowOf(deps));
    const v = (await readSetting(deps, BOSS_MEMBER_AI_SETTING)) as { day?: unknown; counts?: unknown } | undefined;
    const counts: Record<string, number> = v?.day === day && v.counts && typeof v.counts === "object" ? { ...(v.counts as Record<string, number>) } : {};
    const sid = id.toString();
    const n = Number(counts[sid] ?? 0) || 0;
    if (n >= limit) return false;
    counts[sid] = n + 1;
    await writeSetting(deps, BOSS_MEMBER_AI_SETTING, { day, counts });
    return true;
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] limite du jour d'un membre non lue");
    return true;
  }
}

// ------------------------------------------------------------------------------------------- présentations en attente

export type PendingIntro = {
  username: string | null;
  firstName: string | null;
  roleLabel: string | null;
  teams: TeamMemberTeam[];
  kinds: TeamMemberKind[];
  role: TeamMemberRole;
  by: string | null;
  at: string;
};

export async function readPendingIntros(deps: Pick<AgentsDeps, "prisma">): Promise<PendingIntro[]> {
  const v = await readSetting(deps, BOSS_PENDING_INTROS_SETTING);
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as PendingIntro[]) : [];
}

export async function addPendingIntro(deps: Pick<AgentsDeps, "prisma">, intro: PendingIntro): Promise<void> {
  const key = (i: PendingIntro) => (i.username ? `@${i.username.toLowerCase()}` : `#${(i.firstName ?? "").toLowerCase()}`);
  const list = (await readPendingIntros(deps)).filter((i) => key(i) !== key(intro));
  await writeSetting(deps, BOSS_PENDING_INTROS_SETTING, [intro, ...list].slice(0, 20));
}

/** Présentation en attente qui correspond à cette personne (par nom d'utilisateur), retirée de la liste. */
export async function takePendingIntro(
  deps: Pick<AgentsDeps, "prisma" | "now">,
  p: { username?: string | null },
): Promise<PendingIntro | null> {
  if (!p.username) return null;
  const list = await readPendingIntros(deps);
  const u = p.username.toLowerCase();
  // Une présentation reste valable 30 jours.
  const limit = nowOf(deps).getTime() - 30 * 86_400_000;
  const hit = list.find((i) => i.username?.toLowerCase() === u && new Date(i.at).getTime() >= limit);
  if (!hit) return null;
  await writeSetting(deps, BOSS_PENDING_INTROS_SETTING, list.filter((i) => i !== hit));
  return hit;
}

// ------------------------------------------------------------------------------------------- textes

/** « vidéos casino et posts roulette » ou, à défaut, « Casino · les vidéos et photos » (pur). */
export function memberDutyText(m: { roleLabel: string | null; responsibilities: unknown }): string {
  if (m.roleLabel?.trim()) return m.roleLabel.trim();
  const r = responsibilitiesOf(m.responsibilities);
  const teams = r.teams.map((t) => MEMBER_TEAM_LABELS[t]).join(", ");
  const kinds = r.kinds.map((k) => MEMBER_KIND_LABELS[k]).join(", ");
  return [teams, kinds].filter(Boolean).join(" · ") || "rien de précis pour l'instant";
}

const PARIS_DATE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });

/** « lundi 26 octobre » (Paris) (pur). */
export function parisDateLabel(d: Date): string {
  return PARIS_DATE.format(d);
}

/** Une ligne de « qui fait quoi ? » (pur). */
export function memberLine(m: TeamMemberRow, now: Date): string {
  const role = m.role === "MANAGER" ? " (responsable)" : m.role === "ADMIN" ? " (administrateur)" : "";
  const away = m.awayUntil && m.awayUntil.getTime() > now.getTime() ? ` — absent·e jusqu'au ${parisDateLabel(m.awayUntil)}` : !m.available ? " — indisponible" : "";
  return `• ${esc(m.firstName)}${m.username ? ` (@${esc(m.username)})` : ""}${role} : ${esc(memberDutyText(m))}${away}`;
}
