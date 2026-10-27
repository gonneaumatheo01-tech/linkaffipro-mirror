import { describe, expect, it } from "vitest";
import { llmFromClient, wellFormedText } from "./llm";

describe("texte envoyé à l'IA", () => {
  it("une moitié d'emoji laissée par une troncature est remplacée, le reste intact", () => {
    const emoji = "⚽🔥";
    const cut = emoji.slice(0, 2); // « ⚽ » + première moitié de « 🔥 »
    expect(wellFormedText(cut)).toBe("⚽�");
    expect(wellFormedText("\uDD25 fin")).toBe("� fin");
    expect(wellFormedText("Pronos 🔥 du jour")).toBe("Pronos 🔥 du jour");
    expect(JSON.parse(JSON.stringify(wellFormedText(cut)))).toBe("⚽�");
  });

  it("le système et le message sont nettoyés avant l'appel", async () => {
    const seen: Array<{ system: Array<{ text: string }>; user: string }> = [];
    const llm = llmFromClient({ createMessage: async (r: never) => (seen.push(r), { text: "ok", usage: { inputTokens: 1, outputTokens: 1 } }) } as never);
    await llm.complete({ model: "claude-haiku-5-5", system: "règles \uD83D", user: "post 🔥".slice(0, 6), maxTokens: 10 });
    expect(seen[0]!.system[0]!.text).toBe("règles �");
    expect(seen[0]!.user).toBe("post �");
  });
});
