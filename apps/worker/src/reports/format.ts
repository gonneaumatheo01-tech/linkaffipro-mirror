/**
 * Mise en forme des rapports Telegram (brief quotidien, rapport hebdomadaire). Fonctions pures.
 * HTML Telegram : seules les balises b, i, code sont utilisées ; le reste est échappé.
 * Vocabulaire du client (docs/REFONTE-UX.md) : premiers dépôts, revenu net, coût par membre, coût par
 * inscription, retour sur dépense pub ; jamais FTD, NGR, CPL, CPA ni ROAS.
 */

export type ReportMetrics = {
  requests: number;
  approved: number;
  joined: number;
  left: number;
  entryClicks: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
  deposits: number;
  depositAmount: number;
  ngr: number;
  spend: number;
};

export type NamedMetrics = ReportMetrics & { name: string };

export type ReportData = {
  /** Libellé de la période courante, ex. « jeudi 9 octobre » ou « semaine du 29 sept. au 5 oct. ». */
  periodLabel: string;
  current: ReportMetrics;
  previous: ReportMetrics;
  topCampaigns: NamedMetrics[];
  topChannels: NamedMetrics[];
  openAlerts: Array<{ kind: string; message: string }>;
  /** Dernier succès de la synchro Link Affi (null si jamais) et éventuelle erreur en cours. */
  sync: { lastSuccessAt: Date | null; errors: string[] };
  /** Résumé de la dernière sauvegarde automatique (phrase en français), absent dans les tests anciens. */
  backup?: string | null;
  upcomingPosts: Array<{ channel: string; scheduledAt: Date }>;
};

export const EMPTY_METRICS: ReportMetrics = {
  requests: 0,
  approved: 0,
  joined: 0,
  left: 0,
  entryClicks: 0,
  offerClicks: 0,
  registrations: 0,
  ftds: 0,
  deposits: 0,
  depositAmount: 0,
  ngr: 0,
  spend: 0,
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Montant en euros, format français (« 1 234,50 € »). */
export function eur(n: number): string {
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
}

/** Rapport (retour sur dépense pub), format du site : « 0,42× ». */
export function ratio2(n: number): string {
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}×`;
}

/** Variation en % entre `prev` et `cur` : « +25 % », « −10 % », « = », ou « nouveau » si prev = 0 et cur > 0. */
export function pct(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? "=" : "nouveau";
  const v = Math.round(((cur - prev) / prev) * 100);
  if (v === 0) return "=";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)} %`;
}

const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

function ratio(spend: number, n: number): string | null {
  if (spend <= 0 || n <= 0) return null;
  return eur(spend / n);
}

function line(
  label: string,
  cur: number,
  prev: number,
  fmt: (n: number) => string = (n) => String(n),
): string {
  return `${label} : <b>${fmt(cur)}</b> (${pct(cur, prev)})`;
}

/** Bloc des chiffres principaux avec comparaison. */
export function formatMetricsBlock(cur: ReportMetrics, prev: ReportMetrics): string[] {
  const out = [
    line("👥 Demandes", cur.requests, prev.requests),
    line("✅ Acceptés", cur.approved, prev.approved),
    line("🚪 Entrées / départs", cur.joined, prev.joined) + ` / ${cur.left}`,
    line("🔗 Clics pub", cur.entryClicks, prev.entryClicks),
    line("🎁 Clics offres", cur.offerClicks, prev.offerClicks),
    line("📝 Inscriptions", cur.registrations, prev.registrations),
    line("💳 Premiers dépôts", cur.ftds, prev.ftds),
    line("💰 Dépôts", cur.deposits, prev.deposits) + ` · ${eur(cur.depositAmount)}`,
    line("📈 Revenu net", cur.ngr, prev.ngr, eur),
  ];
  if (cur.spend > 0 || prev.spend > 0) {
    out.push(line("💸 Dépense pub", cur.spend, prev.spend, eur));
    const cpl = ratio(cur.spend, cur.approved);
    const cpa = ratio(cur.spend, cur.registrations);
    const cftd = ratio(cur.spend, cur.ftds);
    const roas = cur.spend > 0 ? ratio2(cur.ngr / cur.spend) : null;
    const parts = [
      cpl && `coût par membre ${cpl}`,
      cpa && `coût par inscription ${cpa}`,
      cftd && `coût par premier dépôt ${cftd}`,
      roas && `retour sur dépense pub ${roas}`,
    ].filter((p): p is string => Boolean(p));
    if (parts.length) {
      const text = parts.join(" · ");
      out.push(`🧮 ${text.charAt(0).toUpperCase()}${text.slice(1)}`);
    }
  }
  return out;
}

function formatTop(title: string, rows: NamedMetrics[]): string[] {
  if (rows.length === 0) return [];
  const out = [`<b>${title}</b>`];
  for (const r of rows) {
    const bits = [
      `${r.approved} acceptés`,
      `${r.registrations} inscr.`,
      `${r.ftds} premier${r.ftds > 1 ? "s" : ""} dépôt${r.ftds > 1 ? "s" : ""}`,
    ];
    if (r.spend > 0) bits.push(`${eur(r.spend)} dépensés`);
    if (r.ngr !== 0) bits.push(`revenu net ${eur(r.ngr)}`);
    out.push(`• ${escapeHtml(r.name)} — ${bits.join(", ")}`);
  }
  return out;
}

function formatStatus(d: ReportData): string[] {
  const out: string[] = [];
  if (d.openAlerts.length === 0 && d.sync.errors.length === 0)
    out.push("🟢 Rien à signaler : aucune alerte ouverte.");
  for (const a of d.openAlerts) out.push(`🔴 Alerte : ${escapeHtml(a.message)}`);
  if (d.sync.lastSuccessAt)
    out.push(`🔄 Synchro Link Affi : dernier succès ${dateTimeFmt.format(d.sync.lastSuccessAt)}`);
  else out.push("🔄 Synchro Link Affi : jamais réussie");
  for (const e of d.sync.errors) out.push(`⚠️ Synchro : ${escapeHtml(e)}`);
  if (d.backup)
    out.push(`${/échec|aucune/.test(d.backup) ? "⚠️" : "💾"} Sauvegarde : ${escapeHtml(d.backup)}`);
  if (d.upcomingPosts.length > 0) {
    out.push(
      `🗓 ${d.upcomingPosts.length} message${d.upcomingPosts.length > 1 ? "s" : ""} programmé${d.upcomingPosts.length > 1 ? "s" : ""} dans les 24 h :`,
    );
    for (const p of d.upcomingPosts.slice(0, 8))
      out.push(`• ${timeFmt.format(p.scheduledAt)} — ${escapeHtml(p.channel)}`);
  } else out.push("🗓 Aucun message programmé dans les 24 h.");
  return out;
}

/** Brief quotidien (hier vs avant-hier). */
export function formatDailyBrief(d: ReportData): string {
  const lines = [
    `<b>☀️ Brief du jour — ${escapeHtml(d.periodLabel)}</b>`,
    "",
    ...formatMetricsBlock(d.current, d.previous),
    "",
  ];
  lines.push(...formatTop("Top campagnes", d.topCampaigns));
  if (d.topCampaigns.length) lines.push("");
  lines.push(...formatTop("Top canaux", d.topChannels));
  if (d.topChannels.length) lines.push("");
  lines.push(...formatStatus(d));
  return lines.join("\n").trim();
}

/** Rapport hebdomadaire (7 derniers jours vs 7 précédents). */
export function formatWeeklyReport(d: ReportData): string {
  const lines = [
    `<b>📊 Rapport hebdomadaire — ${escapeHtml(d.periodLabel)}</b>`,
    "<i>Comparé à la semaine précédente</i>",
    "",
    ...formatMetricsBlock(d.current, d.previous),
    "",
  ];
  lines.push(...formatTop("Top campagnes de la semaine", d.topCampaigns));
  if (d.topCampaigns.length) lines.push("");
  lines.push(...formatTop("Top canaux de la semaine", d.topChannels));
  if (d.topChannels.length) lines.push("");
  lines.push(...formatStatus(d));
  return lines.join("\n").trim();
}
