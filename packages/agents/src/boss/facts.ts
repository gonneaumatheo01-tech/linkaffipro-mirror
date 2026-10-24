/**
 * Collecteurs de données du Boss (phase 26, règle 5) : chaque réponse chiffrée vient des fonctions existantes (vue
 * d'ensemble, rapport du jour, dépenses et projection, résultats 7 / 28 jours, demandes, validations, stock de
 * médias, paris du jour, recommandations). Chaque collecteur rend les FAITS (JSON, seule source des chiffres que l'IA
 * peut écrire) et les lignes mises en forme par le code (réponse directe, ou repli si la rédaction de l'IA échoue).
 * Lecture seule.
 */
import { agentsOverview } from "../orchestrator/overview-contract";
import { PROVIDER_LABELS } from "../orchestrator/budgets";
import { unusedSourceCount } from "../agents/mediatheque/stock";
import { casinoStock } from "../casino/contracts";
import { betSummary } from "../sports/contracts";
import { parisDay, parisDayStart } from "../rules/time";
import { nowOf } from "../admin/journal";
import { TEAM_LABELS, type ProviderKey, type TeamKey } from "../types";
import type { BossDeps } from "./contract";
import { bossMonthSpend, bossMonthlyCapCents } from "./llm";
import { eur, plural } from "./catalog-kit";

export type Facts = { facts: Record<string, unknown>; lines: string[] };

const euros = (cents: number) => Math.round(cents) / 100;
const pct = (x: number | null | undefined) => (typeof x === "number" ? Math.round(x * 1000) / 10 : null);

export const FACT_TOPICS = [
  "etat",
  "depenses",
  "resultats",
  "demandes",
  "validations",
  "stock",
  "paris",
  "recommandations",
] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];

export const FACT_TOPIC_LABELS: Record<FactTopic, string> = {
  etat: "état des équipes (pause, simulation, niveau, posts du jour)",
  depenses: "dépenses du mois par équipe et par poste, plafonds, projection à fin de mois",
  resultats: "résultats des posts des agents sur 7 et 28 jours (vues, clics, inscriptions, premiers dépôts, commissions)",
  demandes: "questions ouvertes posées par les agents",
  validations: "posts qui attendent une validation",
  stock: "stock de médias (vidéos sources Rencontres, médias Casino)",
  paris: "paris du jour et bilan des paris",
  recommandations: "réglages proposés par l'équipe Algorithme et recommandations pubs",
};

/** État général (une ligne par équipe). */
export async function stateFacts(deps: BossDeps, team?: TeamKey | null): Promise<Facts> {
  const o = await agentsOverview(deps.prisma, { now: nowOf(deps) });
  const teams = o.teams.filter((t) => !team || t.teamKey === team);
  const facts = {
    pauseGenerale: o.pausedAll,
    aValider: o.pendingValidations,
    demandesOuvertes: o.openHumanRequests,
    alertes: o.openAlerts,
    equipes: teams.map((t) => ({
      equipe: t.label,
      enPause: t.paused,
      simulation: t.simulation,
      niveau: t.autonomyLevel,
      aujourdhui: t.today,
    })),
  };
  const ls = [
    `${o.pausedAll ? "⏸ Pause générale. " : ""}À valider : ${o.pendingValidations} · demandes : ${o.openHumanRequests} · alertes : ${o.openAlerts}`,
    ...teams.map(
      (t) =>
        `${t.label} : ${t.paused ? "⏸ pause" : "▶️ active"}, ${t.simulation ? "simulation" : "en vrai"}, niveau ${t.autonomyLevel} · aujourd'hui ${t.today.created} créé${t.today.created > 1 ? "s" : ""}, ${t.today.published} publié${t.today.published > 1 ? "s" : ""}, ${t.today.waiting} en attente`,
    ),
  ];
  return { facts, lines: ls };
}

/** Dépenses du mois par équipe et par poste, plafonds, projection ; IA du Boss comprise. */
export async function spendFacts(deps: BossDeps, team?: TeamKey | null): Promise<Facts> {
  const now = nowOf(deps);
  const [o, boss, bossCap] = await Promise.all([agentsOverview(deps.prisma, { now }), bossMonthSpend(deps.prisma, now), bossMonthlyCapCents(deps.prisma)]);
  const teams = o.teams.filter((t) => !team || t.teamKey === team);
  const rows = teams.map((t) => ({
    equipe: t.label,
    totalEuros: euros(t.spend.reduce((s, p) => s + p.cents, 0)),
    projectionEuros: euros(t.spend.reduce((s, p) => s + p.projectedCents, 0)),
    postes: t.spend.map((p) => ({
      poste: PROVIDER_LABELS[p.provider as ProviderKey] ?? p.provider,
      euros: euros(p.cents),
      plafondEuros: p.capCents === null ? null : euros(p.capCents),
      projectionEuros: euros(p.projectedCents),
    })),
  }));
  const totalCents = teams.reduce((s, t) => s + t.spend.reduce((a, p) => a + p.cents, 0), 0) + (team ? 0 : boss.cents);
  const projected = teams.reduce((s, t) => s + t.spend.reduce((a, p) => a + p.projectedCents, 0), 0);
  const facts = {
    mois: now.toISOString().slice(0, 7),
    totalEuros: euros(totalCents),
    projectionEquipesEuros: euros(projected),
    equipes: rows,
    ...(team ? {} : { iaDuBoss: { euros: euros(boss.cents), plafondEuros: euros(bossCap) } }),
  };
  const ls = [
    `💶 Dépensé ce mois : ${eur(totalCents)} (projection équipes à fin de mois : ${eur(projected)})`,
    ...teams.map((t) => {
      const parts = t.spend.map((p) => `${PROVIDER_LABELS[p.provider as ProviderKey] ?? p.provider} ${eur(p.cents)}${p.capCents !== null ? ` / ${eur(p.capCents)}` : ""}`);
      return `${t.label} : ${parts.length ? parts.join(", ") : "rien"}`;
    }),
    ...(team ? [] : [`IA du Boss : ${eur(boss.cents)} / ${eur(bossCap)}`]),
  ];
  return { facts, lines: ls };
}

/** Résultats des posts des agents (7 ou 28 jours). */
export async function resultsFacts(deps: BossDeps, period: "7j" | "28j", team?: TeamKey | null): Promise<Facts> {
  const o = await agentsOverview(deps.prisma, { now: nowOf(deps) });
  const key = period === "7j" ? "d7" : "d28";
  const teams = o.teams.filter((t) => (!team || t.teamKey === team) && t.teamKey !== "algo");
  const facts = {
    periode: period === "7j" ? "7 derniers jours" : "28 derniers jours",
    equipes: teams.map((t) => ({ equipe: t.label, ...t.results[key] })),
  };
  const ls = [
    `📈 Résultats des agents (${facts.periode})`,
    ...teams.map((t) => {
      const r = t.results[key];
      return r.posts
        ? `${t.label} : ${plural(r.posts, "post")}, ${plural(r.views, "vue")}, ${plural(r.clicks, "clic")}, ${plural(r.registrations, "inscription")}, ${plural(r.ftds, "premier dépôt", "premiers dépôts")}, ${eur(Math.round(r.commissions * 100))} de commissions`
        : `${t.label} : aucun post sur la période`;
    }),
  ];
  return { facts, lines: ls };
}

type RequestRow = { id: string; status: string; kind: string; question: string; teamKey: string | null; askedAt: Date | null; createdAt: Date };

export async function requestsFacts(deps: BossDeps): Promise<Facts> {
  const rows = (await deps.prisma.humanRequest.findMany({
    where: { status: { in: ["QUEUED", "PENDING"] } },
    orderBy: [{ createdAt: "asc" }],
    take: 30,
  })) as RequestRow[];
  rows.sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1));
  const first = (q: string) => {
    const l = q.split("\n")[0]!;
    return l.length > 90 ? `${l.slice(0, 89)}…` : l;
  };
  const facts = {
    total: rows.length,
    enCours: rows.find((r) => r.status === "PENDING") ? first(rows.find((r) => r.status === "PENDING")!.question) : null,
    liste: rows.slice(0, 5).map((r) => ({ question: first(r.question), enCours: r.status === "PENDING" })),
  };
  const ls = rows.length
    ? [`Demandes ouvertes (${rows.length}) :`, ...rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.status === "PENDING" ? "[en cours] " : ""}${first(r.question)}`)]
    : ["Aucune demande ouverte 👍"];
  return { facts, lines: ls };
}

type ValidationRow = { id: string; number: number; teamKey: string; reason: string; previewText: string; createdAt: Date };

export async function validationsFacts(deps: BossDeps): Promise<Facts> {
  const rows = (await deps.prisma.agentValidation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 10,
  })) as ValidationRow[];
  const facts = {
    total: rows.length,
    posts: rows.map((r) => ({ numero: r.number, equipe: TEAM_LABELS[r.teamKey as TeamKey] ?? r.teamKey, motif: r.reason.slice(0, 80) })),
  };
  const ls = rows.length
    ? [
        `À valider (${rows.length}) :`,
        ...rows.map((r) => `n°${r.number} · ${TEAM_LABELS[r.teamKey as TeamKey] ?? r.teamKey} · ${r.reason.slice(0, 60)}`),
        "Écris « ok <n> » pour publier, « non <n> » pour refuser.",
      ]
    : ["Aucun post à valider 👍"];
  return { facts, lines: ls };
}

/** Stock de médias : vidéos sources non utilisées par persona (Rencontres), thèmes en manque (Casino). */
export async function stockFacts(deps: BossDeps, team?: TeamKey | null): Promise<Facts> {
  const out: Record<string, unknown> = {};
  const ls: string[] = [];
  if (!team || team === "dating") {
    const personas = (await deps.prisma.persona.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } })) as {
      id: string;
      name: string;
    }[];
    const rows = [];
    for (const p of personas.slice(0, 10)) {
      const [videos, photos] = await Promise.all([
        unusedSourceCount(deps, p.id),
        deps.prisma.mediaAsset.count({ where: { personaId: p.id, mimeType: { startsWith: "image/" } } }),
      ]);
      rows.push({ persona: p.name, videosSourcesNonUtilisees: videos, photos });
    }
    out.rencontres = rows;
    ls.push(
      rows.length
        ? `🎬 Rencontres : ${rows.map((r) => `${r.persona} ${plural(r.videosSourcesNonUtilisees, "vidéo source", "vidéos sources")} non utilisée${r.videosSourcesNonUtilisees > 1 ? "s" : ""}, ${plural(r.photos, "photo")}`).join(" · ")}`
        : "🎬 Rencontres : aucune persona active.",
    );
  }
  if (!team || team === "casino") {
    const rows = await casinoStock(deps.prisma as never, { now: nowOf(deps) });
    const low = rows.filter((r) => r.state !== "ok");
    out.casino = {
      lignes: rows.length,
      enManque: low.map((r) => ({ canal: r.channelTitle, theme: r.theme, nonUtilises: r.unused })),
    };
    ls.push(
      rows.length === 0
        ? "🎰 Casino : aucun canal avec des thèmes."
        : low.length
          ? `🎰 Casino : ${plural(low.length, "thème en manque", "thèmes en manque")} : ${low
              .slice(0, 6)
              .map((r) => `${r.channelTitle} / ${r.theme} (${r.unused})`)
              .join(", ")}${low.length > 6 ? "…" : ""}`
          : "🎰 Casino : stock suffisant sur tous les thèmes.",
    );
  }
  return { facts: out, lines: ls };
}

type PickRow = { id: string; homeTeam: string; awayTeam: string; marketLabel: string; selectionLabel: string; odds: number; status: string; kickoffAt: Date };

export async function betsTodayFacts(deps: BossDeps): Promise<Facts> {
  const now = nowOf(deps);
  const rows = (await deps.prisma.bettingPick.findMany({
    where: { createdAt: { gte: parisDayStart(parisDay(now)) }, status: { not: "SKIPPED" } },
    orderBy: { kickoffAt: "asc" },
    take: 20,
  })) as PickRow[];
  const facts = {
    jour: parisDay(now),
    total: rows.length,
    paris: rows.map((r) => ({ match: `${r.homeTeam} - ${r.awayTeam}`, pari: `${r.marketLabel} : ${r.selectionLabel}`, cote: r.odds, statut: r.status })),
  };
  const STATUS: Record<string, string> = { PROPOSED: "prévu", PUBLISHED: "publié", WON: "gagné ✅", LOST: "perdu ❌", VOID: "annulé" };
  const ls = rows.length
    ? [`⚽ Paris du jour (${rows.length}) :`, ...rows.slice(0, 8).map((r) => `${r.homeTeam} - ${r.awayTeam} · ${r.selectionLabel} à ${r.odds.toLocaleString("fr-FR")} · ${STATUS[r.status] ?? r.status}`)]
    : ["⚽ Aucun pari aujourd'hui pour le moment."];
  return { facts, lines: ls };
}

export async function betSummaryFacts(deps: BossDeps, period: "7j" | "28j"): Promise<Facts> {
  const now = nowOf(deps);
  const days = period === "7j" ? 7 : 28;
  const rows = await betSummary(deps.prisma as never, { from: new Date(now.getTime() - days * 86_400_000), to: now, by: "category" });
  const facts = {
    periode: period === "7j" ? "7 derniers jours" : "28 derniers jours",
    categories: rows.map((r) => ({ categorie: r.label, publies: r.published, gagnes: r.won, perdus: r.lost, reussitePct: pct(r.hitRate), coteMoyenne: r.avgOdds, rendementPct: pct(r.roi) })),
  };
  const ls = rows.length
    ? [
        `📊 Bilan des paris (${facts.periode})`,
        ...rows.map((r) => `${r.label} : ${r.published} publié${r.published > 1 ? "s" : ""}, ${r.won} gagné${r.won > 1 ? "s" : ""}, ${r.lost} perdu${r.lost > 1 ? "s" : ""}${r.hitRate !== null ? `, ${pct(r.hitRate)} % de réussite` : ""}`),
      ]
    : [`📊 Aucun pari terminé sur les ${days} derniers jours.`];
  return { facts, lines: ls };
}

export type RecoRow = {
  id: string;
  teamKey: string;
  target: string;
  targetId: string;
  field: string;
  after: unknown;
  status: string;
  expectedGain: string | null;
  appliedAt: Date | null;
  createdAt: Date;
};

const FIELD_LABELS: Record<string, string> = {
  mix: "mélange des posts",
  window: "fenêtre horaire",
  postsPerDay: "posts par jour",
  styleNotes: "consignes du canal",
  styleGuidelines: "consignes de l'équipe",
  followUpAfterHours: "délai de relance",
  minExchangesBeforeOffer: "échanges avant le lien",
};

/** Libellé lisible d'une recommandation (pur). */
export function recommendationLabel(r: Pick<RecoRow, "teamKey" | "field" | "after" | "expectedGain">, names: Map<string, string> = new Map(), targetId?: string): string {
  const after = r.after as Record<string, unknown> | null;
  if (r.teamKey === "ads") {
    const label = typeof after?.label === "string" ? after.label : "action";
    const name = typeof after?.name === "string" ? after.name : "pub";
    return `${label} : ${name}`;
  }
  const where = targetId ? names.get(targetId) : undefined;
  return `${FIELD_LABELS[r.field] ?? r.field}${where ? ` (${where})` : ""}${r.expectedGain ? ` — ${r.expectedGain.slice(0, 80)}` : ""}`;
}

/** Recommandations Algorithme proposées (ordre stable : la plus ancienne d'abord) — numéros de la liste affichée. */
export async function algoProposed(deps: BossDeps): Promise<RecoRow[]> {
  return (await deps.prisma.recommendation.findMany({
    where: { status: "PROPOSED", NOT: [{ teamKey: "ads" }, { source: "inspiration" }] },
    orderBy: [{ createdAt: "asc" }],
    take: 9,
  })) as RecoRow[];
}

/** Réglages Algorithme appliqués (le plus récent d'abord). */
export async function algoApplied(deps: BossDeps): Promise<RecoRow[]> {
  return (await deps.prisma.recommendation.findMany({
    where: { status: "APPLIED", NOT: [{ teamKey: "ads" }, { source: "inspiration" }] },
    orderBy: [{ appliedAt: "desc" }],
    take: 9,
  })) as RecoRow[];
}

export async function adsProposed(deps: BossDeps): Promise<RecoRow[]> {
  return (await deps.prisma.recommendation.findMany({
    where: { status: "PROPOSED", teamKey: "ads" },
    orderBy: [{ createdAt: "asc" }],
    take: 9,
  })) as RecoRow[];
}

/** Noms des cibles (canaux, personas) d'une liste de recommandations. */
export async function targetNames(deps: BossDeps, rows: readonly RecoRow[]): Promise<Map<string, string>> {
  const ch = rows.filter((r) => r.target === "CHANNEL_PLAN").map((r) => r.targetId);
  const pe = rows.filter((r) => r.target === "PERSONA").map((r) => r.targetId);
  const [channels, personas] = await Promise.all([
    ch.length ? deps.prisma.channel.findMany({ where: { id: { in: ch } }, select: { id: true, title: true } }) : [],
    pe.length ? deps.prisma.persona.findMany({ where: { id: { in: pe } }, select: { id: true, name: true } }) : [],
  ]);
  const map = new Map<string, string>();
  for (const c of channels as { id: string; title: string }[]) map.set(c.id, c.title);
  for (const p of personas as { id: string; name: string }[]) map.set(p.id, p.name);
  for (const r of rows) if (r.target === "TEAM_CONFIG") map.set(r.targetId, TEAM_LABELS[r.targetId as TeamKey] ?? r.targetId);
  return map;
}

export async function recommendationsFacts(deps: BossDeps): Promise<Facts> {
  const [proposed, applied, ads] = await Promise.all([algoProposed(deps), algoApplied(deps), adsProposed(deps)]);
  const names = await targetNames(deps, [...proposed, ...applied]);
  const facts = {
    algorithmePropose: proposed.map((r) => recommendationLabel(r, names, r.targetId)),
    algorithmeApplique: applied.slice(0, 5).map((r) => recommendationLabel(r, names, r.targetId)),
    pubs: ads.map((r) => recommendationLabel(r)),
  };
  const ls = [
    proposed.length
      ? `🧠 Réglages proposés : ${proposed.map((r, i) => `${i + 1}. ${recommendationLabel(r, names, r.targetId)}`).join(" · ")}`
      : "🧠 Aucun réglage proposé par l'équipe Algorithme.",
    applied.length ? `Derniers appliqués : ${applied.slice(0, 3).map((r) => recommendationLabel(r, names, r.targetId)).join(" · ")}` : null,
    ads.length ? `📣 Pubs : ${ads.map((r, i) => `${i + 1}. ${recommendationLabel(r)}`).join(" · ")}` : "📣 Aucune recommandation pubs ouverte.",
  ].filter((l): l is string => !!l);
  return { facts, lines: ls };
}

/** Collecteur d'un sujet de question. */
export async function factsFor(deps: BossDeps, topic: FactTopic, opts: { team?: TeamKey | null; period?: "7j" | "28j" } = {}): Promise<Facts> {
  switch (topic) {
    case "etat":
      return stateFacts(deps, opts.team);
    case "depenses":
      return spendFacts(deps, opts.team);
    case "resultats":
      return resultsFacts(deps, opts.period ?? "7j", opts.team);
    case "demandes":
      return requestsFacts(deps);
    case "validations":
      return validationsFacts(deps);
    case "stock":
      return stockFacts(deps, opts.team);
    case "paris": {
      const [today, summary] = await Promise.all([betsTodayFacts(deps), betSummaryFacts(deps, opts.period ?? "7j")]);
      return { facts: { aujourdhui: today.facts, bilan: summary.facts }, lines: [...today.lines, ...summary.lines] };
    }
    case "recommandations":
      return recommendationsFacts(deps);
  }
}

