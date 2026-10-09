/**
 * Lecture d'un fichier CSV de joueurs (programmes sans API ni postback).
 * Séparateurs `,` `;` ou tabulation, guillemets, BOM. Fonctions pures, testées.
 */

export function detectDelimiter(firstLine: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<"," | ";" | "\t", number>;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) counts[ch as "," | ";" | "\t"]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as "," | ";" | "\t") ?? ",";
}

/** Analyse un CSV complet en lignes de cellules. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n")[0] ?? "";
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type PlayerCsvColumns = { subId: number | null; playerId: number; event: number; amount: number | null; currency: number | null; date: number | null; txid: number | null };

const SYNONYMS: Record<keyof PlayerCsvColumns, string[]> = {
  subId: ["sub_id", "subid", "sub id", "sub-id", "sub1", "clickid", "click_id", "click id"],
  playerId: ["player_id", "playerid", "player id", "player", "joueur", "id joueur", "id_joueur", "user_id", "userid", "external_player_id"],
  event: ["event", "evenement", "événement", "type", "action", "status"],
  amount: ["amount", "montant", "sum", "value", "valeur", "deposit", "dépôt", "depot"],
  currency: ["currency", "devise", "cur"],
  date: ["date", "created_at", "timestamp", "time", "datetime", "occurred_at", "jour"],
  txid: ["txid", "tx_id", "transaction_id", "transaction", "idempotency_key", "ref"],
};

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/^﻿/, "").replace(/[_\-\s]+/g, " ").trim();
}

/** Repère les colonnes d'un fichier de joueurs. Lève une erreur si joueur ou événement manquent. */
export function detectPlayerColumns(header: string[]): PlayerCsvColumns {
  const find = (key: keyof PlayerCsvColumns): number | null => {
    const syns = SYNONYMS[key].map(norm);
    const idx = header.findIndex((h) => syns.includes(norm(h)));
    return idx >= 0 ? idx : null;
  };
  const playerId = find("playerId");
  const event = find("event");
  if (playerId === null) throw new Error("Colonne de l'identifiant joueur introuvable (player_id, joueur…).");
  if (event === null) throw new Error("Colonne de l'événement introuvable (event, type…).");
  return { subId: find("subId"), playerId, event, amount: find("amount"), currency: find("currency"), date: find("date"), txid: find("txid") };
}

export type PlayerCsvRow = Record<string, string>;

/** Transforme les lignes en paramètres de postback (clés par défaut : sub_id, player_id, event, amount, currency, date, txid). */
export function rowsToPostbackParams(rows: string[][], cols: PlayerCsvColumns): PlayerCsvRow[] {
  const out: PlayerCsvRow[] = [];
  for (const r of rows) {
    const get = (i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
    const params: PlayerCsvRow = { player_id: get(cols.playerId), event: get(cols.event) };
    if (cols.subId !== null) params.sub_id = get(cols.subId);
    if (cols.amount !== null) params.amount = get(cols.amount);
    if (cols.currency !== null) params.currency = get(cols.currency);
    if (cols.date !== null) params.date = get(cols.date);
    if (cols.txid !== null) params.txid = get(cols.txid);
    out.push(params);
  }
  return out;
}
