/**
 * Dépôt d'un média casino par le bot (chantier B, phase 22) : thèmes tirés des mots-clés, question « Créer le thème
 * <x> » pour un thème inconnu (bouton, admin seulement), ligne de confirmation avec le stock (`casinoStock`).
 */
import type { PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import { nowOf } from "../admin/journal";
import { askHuman, onAnswerOf, OPEN_REQUEST_STATUSES } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { parseCasinoThemes } from "../library/tags";
import { applyCasinoThemes } from "./classify";
import { casinoStock, type CasinoStockRow } from "./contracts";
import { addCasinoTheme, casinoTagsFor, casinoThemesOfAsset, readCasinoThemes } from "./themes";

export const CREATE_THEME_ACTION = "casino-create-theme";

export type CasinoDepositInfo = {
  created: boolean;
  isVideo: boolean;
  /** Thèmes du média après le dépôt (connus seulement). */
  themes: string[];
  /** Thèmes inconnus : une question de création est posée pour chacun. */
  unknownThemes: string[];
};

/** Classement d'un média casino déposé : thèmes connus fusionnés avec ceux d'un doublon. */
export async function planCasinoDeposit(
  deps: Pick<AgentsDeps, "prisma">,
  captionTags: string[],
  existing: { tags: unknown; theme: string | null; teamKey: string | null } | null,
): Promise<{ tags: string[]; theme: string | null; themes: string[]; unknownThemes: string[] }> {
  const known = await readCasinoThemes(deps);
  const parsed = parseCasinoThemes(captionTags, known);
  const previous = casinoThemesOfAsset(existing);
  const themes = [...new Set([...previous, ...parsed.themes])];
  const { tags, theme } = casinoTagsFor(existing?.teamKey === "casino" ? existing.tags : [], themes);
  return { tags, theme, themes, unknownThemes: parsed.unknown };
}

function themeRequestKey(theme: string): string {
  return `casino.theme.${theme}`;
}

/**
 * Une question CONFIRM par thème inconnu (une seule tant qu'elle est ouverte : les médias suivants s'y ajoutent).
 * Le bouton « Créer le thème <x> » part avec la question (`onAnswer.buttonYes`).
 */
export async function askCreateCasinoThemes(deps: AgentsDeps, unknown: string[], assetId: string): Promise<void> {
  for (const theme of unknown) {
    const key = themeRequestKey(theme);
    const open = await deps.prisma.humanRequest.findFirst({ where: { key, status: { in: [...OPEN_REQUEST_STATUSES] } } });
    if (open) {
      const onAnswer = onAnswerOf(open.onAnswer);
      const ids = Array.isArray(onAnswer.assetIds) ? (onAnswer.assetIds as string[]) : [];
      if (!ids.includes(assetId))
        await deps.prisma.humanRequest.update({
          where: { id: open.id },
          data: { onAnswer: JSON.parse(JSON.stringify({ ...onAnswer, assetIds: [...ids, assetId] })) },
        });
      continue;
    }
    await askHuman(deps, {
      teamKey: "casino",
      kind: "CONFIRM",
      key,
      question: `Le thème « ${theme} » n'existe pas encore dans l'équipe Casino. Je le crée et j'y range le média reçu ? Réponds oui ou non (ou « plus tard »).`,
      onAnswer: { action: CREATE_THEME_ACTION, theme, assetIds: [assetId], buttonYes: `Créer le thème ${theme}`, resume: false },
    });
  }
}

/** Réponse à « Créer le thème <x> » : thème ajouté à l'équipe, médias en attente classés dedans. */
registerAnswerAction(CREATE_THEME_ACTION, async (deps, { value, actor, onAnswer }) => {
  const theme = typeof onAnswer.theme === "string" ? onAnswer.theme : null;
  if (!theme) return undefined;
  if (value !== "oui") return `D'accord, pas de thème « ${theme} » : le média reste à classer dans la fiche Casino du site.`;
  await addCasinoTheme(deps, theme, actor);
  const ids = Array.isArray(onAnswer.assetIds) ? onAnswer.assetIds.filter((x): x is string => typeof x === "string") : [];
  let classified = 0;
  for (const id of ids) if (await applyCasinoThemes(deps, id, [theme], "merge")) classified++;
  return `Thème « ${theme} » créé ✅${classified ? ` ; ${classified} média${classified > 1 ? "s" : ""} rangé${classified > 1 ? "s" : ""} dedans` : ""}.`;
});

function unusedLabel(n: number): string {
  return `${n} média${n > 1 ? "s" : ""} non utilisé${n > 1 ? "s" : ""}`;
}

/**
 * Stock d'un thème en clair, tous canaux casino confondus : « 4 médias non utilisés » si tous les canaux ont le même
 * nombre, « 2 à 5 médias non utilisés selon le canal » sinon, « sur aucun canal pour l'instant » sans canal.
 */
export function stockPhrase(theme: string, rows: CasinoStockRow[]): string {
  const counts = rows.filter((r) => r.theme === theme).map((r) => r.unused);
  if (counts.length === 0) return `${theme} (sur aucun canal casino pour l'instant)`;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  if (min === max) return `${theme}, ${unusedLabel(min)}`;
  return `${theme}, ${min} à ${unusedLabel(max)} selon le canal`;
}

async function stockOrNull(deps: AgentsDeps): Promise<CasinoStockRow[] | null> {
  try {
    return await casinoStock(deps.prisma as unknown as PrismaClient, { now: nowOf(deps) });
  } catch (err) {
    // Stock indisponible (pas encore écrit, base lente) : la confirmation part sans les chiffres.
    deps.logger?.warn({ err: (err as Error).message }, "[agents] stock casino indisponible pour la confirmation");
    return null;
  }
}

/**
 * Une ligne de confirmation pour un ou plusieurs médias casino (album) : « Vidéo rangée ✅ roulette, 4 médias non
 * utilisés », « 3 médias rangés ✅ … », « à classer dans la fiche Casino du site », thème inconnu signalé.
 */
export async function casinoDepositLine(deps: AgentsDeps, items: CasinoDepositInfo[], progress?: string | null): Promise<string> {
  if (items.length === 0) return "";
  const themes = [...new Set(items.flatMap((i) => i.themes))];
  const unknown = [...new Set(items.flatMap((i) => i.unknownThemes))];
  const toClassify = items.filter((i) => i.themes.length === 0).length;
  const allDup = items.every((i) => !i.created);
  let head: string;
  if (items.length === 1) {
    const one = items[0]!;
    const noun = one.isVideo ? "Vidéo" : "Image";
    head = allDup ? `${noun} déjà rangée : thèmes mis à jour ✅` : `${noun} rangée ✅`;
  } else head = allDup ? `${items.length} médias déjà rangés : thèmes mis à jour ✅` : `${items.length} médias rangés ✅`;

  const parts: string[] = [];
  if (themes.length > 0) {
    const rows = await stockOrNull(deps);
    if (!rows) parts.push(themes.join(", "));
    else {
      // Thèmes sans canal regroupés en fin de ligne : la mention n'est dite qu'une fois.
      const onChannels = themes.filter((t) => rows.some((r) => r.theme === t));
      const nowhere = themes.filter((t) => !onChannels.includes(t));
      const phrases = onChannels.map((t) => stockPhrase(t, rows));
      if (nowhere.length) phrases.push(`${nowhere.join(", ")} (sur aucun canal casino pour l'instant)`);
      parts.push(phrases.join(" ; "));
    }
  }
  if (toClassify > 0)
    parts.push(
      items.length === 1
        ? "à classer dans la fiche Casino du site (aucun thème reconnu)"
        : `${toClassify} à classer dans la fiche Casino du site`,
    );
  if (unknown.length > 0)
    parts.push(`thème${unknown.length > 1 ? "s" : ""} inconnu${unknown.length > 1 ? "s" : ""} : ${unknown.join(", ")} (je te demande s'il faut le créer)`);
  const line = `${head} ${parts.join(" · ")}`.trim();
  return progress ? `${line} (${progress})` : line;
}
