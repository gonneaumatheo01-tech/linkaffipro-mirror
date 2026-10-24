import { describe, expect, it } from "vitest";
import { transcribe } from "./transcribe";

describe("transcription d'un vocal : journal", () => {
  it("vocal non compris : jamais le texte dans le journal, seulement sa longueur et son nombre de mots", async () => {
    const logs: unknown[] = [];
    const logger = {
      info: (o: unknown) => void logs.push(o),
      warn: (o: unknown) => void logs.push(o),
      error: (o: unknown) => void logs.push(o),
      debug: (o: unknown) => void logs.push(o),
    };
    // Transcription rejetée (hallucination connue) qui contient une clé dictée.
    const text = "Thanks for watching sk-SECRET1234567890";
    const fetchFn = (async () => new Response(JSON.stringify({ text, duration: 3 }), { status: 200 })) as typeof fetch;
    const r = await transcribe("k", Buffer.from([1, 2, 3]), "audio/ogg", {
      fetch: fetchFn,
      prepare: async () => null,
      logger: logger as never,
    });
    expect(r).toBeNull();
    const journal = JSON.stringify(logs);
    expect(journal).not.toContain("SECRET1234567890");
    expect(journal).not.toContain("Thanks");
    expect(journal).toContain(`"caracteres":${text.length}`);
    expect(journal).toContain('"mots":');
  });
});
