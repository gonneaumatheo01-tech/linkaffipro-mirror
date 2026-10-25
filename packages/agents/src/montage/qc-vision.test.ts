import { describe, expect, it } from "vitest";
import { checkSubtitleReadability, parseReadability } from "./qc-vision";
import { createFakeMontageLlm, fakeMontageAiDeps } from "./ai-fakes";

const files = {
  "/tmp/montage/j/qc1.jpg": new Uint8Array([0xff, 0xd8, 1]),
  "/tmp/montage/j/qc2.jpg": new Uint8Array([0xff, 0xd8, 2]),
  "/tmp/montage/j/qc3.png": new Uint8Array([0x89, 0x50, 3]),
};
const paths = Object.keys(files);

describe("checkSubtitleReadability", () => {
  it("lisible : Opus vision sur 3 images", async () => {
    const llm = createFakeMontageLlm(['{"ok": true, "problems": []}']);
    const d = fakeMontageAiDeps({ llm, files });
    expect(await checkSubtitleReadability(d, paths)).toEqual({ ok: true, problems: [] });
    expect(llm.calls[0]!.model).toBe("claude-opus-5-5");
    expect(llm.calls[0]!.images?.map((i) => i.mediaType)).toEqual(["image/jpeg", "image/jpeg", "image/png"]);
    expect(d.usage[0]!.cents).toBe(1);
  });

  it("problèmes rendus en français ; un problème signalé n'est jamais « ok »", async () => {
    const d = fakeMontageAiDeps({ llm: createFakeMontageLlm(['{"ok": true, "problems": ["image 2 : sous-titre caché par la caméra"]}']), files });
    expect(await checkSubtitleReadability(d, paths)).toEqual({ ok: false, problems: ["image 2 : sous-titre caché par la caméra"] });
    expect(parseReadability('{"ok": false}')).toEqual({ ok: false, problems: ["Sous-titres jugés peu lisibles."] });
  });

  it("réponse invalide, IA en panne, aucune image → erreur claire", async () => {
    await expect(checkSubtitleReadability(fakeMontageAiDeps({ llm: createFakeMontageLlm(['{"lisible": "oui"}']), files }), paths)).rejects.toMatchObject({ code: "invalid_output" });
    await expect(checkSubtitleReadability(fakeMontageAiDeps({ llm: createFakeMontageLlm([new Error("x")]), files }), paths)).rejects.toMatchObject({ code: "ai_failed" });
    await expect(checkSubtitleReadability(fakeMontageAiDeps({ llm: createFakeMontageLlm(["{}"]), files }), [])).rejects.toMatchObject({ code: "input" });
  });

  it("plafond atteint : aucun appel", async () => {
    const llm = createFakeMontageLlm(['{"ok": true, "problems": []}']);
    const d = fakeMontageAiDeps({ llm, files, usage: [{ teamKey: "montage", provider: "llm", month: "2026-10", cents: 3000, calls: 1 }] });
    await expect(checkSubtitleReadability(d, paths)).rejects.toMatchObject({ code: "budget" });
    expect(llm.calls).toHaveLength(0);
  });
});
