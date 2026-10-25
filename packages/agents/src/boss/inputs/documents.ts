/**
 * Phase 34, chantier F — fichier envoyé à Kevin (CSV, TXT, TSV ; 2 Mo au plus) : téléchargé par le bot (fonction
 * injectée : `getFile` + adresse Telegram ; faux en test), décodé (UTF-8, repli Windows-1252, UTF-16 avec BOM ; BOM
 * retiré), gardé 30 minutes (`ReceivedDocument`). Le texte du fichier ne part JAMAIS à l'IA : seuls l'en-tête des
 * colonnes (raccourci) et le nombre de lignes peuvent être décrits (`documentSummary`).
 */
import { esc, nowOf } from "../../admin/journal";
import type { ReceivedDocument } from "../../site/contract";
import { pick } from "../voice";
import { expiresFrom, readInputs, serialized, writeInputs, type InputsDeps, type StoredDocument } from "./store";
import { INPUTS_VARIANTS } from "./texts";

export const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_EXTENSIONS = ["csv", "txt", "tsv"] as const;
const TEXT_MIMES = new Set(["text/csv", "text/plain", "text/tab-separated-values", "application/csv", "text/comma-separated-values"]);

export type DocumentRefusal = "type" | "size" | "unreadable";

function extensionOf(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : null;
}

/** Type accepté ? Extension csv / txt / tsv, ou, sans extension, un type texte. Pur. */
export function acceptedDocument(fileName: string, mimeType: string | null): boolean {
  const ext = extensionOf(fileName);
  if (ext) return (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
  return !!mimeType && TEXT_MIMES.has(mimeType.toLowerCase().split(";")[0]!.trim());
}

/**
 * Octets → texte. UTF-16 (BOM FF FE / FE FF), sinon UTF-8 strict (BOM retiré), sinon Windows-1252 (Excel en France).
 * Rend null pour un fichier binaire (octet nul). Pur.
 */
export function decodeDocumentText(bytes: Uint8Array): string | null {
  let text: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  else {
    const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    if (body.includes(0)) return null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      text = new TextDecoder("windows-1252").decode(body);
    }
  }
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\u0000")) return null;
  return text.replace(/\r\n?/g, "\n");
}

/** Séparateur probable d'une ligne d'en-tête (`;` en France, `,`, tabulation). Pur. */
export function delimiterOf(header: string): string {
  const count = (c: string) => header.split(c).length - 1;
  const cands: Array<[string, number]> = [
    [";", count(";")],
    [",", count(",")],
    ["\t", count("\t")],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0]![1] > 0 ? cands[0]![0] : ",";
}

export type DocumentShape = { lines: number; columns: string[] | null };

/** Lignes non vides (en-tête compris pour un TXT, hors en-tête pour un CSV) et noms de colonnes raccourcis. Pur. */
export function documentShape(doc: Pick<ReceivedDocument, "fileName" | "text">): DocumentShape {
  const rows = doc.text.split("\n").filter((l) => l.trim());
  const ext = extensionOf(doc.fileName);
  if (ext === "txt" || rows.length === 0) return { lines: rows.length, columns: null };
  const sep = ext === "tsv" ? "\t" : delimiterOf(rows[0]!);
  const columns = rows[0]!
    .split(sep)
    .map((c) => c.trim().replace(/^"|"$/g, "").replace(/\s+/g, " ").slice(0, 24))
    .filter(Boolean)
    .slice(0, 8);
  return { lines: Math.max(0, rows.length - 1), columns };
}

/** Résumé sans le contenu : « 120 lignes, colonnes nom, email, pays ». Pur, non échappé. */
export function documentSummary(doc: Pick<ReceivedDocument, "fileName" | "text">): string {
  const s = documentShape(doc);
  const lines = `${s.lines} ligne${s.lines > 1 ? "s" : ""}`;
  return s.columns?.length ? `${lines}, colonnes ${s.columns.join(", ")}` : lines;
}

function publicOf(d: StoredDocument): ReceivedDocument {
  return { fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, text: d.text, receivedAt: d.receivedAt };
}

export type ReceiveDocumentInput = {
  chatId: string;
  fileName: string;
  mimeType: string | null;
  /** Taille annoncée par Telegram (contrôlée avant le téléchargement), si connue. */
  sizeBytes: number | null;
  /** Téléchargement du fichier (bot : `getFile` + adresse Telegram ; tests : faux). */
  download: () => Promise<Uint8Array>;
};

export type ReceiveDocumentResult =
  | { ok: true; document: ReceivedDocument; summary: string; reply: string }
  | { ok: false; reason: DocumentRefusal; reply: string };

/** Contrôle, téléchargement, décodage, garde (30 min). Ne lève jamais ; `reply` = réponse de Kevin (voix). */
export async function receiveDocument(deps: InputsDeps, input: ReceiveDocumentInput): Promise<ReceiveDocumentResult> {
  const say = (reason: DocumentRefusal): ReceiveDocumentResult => ({
    ok: false,
    reason,
    reply: pick(
      reason === "type" ? INPUTS_VARIANTS.documentType : reason === "size" ? INPUTS_VARIANTS.documentSize : INPUTS_VARIANTS.documentUnreadable,
      `inputs.document.${reason}`,
      input.chatId,
    ),
  });
  const fileName = (input.fileName || "fichier.txt").trim().slice(0, 120);
  if (!acceptedDocument(fileName, input.mimeType)) return say("type");
  if (input.sizeBytes !== null && input.sizeBytes > DOCUMENT_MAX_BYTES) return say("size");
  let bytes: Uint8Array;
  try {
    bytes = await input.download();
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message }, "[boss] fichier non téléchargé");
    return say("unreadable");
  }
  if (bytes.length > DOCUMENT_MAX_BYTES) return say("size");
  const text = decodeDocumentText(bytes);
  if (text === null) return say("unreadable");
  const now = nowOf(deps);
  const doc: StoredDocument = { fileName, mimeType: input.mimeType, sizeBytes: bytes.length, text, receivedAt: now.toISOString(), expiresAt: expiresFrom(now) };
  await serialized(input.chatId, async () => {
    const stored = await readInputs(deps, input.chatId);
    await writeInputs(deps, input.chatId, { ...stored, document: doc });
  });
  const summary = documentSummary(doc);
  const reply = pick(INPUTS_VARIANTS.documentAck({ name: esc(fileName), summary: esc(summary) }), "inputs.document.ack", input.chatId);
  return { ok: true, document: publicOf(doc), summary, reply };
}

/** Texte gardé dans la mémoire de Kevin : nom et forme du fichier, jamais son contenu. */
export function documentMemoryLine(doc: Pick<ReceivedDocument, "fileName" | "text">): string {
  return `[fichier reçu : ${doc.fileName}, ${documentSummary(doc)}]`;
}

/** Le fichier gardé pour cette conversation (sans le consommer), ou null (absent ou expiré). */
export async function peekDocument(deps: InputsDeps, chatId: string): Promise<ReceivedDocument | null> {
  const d = (await readInputs(deps, chatId)).document;
  return d ? publicOf(d) : null;
}

/** Prend le fichier et l'efface. */
export function takeDocument(deps: InputsDeps, chatId: string): Promise<ReceivedDocument | null> {
  return serialized(chatId, async () => {
    const stored = await readInputs(deps, chatId);
    const d = stored.document ?? null;
    if (!d) return null;
    await writeInputs(deps, chatId, { ...stored, document: null });
    return publicOf(d);
  });
}
