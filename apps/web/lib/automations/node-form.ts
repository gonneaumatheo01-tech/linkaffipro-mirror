/**
 * Conversions entre l'affichage (champs de formulaire) et les données des relances : durées, boutons, langues.
 * Fonctions pures, partagées par les cartes et l'éditeur à branches (testées dans node-form.test.ts).
 */

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

export type ButtonRows = Array<Array<{ text: string; url: string }>>;

/** Boutons d'un message → une ligne par bouton (« Libellé | https://… »). */
export function buttonsToLines(rows: ButtonRows | undefined | null): string {
  return (rows ?? []).flatMap((r) => r.map((b) => `${b.text} | ${b.url}`)).join("\n");
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

/** Un bouton tel que saisi à l'écran (libellé et adresse, éventuellement incomplets). */
export type ButtonEntry = { text: string; url: string };

/** 10 boutons au plus sous un message de relance. */
export const MAX_BUTTONS = 10;

/** Boutons d'un message → lignes de saisie « Libellé » / « Adresse » (un bouton par rangée). */
export function buttonsToEntries(rows: ButtonRows | undefined | null): ButtonEntry[] {
  return (rows ?? []).flatMap((r) => r.map((b) => ({ text: b.text, url: b.url })));
}

/**
 * Lignes de saisie → rangées d'un bouton chacune (même forme enregistrée qu'avant). Une ligne entièrement vide est
 * ignorée ; un libellé manquant ou une adresse qui ne commence pas par http(s):// donne une erreur en français, avec
 * le rang de la ligne fautive (`index`) pour la signaler à côté du champ.
 */
export function entriesToButtons(
  entries: readonly ButtonEntry[],
): { ok: true; rows: ButtonRows } | { ok: false; error: string; index: number } {
  const rows: ButtonRows = [];
  for (let i = 0; i < entries.length; i++) {
    const text = entries[i]!.text.trim();
    const url = entries[i]!.url.trim();
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

/** Remplace {prenom}, {canal}, {bot} par des exemples (aperçu) ; les autres mots restent tels quels. */
export function fillMessageExamples(text: string): string {
  return text.replace(
    /\{(prenom|canal|bot)\}/g,
    (_m, k: keyof typeof MESSAGE_EXAMPLES) => MESSAGE_EXAMPLES[k],
  );
}
