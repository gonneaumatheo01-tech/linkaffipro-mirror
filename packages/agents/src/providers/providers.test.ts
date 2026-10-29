/** Fournisseur de photos (phase 20) : coûts, client fal.ai sur réponses enregistrées, vérificateur, faux fournisseur. */
import { describe, expect, it } from "vitest";
import { USD_TO_EUR } from "@linkaffipro/ai";
import { billedMegapixels, falImageCents } from "./costs";
import { createFalClient, createFalImageProvider, falAppPath, paidCentsOf } from "./fal";
import { falKeyVerifier } from "./verifiers";
import { fal, fixtureFetch } from "./fixtures/http";
import { createFakeImageProvider, FAKE_TEST_IMAGE_URL } from "./fake";

const KEY = "fal-secret-key-123456";
const file = (name: string, mimeType: string) => ({ bytes: new Uint8Array([1, 2, 3]), mimeType, filename: name });

describe("coûts estimés", () => {
  it("fal photo : 0,035 $ par mégapixel arrondi au supérieur", () => {
    expect(billedMegapixels(1024, 1024)).toBe(1);
    expect(billedMegapixels(768, 1024)).toBe(1);
    expect(billedMegapixels(1536, 1024)).toBe(2);
    expect(falImageCents(1, "portrait")).toBe(Math.ceil(0.035 * USD_TO_EUR * 100));
    expect(falImageCents(4, "square")).toBe(Math.ceil(0.14 * USD_TO_EUR * 100));
  });
});

describe("client fal.ai (réponses enregistrées)", () => {
  it("photo écartée par le filtre : l'erreur porte le coût de la génération ; reprise d'un travail soumis sans nouvelle soumission", async () => {
    const routes = (result: unknown) =>
      fixtureFetch([
        { method: "POST", match: "https://queue.fal.run/fal-ai/flux-lora", body: fal.imageSubmit },
        { match: fal.imageSubmit.status_url, body: fal.completed },
        { match: fal.imageSubmit.response_url, body: result },
      ]);
    const nsfw = createFalImageProvider({ client: createFalClient({ apiKey: KEY, fetch: routes(fal.imageNsfw).fetch }), sleep: async () => {} });
    const err = await nsfw.generate({ loraUrl: "u", triggerWord: "t", prompt: "t", count: 1, aspect: "portrait" }).catch((e: unknown) => e);
    expect(paidCentsOf(err)).toBe(falImageCents(1, "portrait"));
    const f = routes(fal.imageResult);
    const image = createFalImageProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }), sleep: async () => {} });
    const submitted: unknown[] = [];
    await image.generate({ loraUrl: "u", triggerWord: "t", prompt: "t", count: 1, aspect: "portrait" }, { onSubmitted: async (j) => void submitted.push(j) });
    expect(submitted).toEqual([{ requestId: fal.imageSubmit.request_id, statusUrl: fal.imageSubmit.status_url, responseUrl: fal.imageSubmit.response_url, cents: falImageCents(1, "portrait") }]);
    const before = f.calls.filter((c) => c.method === "POST").length;
    const res = await image.generate({ loraUrl: "u", triggerWord: "t", prompt: "t", count: 1, aspect: "portrait" }, { resume: submitted[0] as never });
    expect(res.images).toHaveLength(1);
    expect(f.calls.filter((c) => c.method === "POST").length).toBe(before);
  });
  it("adresse d'état : propriétaire/app du modèle, jamais le chemin complet", () => {
    expect(falAppPath("fal-ai/flux-lora")).toBe("fal-ai/flux-lora");
    expect(falAppPath("fal-ai/wan/v2.2-14b/animate/replace")).toBe("fal-ai/wan");
  });
  it("stockage : repli sur rest.alpha.fal.ai si l'hôte officiel est indisponible", async () => {
    const f = fixtureFetch([
      { method: "POST", match: /^https:\/\/rest\.fal\.ai\//, status: 502, body: fal.serverError },
      { method: "POST", match: /^https:\/\/rest\.alpha\.fal\.ai\//, body: fal.initiate },
      { method: "PUT", match: /storage\.fal\.ai/, body: {} },
    ]);
    expect(await createFalClient({ apiKey: KEY, fetch: f.fetch }).upload(file("lora.safetensors", "application/octet-stream"))).toBe(fal.initiate.file_url);
  });
  it("photo Flux + LoRA : prompt, LoRA et taille envoyés, image signalée par le filtre écartée", async () => {
    const routes = (result: unknown) =>
      fixtureFetch([
        { method: "POST", match: "https://queue.fal.run/fal-ai/flux-lora", body: fal.imageSubmit },
        { match: fal.imageSubmit.status_url, body: fal.inProgress, once: true },
        { match: fal.imageSubmit.status_url, body: fal.completed },
        { match: fal.imageSubmit.response_url, body: result },
      ]);
    const f = routes(fal.imageResult);
    const image = createFalImageProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }), sleep: async () => {} });
    const res = await image.generate({ loraUrl: "https://x/lea.safetensors", triggerWord: "lea_trigger", loraScale: 0.8, prompt: "lea_trigger, selfie", count: 1, aspect: "portrait" });
    expect(res).toEqual({ images: [{ url: fal.imageResult.images[0]!.url, width: 768, height: 1024 }], cents: falImageCents(1, "portrait") });
    expect(f.calls[0]!.body).toMatchObject({ prompt: "lea_trigger, selfie", image_size: "portrait_4_3", num_images: 1, loras: [{ path: "https://x/lea.safetensors", scale: 0.8 }], output_format: "jpeg" });
    const nsfw = createFalImageProvider({ client: createFalClient({ apiKey: KEY, fetch: routes(fal.imageNsfw).fetch }), sleep: async () => {} });
    await expect(nsfw.generate({ loraUrl: "u", triggerWord: "t", prompt: "t", count: 1, aspect: "portrait" })).rejects.toMatchObject({ transient: false });
  });
});


describe("vérification des clés (appel gratuit)", () => {
  it("fal : 401 / 403 refusée, 404 acceptée, réseau coupé = à réessayer ; jamais la clé dans le message", async () => {
    const check = (status: number) => falKeyVerifier(fixtureFetch([{ match: /flux-lora\/requests\/0{8}-/, status, body: {} }]).fetch)(KEY);
    expect(await check(404)).toEqual({ ok: true, message: "clé acceptée par fal.ai" });
    expect((await check(401)).ok).toBe(false);
    expect((await check(403)).ok).toBe(false);
    const down = await falKeyVerifier(fixtureFetch([{ match: /fal/, throws: "ECONNRESET" }]).fetch)(KEY);
    expect(down.ok).toBe(false);
    for (const r of [await check(401), down]) expect(r.message).not.toContain(KEY);
    const f = fixtureFetch([{ match: /flux-lora/, status: 404, body: {} }]);
    await falKeyVerifier(f.fetch)(KEY);
    expect(f.calls[0]!.headers.Authorization).toBe(`Key ${KEY}`);
  });
});

describe("faux fournisseur", () => {
  it("fausse photo : image de référence ou de test, coût 0", async () => {
    const image = createFakeImageProvider();
    expect((await image.generate({ loraUrl: "", triggerWord: "", prompt: "", count: 1, aspect: "portrait" })).images[0]!.url).toBe(FAKE_TEST_IMAGE_URL);
    expect((await image.generate({ loraUrl: "", triggerWord: "", prompt: "", count: 1, aspect: "portrait", referenceAssetId: "ref1" })).images[0]!.url).toBe("fake://media-asset/ref1");
  });
});
