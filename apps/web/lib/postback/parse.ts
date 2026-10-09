/**
 * Lecture des paramètres d'un postback selon la correspondance (mapping) de l'endpoint.
 * Fonctions pures, testées.
 */

export const EVENT_TYPES = ["REGISTRATION", "FTD", "DEPOSIT", "REDEPOSIT", "NGR", "OTHER"] as const;
export type PostbackEventType = (typeof EVENT_TYPES)[number];

export type PostbackMapping = {
  sub_id: string;
  player_id: string;
  event: string;
  amount: string;
  currency: string;
  /** Nom du paramètre portant un identifiant de transaction (idempotence), optionnel. */
  txid: string;
  /** Nom du paramètre portant la date de l'événement, optionnel. */
  date: string;
  /** Valeur reçue (minuscules) → type d'événement. */
  eventMap: Record<string, PostbackEventType>;
};

export const DEFAULT_MAPPING: PostbackMapping = {
  sub_id: "sub_id",
  player_id: "player_id",
  event: "event",
  amount: "amount",
  currency: "currency",
  txid: "txid",
  date: "date",
  eventMap: {
    registration: "REGISTRATION",
    register: "REGISTRATION",
    signup: "REGISTRATION",
    reg: "REGISTRATION",
    ftd: "FTD",
    first_deposit: "FTD",
    firstdeposit: "FTD",
    deposit: "DEPOSIT",
    dep: "DEPOSIT",
    redeposit: "REDEPOSIT",
    lifecycle_redeposit: "REDEPOSIT",
    revenue: "NGR",
    ngr: "NGR",
    rev: "NGR",
  },
};

function isEventType(v: unknown): v is PostbackEventType {
  return typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);
}

/** Valide et complète un mapping stocké en JSON ; lève une erreur lisible si invalide. */
export function normalizeMapping(input: unknown): PostbackMapping {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (k: keyof PostbackMapping): string => {
    const v = obj[k];
    if (v === undefined || v === null || v === "") return DEFAULT_MAPPING[k] as string;
    if (typeof v !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(v)) throw new Error(`Paramètre « ${k} » invalide (nom de paramètre attendu).`);
    return v;
  };
  const eventMap: Record<string, PostbackEventType> = {};
  const rawMap = obj.eventMap;
  if (rawMap !== undefined) {
    if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) throw new Error("« eventMap » doit être un objet { valeur: TYPE }.");
    for (const [k, v] of Object.entries(rawMap as Record<string, unknown>)) {
      if (!isEventType(v)) throw new Error(`Type d'événement inconnu pour « ${k} » : ${String(v)} (attendu : ${EVENT_TYPES.join(", ")}).`);
      eventMap[k.trim().toLowerCase()] = v;
    }
  }
  return {
    sub_id: str("sub_id"),
    player_id: str("player_id"),
    event: str("event"),
    amount: str("amount"),
    currency: str("currency"),
    txid: str("txid"),
    date: str("date"),
    eventMap: Object.keys(eventMap).length > 0 ? eventMap : { ...DEFAULT_MAPPING.eventMap },
  };
}

export type ParsedPostback = {
  subId: string | null;
  externalPlayerId: string;
  eventRaw: string;
  eventType: PostbackEventType;
  amount: number | null;
  currency: string;
  txid: string | null;
  occurredAt: Date;
};

/** Convertit « 12,50 », « 1 250.00 », « €12 » en nombre ; null si vide ou illisible. */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[€$£\s]/g, "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function firstValue(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(params)) {
    if (k.toLowerCase() !== lower) continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
  }
  return null;
}

/**
 * Lit un postback. Lève une erreur si l'identifiant joueur ou l'événement manque.
 * Un événement inconnu devient OTHER (il est journalisé mais ne modifie pas les cumuls).
 */
export function parsePostback(params: Record<string, string | string[] | undefined>, mapping: PostbackMapping, now = new Date()): ParsedPostback {
  const externalPlayerId = firstValue(params, mapping.player_id);
  if (!externalPlayerId) throw new Error(`Paramètre « ${mapping.player_id} » (identifiant joueur) manquant.`);
  const eventRaw = firstValue(params, mapping.event);
  if (!eventRaw) throw new Error(`Paramètre « ${mapping.event} » (événement) manquant.`);
  const eventType = mapping.eventMap[eventRaw.toLowerCase()] ?? "OTHER";
  const subRaw = firstValue(params, mapping.sub_id);
  const subId = subRaw && /^[A-Za-z0-9_-]{1,64}$/.test(subRaw) ? subRaw : null;
  const amount = parseAmount(firstValue(params, mapping.amount));
  const currency = (firstValue(params, mapping.currency) ?? "EUR").toUpperCase().slice(0, 3);
  const txid = firstValue(params, mapping.txid);
  const dateRaw = firstValue(params, mapping.date);
  let occurredAt = now;
  if (dateRaw) {
    const d = /^\d{9,11}$/.test(dateRaw) ? new Date(Number(dateRaw) * 1000) : new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) occurredAt = d;
  }
  return { subId, externalPlayerId: externalPlayerId.slice(0, 128), eventRaw: eventRaw.slice(0, 64), eventType, amount, currency, txid: txid ? txid.slice(0, 128) : null, occurredAt };
}

/** Clé d'idempotence d'un événement : txid fourni, sinon événement + joueur + montant + jour. */
export function postbackExternalId(p: ParsedPostback): string {
  if (p.txid) return `tx:${p.txid}`;
  const day = p.occurredAt.toISOString().slice(0, 10);
  return `${p.eventType.toLowerCase()}:${p.externalPlayerId}:${p.amount ?? 0}:${day}`;
}

/** Résumé sans donnée personnelle pour l'affichage du journal. */
export function summarizeParams(raw: unknown, mapping: PostbackMapping): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  const keys = [mapping.event, mapping.sub_id, mapping.amount, mapping.currency, mapping.player_id];
  return keys
    .map((k) => {
      const v = Object.entries(r).find(([kk]) => kk.toLowerCase() === k.toLowerCase())?.[1];
      if (v === undefined || v === null || v === "") return null;
      const val = k === mapping.player_id ? `…${String(v).slice(-4)}` : String(v).slice(0, 40);
      return `${k}=${val}`;
    })
    .filter(Boolean)
    .join(" ");
}

/** URL modèle à donner au programme. */
export function postbackUrlTemplate(baseUrl: string, token: string, mapping: PostbackMapping): string {
  const q = [mapping.sub_id, mapping.player_id, mapping.event, mapping.amount, mapping.currency].map((k) => `${k}={${k}}`).join("&");
  return `${baseUrl.replace(/\/$/, "")}/api/postback/${token}?${q}`;
}
