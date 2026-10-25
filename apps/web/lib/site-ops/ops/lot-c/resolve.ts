/**
 * Phase 34, lot C : retrouver une campagne, un canal, une offre, un membre… par son nom OU son identifiant (Kevin dit
 * « la campagne Celsius », « Zone Interdite »). Insensible à la casse, aux accents et aux lettres stylisées des titres
 * (même règle que `normName` de Kevin, `packages/agents/src/boss/resolve.ts`). Jamais de devinette : plusieurs
 * correspondances → erreur `invalid` avec la liste ; aucune → `not_found` avec quelques noms connus.
 */
import { CHANNEL_BOT_WHERE } from "@linkaffipro/db/bot-selectors";
import { prisma } from "@linkaffipro/db";

/** Minuscules, sans accents ni ponctuation ni emojis ; lettres stylisées ramenées aux lettres ordinaires (NFKD). */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Candidate = { id: string; label: string; names: string[] };
export type Resolution =
  | { ok: true; id: string; label: string }
  | { ok: false; error: string; code: "invalid" | "not_found" };

/**
 * Choisit le candidat : identifiant exact, puis nom égal (normalisé), puis nom qui contient la demande (ou l'inverse,
 * pour « Celsius » ↔ « Celsius FR »). Plusieurs au même niveau → refus avec la liste.
 */
export function pickCandidate(query: string, candidates: Candidate[], what: string): Resolution {
  const raw = query.trim().replace(/^id:/, "");
  const byId = candidates.find((c) => c.id === raw);
  if (byId) return { ok: true, id: byId.id, label: byId.label };
  const q = normName(raw.replace(/^@/, ""));
  if (!q) return { ok: false, code: "invalid", error: `Indiquez ${what}.` };
  const levels: Array<(n: string) => boolean> = [
    (n) => n === q,
    (n) => n.startsWith(`${q} `) || n.endsWith(` ${q}`) || n.includes(` ${q} `),
    (n) => n.includes(q) || (n.length >= 3 && q.includes(n)),
  ];
  for (const test of levels) {
    const hits = candidates.filter((c) => c.names.some((n) => test(normName(n))));
    const unique = [...new Map(hits.map((h) => [h.id, h])).values()];
    if (unique.length === 1) return { ok: true, id: unique[0]!.id, label: unique[0]!.label };
    if (unique.length > 1)
      return {
        ok: false,
        code: "invalid",
        error: `Plusieurs correspondances pour « ${query.trim()} » : ${unique
          .slice(0, 8)
          .map((h) => `« ${h.label} »`)
          .join(", ")}${unique.length > 8 ? "…" : ""}. Précisez lequel.`,
      };
  }
  const known = candidates.slice(0, 6).map((c) => `« ${c.label} »`);
  return {
    ok: false,
    code: "not_found",
    error: `Je ne trouve pas ${what} « ${query.trim()} ».${known.length ? ` Connus : ${known.join(", ")}.` : ""}`,
  };
}

/** Champ `idKey` (identifiant, site) sinon `nameKey` (nom ou identifiant, Kevin). Rien des deux → null. */
export function refOf(input: Record<string, unknown>, idKey: string, nameKey: string): string | null {
  const id = input[idKey];
  if (typeof id === "string" && id.trim()) return null;
  const v = input[nameKey];
  return typeof v === "string" && v.trim() ? v : null;
}

export async function campaignCandidates(): Promise<Candidate[]> {
  const rows = await prisma.campaign.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  return rows.map((r) => ({ id: r.id, label: r.name, names: [r.name] }));
}

export async function channelCandidates(): Promise<Candidate[]> {
  const rows = await prisma.channel.findMany({
    select: { id: true, title: true, username: true },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.title,
    names: [r.title, ...(r.username ? [r.username] : [])],
  }));
}

export async function offerCandidates(): Promise<Candidate[]> {
  const rows = await prisma.affiliateCampaign.findMany({
    where: { isActive: true },
    select: { id: true, name: true, campaignKey: true, externalId: true },
    take: 5000,
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.name,
    names: [r.name, ...(r.campaignKey ? [r.campaignKey] : []), r.externalId],
  }));
}

export async function botCandidates(): Promise<Candidate[]> {
  // Bots de canal seulement (jamais Kevin, un assistant ou un bot fantôme) : ce sont les seuls qui envoient.
  const rows = await prisma.bot.findMany({ where: CHANNEL_BOT_WHERE, select: { id: true, name: true, username: true } });
  return rows.map((r) => ({ id: r.id, label: `${r.name} (@${r.username})`, names: [r.name, r.username] }));
}

export async function personaCandidates(): Promise<Candidate[]> {
  const rows = await prisma.persona.findMany({ select: { id: true, name: true } });
  return rows.map((r) => ({ id: r.id, label: r.name, names: [r.name] }));
}

export async function ruleCandidates(): Promise<Candidate[]> {
  const rows = await prisma.automationRule.findMany({
    select: { id: true, name: true, templateKey: true },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.name,
    names: [r.name, ...(r.templateKey ? [r.templateKey] : [])],
  }));
}

export async function broadcastCandidates(): Promise<Candidate[]> {
  const rows = await prisma.broadcast.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map((r) => ({ id: r.id, label: r.name, names: [r.name] }));
}

export async function trackingLinkCandidates(): Promise<Candidate[]> {
  const rows = await prisma.trackingLink.findMany({
    where: { kind: { in: ["AD_ENTRY", "GENERIC"] } },
    select: { id: true, label: true, slug: true },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });
  return rows.map((r) => ({ id: r.id, label: r.label ?? r.slug, names: [r.label ?? "", r.slug] }));
}

/** Membre : identifiant, @pseudo, identifiant Telegram ou prénom + nom (membres anonymisés exclus des noms). */
export async function resolveMember(query: string): Promise<Resolution> {
  const q = query.trim().replace(/^id:/, "");
  const byId = await prisma.member.findUnique({
    where: { id: q },
    select: { id: true, firstName: true, username: true },
  });
  if (byId) return { ok: true, id: byId.id, label: memberLabel(byId) };
  if (/^\d{5,15}$/.test(q)) {
    const byTg = await prisma.member.findUnique({
      where: { telegramUserId: BigInt(q) },
      select: { id: true, firstName: true, username: true },
    });
    if (byTg) return { ok: true, id: byTg.id, label: memberLabel(byTg) };
  }
  const name = q.replace(/^@/, "");
  const rows = await prisma.member.findMany({
    where: {
      anonymizedAt: null,
      OR: [
        { username: { equals: name, mode: "insensitive" } },
        { firstName: { contains: name.split(" ")[0] ?? name, mode: "insensitive" } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, username: true },
    take: 50,
  });
  return pickCandidate(
    q,
    rows.map((m) => ({
      id: m.id,
      label: memberLabel(m),
      names: [
        ...(m.username ? [m.username] : []),
        [m.firstName, m.lastName].filter(Boolean).join(" "),
      ],
    })),
    "le membre",
  );
}

export function memberLabel(m: { firstName?: string | null; username?: string | null }): string {
  if (m.firstName && m.username) return `${m.firstName} (@${m.username})`;
  return m.firstName || (m.username ? `@${m.username}` : "membre sans nom");
}

/**
 * Remplace dans `input` le champ `nameKey` (nom ou identifiant donné par Kevin) par `idKey` (identifiant). Erreur
 * rendue telle quelle si le nom ne désigne pas exactement un élément.
 */
export async function resolveInto(
  input: Record<string, unknown>,
  idKey: string,
  nameKey: string,
  what: string,
  candidates: () => Promise<Candidate[]>,
): Promise<{ ok: true; label: string | null } | { ok: false; error: string; code: "invalid" | "not_found" }> {
  const ref = refOf(input, idKey, nameKey);
  if (!ref) return { ok: true, label: null };
  const r = pickCandidate(ref, await candidates(), what);
  if (!r.ok) return r;
  input[idKey] = r.id;
  return { ok: true, label: r.label };
}

/** Plusieurs noms (liste ou « a, b ») → identifiants ; première erreur rendue. */
export async function resolveManyInto(
  input: Record<string, unknown>,
  idKey: string,
  nameKey: string,
  what: string,
  candidates: () => Promise<Candidate[]>,
): Promise<{ ok: true } | { ok: false; error: string; code: "invalid" | "not_found" }> {
  const raw = input[nameKey];
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const names = (Array.isArray(raw) ? raw.map(String) : String(raw).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return { ok: true };
  const all = await candidates();
  const ids: string[] = Array.isArray(input[idKey]) ? (input[idKey] as unknown[]).map(String) : input[idKey] ? [String(input[idKey])] : [];
  for (const n of names) {
    const r = pickCandidate(n, all, what);
    if (!r.ok) return r;
    if (!ids.includes(r.id)) ids.push(r.id);
  }
  input[idKey] = ids;
  return { ok: true };
}
