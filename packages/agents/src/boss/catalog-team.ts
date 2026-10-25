/**
 * Entrées du catalogue du Boss pour l'équipe du groupe (phase 26, section 4) : présenter, modifier, retirer un membre,
 * « qui fait quoi ? », et (cachée, jamais proposée à l'IA) le changement de groupe confirmé par l'admin en privé.
 * L'identifiant Telegram d'une personne vient TOUJOURS de Telegram (mention cliquable avec identifiant, nom
 * d'utilisateur déjà vu par Kevin, membre déjà noté), jamais d'un texte inventé par l'IA. Un PRÉNOM seul (prénom
 * Telegram, libre) ou une présentation en attente (« voici @lea » avant que Léa n'écrive) n'enregistre rien sans un OUI
 * de l'admin, qui voit @nom, prénom et identifiant (`confirmer_membre`, cachée). Droits : `team/rights.ts`.
 */
import { esc, nowOf } from "../admin/journal";
import type { BossAction, BossDeps, BossReply, BossSpeaker, TeamMemberKind, TeamMemberTeam } from "./contract";
import type { BossExecDeps } from "./catalog-read";
import { defineAction, lines } from "./catalog-kit";
import { bool, str } from "./params";
import { normName } from "./resolve";
import type { MentionRef } from "./team/addressed";
import {
  MEMBER_KIND_LABELS,
  TEAM_MEMBER_KINDS,
  TEAM_MEMBER_TEAMS,
  activeTeamMembers,
  addPendingIntro,
  adminFirstName,
  isMemberAvailable,
  memberDutyText,
  memberLine,
  notesOf,
  parisDateLabel,
  pickResponsibleFrom,
  readSeenPeople,
  responsibilitiesOf,
  type TeamMemberRole,
  type TeamMemberRow,
} from "./team/members";
import { parseKindList, parseReturnDate, parseTeamList } from "./team/parse";
import { activeBossGroup, claimDeleteRightAsk, claimGroupWelcome, groupReplacementSummary, readBossGroupId, setBossGroup } from "./team/group";
import { adminTelegramId } from "../admin/journal";
import { createBossPending, rememberBossPendingMessage } from "./confirm";
import { pick, voiceTemplate, type VoiceTable } from "./voice";

type Who = { name: string };
const LEA: Who = { name: "Léa" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/**
 * Textes de Kevin pour l'équipe (charte `docs/KEVIN-VOIX.md`, contrôlés par `voice.test.ts`). Les valeurs passées aux
 * modèles sont déjà échappées, sauf les questions OUI / NON (`confirm*`, `groupe`) : `createBossPending` les échappe.
 */
export const CATALOG_TEAM_VARIANTS = {
  ambiguous: voiceTemplate([{ names: "Léa (@lea), Léa (@lea_casino)" }], (p) => [
    `Plusieurs personnes possibles : ${p.names}. Mentionne la bonne avec @.`,
    `J'en vois plusieurs : ${p.names}. Tu mentionnes la bonne avec @ ?`,
  ]),
  uncertain: ["Mentionne la personne avec @ : je ne me fie pas à un prénom seul.", "Un prénom seul ne me suffit pas : mentionne la personne avec @."],
  unseen: voiceTemplate([{ user: "lea", boss: "Kevin" }], (p) => [
    `Je n'ai encore jamais vu @${p.user} écrire ici.\n@${p.user}, dis-moi juste « ${p.boss}, salut » et c'est réglé.`,
    `Je n'ai jamais vu @${p.user} écrire ici pour l'instant.\n@${p.user}, écris juste « ${p.boss}, salut » et c'est bon.`,
  ]),
  unknown: [
    "Je ne vois pas de qui tu parles : mentionne la personne avec @ (« voici @lea »), ou demande-lui de m'écrire un mot ici.",
    "Je ne vois pas qui c'est. Tu la mentionnes avec @ (« voici @lea ») ? Sinon, demande-lui de m'écrire un mot ici.",
  ],
  teamUnknownFull: voiceTemplate([{ team: "cuisine" }], (p) => [
    `Je ne connais pas cette équipe (${p.team}). Équipes : Rencontres, Casino, Paris sportifs, Algorithme, Pubs.`,
    `« ${p.team} », je ne connais pas comme équipe. J'ai Rencontres, Casino, Paris sportifs, Algorithme et Pubs.`,
  ]),
  teamUnknownShort: voiceTemplate([{ team: "cuisine" }], (p) => [`Je ne connais pas cette équipe : ${p.team}.`, `Équipe inconnue pour moi : ${p.team}.`]),
  self: ["Toi, je te connais déjà : tu as tous les droits 🙂", "Toi, pas besoin : tu as déjà tous les droits."],
  adminDecides: voiceTemplate([{ name: "Mathéo" }, { name: "l'admin" }], (p: Who) => [
    `Ça, c'est ${p.name} qui décide.`,
    `C'est ${p.name} qui décide pour ça.`,
    `Ça, il faut voir avec ${p.name}.`,
  ]),
  introduced: voiceTemplate(
    [
      { first: "Léa", duty: "vidéos casino et posts roulette", asks: "les vidéos et photos", manager: false },
      { first: "Marc", duty: "Paris sportifs · les clés et mots de passe", asks: "", manager: true },
    ],
    (p: { first: string; duty: string; asks: string; manager: boolean }) => [
      `Noté : ${p.first}, ${p.duty}.${p.asks ? ` Je lui demanderai ${p.asks} directement.` : ""}${p.manager ? ` ${p.first} peut aussi me présenter des gens.` : ""}`,
      `C'est noté : ${p.first}, ${p.duty}.${p.asks ? ` Pour ${p.asks}, je passerai par ${p.first}.` : ""}${p.manager ? ` ${p.first} pourra aussi me présenter des gens.` : ""}`,
    ],
  ),
  notPresented: voiceTemplate([{ name: "Léa", user: "lea" }, { name: "Cette personne", user: "nom" }], (p) => [
    `${p.name} ne m'a pas encore été présenté·e. Dis par exemple « voici @${p.user}, elle s'occupe de … ».`,
    `Je ne connais pas encore ${p.name} dans l'équipe. Présente-moi la personne d'abord, par exemple « voici @${p.user}, elle s'occupe de … ».`,
  ]),
  askDate: [
    "Absente jusqu'à quand ? Dis par exemple « jusqu'à lundi » ou « jusqu'au 26/10 ».",
    "Jusqu'à quand ? Dis-moi par exemple « jusqu'à lundi » ou « jusqu'au 26/10 ».",
  ],
  nothingChanges: voiceTemplate([LEA], (p: Who) => [
    `Qu'est-ce qui change pour ${p.name} ? (tâches, absente jusqu'au…, de retour, une note)`,
    `Je change quoi pour ${p.name} ? Ses tâches, une absence, son retour ou une note ?`,
  ]),
  edited: voiceTemplate(
    [
      { name: "Léa", said: "absent·e jusqu'au lundi 26 octobre", extra: " En attendant, je passe par Marc." },
      { name: "Léa", said: "note : « préviens-moi le matin »", extra: "" },
    ],
    (p) => [`Noté : ${p.name}, ${p.said}.${p.extra}`, `C'est fait : ${p.name}, ${p.said}.${p.extra}`],
  ),
  replacedBy: voiceTemplate([{ name: "Marc" }], (p: Who) => [` En attendant, je passe par ${p.name}.`, ` D'ici là, je passe par ${p.name}.`]),
  replacedByAdmin: voiceTemplate([{ name: "Mathéo" }], (p: Who) => [` En attendant, je demande à ${p.name}.`, ` D'ici là, je demande à ${p.name}.`]),
  alreadyOut: voiceTemplate([LEA], (p: Who) => [`${p.name} ne fait déjà pas partie de l'équipe.`, `${p.name} n'est déjà plus dans l'équipe.`]),
  removed: voiceTemplate([LEA], (p: Who) => [
    `Noté : ${p.name} ne fait plus partie de l'équipe. Je ne lui demanderai plus rien.`,
    `Fait : ${p.name} n'est plus dans l'équipe, je ne lui demande plus rien.`,
  ]),
  whoEmpty: [
    "Personne ne m'a encore été présenté.\nDis-moi par exemple « Kevin, voici @lea, elle s'occupe des vidéos casino ».",
    "On ne m'a encore présenté personne.\nDis-moi par exemple « Kevin, voici @lea, elle s'occupe des vidéos casino ».",
  ],
  /** « qui fait quoi ? » : une liste demandée (une ligne par personne, 16 au plus). */
  whoList: voiceTemplate(
    [
      { n: 1, lines: "• Léa (@lea) : vidéos casino et posts roulette", admin: "Mathéo" },
      {
        n: 9,
        lines: Array.from({ length: 9 }, (_, i) => `• Personne ${i + 1} (@p${i + 1}) (responsable) : Casino · les vidéos et photos — absent·e jusqu'au lundi 26 octobre`).join("\n"),
        admin: "l'admin",
      },
    ],
    (p) => [
      `${plural(p.n, "personne")} dans l'équipe :\n${p.lines}\n• ${p.admin} : tout le reste, et c'est lui qui confirme.`,
      `Dans l'équipe, on est ${p.n} :\n${p.lines}\n• ${p.admin} : tout le reste, c'est lui qui confirme.`,
    ],
    { allowList: true, allowLong: true },
  ),
  checking: voiceTemplate([{ admin: "Mathéo", first: "Léa" }], (p) => [
    `Je vérifie avec ${p.admin} avant de noter ${p.first} 👍`,
    `Je vois avec ${p.admin} avant de noter ${p.first}.`,
  ]),
  /** Question OUI / NON (2 lignes, texte brut). */
  confirmWaiting: voiceTemplate(
    [{ who: "@lea", identity: "@lea, prénom « Léa », identifiant 777", first: "Léa", duty: "vidéos casino" }],
    (p) => [
      `${p.who} vient d'écrire (${p.identity}) : c'est bien la personne que tu m'as présentée ?\nJe la note alors : ${p.first}, ${p.duty}.`,
      `${p.who} vient d'écrire (${p.identity}). C'est bien la personne que tu m'as présentée ?\nSi oui, je note : ${p.first}, ${p.duty}.`,
    ],
  ),
  /** Question OUI / NON (2 lignes, texte brut). */
  confirmFirstName: voiceTemplate(
    [{ said: "Sam", identity: "sans nom d'utilisateur, prénom « Sam », identifiant 999", first: "Sam", duty: "vidéos casino" }],
    (p) => [
      `« ${p.said} », c'est bien cette personne (${p.identity}) ?\nJe la note alors : ${p.first}, ${p.duty}.`,
      `Quand tu dis « ${p.said} », c'est bien cette personne : ${p.identity} ?\nSi oui, je note : ${p.first}, ${p.duty}.`,
    ],
  ),
  confirmSummarize: voiceTemplate([{ first: "Sam", id: "999" }], (p) => [`Noter ${p.first} (identifiant ${p.id}) dans l'équipe ?`, `J'ajoute ${p.first} (identifiant ${p.id}) à l'équipe ?`]),
  welcomeMember: voiceTemplate([LEA], (p: Who) => [`Bienvenue ${p.name} 👋`, `Bienvenue dans l'équipe, ${p.name} !`]),
  groupSet: voiceTemplate([{ title: "Équipe Casino" }], (p) => [`C'est noté : je travaille maintenant dans « ${p.title} ».`, `Fait : je bosse maintenant dans « ${p.title} ».`]),
} satisfies VoiceTable;

/** Conversation en cours (rotation des tournures), ou null. */
function chatOf(deps: BossDeps): bigint | null {
  return (deps as BossExecDeps).chat?.chatId ?? null;
}

async function adminDecides(deps: BossDeps): Promise<BossReply> {
  return { reply: pick(CATALOG_TEAM_VARIANTS.adminDecides({ name: esc(await adminFirstName(deps)) }), "team.adminDecides", chatOf(deps)) };
}

function selfReply(deps: BossDeps): BossReply {
  return { reply: pick(CATALOG_TEAM_VARIANTS.self, "team.self", chatOf(deps)) };
}

const PERSON_DESC =
  "La personne : « @nom » tel qu'écrit, son prénom, ou « moi » si la personne parle d'elle-même. Recopie tel quel, n'invente jamais d'identifiant";

type Person = { id: bigint; username: string | null; firstName: string | null };
type Found =
  | { kind: "found"; person: Person; member: TeamMemberRow | null }
  /** Retrouvée par son prénom Telegram seulement (libre, n'importe qui peut le porter) : rien sans un OUI de l'admin. */
  | { kind: "uncertain"; person: Person }
  | { kind: "unseen"; username: string }
  | { kind: "unknown"; raw: string }
  | { kind: "ambiguous"; names: string[] };

function speakerOf(deps: BossDeps): BossSpeaker | null {
  return (deps as BossExecDeps).speaker ?? null;
}
function mentionsOfDeps(deps: BossDeps): MentionRef[] {
  return (deps as BossExecDeps).mentions ?? [];
}

const SELF = new Set(["moi", "me", "je", "moi meme", "myself"]);

/** Retrouve la personne visée, uniquement à partir de ce que Telegram a montré à Kevin. */
export async function findPerson(deps: BossDeps, raw: string | undefined): Promise<Found> {
  const members = (await deps.prisma.teamMember.findMany({ orderBy: { createdAt: "asc" } })) as TeamMemberRow[];
  const memberOf = (id: bigint) => members.find((m) => m.telegramUserId === id) ?? null;
  const mentions = mentionsOfDeps(deps);
  const text = (raw ?? "").trim();
  const speaker = speakerOf(deps);
  if (!text && mentions.length === 1) return personFromMention(deps, mentions[0]!, members);
  if (SELF.has(normName(text))) {
    if (!speaker) return { kind: "unknown", raw: text };
    return { kind: "found", person: { id: speaker.telegramUserId, username: null, firstName: speaker.firstName }, member: memberOf(speaker.telegramUserId) };
  }
  const username = /^@([A-Za-z0-9_]{3,40})$/.exec(text)?.[1] ?? null;
  if (username) {
    const m = mentions.find((x) => x.username?.toLowerCase() === username.toLowerCase());
    return personFromMention(deps, m ?? { username }, members);
  }
  // Prénom : mention cliquable portant ce prénom (identifiant donné par Telegram), membre déjà noté (même retiré : on
  // le reprend), sinon personne vue dans le groupe avec ce prénom — INCERTAIN (un prénom Telegram est libre).
  const n = normName(text);
  const byMention = mentions.filter((x) => x.telegramUserId && normName(x.firstName ?? "") === n);
  if (byMention.length === 1) return personFromMention(deps, byMention[0]!, members);
  const active = members.filter((m) => !m.removedAt && (normName(m.firstName) === n || normName(m.username ?? "") === n));
  if (active.length === 1) return { kind: "found", person: { id: active[0]!.telegramUserId, username: active[0]!.username, firstName: active[0]!.firstName }, member: active[0]! };
  if (active.length > 1) return { kind: "ambiguous", names: active.map((m) => `${m.firstName}${m.username ? ` (@${m.username})` : ""}`) };
  const admin = await adminTelegramId(deps);
  const seen = (await readSeenPeople(deps)).filter((p) => (normName(p.firstName ?? "") === n || normName(p.username ?? "") === n) && BigInt(p.id) !== admin);
  const removed = members.filter((m) => normName(m.firstName) === n);
  if (removed.length === 1) return { kind: "found", person: { id: removed[0]!.telegramUserId, username: removed[0]!.username, firstName: removed[0]!.firstName }, member: removed[0]! };
  if (seen.length === 1) return { kind: "uncertain", person: { id: BigInt(seen[0]!.id), username: seen[0]!.username, firstName: seen[0]!.firstName } };
  if (seen.length > 1) return { kind: "ambiguous", names: seen.map((p) => `${p.firstName ?? "?"}${p.username ? ` (@${p.username})` : ""}`) };
  return { kind: "unknown", raw: text };
}

async function personFromMention(deps: BossDeps, m: MentionRef, members: TeamMemberRow[]): Promise<Found> {
  if (m.telegramUserId) {
    const member = members.find((x) => x.telegramUserId === m.telegramUserId) ?? null;
    return { kind: "found", person: { id: m.telegramUserId, username: m.username ?? null, firstName: m.firstName ?? null }, member };
  }
  const u = (m.username ?? "").toLowerCase();
  if (!u) return { kind: "unknown", raw: "" };
  // Nom d'utilisateur (unique chez Telegram) : membre actif, sinon personne vue (nom tel que Telegram l'a montré),
  // sinon ancien membre ; jamais par prénom.
  const member = members.find((x) => !x.removedAt && x.username?.toLowerCase() === u);
  if (member) return { kind: "found", person: { id: member.telegramUserId, username: member.username, firstName: member.firstName }, member };
  const seen = (await readSeenPeople(deps)).find((p) => p.username?.toLowerCase() === u);
  if (seen) {
    const id = BigInt(seen.id);
    return { kind: "found", person: { id, username: seen.username, firstName: seen.firstName }, member: members.find((x) => x.telegramUserId === id) ?? null };
  }
  const old = members.find((x) => x.username?.toLowerCase() === u);
  if (old) return { kind: "found", person: { id: old.telegramUserId, username: old.username, firstName: old.firstName }, member: old };
  return { kind: "unseen", username: m.username! };
}

function notFoundReply(f: Exclude<Found, { kind: "found" }>, chatId: bigint | null, bossName = "Kevin"): BossReply {
  if (f.kind === "ambiguous") return { reply: pick(CATALOG_TEAM_VARIANTS.ambiguous({ names: f.names.map(esc).join(", ") }), "team.ambiguous", chatId) };
  if (f.kind === "uncertain") return { reply: pick(CATALOG_TEAM_VARIANTS.uncertain, "team.uncertain", chatId) };
  if (f.kind === "unseen") return { reply: pick(CATALOG_TEAM_VARIANTS.unseen({ user: esc(f.username), boss: esc(bossName) }), "team.unseen", chatId) };
  return { reply: pick(CATALOG_TEAM_VARIANTS.unknown, "team.unknown", chatId) };
}

const TEAM_WORDS: ReadonlyArray<readonly [RegExp, TeamMemberTeam]> = [
  [/\b(casino|roulette|slots?|machines? a sous|blackjack|poker)\b/u, "casino"],
  [/\b(rencontres?|dating|personas?)\b/u, "dating"],
  [/\b(paris|pari|cotes?|sportaza|bookmakers?|foot|sports?|match)\b/u, "sports"],
  [/\b(algo|algorithme|horaires|tests? a\/?b)\b/u, "algo"],
  [/\b(pubs?|ads|meta|tiktok|publicites?)\b/u, "ads"],
];
const KIND_WORDS: ReadonlyArray<readonly [RegExp, TeamMemberKind]> = [
  [/\b(videos?|photos?|medias?|images?|visuels?|rushs?|contenus?)\b/u, "media"],
  [/\b(cles?|mots? de passe|mdp|identifiants?|comptes?|jetons?|acces)\b/u, "secret"],
  [/\b(choix|decisions?|cotes?|reglages?)\b/u, "choice"],
  [/\b(validations?|valider|relecture|relit|relire|posts? a valider)\b/u, "validation"],
];

/** Équipes et natures déduites d'une phrase de rôle (« vidéos casino et posts roulette ») (pur). */
export function dutiesFromText(text: string): { teams: TeamMemberTeam[]; kinds: TeamMemberKind[] } {
  const n = normName(text);
  return {
    teams: [...new Set(TEAM_WORDS.filter(([re]) => re.test(n)).map(([, t]) => t))],
    kinds: [...new Set(KIND_WORDS.filter(([re]) => re.test(n)).map(([, k]) => k))],
  };
}

function kindsPhrase(kinds: readonly TeamMemberKind[]): string {
  const ls = kinds.map((k) => MEMBER_KIND_LABELS[k]);
  return ls.length <= 1 ? (ls[0] ?? "") : `${ls.slice(0, -1).join(", ")} et ${ls[ls.length - 1]}`;
}

function speakerName(s: BossSpeaker | null): string | null {
  return s ? (s.kind === "member" ? s.firstName : s.firstName) : null;
}

// ------------------------------------------------------------------------------------------- presenter_membre

type PresentP = { personne: string; prenom?: string; role?: string; equipes?: string; natures?: string; responsable?: boolean };

export const presenterMembre = defineAction<PresentP>({
  key: "presenter_membre",
  description: "Retenir une personne de l'équipe présentée par l'admin : qui elle est, ce dont elle s'occupe (équipes, médias, clés, choix, validations)",
  theme: "guide",
  cls: "immediate",
  spec: {
    personne: str(PERSON_DESC, { maxLength: 60 }),
    prenom: str("Son prénom, s'il est dit", { optional: true, maxLength: 40 }),
    role: str("Ce qu'elle fait, en une ligne, avec les mots de l'admin (« vidéos casino et posts roulette »)", { optional: true, maxLength: 160 }),
    equipes: str("Équipes dont elle s'occupe, séparées par des virgules : rencontres, casino, paris sportifs, algorithme, pubs", { optional: true }),
    natures: str("Ce qu'on peut lui demander, séparé par des virgules : médias, clés, choix, validations", { optional: true }),
    responsable: bool("Vrai seulement si l'admin dit qu'elle est responsable (manager) et peut présenter des gens", true),
  },
  async execute(deps, p, actor) {
    const f = await findPerson(deps, p.personne);
    const speaker = speakerOf(deps);
    const teamsParsed = parseTeamList(p.equipes);
    if (!teamsParsed.ok)
      return { reply: pick(CATALOG_TEAM_VARIANTS.teamUnknownFull({ team: esc(teamsParsed.error.replace("équipe inconnue : ", "")) }), "team.teamUnknown", chatOf(deps)) };
    const fromRole = dutiesFromText(`${p.role ?? ""} ${p.equipes ?? ""} ${p.natures ?? ""}`);
    const teams = teamsParsed.teams.length ? teamsParsed.teams : fromRole.teams;
    const parsedKinds = parseKindList(p.natures);
    const kinds = parsedKinds.length ? parsedKinds : fromRole.kinds;
    // Seul l'admin nomme un responsable ; un responsable présente des membres.
    const role: TeamMemberRole = p.responsable && (!speaker || speaker.kind === "admin") ? "MANAGER" : "MEMBER";
    if (f.kind === "uncertain") {
      const admin = await adminTelegramId(deps);
      if (admin && f.person.id === admin) return selfReply(deps);
      if (speaker && speaker.kind === "member" && f.person.id === speaker.telegramUserId) return adminDecides(deps);
      // Prénom seul : l'admin confirme qui c'est (@nom, prénom, identifiant) avant que rien ne soit noté.
      return askMemberConfirmation(deps, {
        person: f.person,
        firstName: (p.prenom ?? f.person.firstName ?? f.person.username ?? "?").slice(0, 40),
        roleLabel: p.role ?? null,
        teams,
        kinds,
        role,
        by: speaker?.telegramUserId ?? null,
        reason: "prenom",
        said: p.personne,
      });
    }
    if (f.kind !== "found") {
      if (f.kind === "unseen")
        await addPendingIntro(deps, {
          username: f.username,
          firstName: p.prenom ?? null,
          roleLabel: p.role ?? null,
          teams,
          kinds,
          role,
          by: speaker?.telegramUserId.toString() ?? null,
          at: nowOf(deps).toISOString(),
        });
      return notFoundReply(f, chatOf(deps));
    }
    const admin = await adminTelegramId(deps);
    if (admin && f.person.id === admin) return selfReply(deps);
    if (speaker && speaker.kind === "member" && f.person.id === speaker.telegramUserId) return adminDecides(deps);
    const firstName = (p.prenom ?? f.person.firstName ?? f.member?.firstName ?? f.person.username ?? "?").slice(0, 40);
    const member = await upsertMember(deps, {
      person: f.person,
      firstName,
      roleLabel: p.role ?? null,
      teams,
      kinds,
      role: f.member && !f.member.removedAt && role === "MEMBER" ? f.member.role : role,
      introducedBy: speaker?.telegramUserId ?? null,
    });
    void actor;
    return introducedReply(member, chatOf(deps));
  },
});

/** « Noté : Léa, vidéos casino et posts roulette. Je lui demanderai les vidéos et photos directement. » (pur) */
export function introducedReply(m: Pick<TeamMemberRow, "firstName" | "roleLabel" | "responsibilities" | "role">, chatId: bigint | null = null): BossReply {
  const kinds = responsibilitiesOf(m.responsibilities).kinds;
  const variants = CATALOG_TEAM_VARIANTS.introduced({ first: esc(m.firstName), duty: esc(memberDutyText(m)), asks: kinds.length ? kindsPhrase(kinds) : "", manager: m.role === "MANAGER" });
  return { reply: pick(variants, "team.introduced", chatId) };
}

export async function upsertMember(
  deps: BossDeps,
  input: { person: Person; firstName: string; roleLabel: string | null; teams: TeamMemberTeam[]; kinds: TeamMemberKind[]; role: TeamMemberRole; introducedBy: bigint | null },
): Promise<TeamMemberRow> {
  const existing = (await deps.prisma.teamMember.findUnique({ where: { telegramUserId: input.person.id } })) as TeamMemberRow | null;
  const responsibilities = { teams: input.teams, kinds: input.kinds };
  if (existing) {
    const cur = responsibilitiesOf(existing.responsibilities);
    return (await deps.prisma.teamMember.update({
      where: { telegramUserId: input.person.id },
      data: {
        firstName: input.firstName,
        username: input.person.username ?? existing.username,
        roleLabel: input.roleLabel ?? (existing.removedAt ? null : existing.roleLabel),
        responsibilities: existing.removedAt || input.teams.length || input.kinds.length ? responsibilities : cur,
        role: input.role,
        removedAt: null,
        available: true,
        awayUntil: null,
      },
    })) as TeamMemberRow;
  }
  return (await deps.prisma.teamMember.create({
    data: {
      telegramUserId: input.person.id,
      username: input.person.username,
      firstName: input.firstName,
      role: input.role,
      roleLabel: input.roleLabel,
      responsibilities,
      available: true,
      notes: [],
      introducedByTelegramId: input.introducedBy,
    },
  })) as TeamMemberRow;
}

// ------------------------------------------------------------------------------------------- modifier_membre

type EditP = {
  personne: string;
  prenom?: string;
  role?: string;
  equipes?: string;
  natures?: string;
  disponible?: boolean;
  absent_jusqu_au?: string;
  note?: string;
  responsable?: boolean;
};

/** Seule une note change (un membre peut noter quelque chose sur lui-même : « préviens-moi le matin ») (pur). */
export function isNoteOnlyEdit(p: Record<string, unknown>): boolean {
  return typeof p.note === "string" && Object.keys(p).every((k) => k === "personne" || k === "note");
}

export const modifierMembre = defineAction<EditP>({
  key: "modifier_membre",
  description: "Changer ce que je sais d'une personne de l'équipe : ses tâches, absente jusqu'au…, de retour, une note datée",
  theme: "guide",
  cls: "immediate",
  spec: {
    personne: str(PERSON_DESC, { maxLength: 60 }),
    prenom: str("Nouveau prénom affiché (facultatif)", { optional: true, maxLength: 40 }),
    role: str("Nouvelle description en une ligne (facultatif)", { optional: true, maxLength: 160 }),
    equipes: str("Nouvelles équipes, séparées par des virgules (facultatif)", { optional: true }),
    natures: str("Nouvelles natures : médias, clés, choix, validations (facultatif)", { optional: true }),
    disponible: bool("Faux si elle est indisponible sans date, vrai si elle est de retour (facultatif)", true),
    absent_jusqu_au: str("Absente jusqu'à quand, tel que dit : « lundi », « demain », « 26/10 » (facultatif)", { optional: true, maxLength: 40 }),
    note: str("Note à retenir sur elle, avec ses mots (« préviens-moi le matin ») (facultatif)", { optional: true, maxLength: 200 }),
    responsable: bool("Vrai : devient responsable ; faux : redevient simple membre (facultatif, admin seulement)", true),
  },
  async execute(deps, p) {
    const f = await findPerson(deps, p.personne);
    const chatId = chatOf(deps);
    if (f.kind !== "found") return notFoundReply(f, chatId);
    const m = f.member && !f.member.removedAt ? f.member : null;
    if (!m)
      return { reply: pick(CATALOG_TEAM_VARIANTS.notPresented({ name: esc(f.person.firstName ?? "Cette personne"), user: esc(f.person.username ?? "nom") }), "team.notPresented", chatId) };
    const speaker = speakerOf(deps);
    const isAdmin = !speaker || speaker.kind === "admin";
    // Un simple membre ne touche qu'à SA fiche, et seulement pour une note : comparé par IDENTIFIANT, jamais par prénom.
    if (speaker && speaker.kind === "member" && speaker.role === "MEMBER" && (m.telegramUserId !== speaker.telegramUserId || !isNoteOnlyEdit(p as Record<string, unknown>)))
      return adminDecides(deps);
    const now = nowOf(deps);
    const data: Record<string, unknown> = {};
    const said: string[] = [];
    if (p.prenom) {
      data.firstName = p.prenom;
      said.push(`s'appelle ${p.prenom}`);
    }
    if (p.role) {
      data.roleLabel = p.role;
      said.push(p.role);
    }
    if (p.equipes !== undefined || p.natures !== undefined) {
      const cur = responsibilitiesOf(m.responsibilities);
      const t = parseTeamList(p.equipes);
      if (!t.ok) return { reply: pick(CATALOG_TEAM_VARIANTS.teamUnknownShort({ team: esc(t.error.replace("équipe inconnue : ", "")) }), "team.teamUnknownShort", chatId) };
      data.responsibilities = { teams: p.equipes !== undefined ? t.teams : cur.teams, kinds: p.natures !== undefined ? parseKindList(p.natures) : cur.kinds };
    }
    if (p.absent_jusqu_au) {
      const until = parseReturnDate(p.absent_jusqu_au, now);
      if (!until) return { reply: pick(CATALOG_TEAM_VARIANTS.askDate, "team.askDate", chatId) };
      data.awayUntil = until;
      said.push(`absent·e jusqu'au ${parisDateLabel(until)}`);
    }
    if (p.disponible === true) {
      data.available = true;
      data.awayUntil = null;
      said.push("de retour");
    } else if (p.disponible === false && !p.absent_jusqu_au) {
      data.available = false;
      said.push("indisponible pour le moment");
    }
    if (p.responsable !== undefined) {
      if (!isAdmin) return adminDecides(deps);
      data.role = p.responsable ? "MANAGER" : "MEMBER";
      said.push(p.responsable ? "responsable" : "simple membre");
    }
    if (p.note) {
      const by = speakerName(speaker) ?? "admin";
      data.notes = [...notesOf(m.notes), { at: now.toISOString(), text: p.note.slice(0, 200), by }].slice(-30);
      said.push(`note : « ${p.note.slice(0, 80)} »`);
    }
    if (!Object.keys(data).length) return { reply: pick(CATALOG_TEAM_VARIANTS.nothingChanges({ name: esc(m.firstName) }), "team.nothingChanges", chatId) };
    const updated = (await deps.prisma.teamMember.update({ where: { telegramUserId: m.telegramUserId }, data })) as TeamMemberRow;
    const extra = isMemberAvailable(updated, now) ? "" : await replacementLine(deps, updated, now, chatId);
    return { reply: pick(CATALOG_TEAM_VARIANTS.edited({ name: esc(updated.firstName), said: esc(said.join(", ")), extra }), "team.edited", chatId) };
  },
});

/** « En attendant, je passe par Marc. » / « … je te demande à toi. » quand la personne n'est plus disponible. */
async function replacementLine(deps: BossDeps, away: TeamMemberRow, now: Date, chatId: bigint | null): Promise<string> {
  const r = responsibilitiesOf(away.responsibilities);
  const others = (await activeTeamMembers(deps)).filter((m) => m.id !== away.id);
  const team = r.teams[0] ?? null;
  const kind = r.kinds[0] ?? "choice";
  const next = pickResponsibleFrom(others, team, kind, now).assignee;
  return next
    ? pick(CATALOG_TEAM_VARIANTS.replacedBy({ name: esc(next.firstName) }), "team.replacedBy", chatId)
    : pick(CATALOG_TEAM_VARIANTS.replacedByAdmin({ name: esc(await adminFirstName(deps)) }), "team.replacedByAdmin", chatId);
}

// ------------------------------------------------------------------------------------------- retirer_membre

type RemoveP = { personne: string };

export const retirerMembre = defineAction<RemoveP>({
  key: "retirer_membre",
  description: "Oublier une personne qui ne travaille plus avec l'équipe (je ne lui demande plus rien)",
  theme: "guide",
  cls: "immediate",
  spec: { personne: str(PERSON_DESC, { maxLength: 60 }) },
  async execute(deps, p) {
    const f = await findPerson(deps, p.personne);
    const chatId = chatOf(deps);
    if (f.kind !== "found") return notFoundReply(f, chatId);
    const m = f.member && !f.member.removedAt ? f.member : null;
    if (!m) return { reply: pick(CATALOG_TEAM_VARIANTS.alreadyOut({ name: esc(f.person.firstName ?? "Cette personne") }), "team.alreadyOut", chatId) };
    const speaker = speakerOf(deps);
    if (m.role !== "MEMBER" && speaker && speaker.kind !== "admin") return adminDecides(deps);
    await deps.prisma.teamMember.update({ where: { telegramUserId: m.telegramUserId }, data: { removedAt: nowOf(deps) } });
    // Ses demandes en file reviendront au bon responsable (calculé à l'envoi) ; celle posée revient à l'admin.
    await deps.prisma.humanRequest.updateMany({ where: { assigneeTelegramId: m.telegramUserId, status: { in: ["QUEUED", "PENDING"] } }, data: { assigneeTelegramId: null } });
    await deps.prisma.agentValidation.updateMany({ where: { assigneeTelegramId: m.telegramUserId, status: "PENDING" }, data: { assigneeTelegramId: null } });
    return { reply: pick(CATALOG_TEAM_VARIANTS.removed({ name: esc(m.firstName) }), "team.removed", chatId) };
  },
});

// ------------------------------------------------------------------------------------------- qui_fait_quoi

export const quiFaitQuoi = defineAction<Record<string, never>>({
  key: "qui_fait_quoi",
  description: "Dire qui fait quoi dans l'équipe (personnes présentées, leurs tâches, qui est absent)",
  theme: "guide",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const members = await activeTeamMembers(deps);
    const admin = await adminFirstName(deps);
    const chatId = chatOf(deps);
    if (!members.length) return { reply: pick(CATALOG_TEAM_VARIANTS.whoEmpty, "team.whoEmpty", chatId) };
    const now = nowOf(deps);
    const list = members
      .slice(0, 15)
      .map((m) => memberLine(m, now))
      .join("\n");
    return lines(pick(CATALOG_TEAM_VARIANTS.whoList({ n: members.length, lines: list, admin: esc(admin) }), "team.whoList", chatId));
  },
});

// ------------------------------------------------------------------------------------------- confirmer_membre (cachée)

export type MemberConfirmInput = {
  person: Person;
  firstName: string;
  roleLabel: string | null;
  teams: TeamMemberTeam[];
  kinds: TeamMemberKind[];
  role: TeamMemberRole;
  by: bigint | null;
  /** « prenom » : retrouvée par son prénom seul ; « attente » : présentation en attente, la personne vient d'écrire. */
  reason: "prenom" | "attente";
  /** Ce que l'admin a dit (« Léa »), pour la question. */
  said?: string | null;
};

/** « @lea, prénom « Léa », identifiant 7001 » (pur). */
export function personIdentityText(p: Person): string {
  return `${p.username ? `@${p.username}` : "sans nom d'utilisateur"}, prénom « ${p.firstName?.trim() || "?"} », identifiant ${p.id.toString()}`;
}

/** Les deux lignes de la question posée à l'admin (pur). */
export function memberConfirmSummary(input: MemberConfirmInput, chatId: bigint | null = null): string {
  const identity = personIdentityText(input.person);
  const duty = memberDutyText({ roleLabel: input.roleLabel, responsibilities: { teams: input.teams, kinds: input.kinds } });
  return input.reason === "attente"
    ? pick(
        CATALOG_TEAM_VARIANTS.confirmWaiting({ who: input.person.username ? `@${input.person.username}` : input.firstName, identity, first: input.firstName, duty }),
        "team.confirmWaiting",
        chatId,
      )
    : pick(CATALOG_TEAM_VARIANTS.confirmFirstName({ said: input.said?.trim() || input.firstName, identity, first: input.firstName, duty }), "team.confirmFirstName", chatId);
}

/**
 * Fait confirmer par l'admin l'identité d'une personne avant de la noter (OUI / NON, une seule confirmation à la
 * fois, 10 minutes). L'admin qui parle : la question part dans la même conversation. Sinon (un responsable, ou une
 * présentation en attente) : en privé chez l'admin.
 */
export async function askMemberConfirmation(deps: BossDeps, input: MemberConfirmInput): Promise<BossReply> {
  const params: Record<string, unknown> = {
    telegram_id: input.person.id.toString(),
    prenom: input.firstName.slice(0, 40),
    ...(input.person.username ? { username: input.person.username.slice(0, 40) } : {}),
    ...(input.roleLabel ? { role: input.roleLabel.slice(0, 160) } : {}),
    ...(input.teams.length ? { equipes: input.teams.join(",") } : {}),
    ...(input.kinds.length ? { natures: input.kinds.join(",") } : {}),
    ...(input.role === "MANAGER" ? { responsable: true } : {}),
    ...(input.by ? { par: input.by.toString() } : {}),
  };
  const summary = memberConfirmSummary(input, chatOf(deps));
  const r = await createBossPending(deps, { actionKey: "confirmer_membre", params, summary });
  const speaker = speakerOf(deps);
  if (speaker?.kind === "admin") return r;
  try {
    const sent = await deps.admin?.send(r.reply ?? summary, { buttons: r.buttons });
    if (sent && r.pendingId) await rememberBossPendingMessage(deps, r.pendingId, sent.messageId);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] confirmation d'une présentation non envoyée");
  }
  return { reply: pick(CATALOG_TEAM_VARIANTS.checking({ admin: esc(await adminFirstName(deps)), first: esc(input.firstName) }), "team.checking", chatOf(deps)) };
}

type ConfirmMemberP = { telegram_id: string; prenom: string; username?: string; role?: string; equipes?: string; natures?: string; responsable?: boolean; par?: string };

const listOf = <T extends string>(raw: string | undefined, allowed: readonly T[]): T[] =>
  [...new Set((raw ?? "").split(",").map((x) => x.trim()).filter((x): x is T => (allowed as readonly string[]).includes(x)))];

/**
 * Note une personne dont l'admin vient de confirmer l'identité. Jamais proposée à l'IA (hors catalogue visible) :
 * créée par Kevin (`askMemberConfirmation`), exécutée seulement après un OUI de l'admin.
 */
export const confirmerMembre = defineAction<ConfirmMemberP>({
  key: "confirmer_membre",
  description: "Noter une personne de l'équipe dont l'admin a confirmé l'identité",
  theme: "guide",
  cls: "confirm",
  spec: {
    telegram_id: str("Identifiant Telegram", { maxLength: 20 }),
    prenom: str("Prénom", { maxLength: 40 }),
    username: str("Nom d'utilisateur", { optional: true, maxLength: 40 }),
    role: str("Rôle en une ligne", { optional: true, maxLength: 160 }),
    equipes: str("Équipes (clés)", { optional: true, maxLength: 60 }),
    natures: str("Natures (clés)", { optional: true, maxLength: 60 }),
    responsable: bool("Responsable", true),
    par: str("Présentée par (identifiant)", { optional: true, maxLength: 20 }),
  },
  refine: (p) => (/^\d{3,20}$/.test(p.telegram_id) && (!p.par || /^\d{3,20}$/.test(p.par)) ? null : "identifiant invalide"),
  async summarize(_deps, p) {
    return pick(CATALOG_TEAM_VARIANTS.confirmSummarize({ first: p.prenom, id: p.telegram_id }), "team.confirmSummarize", null);
  },
  async execute(deps, p) {
    const id = BigInt(p.telegram_id);
    const admin = await adminTelegramId(deps);
    if (admin && id === admin) return selfReply(deps);
    const member = await upsertMember(deps, {
      person: { id, username: p.username ?? null, firstName: p.prenom },
      firstName: p.prenom,
      roleLabel: p.role ?? null,
      teams: listOf(p.equipes, TEAM_MEMBER_TEAMS),
      kinds: listOf(p.natures, TEAM_MEMBER_KINDS),
      role: p.responsable ? "MANAGER" : "MEMBER",
      introducedBy: p.par ? BigInt(p.par) : null,
    });
    const r = introducedReply(member, chatOf(deps));
    const group = await activeBossGroup(deps);
    if (group && deps.admin?.sendTo) {
      const welcome = pick(CATALOG_TEAM_VARIANTS.welcomeMember({ name: esc(member.firstName) }), "team.welcomeMember", group);
      await deps.admin.sendTo(group, `${introducedReply(member, group).reply} ${welcome}`).catch(() => null);
    }
    return r;
  },
});

// ------------------------------------------------------------------------------------------- groupe_equipe (cachée)

type GroupP = { chat_id: string; titre?: string };

/**
 * Changement de groupe de travail : jamais proposé à l'IA (hors catalogue visible) ; créé par Kevin quand l'admin
 * l'ajoute dans un second groupe, confirmé par OUI en privé.
 */
export const groupeEquipe = defineAction<GroupP>({
  key: "groupe_equipe",
  description: "Changer le groupe Telegram de l'équipe (confirmé par l'admin en privé)",
  theme: "guide",
  cls: "confirm",
  spec: { chat_id: str("Identifiant du nouveau groupe", { maxLength: 24 }), titre: str("Nom du groupe", { optional: true, maxLength: 120 }) },
  refine: (p) => (/^-\d{5,20}$/.test(p.chat_id) ? null : "identifiant de groupe invalide"),
  async summarize(deps, p) {
    const old = await readBossGroupId(deps);
    return groupReplacementSummary(p.titre ?? p.chat_id, !!old);
  },
  async execute(deps, p, actor) {
    const chatId = BigInt(p.chat_id);
    await setBossGroup(deps, { chatId, title: p.titre ?? null, byTelegramId: await adminTelegramId(deps), userId: actor.userId });
    const group = await activeBossGroup(deps);
    if (group && deps.admin?.sendTo) {
      const welcome = await claimGroupWelcome(deps, chatId, await adminFirstName(deps));
      const ask = await claimDeleteRightAsk(deps);
      for (const t of [welcome, ask]) if (t) await deps.admin.sendTo(chatId, t).catch(() => null);
    }
    return { reply: pick(CATALOG_TEAM_VARIANTS.groupSet({ title: esc(p.titre ?? p.chat_id) }), "team.groupSet", chatOf(deps)) };
  },
});

export const TEAM_MEMBER_ACTIONS: BossAction[] = [presenterMembre, modifierMembre, retirerMembre, quiFaitQuoi] as unknown as BossAction[];
/** Entrées cachées : exécutables après un OUI, jamais proposées à l'IA. */
export const HIDDEN_BOSS_ACTIONS: BossAction[] = [groupeEquipe, confirmerMembre] as unknown as BossAction[];
