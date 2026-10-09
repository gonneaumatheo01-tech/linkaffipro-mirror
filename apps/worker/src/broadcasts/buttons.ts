import { buttonUrl, parseButtons, type KeyboardContext } from "../sending/keyboard";

/** Convertit les boutons d'un envoi groupé (format Post) en lignes `{ text, url }` pour un message privé. */
export function resolveBroadcastButtons(value: unknown, ctx: KeyboardContext): Array<Array<{ text: string; url: string }>> {
  const out: Array<Array<{ text: string; url: string }>> = [];
  for (const row of parseButtons(value)) {
    const line: Array<{ text: string; url: string }> = [];
    for (const b of row) {
      const url = buttonUrl(b, ctx);
      if (url) line.push({ text: b.text, url });
    }
    if (line.length > 0) out.push(line);
  }
  return out;
}
