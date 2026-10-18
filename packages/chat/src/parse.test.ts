import { describe, expect, it } from "vitest";
import { fakeOutput } from "./fake";
import { extractJsonObject, parseTurnOutput, removeThinkBlocks } from "./parse";
import { checkTurnOutput, TURN_OUTPUT_JSON_SCHEMA } from "./schema";

const json = JSON.stringify(fakeOutput({ messages: ["Coucou {toi} 😊"] }));

describe("schéma strict", () => {
  it("tous les champs requis, aucun champ en plus, valeurs fixes, 1 à 3 messages", () => {
    const s = TURN_OUTPUT_JSON_SCHEMA as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, Record<string, unknown>>;
    };
    expect(s.additionalProperties).toBe(false);
    expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
    // Bornes vérifiées par le code (checkTurnOutput), pas par Venice : aucun mot-clé que le mode strict pourrait refuser.
    expect(JSON.stringify(s)).not.toMatch(/minItems|maxItems|minimum|maximum/);
    const style = s.properties.style_update as {
      required: string[];
      additionalProperties: boolean;
      properties: object;
    };
    expect(style.additionalProperties).toBe(false);
    expect(style.required.sort()).toEqual(Object.keys(style.properties).sort());
    expect(s.properties.stage?.enum).toContain("LINK_SENT");
  });
});

describe("checkTurnOutput", () => {
  it("accepte une sortie conforme et tolère la casse, l'intérêt en texte, les champs facultatifs absents", () => {
    const r = checkTurnOutput({
      messages: [{ text: "ok" }],
      style_update: {
        length: "SHORT",
        emojis: "few",
        register: "casual",
        language: "FR",
        tone: "direct",
        interest: "7.4",
      },
      stage: "chat",
      send_offer: true,
      extra: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.style_update).toMatchObject({ length: "short", language: "fr", interest: 7 });
      expect(r.value.stage).toBe("CHAT");
      expect(r.value.memory_facts).toEqual([]);
      expect(r.value.minor_suspected).toBe(false);
      expect(r.value.note_interne).toBe("");
    }
  });

  it("donne des erreurs lisibles", () => {
    const r = checkTurnOutput({
      messages: [],
      style_update: { language: "nl" },
      stage: "NOPE",
      send_offer: "oui",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toContain("messages : 1 à 3 éléments attendus");
      expect(r.errors.join("\n")).toContain("style_update.language");
      expect(r.errors.join("\n")).toContain("stage");
      expect(r.errors.join("\n")).toContain("send_offer");
    }
    expect(checkTurnOutput("texte").ok).toBe(false);
  });
});

describe("parseTurnOutput", () => {
  it("lit le JSON brut, entre barrières, avec du texte autour ou un bloc <think>", () => {
    for (const text of [
      json,
      "```json\n" + json + "\n```",
      "Voici ma réponse : " + json + " Bonne journée !",
      "<think>je réfléchis { pas du JSON }</think>\n" + json,
    ]) {
      const r = parseTurnOutput({ text, finishReason: "stop" });
      expect(r.ok, text).toBe(true);
      if (r.ok) expect(r.output.messages[0]?.text).toBe("Coucou {toi} 😊");
    }
  });

  it("rejette une réponse coupée (finish_reason length) et un texte sans JSON", () => {
    expect(parseTurnOutput({ text: json, finishReason: "length" })).toMatchObject({
      ok: false,
      code: "truncated",
    });
    expect(parseTurnOutput({ text: "Salut !", finishReason: "stop" })).toMatchObject({
      ok: false,
      code: "invalid_output",
    });
    expect(parseTurnOutput({ text: '{"messages": [', finishReason: "stop" })).toMatchObject({
      ok: false,
      code: "invalid_output",
    });
    expect(parseTurnOutput({ text: '{"messages": []}', finishReason: "stop" })).toMatchObject({
      ok: false,
      code: "invalid_output",
    });
  });

  it("removeThinkBlocks et extractJsonObject", () => {
    expect(removeThinkBlocks("<think>a</think>b")).toBe("b");
    expect(removeThinkBlocks("a<think>b")).toBe("a");
    expect(removeThinkBlocks("a</think>b")).toBe("b");
    expect(extractJsonObject('x {"a": "}{"} y')).toEqual({ a: "}{" });
    expect(extractJsonObject('{pas du json} puis {"b":1}')).toEqual({ b: 1 });
    expect(extractJsonObject("rien")).toBeNull();
  });
});
