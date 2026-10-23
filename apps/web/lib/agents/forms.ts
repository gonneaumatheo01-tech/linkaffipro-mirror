/**
 * Lecture des formulaires de la rubrique Agents (pur, testé dans forms.test.ts) : réglages d'une équipe, plan d'un
 * canal, réglages généraux (modèles, médiathèque), clé d'un fournisseur. Messages d'erreur en français simple.
 * Aucun de ces enregistrements n'appelle une IA : ce sont des réglages lus par le Grand Chef à son prochain passage.
 */
import { z } from "zod";
import { AI_MODEL_IDS } from "@linkaffipro/ai";
import type { ProviderKey } from "@linkaffipro/agents";
import { DEFAULT_MAX_TEXT_LENGTH, type QuietHours } from "./config";

export type FormResult<T> = { ok: true; data: T } | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function checked(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "1" || v === "true";
}

/** Nombre saisi (virgule ou point) ; vide → `undefined`. */
function num(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function intField(
  fd: FormData,
  key: string,
  label: string,
  { min, max }: { min: number; max: number },
): { ok: true; value: number } | { ok: false; error: string } {
  const n = num(str(fd, key));
  if (n === undefined || Number.isNaN(n)) return { ok: false, error: `${label} : saisissez un nombre.` };
  if (!Number.isInteger(n)) return { ok: false, error: `${label} : saisissez un nombre entier.` };
  if (n < min) return { ok: false, error: `${label} : au moins ${min}.` };
  if (n > max) return { ok: false, error: `${label} : au plus ${max}.` };
  return { ok: true, value: n };
}

/** Liste saisie en texte : une valeur par ligne ou séparées par des virgules, sans doublon (casse ignorée). */
export function splitList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]/)) {
    const t = part.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** Heures calmes : une plage « HH:MM-HH:MM » par ligne (Europe/Paris) ; une plage peut passer minuit. */
export function parseQuietHoursText(raw: string): FormResult<QuietHours[]> {
  const out: QuietHours[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(\d{1,2})[:h](\d{2})\s*[-–à]+\s*(\d{1,2})[:h](\d{2})$/i.exec(t.replace(/\s+à\s+/i, "-"));
    const start = m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : "";
    const end = m ? `${m[3]!.padStart(2, "0")}:${m[4]}` : "";
    if (!m || !HHMM.test(start) || !HHMM.test(end))
      return {
        ok: false,
        error: `Heures calmes : « ${t} » n'est pas une plage valide. Écrivez par exemple 23:00-08:00, une plage par ligne.`,
      };
    if (start === end)
      return { ok: false, error: `Heures calmes : la plage « ${t} » commence et finit à la même heure.` };
    out.push({ start, end });
  }
  if (out.length > 6) return { ok: false, error: "Heures calmes : 6 plages au plus." };
  return { ok: true, data: out };
}

/** Plafonds mensuels en euros (champ `budget_<fournisseur>`) → centimes ; vide = aucun plafond saisi. */
export function parseBudgetFields(
  fd: FormData,
  providers: readonly ProviderKey[],
  labels: Record<ProviderKey, string>,
): FormResult<Partial<Record<ProviderKey, number>>> {
  const out: Partial<Record<ProviderKey, number>> = {};
  for (const p of providers) {
    const n = num(str(fd, `budget_${p}`));
    if (n === undefined) continue;
    if (Number.isNaN(n) || n < 0)
      return { ok: false, error: `Plafond « ${labels[p]} » : saisissez un montant en euros (0 ou plus).` };
    if (n > 100_000) return { ok: false, error: `Plafond « ${labels[p]} » : 100 000 € au plus.` };
    out[p] = Math.round(n * 100);
  }
  return { ok: true, data: out };
}

export type TeamSettingsInput = {
  styleGuidelines: string;
  forbiddenWords: string[];
  maxTextLength: number;
  quietHours: QuietHours[];
  budgets: Partial<Record<ProviderKey, number>>;
};

/** Réglages d'une équipe (fiche d'équipe, bloc « Réglages de l'équipe »). */
export function parseTeamSettingsForm(
  fd: FormData,
  providers: readonly ProviderKey[],
  labels: Record<ProviderKey, string>,
): FormResult<TeamSettingsInput> {
  const styleGuidelines = str(fd, "styleGuidelines").trim();
  if (styleGuidelines.length > 4000)
    return { ok: false, error: "Consignes de style : 4 000 caractères au plus." };
  const forbiddenWords = splitList(str(fd, "forbiddenWords"));
  if (forbiddenWords.length > 200) return { ok: false, error: "Mots interdits : 200 au plus." };
  if (forbiddenWords.some((w) => w.length > 60))
    return { ok: false, error: "Mots interdits : 60 caractères au plus par mot ou expression." };
  const rawLength = str(fd, "maxTextLength").trim();
  let maxTextLength = DEFAULT_MAX_TEXT_LENGTH;
  if (rawLength) {
    const len = intField(fd, "maxTextLength", "Longueur maximale", { min: 50, max: 4000 });
    if (!len.ok) return len;
    maxTextLength = len.value;
  }
  const quiet = parseQuietHoursText(str(fd, "quietHours"));
  if (!quiet.ok) return quiet;
  const budgets = parseBudgetFields(fd, providers, labels);
  if (!budgets.ok) return budgets;
  return {
    ok: true,
    data: {
      styleGuidelines,
      forbiddenWords,
      maxTextLength,
      quietHours: quiet.data,
      budgets: budgets.data,
    },
  };
}

export type ChannelPlanInput = {
  channelId: string;
  enabled: boolean;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  minSpacingMinutes: number;
  mix: { video: number; photo: number; text: number };
  personaId: string | null;
  campaignId: string | null;
  themes: string[];
};

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Plan d'un canal (fiche d'équipe, bloc « Plan par canal »). */
export function parseChannelPlanForm(fd: FormData): FormResult<ChannelPlanInput> {
  const channelId = str(fd, "channelId").trim();
  if (!channelId) return { ok: false, error: "Canal inconnu : rechargez la page." };
  const posts = intField(fd, "postsPerDay", "Posts par jour", { min: 0, max: 24 });
  if (!posts.ok) return posts;
  const windowStart = str(fd, "windowStart").trim();
  const windowEnd = str(fd, "windowEnd").trim();
  if (!HHMM.test(windowStart) || !HHMM.test(windowEnd))
    return { ok: false, error: "Fenêtre horaire : saisissez deux heures, par exemple 09:00 et 22:00." };
  if (minutesOf(windowEnd) <= minutesOf(windowStart))
    return { ok: false, error: "Fenêtre horaire : la fin doit être après le début (même journée)." };
  const spacing = intField(fd, "minSpacingMinutes", "Espacement minimal", { min: 0, max: 1440 });
  if (!spacing.ok) return spacing;
  const mix = { video: 0, photo: 0, text: 0 };
  for (const [k, label] of [
    ["video", "vidéo"],
    ["photo", "photo"],
    ["text", "texte"],
  ] as const) {
    const raw = str(fd, `mix_${k}`).trim();
    if (!raw) continue;
    const part = intField(fd, `mix_${k}`, `Part « ${label} »`, { min: 0, max: 100 });
    if (!part.ok) return part;
    mix[k] = part.value;
  }
  if (mix.video + mix.photo + mix.text === 0)
    return { ok: false, error: "Mélange : donnez une part à au moins un type de post (vidéo, photo ou texte)." };
  const themes = splitList(str(fd, "themes"));
  if (themes.length > 30 || themes.some((t) => t.length > 60))
    return { ok: false, error: "Thèmes : 30 au plus, 60 caractères au plus chacun." };
  return {
    ok: true,
    data: {
      channelId,
      enabled: checked(fd, "enabled"),
      postsPerDay: posts.value,
      windowStart,
      windowEnd,
      minSpacingMinutes: spacing.value,
      mix,
      personaId: str(fd, "personaId").trim() || null,
      campaignId: str(fd, "campaignId").trim() || null,
      themes,
    },
  };
}

/** Le quota du jour tient-il dans la fenêtre avec l'espacement demandé ? (avertissement affiché, pas une erreur) */
export function planFitsWindow(p: Pick<ChannelPlanInput, "postsPerDay" | "windowStart" | "windowEnd" | "minSpacingMinutes">): boolean {
  if (p.postsPerDay <= 1) return true;
  return (p.postsPerDay - 1) * p.minSpacingMinutes <= minutesOf(p.windowEnd) - minutesOf(p.windowStart);
}

const modelSchema = z.enum(AI_MODEL_IDS as unknown as [string, ...string[]], {
  error: "Choisissez un modèle de la liste.",
});

export type AgentsSettingsInput = { fast: string; strong: string; libraryChannelId: string | null };

/** Réglages généraux (`/agents/settings`) : modèles rapide / fort et canal Médiathèque. */
export function parseAgentsSettingsForm(fd: FormData): FormResult<AgentsSettingsInput> {
  const fast = modelSchema.safeParse(str(fd, "modelFast"));
  if (!fast.success) return { ok: false, error: "IA rapide : choisissez un modèle de la liste." };
  const strong = modelSchema.safeParse(str(fd, "modelStrong"));
  if (!strong.success) return { ok: false, error: "IA d'écriture : choisissez un modèle de la liste." };
  return {
    ok: true,
    data: {
      fast: fast.data,
      strong: strong.data,
      libraryChannelId: str(fd, "libraryChannelId").trim() || null,
    },
  };
}

/** Clé collée pour un fournisseur : seule, sans espace, d'une longueur raisonnable. */
export function parseSecretValue(raw: string): FormResult<string> {
  const v = raw.trim();
  if (!v) return { ok: false, error: "Collez d'abord la clé dans le champ." };
  if (v.length > 500) return { ok: false, error: "La clé semble trop longue : collez-la seule, sans autre texte." };
  if (!/^\S{8,}$/.test(v)) return { ok: false, error: "Collez la clé entièrement, sans espace." };
  return { ok: true, data: v };
}
