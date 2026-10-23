import { describe, expect, it } from "vitest";
import { changedMediaFields, parseReferenceIds, urlHost, validatePersonaMediaForm } from "./media";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("médias du personnage : lecture du formulaire", () => {
  it("formulaire complet : images dans l'ordre, poids à la virgule, textes nettoyés", () => {
    const r = validatePersonaMediaForm(
      fd({
        referenceImageIds: "r2, r1,r2",
        loraUrl: " https://v3.fal.media/files/lea.safetensors ",
        loraTrigger: "  lea   tok ",
        loraScale: "1,2",
        mediaNotes: " Tenues décontractées ",
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        referenceImageIds: ["r2", "r1"],
        loraUrl: "https://v3.fal.media/files/lea.safetensors",
        loraTrigger: "lea tok",
        loraScale: 1.2,
        mediaNotes: "Tenues décontractées",
      },
    });
  });

  it("tout vide : aucune image, poids 0,8 par défaut", () => {
    expect(validatePersonaMediaForm(fd({}))).toEqual({
      ok: true,
      data: { referenceImageIds: [], loraUrl: null, loraTrigger: null, loraScale: 0.8, mediaNotes: null },
    });
  });

  it("refus : plus de 3 images, adresse non https, poids hors bornes, adresse sans mot déclencheur", () => {
    const four = validatePersonaMediaForm(fd({ referenceImageIds: "a,b,c,d" }));
    expect(four.ok).toBe(false);
    if (!four.ok) expect(four.errors.referenceImageIds).toContain("3 images au plus");

    const http = validatePersonaMediaForm(fd({ loraUrl: "http://exemple.com/x", loraTrigger: "x" }));
    expect(http.ok).toBe(false);
    if (!http.ok) expect(http.errors.loraUrl).toContain("https://");

    for (const scale of ["0", "1,6", "abc"]) {
      const s = validatePersonaMediaForm(fd({ loraScale: scale }));
      expect(s.ok, scale).toBe(false);
    }
    expect(validatePersonaMediaForm(fd({ loraScale: "0,1" })).ok).toBe(true);
    expect(validatePersonaMediaForm(fd({ loraScale: "1.5" })).ok).toBe(true);

    const noTrigger = validatePersonaMediaForm(fd({ loraUrl: "https://exemple.com/x.safetensors" }));
    expect(noTrigger.ok).toBe(false);
    if (!noTrigger.ok) expect(noTrigger.errors.loraTrigger).toContain("mot déclencheur");

    const badId = validatePersonaMediaForm(fd({ referenceImageIds: "ok,../x" }));
    expect(badId.ok).toBe(false);
  });
});

describe("médias du personnage : relecture et journal", () => {
  it("identifiants enregistrés : sans doublon, 3 au plus, valeur abîmée → []", () => {
    expect(parseReferenceIds(["a", "b", "a", 3, "c", "d"])).toEqual(["a", "b", "c"]);
    expect(parseReferenceIds("a")).toEqual([]);
    expect(parseReferenceIds(null)).toEqual([]);
  });

  it("champs modifiés seulement, et le domaine de l'adresse (jamais l'adresse entière)", () => {
    const base = { referenceImageIds: ["a", "b"], loraUrl: null, loraTrigger: null, loraScale: 0.8, mediaNotes: null };
    expect(changedMediaFields(base, { ...base })).toEqual([]);
    expect(changedMediaFields(base, { ...base, referenceImageIds: ["b", "a"], loraScale: 1 })).toEqual([
      "referenceImageIds",
      "loraScale",
    ]);
    expect(urlHost("https://v3.fal.media/files/x?sig=secret")).toBe("v3.fal.media");
    expect(urlHost(null)).toBeNull();
  });
});
