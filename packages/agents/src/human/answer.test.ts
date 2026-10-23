import { describe, expect, it } from "vitest";
import { interpretAnswer, parseYesNo } from "./answer";

describe("interprétation des réponses", () => {
  it("CHOICE : numéro ou texte de l'option", () => {
    const t = { kind: "CHOICE" as const, key: "x", options: ["fal 580p", "fal 720p", "Magic Hour"] };
    expect(interpretAnswer(t, "2")).toMatchObject({ type: "answer", value: "fal 720p" });
    expect(interpretAnswer(t, "magic hour")).toMatchObject({ type: "answer", value: "Magic Hour" });
    expect(interpretAnswer(t, "7")).toMatchObject({ type: "invalid" });
  });
  it("CONFIRM : oui / non, insensible à la casse", () => {
    expect(interpretAnswer({ kind: "CONFIRM", key: "x" }, "OUI")).toMatchObject({ value: "oui" });
    expect(interpretAnswer({ kind: "CONFIRM", key: "x" }, "Non.")).toMatchObject({ value: "non" });
    expect(interpretAnswer({ kind: "CONFIRM", key: "x" }, "peut-être")).toMatchObject({ type: "invalid" });
    expect(parseYesNo("ouais")).toBe("oui");
  });
  it("« plus tard » passe la demande, quel que soit le type", () => {
    expect(interpretAnswer({ kind: "SECRET", key: "k" }, "Plus tard")).toEqual({ type: "skip" });
    expect(interpretAnswer({ kind: "TEXT", key: "k" }, "« plus tard »")).toEqual({ type: "skip" });
  });
  it("TEXT : tel quel, adresse vérifiée", () => {
    expect(interpretAnswer({ kind: "TEXT", key: "persona.x.name" }, " Léa ")).toMatchObject({ value: "Léa" });
    expect(interpretAnswer({ kind: "TEXT", key: "persona.x.loraUrl" }, "pas une adresse")).toMatchObject({ type: "invalid" });
    expect(interpretAnswer({ kind: "TEXT", key: "persona.x.loraUrl" }, "https://fal.ai/lora.safetensors")).toMatchObject({ type: "answer" });
    expect(interpretAnswer({ kind: "TEXT", key: "contact.email" }, "a@b")).toMatchObject({ type: "invalid" });
  });
  it("SECRET : résumé limité aux 4 derniers caractères", () => {
    const r = interpretAnswer({ kind: "SECRET", key: "providers.fal.apiKey" }, "abcd-1234-efgh-9876");
    expect(r).toEqual({ type: "answer", value: "abcd-1234-efgh-9876", summary: "…9876" });
    expect(interpretAnswer({ kind: "SECRET", key: "k" }, "deux mots")).toMatchObject({ type: "invalid" });
  });
  it("MEDIA : un texte ne répond pas, il rappelle quoi envoyer", () => {
    const r = interpretAnswer({ kind: "MEDIA", key: "k", expected: { count: 5, tags: ["dating", "source", "lea"], received: 2 } }, "voilà");
    expect(r).toMatchObject({ type: "invalid" });
    expect((r as { message: string }).message).toContain("#dating #source #lea (2/5");
  });
});
