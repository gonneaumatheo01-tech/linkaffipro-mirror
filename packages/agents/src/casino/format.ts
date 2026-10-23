/**
 * Formats des posts du Chef Casino (règles pures) : format tiré du mélange du jour du canal (2 vidéos, 1 image, 1 texte
 * par défaut), cascade des replis (autre thème du canal → image → texte) et lignes du rapport du matin
 * (« 3 posts texte faute de vidéos : roulette »). Jamais de média produit par l'IA : un repli ne passe jamais par
 * Média IA.
 */
import { chooseFormat, type MediaFormat, type Mix } from "../agents/mediatheque/pick";

/** Événement d'un repli casino (`Event`, compté dans le rapport du matin). */
export const CASINO_FALLBACK_EVENT = "agents.casino.fallback";

/** Mélange par défaut d'un canal Casino (l'image est le format `photo` des types communs). */
export const CASINO_DEFAULT_MIX: Mix = Object.freeze({ video: 2, photo: 1, text: 1 });

/** Mélange de la base par défaut (`ChannelAgentPlan.mix`) : non réglé pour un canal casino. */
const DB_DEFAULT_MIX: Mix = { video: 0, photo: 0, text: 1 };

/** Mélange effectif d'un canal casino : le sien s'il est réglé, sinon le mélange casino par défaut. */
export function casinoMix(raw: Mix | null | undefined): Mix {
  if (!raw || raw.video + raw.photo + raw.text <= 0) return CASINO_DEFAULT_MIX;
  if (raw.video === DB_DEFAULT_MIX.video && raw.photo === DB_DEFAULT_MIX.photo && raw.text === DB_DEFAULT_MIX.text) return CASINO_DEFAULT_MIX;
  return raw;
}

export function casinoDayFormat(mix: Mix | null | undefined, plannedToday: readonly MediaFormat[]): MediaFormat {
  return chooseFormat(casinoMix(mix), plannedToday);
}

export type CasinoAttempt = { format: MediaFormat; theme: string | null };

/**
 * Essais dans l'ordre : le format voulu sur chaque thème (thème du jour d'abord), puis l'image sur chaque thème (pour
 * une vidéo), puis le texte sur le thème du jour.
 */
export function casinoAttempts(format: MediaFormat, themes: readonly string[]): CasinoAttempt[] {
  const first = themes[0] ?? null;
  if (format === "text") return [{ format: "text", theme: first }];
  const out: CasinoAttempt[] = themes.map((theme) => ({ format, theme }));
  if (format === "video") out.push(...themes.map((theme) => ({ format: "photo" as const, theme })));
  out.push({ format: "text", theme: first });
  return out;
}

export type CasinoFallback = { from: MediaFormat; to: MediaFormat; fromTheme: string | null; toTheme: string | null; reason: string; at: string };

const NOUN: Record<MediaFormat, [string, string]> = {
  video: ["vidéo", "vidéos"],
  photo: ["image", "images"],
  text: ["post texte", "posts texte"],
};
const LACK: Record<MediaFormat, string> = { video: "faute de vidéos", photo: "faute d'images", text: "" };

/** Lignes du rapport : une par sorte de repli, avec les thèmes qui manquaient (« 3 posts texte faute de vidéos : roulette »). */
export function casinoFallbackNotes(list: ReadonlyArray<Pick<CasinoFallback, "from" | "to" | "fromTheme" | "toTheme">>): string[] {
  const groups = new Map<string, { n: number; to: MediaFormat; from: MediaFormat; sameFormat: boolean; themes: string[] }>();
  for (const f of list) {
    if (f.from === "text") continue;
    const sameFormat = f.from === f.to;
    const key = `${f.from}>${f.to}`;
    const g = groups.get(key) ?? { n: 0, to: f.to, from: f.from, sameFormat, themes: [] };
    g.n++;
    if (f.fromTheme && !g.themes.includes(f.fromTheme)) g.themes.push(f.fromTheme);
    groups.set(key, g);
  }
  const order = ["video>text", "photo>text", "video>photo", "video>video", "photo>photo"];
  return [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([, g]) => {
      const noun = NOUN[g.to][g.n > 1 ? 1 : 0];
      const what = g.sameFormat ? `${g.n} ${noun} sur un autre thème` : `${g.n} ${noun}`;
      return `${what} ${LACK[g.from]}${g.themes.length ? ` : ${g.themes.join(", ")}` : ""}`;
    });
}
