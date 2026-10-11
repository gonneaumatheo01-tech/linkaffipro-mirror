/**
 * Calque des animations des emojis animés (phase 12) : règles sans navigateur.
 * - un aperçu redessiné à chaque frappe garde les animations déjà montées (même emoji au même rang) au lieu de les
 *   recréer (plus de retour à l'emoji normal ni d'animation qui repart de zéro) ;
 * - un emoji animé dans un texte masqué reste caché tant que le texte n'est pas révélé (comme sur Telegram).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TelegramPreview } from "@/components/messages/telegram-preview";
import { isConcealed, pairChips } from "./emoji-chips";

describe("pairChips : réemploi des animations quand le texte affiché est remplacé", () => {
  it("même texte redessiné : chaque emoji reprend son animation, rien n'est arrêté", () => {
    expect(pairChips(["1", "2", "1"], ["1", "2", "1"])).toEqual({ reuse: [0, 1, 2], drop: [] });
  });

  it("même emoji au même rang : la k-ième puce reprend la k-ième ancienne animation de cet emoji", () => {
    // Un emoji « 2 » inséré au début : les « 1 » gardent leurs animations, le premier « 2 » reprend celle de l'ancien,
    // le second en démarre une.
    expect(pairChips(["1", "2", "1"], ["2", "1", "2", "1"])).toEqual({
      reuse: [1, 0, -1, 2],
      drop: [],
    });
  });

  it("emoji retiré : son animation est arrêtée ; nouvel emoji : nouvelle animation", () => {
    expect(pairChips(["1", "2"], ["1", "3"])).toEqual({ reuse: [0, -1], drop: [1] });
    expect(pairChips(["1"], [])).toEqual({ reuse: [], drop: [0] });
    expect(pairChips([], ["4"])).toEqual({ reuse: [-1], drop: [] });
  });
});

/** Élément simulé : `closest` sur une chaîne de parents (sélecteurs `[data-spoiler]` et `[data-spoiler]:hover`). */
function chip(parents: Array<{ spoiler?: boolean; hover?: boolean }>) {
  return {
    closest(selector: string) {
      const wantHover = selector.includes(":hover");
      const found = parents.find((p) => p.spoiler && (!wantHover || p.hover));
      return found ? {} : null;
    },
  } as unknown as Element;
}

describe("emoji animé dans un texte masqué", () => {
  it("caché tant que le texte masqué n'est pas révélé (survol), visible ailleurs", () => {
    expect(isConcealed(chip([{ spoiler: true }]))).toBe(true);
    expect(isConcealed(chip([{ spoiler: true, hover: true }]))).toBe(false);
    expect(isConcealed(chip([{}]))).toBe(false);
  });

  it("aperçu « tel que les membres le verront » : le texte masqué porte le repère qui cache ses emojis", () => {
    const html = renderToStaticMarkup(
      createElement(TelegramPreview, {
        html: 'Visible puis <tg-spoiler>secret <tg-emoji emoji-id="9100000000000000019">❤️</tg-emoji> fin</tg-spoiler>',
        buttons: [],
        mediaCount: 0,
      }),
    );
    expect(html).toMatch(
      /<span data-spoiler=""[^>]*>secret <img class="lap-ce" data-ce-id="9100000000000000019"/,
    );
    const css = readFileSync(
      fileURLToPath(new URL("../editor/rich-text.css", import.meta.url)),
      "utf8",
    );
    expect(css).toMatch(
      /\[data-spoiler\]:not\(:hover\)\s+img\.lap-ce\s*\{[^}]*visibility:\s*hidden/,
    );
  });
});
