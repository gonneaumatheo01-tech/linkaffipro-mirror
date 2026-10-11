/**
 * Conversions entre l'affichage (champs de formulaire) et les données des relances : durées, boutons, langues.
 * Fonctions pures, partagées par les cartes et l'éditeur à branches (testées dans node-form.test.ts).
 */
import { isOfferButton, type AutomationButton } from "@linkaffipro/core";

export type DelayUnit = "hours" | "days";

/** Durée en heures → valeur et unité affichées (« 2 jours » plutôt que « 48 h » quand c'est rond). */
export function hoursToDelay(hours: number | null | undefined): { value: string; unit: DelayUnit } {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours <= 0)
    return { value: "", unit: "hours" };
  if (hours >= 24 && hours % 24 === 0) return { value: String(hours / 24), unit: "days" };
  return { value: String(hours), unit: "hours" };
}

/** Valeur et unité saisies → heures (null si vide ou illisible ; la validation des bornes reste au core). */
export function delayToHours(value: string, unit: DelayUnit): number | null {
  const v = value.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round((unit === "days" ? n * 24 : n) * 100) / 100;
}

/** Boutons d'un message de relance : liens simples et boutons « Offre (campagne) » (une rangée par bouton). */
export type ButtonRows = AutomationButton[][];

/** Boutons d'un message → une ligne par bouton (« Libellé | https://… ») ; ancien champ texte, liens seulement. */
export function buttonsToLines(rows: ButtonRows | undefined | null): string {
  return (rows ?? [])
    .flatMap((r) => r.flatMap((b) => (isOfferButton(b) ? [] : [`${b.text} | ${b.url}`])))
    .join("\n");
}

/**
 * Une ligne par bouton (« Libellé | https://… ») → rangées d'un bouton chacune. Lignes vides ignorées ; un libellé
 * manquant ou une adresse qui ne commence pas par http(s):// donne une erreur en français (avec le numéro de ligne).
 */
export function linesToButtons(
  text: string,
): { ok: true; rows: ButtonRows } | { ok: false; error: string } {
  const rows: ButtonRows = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const sep = line.indexOf("|");
    const label = (sep >= 0 ? line.slice(0, sep) : line).trim();
    const url = (sep >= 0 ? line.slice(sep + 1) : "").trim();
    if (!label)
      return { ok: false, error: `Bouton ligne ${i + 1} : écrivez le libellé avant le « | ».` };
    if (!/^https?:\/\/\S+$/.test(url))
      return {
        ok: false,
        error: `Bouton « ${label} » : ajoutez son adresse après un « | » (elle commence par https://).`,
      };
    if (rows.length >= 10) return { ok: false, error: "10 boutons au plus sous un message." };
    rows.push([{ text: label.slice(0, 64), url }]);
  }
  return { ok: true, rows };
}

/**
 * Un bouton tel que saisi à l'écran (éventuellement incomplet) : un lien (libellé et adresse), ou un bouton
 * « Offre (campagne) » (`kind: "offer"`, libellé, notre campagne et son offre Link Affi ; l'adresse reste vide).
 */
export type ButtonEntry = {
  text: string;
  url: string;
  kind?: "link" | "offer";
  campaignId?: string;
  affiliateCampaignId?: string;
};

/** Vrai pour une ligne « Offre (campagne) ». */
export const isOfferEntry = (e: ButtonEntry): boolean => e.kind === "offer";

/**
 * Ligne de saisie lue d'un JSON (formulaire, brouillon de l'éditeur) : une ligne `{ kind: "offer" }` ou un bouton
 * enregistré `{ type: "OFFER" }` devient une ligne Offre ; tout le reste, une ligne de lien.
 */
export function toButtonEntry(raw: unknown): ButtonEntry {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (o.kind === "offer" || o.type === "OFFER")
    return {
      kind: "offer",
      text: s(o.text),
      url: "",
      campaignId: s(o.campaignId),
      affiliateCampaignId: s(o.affiliateCampaignId),
    };
  return { text: s(o.text), url: s(o.url) };
}

/**
 * Boutons d'un bloc de l'éditeur tels que saisis (lignes vides retirées, rien n'est perdu) : un bouton incomplet reste
 * dans le brouillon, où la validation de l'éditeur le signale (`toButtonEntry` le relit).
 */
export function draftButtonRows(
  entries: readonly ButtonEntry[],
): Array<Array<Record<string, string>>> {
  return entries
    .filter((e) => e.text.trim() || e.url.trim() || (isOfferEntry(e) && e.campaignId))
    .map((e): Array<Record<string, string>> => [
      isOfferEntry(e)
        ? {
            text: e.text.trim(),
            type: "OFFER",
            campaignId: e.campaignId ?? "",
            affiliateCampaignId: e.affiliateCampaignId ?? "",
          }
        : { text: e.text.trim(), url: e.url.trim() },
    ]);
}

/** Boutons de l'aperçu Telegram (libellés des lignes commencées, un bouton par rangée). */
export function previewButtonRows(entries: readonly ButtonEntry[]): Array<Array<{ text: string }>> {
  return entries
    .filter((e) => e.text.trim() || e.url.trim() || (isOfferEntry(e) && e.campaignId))
    .map((e) => [{ text: e.text.trim() }]);
}

/** 10 boutons au plus sous un message de relance. */
export const MAX_BUTTONS = 10;

/** Boutons d'un message → lignes de saisie (un bouton par rangée). */
export function buttonsToEntries(rows: ButtonRows | undefined | null): ButtonEntry[] {
  return (rows ?? []).flatMap((r) =>
    r.map((b): ButtonEntry =>
      isOfferButton(b)
        ? {
            kind: "offer",
            text: b.text,
            url: "",
            campaignId: b.campaignId,
            affiliateCampaignId: b.affiliateCampaignId,
          }
        : { text: b.text, url: b.url },
    ),
  );
}

/**
 * Lignes de saisie → rangées d'un bouton chacune (même forme enregistrée qu'avant pour un lien ; `{ text, type:
 * "OFFER", campaignId, affiliateCampaignId }` pour une offre). Une ligne entièrement vide est ignorée ; un libellé
 * manquant, une adresse qui ne commence pas par http(s):// ou une offre sans campagne donne une erreur en français,
 * avec le rang de la ligne fautive (`index`) pour la signaler à côté du champ.
 */
export function entriesToButtons(
  entries: readonly ButtonEntry[],
): { ok: true; rows: ButtonRows } | { ok: false; error: string; index: number } {
  const rows: ButtonRows = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const text = e.text.trim();
    if (isOfferEntry(e)) {
      const campaignId = e.campaignId?.trim() ?? "";
      const affiliateCampaignId = e.affiliateCampaignId?.trim() ?? "";
      if (!text && !campaignId) continue;
      if (!text) return { ok: false, index: i, error: `Bouton ${i + 1} : écrivez son libellé.` };
      if (!campaignId || !affiliateCampaignId)
        return {
          ok: false,
          index: i,
          error: `Bouton « ${text} » : choisissez la campagne de l'offre.`,
        };
      if (rows.length >= MAX_BUTTONS)
        return { ok: false, index: i, error: `${MAX_BUTTONS} boutons au plus sous un message.` };
      rows.push([{ text: text.slice(0, 64), type: "OFFER", campaignId, affiliateCampaignId }]);
      continue;
    }
    const url = e.url.trim();
    if (!text && !url) continue;
    if (!text) return { ok: false, index: i, error: `Bouton ${i + 1} : écrivez son libellé.` };
    if (!/^https?:\/\/\S+$/.test(url))
      return {
        ok: false,
        index: i,
        error: `Bouton « ${text} » : écrivez son adresse complète (elle commence par https://).`,
      };
    if (rows.length >= MAX_BUTTONS)
      return { ok: false, index: i, error: `${MAX_BUTTONS} boutons au plus sous un message.` };
    rows.push([{ text: text.slice(0, 64), url }]);
  }
  return { ok: true, rows };
}

/** Codes de langue → texte du champ (« fr, en »). */
export function languagesToText(list: readonly string[] | undefined | null): string {
  return (list ?? []).join(", ");
}

/** Texte du champ → codes de langue en minuscules, sans doublon (« FR, en ; es » → fr, en, es). */
export function textToLanguages(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\s]+/)) {
    const l = raw.trim().toLowerCase();
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** Forme d'un code de langue accepté par les relances (« fr », « pt-br »). */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

/**
 * Langues proposées en cases à cocher : celles des membres (`available`, déjà triées), puis celles déjà choisies qui
 * n'y sont pas (rien ne disparaît de l'écran).
 */
export function languageChoiceCodes(
  available: ReadonlyArray<{ code: string }>,
  selected: readonly string[],
): string[] {
  const out = available.map((l) => l.code.toLowerCase());
  for (const c of selected) if (!out.includes(c.toLowerCase())) out.push(c.toLowerCase());
  return out;
}

/** « Autre langue » saisie (« de, it ») → codes valides et morceaux refusés. */
export function parseLanguageCodes(raw: string): { codes: string[]; invalid: string[] } {
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const l of textToLanguages(raw.replace(/_/g, "-")))
    (LANGUAGE_CODE.test(l) ? codes : invalid).push(l);
  return { codes, invalid };
}

/** Ajoute ou retire une valeur d'une liste de cases cochées (ordre conservé). */
export function toggleInList<T>(list: readonly T[] | undefined, value: T, on: boolean): T[] {
  const cur = [...(list ?? [])];
  if (on) return cur.includes(value) ? cur : [...cur, value];
  return cur.filter((v) => v !== value);
}

/** Exemples des mots remplacés par le bot, pour l'aperçu d'un message de relance. */
export const MESSAGE_EXAMPLES = {
  prenom: "Léa",
  canal: "Casino VIP",
  bot: "LinkAffi Bot",
} as const;

/** Repères à insérer dans un message de relance (mêmes mots que l'exécution : prénom, canal, bot). */
export const MESSAGE_WORDS: ReadonlyArray<{ key: "prenom" | "canal" | "bot"; label: string }> = [
  { key: "prenom", label: "Prénom" },
  { key: "canal", label: "Nom du canal" },
  { key: "bot", label: "Nom du bot" },
];

/** Aide sous le texte d'un message de relance : les repères avec les mots des pastilles, jamais entre accolades. */
export const MESSAGE_FIELD_HELP = `Les repères en couleur (${MESSAGE_WORDS.map((w) => w.label).join(", ")}) sont remplacés pour chaque personne.`;

/** Remplace {prenom}, {canal}, {bot} par des exemples (aperçu) ; les autres mots restent tels quels. */
export function fillMessageExamples(text: string): string {
  return text.replace(
    /\{(prenom|canal|bot)\}/g,
    (_m, k: keyof typeof MESSAGE_EXAMPLES) => MESSAGE_EXAMPLES[k],
  );
}
