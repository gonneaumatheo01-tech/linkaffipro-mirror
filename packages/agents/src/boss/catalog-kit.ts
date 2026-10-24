/**
 * Outils communs des entrées du catalogue du Boss (phase 26) : déclaration d'une entrée (schéma + validation par le
 * code depuis une seule spécification), formats (euros, listes), acteur journalisé.
 */
import type { BossAction, BossActionClass, BossActor, BossDeps, BossReply, BossTheme } from "./contract";
import { jsonSchemaOf, parseWith, type ParamSpec } from "./params";
import type { ActorRef } from "../admin/team";
import { esc } from "../admin/journal";

export type ActionDef<P> = {
  key: string;
  description: string;
  theme: BossTheme;
  cls: BossActionClass;
  spec: ParamSpec;
  /** Contrôle supplémentaire après la validation des types (pur). */
  refine?: (p: P) => string | null;
  classify?(deps: BossDeps, params: P): Promise<BossActionClass>;
  summarize?(deps: BossDeps, params: P): Promise<string>;
  execute(deps: BossDeps, params: P, actor: BossActor): Promise<BossReply>;
};

/** Entrée du catalogue : `params` (schéma envoyé à l'IA) et `parse` viennent de la même spécification. */
export function defineAction<P>(def: ActionDef<P>): BossAction<P> {
  return {
    key: def.key,
    description: def.description,
    theme: def.theme,
    cls: def.cls,
    params: jsonSchemaOf(def.spec),
    parse(input) {
      const r = parseWith<P>(def.spec, input);
      if (!r.ok) return r;
      const extra = def.refine?.(r.params);
      return extra ? { ok: false, error: extra } : r;
    },
    ...(def.classify ? { classify: def.classify } : {}),
    ...(def.summarize ? { summarize: def.summarize } : {}),
    execute: def.execute,
  };
}

export function actorRef(actor: BossActor): ActorRef {
  return { userId: actor.userId, via: "TELEGRAM" };
}

export const eur = (cents: number) =>
  `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Réponse texte (HTML échappé, lignes vides retirées). */
export function lines(...ls: (string | null | undefined | false)[]): BossReply {
  return { reply: ls.filter((l): l is string => typeof l === "string" && l.length > 0).join("\n") };
}

export function escLines(ls: readonly string[]): string {
  return ls.map(esc).join("\n");
}

/** Réponse d'un résultat `{ ok, message }` d'une fonction de domaine. */
export function fromResult(r: { ok: boolean; message: string }): BossReply {
  return { reply: esc(r.message) };
}
