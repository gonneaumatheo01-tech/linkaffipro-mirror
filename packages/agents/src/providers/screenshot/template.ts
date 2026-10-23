/**
 * Image de repli (phase 23, parade n° 3) : gabarit HTML autonome (aucune ressource externe) rendu en PNG par le
 * navigateur. Match, marché, sélection, cote, bookmaker, et la mention « capture indisponible ». Toujours soumise à la
 * validation du client (origine TEMPLATE).
 */
export type FallbackImageData = {
  homeTeam: string;
  awayTeam: string;
  league?: string | null;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  odds: number;
  bookmaker: string;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatOddsFr(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

function kickoffFr(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Pur : HTML du gabarit (1080 × 1080). */
export function renderFallbackHtml(d: FallbackImageData): string {
  const selection = d.line !== null && !d.selectionLabel.includes(String(d.line)) ? `${d.selectionLabel} ${String(d.line).replace(".", ",")}` : d.selectionLabel;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1080px;font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:linear-gradient(160deg,#0f1b2d 0%,#16263f 60%,#0b1422 100%);color:#fff;display:flex;flex-direction:column;justify-content:space-between;padding:72px}
.top{font-size:30px;color:#9fb3c8;letter-spacing:.5px}
.teams{font-size:72px;font-weight:800;line-height:1.1;margin-top:28px}
.vs{color:#ff7a00;font-weight:700}
.when{font-size:32px;color:#c9d6e3;margin-top:20px;text-transform:capitalize}
.card{background:#fff;color:#0f1b2d;border-radius:28px;padding:48px;border:6px solid #ff7a00}
.market{font-size:34px;color:#4a5b6d}
.sel{font-size:54px;font-weight:800;margin-top:12px}
.odds{display:inline-block;margin-top:28px;background:#ff7a00;color:#0f1b2d;font-size:84px;font-weight:900;border-radius:20px;padding:12px 40px}
.foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:28px;color:#9fb3c8}
.bk{font-size:36px;color:#fff;font-weight:700}
.note{font-style:italic}
</style></head><body>
<div><div class="top">${esc(d.league ?? "Football")}</div>
<div class="teams">${esc(d.homeTeam)} <span class="vs">–</span> ${esc(d.awayTeam)}</div>
<div class="when">${esc(kickoffFr(d.kickoffAt))}</div></div>
<div class="card"><div class="market">${esc(d.marketLabel)}</div><div class="sel">${esc(selection)}</div><div class="odds">${esc(formatOddsFr(d.odds))}</div></div>
<div class="foot"><div>Cote constatée chez<br><span class="bk">${esc(d.bookmaker)}</span></div><div class="note">capture indisponible</div></div>
</body></html>`;
}
