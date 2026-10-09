const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
const numFmt = new Intl.NumberFormat("fr-FR");

export function fmtDate(d: Date | null | undefined): string {
  return d ? dateFmt.format(d) : "—";
}
export function fmtNum(n: number | bigint): string {
  return numFmt.format(n);
}
