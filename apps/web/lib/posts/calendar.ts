/**
 * Calendrier des messages (vue semaine, heure de Paris) : jours, libellés, placement des messages dans la grille,
 * déplacement par glisser-déposer, vue « jour par jour » du téléphone et adresses de navigation.
 * Fonctions pures (aucun accès base), testées dans calendar.test.ts ; utilisables côté serveur et côté client.
 * Un jour est une clé « AAAA-MM-JJ » (date de Paris) : l'arithmétique se fait sur la date, jamais en ajoutant
 * 24 h à un instant (sinon la semaine du changement d'heure saute ou se répète).
 */
import { fromParisLocal, toParisLocalInput } from "./time";

/** Jour du calendrier, « AAAA-MM-JJ » (date de Paris). */
export type DayKey = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MONTHS_SHORT = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DAYS_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Première et dernière heure affichées par défaut (une ligne par heure). */
export const FIRST_HOUR = 6;
export const LAST_HOUR = 23;

function parts(key: DayKey): [number, number, number] {
  const m = DAY_RE.exec(key);
  if (!m) throw new Error(`jour invalide : ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Vrai pour une date réelle au format « AAAA-MM-JJ » (le 31 février est refusé). */
export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== "string") return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Jour + n jours (n négatif possible), sur la date seule. */
export function addDayKey(key: DayKey, n: number): DayKey {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Jour de la semaine : 1 = lundi … 7 = dimanche (comme les meilleurs horaires du worker). */
export function weekdayOf(key: DayKey): number {
  const [y, m, d] = parts(key);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Lundi de la semaine du jour. */
export function mondayOf(key: DayKey): DayKey {
  return addDayKey(key, 1 - weekdayOf(key));
}

/** Les 7 jours (lundi → dimanche) de la semaine qui commence le lundi donné. */
export function weekDayKeys(monday: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, i) => addDayKey(monday, i));
}

/** Aujourd'hui à Paris. */
export function parisTodayKey(now: Date = new Date()): DayKey {
  return toParisLocalInput(now).slice(0, 10);
}

/** Semaine affichée : lundi de la semaine demandée (`?week=`, n'importe quel jour), sinon de la semaine en cours. */
export function resolveWeek(param: unknown, now: Date = new Date()): DayKey {
  return mondayOf(isDayKey(param) ? param : parisTodayKey(now));
}

/**
 * Jour affiché sur téléphone : celui demandé (`?day=`) s'il est dans la semaine, sinon aujourd'hui si la semaine
 * le contient, sinon le lundi.
 */
export function resolveDay(param: unknown, monday: DayKey, now: Date = new Date()): DayKey {
  const days = weekDayKeys(monday);
  if (isDayKey(param) && days.includes(param)) return param;
  const today = parisTodayKey(now);
  return days.includes(today) ? today : monday;
}

function dayNum(d: number): string {
  return d === 1 ? "1er" : String(d);
}

/**
 * « Semaine du 5 au 11 octobre » ; « Semaine du 28 septembre au 4 octobre » ; l'année est ajoutée quand ce n'est
 * pas celle d'aujourd'hui (« Semaine du 5 au 11 octobre 2025 ») ou quand la semaine change d'année.
 */
export function weekLabel(monday: DayKey, today: DayKey = parisTodayKey()): string {
  const [y1, m1, d1] = parts(monday);
  const [y2, m2, d2] = parts(addDayKey(monday, 6));
  const thisYear = parts(today)[0];
  if (y1 !== y2)
    return `Semaine du ${dayNum(d1)} ${MONTHS[m1 - 1]} ${y1} au ${dayNum(d2)} ${MONTHS[m2 - 1]} ${y2}`;
  const year = y1 !== thisYear ? ` ${y1}` : "";
  if (m1 === m2) return `Semaine du ${dayNum(d1)} au ${dayNum(d2)} ${MONTHS[m2 - 1]}${year}`;
  return `Semaine du ${dayNum(d1)} ${MONTHS[m1 - 1]} au ${dayNum(d2)} ${MONTHS[m2 - 1]}${year}`;
}

/** « lun. 5 oct. » (en-tête de colonne). */
export function dayLabelShort(key: DayKey): string {
  const [, m, d] = parts(key);
  return `${DAYS_SHORT[weekdayOf(key) - 1]} ${dayNum(d)} ${MONTHS_SHORT[m - 1]}`;
}

/** « lundi 5 octobre » (titre du jour sur téléphone, phrases). */
export function dayLabelLong(key: DayKey): string {
  const [, m, d] = parts(key);
  return `${DAYS[weekdayOf(key) - 1]} ${dayNum(d)} ${MONTHS[m - 1]}`;
}

/** Initiale du jour (« L », « M »…) pour la bande des jours du téléphone. */
export function dayInitial(key: DayKey): string {
  return DAYS[weekdayOf(key) - 1]!.charAt(0).toUpperCase();
}

/** Numéro du jour dans le mois (« 5 »). */
export function dayOfMonth(key: DayKey): number {
  return parts(key)[2];
}

/** « 14:30 », « 09:00 ». */
export function timeLabel(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** « 19 h » (ligne de la grille, créneau). */
export function hourLabel(hour: number): string {
  return `${hour} h`;
}

/** Valeur d'un champ date et heure (heure de Paris) : « 2026-10-06T19:00 ». */
export function localInput(day: DayKey, hour: number, minute = 0): string {
  return `${day}T${timeLabel(hour, minute)}`;
}

/** Découpe « AAAA-MM-JJTHH:MM » ; null si la forme est fausse. */
export function splitLocal(local: string): { day: DayKey; hour: number; minute: number } | null {
  const m = LOCAL_RE.exec(local);
  if (!m || !isDayKey(m[1])) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { day: m[1]!, hour, minute };
}

/** « mardi 6 octobre à 14:30 » (confirmation d'un déplacement, nom accessible). */
export function momentLabel(local: string): string {
  const s = splitLocal(local);
  return s ? `${dayLabelLong(s.day)} à ${timeLabel(s.hour, s.minute)}` : local;
}

/** Instant → heure de Paris « AAAA-MM-JJTHH:MM ». */
export function toLocal(d: Date): string {
  return toParisLocalInput(d);
}

/**
 * Heures affichées dans la grille : de 6 h à 23 h, étendues vers le haut si un message (ou un créneau conseillé)
 * tombe plus tôt dans la nuit. Jamais d'heure masquée qui contiendrait un message.
 */
export function visibleHours(usedHours: number[]): number[] {
  const first = Math.min(FIRST_HOUR, ...usedHours.filter((h) => h >= 0 && h <= 23));
  return Array.from({ length: LAST_HOUR - first + 1 }, (_, i) => first + i);
}

/** Clé d'une case jour × heure. */
export function cellKey(day: DayKey, hour: number): string {
  return `${day}:${hour}`;
}

/** Élément plaçable dans la grille : son heure de Paris « AAAA-MM-JJTHH:MM ». */
export type Placeable = { id: string; local: string };

function byTime<T extends Placeable>(a: T, b: T): number {
  return a.local < b.local ? -1 : a.local > b.local ? 1 : a.id < b.id ? -1 : 1;
}

/** Messages de la semaine rangés par case (jour × heure), chacun trié par heure ; hors semaine : ignorés. */
export function placeInWeek<T extends Placeable>(items: T[], days: DayKey[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of [...items].sort(byTime)) {
    const s = splitLocal(item.local);
    if (!s || !days.includes(s.day)) continue;
    const key = cellKey(s.day, s.hour);
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

/** Messages d'un jour, triés par heure. */
export function itemsOfDay<T extends Placeable>(items: T[], day: DayKey): T[] {
  return items.filter((i) => i.local.startsWith(`${day}T`)).sort(byTime);
}

/** Nombre de messages par jour de la semaine (bande des jours du téléphone). */
export function countByDay<T extends Placeable>(
  items: T[],
  days: DayKey[],
): Record<DayKey, number> {
  const out: Record<DayKey, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const i of items) {
    const day = i.local.slice(0, 10);
    if (day in out) out[day]! += 1;
  }
  return out;
}

/** Nouvelle heure d'un message déposé sur une case : le jour et l'heure de la case, les minutes du message. */
export function dropTarget(currentLocal: string, day: DayKey, hour: number): string {
  const minute = splitLocal(currentLocal)?.minute ?? 0;
  return localInput(day, hour, minute);
}

/** Tolérance commune avec le formulaire : une date passée de moins d'une minute est acceptée. */
export const PAST_TOLERANCE_MS = 60_000;

/** Moment passé (au-delà de la tolérance d'une minute) ; une valeur illisible compte comme passée. */
export function isPastLocal(local: string, now: Date = new Date()): boolean {
  const at = fromParisLocal(local);
  return !at || at.getTime() < now.getTime() - PAST_TOLERANCE_MS;
}

/** Case entièrement passée (sa fin est derrière nous) : on n'y dépose rien, on n'y programme rien. */
export function isPastSlot(day: DayKey, hour: number, now: Date = new Date()): boolean {
  const end =
    hour >= 23
      ? fromParisLocal(`${addDayKey(day, 1)}T00:00`)
      : fromParisLocal(localInput(day, hour + 1));
  return !end || end.getTime() <= now.getTime();
}

/** Maintenant, arrondi aux 5 minutes suivantes (au moins une minute d'avance pour avoir le temps d'enregistrer). */
function soonLocal(now: Date): string {
  const step = 5 * 60_000;
  return toLocal(new Date(Math.ceil((now.getTime() + 60_000) / step) * step));
}

/**
 * Heure proposée par une case du calendrier (« Programmer un message le … ») : son heure pleine si elle est à venir ;
 * pour la case de l'heure en cours (14 h à 14:20), maintenant arrondi aux 5 minutes suivantes (14:25), au lieu
 * d'un 14:00 déjà passé que le formulaire refuserait.
 */
export function slotStartLocal(day: DayKey, hour: number, now: Date = new Date()): string {
  const start = localInput(day, hour);
  return isPastLocal(start, now) && !isPastSlot(day, hour, now) ? soonLocal(now) : start;
}

/**
 * Date et heure pré-remplies dans « Programmer un message » à partir du paramètre `at` (heure de Paris) : gardée si
 * elle est à venir ; ramenée à maintenant (arrondi aux 5 minutes) si elle tombe dans l'heure en cours ; sinon null
 * (le formulaire propose alors le meilleur créneau du canal ou l'heure par défaut).
 */
export function presetScheduleLocal(at: unknown, now: Date = new Date()): string | null {
  if (typeof at !== "string") return null;
  const s = splitLocal(at);
  if (!s) return null;
  if (!isPastLocal(at, now)) return at;
  const current = splitLocal(toLocal(now));
  return current && current.day === s.day && current.hour === s.hour ? soonLocal(now) : null;
}

/** Statuts qu'on peut déplacer dans le calendrier : brouillon et programmé (jamais un message parti). */
export const MOVABLE_STATUSES = ["DRAFT", "SCHEDULED"] as const;

export function canMove(post: { status: string; isTemplate?: boolean }): boolean {
  return !post.isTemplate && (MOVABLE_STATUSES as readonly string[]).includes(post.status);
}

/** Statuts modifiables par le formulaire (mêmes que la page Modifier). */
export const EDITABLE_STATUSES = ["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"] as const;

export function canEdit(post: { status: string }): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(post.status);
}

/** Filtres du calendrier conservés dans les liens (semaine, jour, canal, univers, campagne, catégorie). */
export type CalendarQuery = {
  week?: DayKey;
  day?: DayKey;
  channelId?: string;
  vertical?: string;
  campaignId?: string;
  categoryId?: string;
};

/** Paramètres d'adresse du calendrier (seulement ceux qui sont posés). */
export function calendarParams(q: CalendarQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.week) p.set("week", q.week);
  if (q.day) p.set("day", q.day);
  if (q.channelId) p.set("channelId", q.channelId);
  if (q.vertical) p.set("vertical", q.vertical);
  if (q.campaignId) p.set("campaignId", q.campaignId);
  if (q.categoryId) p.set("category", q.categoryId);
  return p;
}

/** « /messages?week=…&channelId=… » (vue Calendrier, la vue par défaut). */
export function calendarHref(q: CalendarQuery): string {
  const qs = calendarParams(q).toString();
  return qs ? `/messages?${qs}` : "/messages";
}

/** Jour précédent / suivant sur téléphone, avec la semaine qui le contient (le lundi précédent → dimanche d'avant). */
export function dayNeighbours(day: DayKey): {
  prev: { day: DayKey; week: DayKey };
  next: { day: DayKey; week: DayKey };
} {
  const prev = addDayKey(day, -1);
  const next = addDayKey(day, 1);
  return { prev: { day: prev, week: mondayOf(prev) }, next: { day: next, week: mondayOf(next) } };
}

/** « Programmer un message à ce créneau » : formulaire pré-rempli (date et heure de Paris, canal s'il est connu). */
export function newPostHref(opts: {
  local?: string;
  channelId?: string;
  categoryId?: string;
}): string {
  const p = new URLSearchParams();
  if (opts.local) p.set("at", opts.local);
  if (opts.channelId) p.set("channel", opts.channelId);
  if (opts.categoryId) p.set("category", opts.categoryId);
  const qs = p.toString();
  return qs ? `/messages/new?${qs}` : "/messages/new";
}

/** Créneau conseillé placé dans la semaine affichée (voir best-slots.ts). */
export type DaySlot = { day: DayKey; hour: number; rank: number; label: string; detail: string };

/** Ligne de la vue « jour » du téléphone : un message, ou un créneau conseillé encore libre. */
export type AgendaEntry<T extends Placeable> =
  | { kind: "post"; key: string; item: T }
  | { kind: "slot"; key: string; slot: DaySlot; past: boolean };

/**
 * Vue « jour par jour » du téléphone : les messages du jour par heure, et les meilleurs créneaux du jour qui n'ont
 * pas encore de message à cette heure (placés à leur heure, marqués « passé » si l'heure est dépassée).
 */
export function dayAgenda<T extends Placeable>(
  items: T[],
  slots: DaySlot[],
  day: DayKey,
  now: Date = new Date(),
): AgendaEntry<T>[] {
  const posts = itemsOfDay(items, day);
  const busy = new Set(posts.map((p) => splitLocal(p.local)?.hour));
  const entries: Array<{ at: string; entry: AgendaEntry<T> }> = posts.map((item) => ({
    at: item.local,
    entry: { kind: "post", key: item.id, item },
  }));
  for (const slot of slots) {
    if (slot.day !== day || busy.has(slot.hour)) continue;
    entries.push({
      at: localInput(day, slot.hour),
      entry: {
        kind: "slot",
        key: `slot-${day}-${slot.hour}`,
        slot,
        past: isPastSlot(day, slot.hour, now),
      },
    });
  }
  // Comparaison cohérente (0 entre deux messages de la même minute : l'ordre de `itemsOfDay` est gardé). Sinon chaque
  // moteur de JavaScript range différemment et la page du serveur ne correspond plus à celle du navigateur.
  return entries
    .sort((a, b) =>
      a.at < b.at
        ? -1
        : a.at > b.at
          ? 1
          : a.entry.kind === b.entry.kind
            ? 0
            : a.entry.kind === "post"
              ? -1
              : 1,
    )
    .map((e) => e.entry);
}
