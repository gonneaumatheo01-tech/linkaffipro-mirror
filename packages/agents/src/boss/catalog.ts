/**
 * Catalogue FERMÉ des actions du Boss (Kevin, phase 26, règle 2). L'IA ne fait que choisir UNE entrée avec des
 * paramètres typés ; le code valide (`parse`), classe (immédiate / à confirmer), résume et exécute par les fonctions
 * existantes. Une action absente de ce catalogue n'existe pas pour le Boss. Outils spéciaux de l'interprète (hors
 * catalogue) : `preciser`, `repondre_question`, `pas_prevu`.
 *
 * Droits : `bossActionAllowed(action, speaker)` rend vrai pour l'admin (speaker absent ou `kind: "admin"`) ; le mode
 * groupe (section 4) l'étendra aux membres présentés.
 */
import type { BossAction, BossSpeaker } from "./contract";
import { defineAction } from "./catalog-kit";
import { READ_ACTIONS } from "./catalog-read";
import { TEAM_ACTIONS } from "./catalog-teams";
import { UNIVERSE_ACTIONS } from "./catalog-univers";
import { bossHelpText } from "./help";
import { bossStartReply } from "./guide";
import { clearBossPending, NOTHING_TO_CANCEL, PENDING_CANCELLED, readBossPending } from "./confirm";
import { clearClarify } from "./resolve";
import { readBossName } from "./memory";

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
    return { reply: PENDING_CANCELLED };
  },
});

export const GUIDE_ACTIONS: BossAction[] = [aide, commencer, annule] as unknown as BossAction[];

export const BOSS_CATALOG: BossAction[] = [...READ_ACTIONS, ...TEAM_ACTIONS, ...UNIVERSE_ACTIONS, ...GUIDE_ACTIONS];

const BY_KEY = new Map(BOSS_CATALOG.map((a) => [a.key, a]));

export function bossAction(key: string): BossAction | null {
  return BY_KEY.get(key) ?? null;
}

/** Outils spéciaux de l'interprète (jamais exécutés comme des actions). */
export const BOSS_SPECIAL_TOOLS = ["preciser", "repondre_question", "pas_prevu"] as const;

/**
 * La personne qui parle peut-elle demander cette action ? Admin : tout. Membre (mode groupe, à venir) : refusé
 * pour l'instant ; l'équipier du groupe étendra ici (lecture et actions immédiates des équipes couvertes).
 */
export function bossActionAllowed(action: Pick<BossAction, "key" | "cls">, speaker?: BossSpeaker | null): boolean {
  if (!speaker || speaker.kind === "admin") return true;
  void action;
  return false;
}
