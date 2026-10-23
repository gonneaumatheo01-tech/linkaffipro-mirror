/**
 * Passages du Chef Paris (phase 23) : heures de passage faites aujourd'hui et passages « 2 h avant un match retenu »
 * à venir, dans `Setting` `agents.sports.passages` (`{ day, done: number[], triggers: [{ at, categoryId }] }`).
 * Règle PURE `duePassage` + lecture / écriture.
 */
import { readSetting, writeSetting } from "../admin/journal";
import { parisDay, parisParts } from "../rules/time";
import type { AgentsDeps } from "../types";

export const SPORTS_PASSAGES_SETTING = "agents.sports.passages";
const MAX_TRIGGERS = 30;

export type PassageTrigger = { at: string; categoryId: string };
export type PassageState = { day: string; done: number[]; triggers: PassageTrigger[] };

export function parsePassageState(v: unknown): PassageState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    day: typeof o.day === "string" ? o.day : "",
    done: Array.isArray(o.done) ? o.done.filter((h): h is number => typeof h === "number") : [],
    triggers: Array.isArray(o.triggers)
      ? o.triggers.filter((t): t is PassageTrigger => !!t && typeof (t as PassageTrigger).at === "string" && typeof (t as PassageTrigger).categoryId === "string")
      : [],
  };
}

export type DuePassage = { due: boolean; reason: string | null; next: PassageState; categoryIds: string[] | null };

/**
 * Passage dû maintenant ? Une heure de passage passée et pas encore faite aujourd'hui (rattrapage dans les 3 h),
 * ou un passage « avant match » arrivé à son heure (seulement pour sa catégorie). Les heures plus anciennes sont
 * marquées faites sans passage (pas de rattrapage tardif).
 */
export function duePassage(state: PassageState, now: Date, runHours: readonly number[]): DuePassage {
  const day = parisDay(now);
  const hour = parisParts(now).hour;
  const done = state.day === day ? [...state.done] : [];
  const pastHours = runHours.filter((h) => h <= hour && !done.includes(h));
  const catchUp = pastHours.filter((h) => hour - h < 3);
  const fired = state.triggers.filter((t) => new Date(t.at).getTime() <= now.getTime());
  const triggers = state.triggers.filter((t) => new Date(t.at).getTime() > now.getTime());
  const next: PassageState = { day, done: [...done, ...pastHours].sort((a, b) => a - b), triggers };
  if (catchUp.length) return { due: true, reason: `passage de ${catchUp[catchUp.length - 1]} h`, next, categoryIds: null };
  if (fired.length) return { due: true, reason: "passage avant un match", next, categoryIds: [...new Set(fired.map((t) => t.categoryId))] };
  return { due: false, reason: null, next, categoryIds: null };
}

export async function readPassageState(deps: Pick<AgentsDeps, "prisma">): Promise<PassageState> {
  return parsePassageState(await readSetting(deps, SPORTS_PASSAGES_SETTING));
}

export async function writePassageState(deps: Pick<AgentsDeps, "prisma">, s: PassageState): Promise<void> {
  await writeSetting(deps, SPORTS_PASSAGES_SETTING, s);
}

/** Ajoute des passages N heures avant ces coups d'envoi (un par catégorie et par heure, jamais dans le passé). */
export async function addKickoffTriggers(deps: Pick<AgentsDeps, "prisma"> & { now: () => Date }, categoryId: string, kickoffs: readonly Date[], hoursBefore: number): Promise<void> {
  if (!kickoffs.length || hoursBefore <= 0) return;
  const s = await readPassageState(deps);
  const now = deps.now().getTime();
  const keyOf = (t: PassageTrigger) => `${t.categoryId}|${t.at.slice(0, 13)}`;
  const have = new Set(s.triggers.map(keyOf));
  for (const k of kickoffs) {
    const at = new Date(k.getTime() - hoursBefore * 3_600_000);
    if (at.getTime() <= now) continue;
    const t = { at: at.toISOString(), categoryId };
    if (have.has(keyOf(t))) continue;
    have.add(keyOf(t));
    s.triggers.push(t);
  }
  s.triggers = s.triggers.sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX_TRIGGERS);
  await writePassageState(deps, s);
}
