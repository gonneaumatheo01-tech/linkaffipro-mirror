/**
 * Entrées du catalogue de Kevin pour les envois programmés (moteur dans `routines.ts`) :
 * - `programmer_envoi` (« envoie chaque matin les canaux paris sportifs trouvés à @Raul_FNZ », « envoie-moi tous les
 *   lundis les dépenses du mois », « envoie à Léa les paris du jour ») : à confirmer par OUI ; contenu et destinataire
 *   trouvés AVANT la question, gardés tels quels jusqu'au OUI ; « maintenant » envoie une seule fois ;
 * - `envois_programmes` (« mes envois programmés ») ;
 * - `arreter_envoi` (« arrête l'envoi 2 », « arrête tous les envois programmés »).
 * Droits : créer et arrêter = l'admin seul (`team/rights.ts`).
 */
import { esc } from "../admin/journal";
import type { BossAction, BossDeps, BossReply } from "./contract";
import { defineAction } from "./catalog-kit";
import { int, oneOf, str, bool } from "./params";
import {
  addRoutine,
  clearRoutineDraft,
  contentLabel,
  listRoutines,
  readRoutineDraft,
  resolveRoutineContent,
  resolveRoutineTarget,
  ROUTINE_DAYS,
  ROUTINE_DEFAULT_HOUR,
  ROUTINES_VARIANTS as V,
  routineBody,
  routineWhenText,
  sendRoutine,
  tickRoutines,
  type RoutinesTickResult,
  stopRoutines,
  targetLabel,
  writeRoutineDraft,
  type RoutineDays,
  type RoutineDraft,
} from "./routines";
import { pick } from "./voice";

type ScheduleP = { quoi: string; a_qui?: string; quand?: RoutineDays; heure?: number; minute?: number };

/** Catalogue et recherche d'une entrée, branchés par `catalog.ts` (évite un import circulaire). */
let catalogPort: { all: () => readonly BossAction[]; byKey: (key: string) => BossAction | null } | null = null;
export function setRoutinesCatalog(port: NonNullable<typeof catalogPort>): void {
  catalogPort = port;
}
export function routinesCatalog(): NonNullable<typeof catalogPort> {
  if (!catalogPort) throw new Error("catalogue des envois programmés non branché");
  return catalogPort;
}

const daysOf = (p: ScheduleP): RoutineDays => p.quand ?? "tous_les_jours";
const timing = (p: ScheduleP) => ({ hour: p.heure ?? ROUTINE_DEFAULT_HOUR, minute: p.minute ?? 0 });

/** Contenu et destinataire (un appel d'IA), gardés pour le OUI ; ou la réponse qui bloque. */
async function prepare(deps: BossDeps, p: ScheduleP): Promise<{ ok: true; draft: RoutineDraft } | { ok: false; reply: BossReply }> {
  const target = await resolveRoutineTarget(deps, p.a_qui);
  if (!target.ok) return { ok: false, reply: { reply: target.reply } };
  const content = await resolveRoutineContent(deps, p.quoi, routinesCatalog().all());
  if (!content.ok) return { ok: false, reply: { reply: pick(V.noContent, "routines.noContent") } };
  const draft: RoutineDraft = { content: content.content, label: content.label, target: target.target, targetLabel: target.label };
  await writeRoutineDraft(deps, p as Record<string, unknown>, draft);
  return { ok: true, draft };
}

export const programmerEnvoi = defineAction<ScheduleP>({
  key: "programmer_envoi",
  description:
    "Envoyer une information que je sais donner (liste, état, chiffres, réponse) à quelqu'un, maintenant ou chaque jour / en semaine / un jour précis à une heure (« envoie chaque matin les canaux paris sportifs trouvés à @Raul_FNZ », « envoie-moi tous les lundis à 8 h les dépenses du mois », « envoie au groupe les paris du jour à 10 h »)",
  theme: "etat",
  cls: "confirm",
  spec: {
    quoi: str("Ce qu'il faut envoyer, recopié tel que dit (« tous les canaux paris sportifs que tu as trouvés »)", { maxLength: 600 }),
    a_qui: str("À qui, tel que dit : « moi », « le groupe », « @Raul_FNZ », un prénom (vide = l'admin)", { optional: true, maxLength: 80 }),
    quand: oneOf("maintenant (une fois), tous_les_jours, semaine (lundi au vendredi) ou un jour (lundi… dimanche) ; « chaque matin » = tous_les_jours", ROUTINE_DAYS, true),
    heure: int("Heure de Paris (matin = 9, midi = 12, soir = 20)", 0, 23, true),
    minute: int("Minutes", 0, 59, true),
  },
  async check(deps, p) {
    const r = await prepare(deps, p);
    return r.ok ? null : r.reply;
  },
  async summarize(deps, p) {
    const draft = (await readRoutineDraft(deps, p as Record<string, unknown>)) ?? (await prepare(deps, p).then((r) => (r.ok ? r.draft : null)));
    if (!draft) return contentLabel(p.quoi);
    const days = daysOf(p);
    const when = days === "maintenant" ? "Maintenant" : routineWhenText({ days, ...timing(p) }).replace(/^./, (c) => c.toUpperCase());
    return `${when}, j'envoie à ${draft.targetLabel} : ${draft.label}.`;
  },
  async execute(deps, p) {
    let draft = await readRoutineDraft(deps, p as Record<string, unknown>);
    if (!draft) {
      const r = await prepare(deps, p);
      if (!r.ok) return r.reply;
      draft = r.draft;
    }
    await clearRoutineDraft(deps, p as Record<string, unknown>);
    const days = daysOf(p);
    const to = esc(targetLabel(draft.target));
    if (days === "maintenant") {
      // Pour l'admin lui-même, le contenu est la réponse.
      if (draft.target.kind === "admin")
        return (await routineBody(deps, { what: p.quoi, content: draft.content }, routinesCatalog().byKey)) ?? { reply: pick(V.noContent, "routines.noContent") };
      const sent = await sendRoutine(deps, { what: p.quoi, content: draft.content, target: draft.target }, routinesCatalog().byKey, { scheduled: false });
      return { reply: sent ? pick(V.sentNow({ to }), "routines.sentNow") : pick(V.sendFailedNow({ to }), "routines.sendFailedNow") };
    }
    const added = await addRoutine(deps, { what: p.quoi, content: draft.content, target: draft.target, days, ...timing(p) });
    if (!added.ok) return { reply: added.reply };
    return { reply: pick(V.created({ when: esc(routineWhenText(added.routine)), to }), "routines.created") };
  },
});

export const envoisProgrammes = defineAction<Record<string, never>>({
  key: "envois_programmes",
  description: "Lister les envois programmés (quoi, à qui, quand), numérotés (« mes envois programmés »)",
  theme: "etat",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const items = await listRoutines(deps);
    if (!items.length) return { reply: pick(V.emptyList, "routines.empty") };
    return {
      reply: [
        esc(pick(V.listHead({ count: items.length }), "routines.listHead")),
        ...items.map((r, i) => `${i + 1}. ${esc(routineWhenText(r))} → ${esc(targetLabel(r.target))} : ${esc(contentLabel(r.what))}`),
        esc(pick(V.listTail, "routines.listTail")),
      ].join("\n"),
    };
  },
});

export const arreterEnvoi = defineAction<{ numero?: number; tous?: boolean }>({
  key: "arreter_envoi",
  description: "Arrêter un envoi programmé par son numéro, ou tous (« arrête l'envoi 2 », « arrête tous les envois programmés »)",
  theme: "etat",
  cls: "immediate",
  spec: {
    numero: int("Numéro de l'envoi dans « mes envois programmés »", 1, 30, true),
    tous: bool("Tous les envois programmés", true),
  },
  async execute(deps, p) {
    if (!p.tous && !p.numero) {
      const items = await listRoutines(deps);
      if (items.length !== 1) return { reply: pick(V.stopWhich, "routines.stopWhich") };
    }
    const gone = await stopRoutines(deps, p.tous ? { all: true } : { n: p.numero ?? 1 });
    if (!gone.length) return { reply: pick(V.stopWhich, "routines.stopWhich") };
    if (p.tous) return { reply: pick(V.stoppedAll({ count: gone.length }), "routines.stoppedAll") };
    const r = gone[0]!;
    return { reply: pick(V.stopped({ what: esc(contentLabel(r.what)), to: esc(targetLabel(r.target)) }), "routines.stopped") };
  },
});

export const ROUTINE_ACTIONS: BossAction[] = [programmerEnvoi, envoisProgrammes, arreterEnvoi] as unknown as BossAction[];

/** Tâche `routines-tick` du worker : envois programmés dus (catalogue branché par `catalog.ts`). Ne lève jamais. */
export async function tickBossRoutines(deps: BossDeps): Promise<RoutinesTickResult> {
  return tickRoutines(deps, routinesCatalog().byKey);
}
