/**
 * Catalogue FERMÉ des actions du Boss (Kevin, phase 26, règle 2). L'IA ne fait que choisir UNE entrée avec des
 * paramètres typés ; le code valide (`parse`), classe (immédiate / à confirmer), résume et exécute par les fonctions
 * existantes. Une action absente de ce catalogue n'existe pas pour le Boss. Outils spéciaux de l'interprète (hors
 * catalogue) : `preciser`, `repondre_question`, `pas_prevu`.
 *
 * Droits : `bossActionAllowed(action, speaker, scope)` : l'admin (speaker absent ou `kind: "admin"`) peut tout ; un membre
 * présenté selon son rôle et ses équipes (`team/rights.ts`).
 */
import type { BossAction, BossSpeaker } from "./contract";
import { HIDDEN_BOSS_ACTIONS, TEAM_MEMBER_ACTIONS } from "./catalog-team";
import { bossRightsAllow, type BossRightsScope } from "./team/rights";
import { defineAction } from "./catalog-kit";
import { READ_ACTIONS, READ_HIDDEN_ACTIONS } from "./catalog-read";
import { TEAM_ACTIONS } from "./catalog-teams";
import { UNIVERSE_ACTIONS } from "./catalog-univers";
import { VIEW_ACTIONS } from "./catalog-view";
import { ORDER_ACTIONS } from "./catalog-orders";
import { ANALYSTS_ACTIONS } from "./catalog-analysts";
import { QA_ACTIONS } from "./catalog-qa";
import { PROSPECTION_ACTIONS } from "./catalog-prospection";
import { PROSPECTION_ADVANCED_ACTIONS } from "./catalog-prospection-advanced";
import { bossHelpText } from "./help";
import { bossStartReply } from "./guide";
import { bossDeferredFollowUp, clearBossPending, NOTHING_TO_CANCEL, PENDING_CANCELLED, readBossPending } from "./confirm";
import { clearClarify } from "./resolve";
import { readBossName } from "./memory";
import { SITE_HIDDEN_ACTIONS } from "../site/actions";

type Empty = Record<string, never>;

export const aide = defineAction<Empty>({
  key: "aide",
  description: "Dire tout ce que je sais faire, groupé par thème, avec des exemples de phrases",
  theme: "guide",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return { reply: bossHelpText(BOSS_CATALOG, await readBossName(deps)) };
  },
});

export const commencer = defineAction<Empty>({
  key: "commencer",
  description: "Guider la mise en route pas à pas (par où commencer, ce qui manque, une question à la fois)",
  theme: "guide",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    return bossStartReply(deps);
  },
});

export const annule = defineAction<Empty>({
  key: "annule",
  description: "Annuler l'action qui attend ta confirmation",
  theme: "guide",
  cls: "immediate",
  spec: {},
  async execute(deps) {
    const cur = await readBossPending(deps);
    await clearClarify(deps);
    if (!cur || cur.expired) {
      if (cur) await clearBossPending(deps, cur.id);
      return { reply: NOTHING_TO_CANCEL };
    }
    await clearBossPending(deps, cur.id);
    const followUp = await bossDeferredFollowUp(deps);
    return { reply: PENDING_CANCELLED, ...(followUp ? { followUp } : {}) };
  },
});

export const GUIDE_ACTIONS: BossAction[] = [aide, commencer, annule] as unknown as BossAction[];

export const BOSS_CATALOG: BossAction[] = [...READ_ACTIONS, ...TEAM_ACTIONS, ...UNIVERSE_ACTIONS, ...VIEW_ACTIONS, ...ANALYSTS_ACTIONS, ...QA_ACTIONS, ...PROSPECTION_ACTIONS, ...PROSPECTION_ADVANCED_ACTIONS, ...ORDER_ACTIONS, ...TEAM_MEMBER_ACTIONS, ...GUIDE_ACTIONS];

const BY_KEY = new Map(BOSS_CATALOG.map((a) => [a.key, a]));
// Phase 34 : opérations du site confirmées (OUI ; SUPPRIMER passe par le chemin rapide), jamais vues par l'IA.
const HIDDEN_BY_KEY = new Map([...HIDDEN_BOSS_ACTIONS, ...READ_HIDDEN_ACTIONS, ...SITE_HIDDEN_ACTIONS].map((a) => [a.key, a]));

/**
 * Entrée du catalogue par sa clé. `includeHidden` : aussi les entrées cachées (changement de groupe), exécutables
 * seulement après un OUI de l'admin ; l'IA ne les voit jamais et ne peut pas les choisir.
 */
export function bossAction(key: string, opts: { includeHidden?: boolean } = {}): BossAction | null {
  return BY_KEY.get(key) ?? (opts.includeHidden ? (HIDDEN_BY_KEY.get(key) ?? null) : null);
}

/** Outils spéciaux de l'interprète (jamais exécutés comme des actions). */
export const BOSS_SPECIAL_TOOLS = ["preciser", "repondre_question", "ordre_equipe", "pas_prevu"] as const;

/**
 * La personne qui parle peut-elle faire cette action elle-même ? Admin : tout. Membre présenté : selon son rôle et ses
 * équipes (`team/rights.ts` : lecture, actions immédiates des équipes couvertes, demandes et validations qui lui sont
 * adressées ; un responsable présente des membres). Une action à confirmer reste à l'admin.
 */
export function bossActionAllowed(
  action: Pick<BossAction, "key" | "cls"> & { theme?: BossAction["theme"] },
  speaker?: BossSpeaker | null,
  scope: BossRightsScope = {},
): boolean {
  return bossRightsAllow({ key: action.key, cls: action.cls, theme: action.theme ?? "guide" }, speaker, scope);
}
