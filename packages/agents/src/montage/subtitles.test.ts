import { describe, expect, it } from "vitest";
import {
  applyClientCorrection,
  createVeniceStt,
  parseSttResponse,
  srtTime,
  subtitlesToSrt,
  transcribeClip,
  verifySubtitles,
  wordDiff,
  wrapSubtitleLines,
  type TranscribedSegment,
} from "./subtitles";
import { createFakeMontageLlm, createFakeStt, fakeMontageAiDeps } from "./ai-fakes";

const WAV = "/tmp/montage/job/clip1.wav";
const wavBytes = new Uint8Array(2000).fill(1);

describe("transcribeClip", () => {
  it("segments horodatés, confiance = exp(avg_logprob), abaissée par no_speech_prob", async () => {
    const stt = createFakeStt([
      {
        text: "Je mise tout sur le rouge. Et c'est gagné !",
        segments: [
          { start: 0, end: 2.4, text: " Je mise tout sur le rouge.", avg_logprob: -0.02, no_speech_prob: 0.01 },
          { start: 2.4, end: 4.1, text: " Et c'est gagné !", avg_logprob: -0.3, no_speech_prob: 0.5 },
          { start: 4.1, end: 5, text: " ...", avg_logprob: -1.5, no_speech_prob: 0.9 },
        ],
      },
    ]);
    const d = fakeMontageAiDeps({ stt, files: { [WAV]: wavBytes } });
    const segs = await transcribeClip(d, WAV, { language: "fr" });
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ startMs: 0, endMs: 2400, text: "Je mise tout sur le rouge.", confidenceSource: "model" });
    expect(segs[0]!.confidence).toBeCloseTo(Math.exp(-0.02), 3);
    expect(segs[1]!.confidence).toBeCloseTo(Math.exp(-0.3) * 0.5, 3);
    expect(stt.calls[0]).toMatchObject({ language: "fr", mimeType: "audio/wav", temperature: 0 });
    expect(stt.calls[0]!.prompt).toContain("martingale");
  });

  it("aucune voix → []", async () => {
    const d = fakeMontageAiDeps({ stt: createFakeStt([{ text: "" }]), files: { [WAV]: wavBytes } });
    expect(await transcribeClip(d, WAV)).toEqual([]);
    const d2 = fakeMontageAiDeps({ stt: createFakeStt([{ text: "Sous-titres réalisés par la communauté d'Amara.org" }]), files: { [WAV]: wavBytes } });
    expect(await transcribeClip(d2, WAV)).toEqual([]);
    const d3 = fakeMontageAiDeps({ stt: createFakeStt([{ text: "x" }]), files: { [WAV]: new Uint8Array(44) } });
    expect(await transcribeClip(d3, WAV)).toEqual([]);
  });

  it("texte seul : un segment, confiance déduite", () => {
    expect(parseSttResponse({ text: "Allez le zéro", duration: 3.2 })).toEqual([{ startMs: 0, endMs: 3200, text: "Allez le zéro", confidence: 0.9, confidenceSource: "deduced" }]);
  });

  it("horodatage par mots (format Venice `timestamps`) regroupé en segments", () => {
    const segs = parseSttResponse({
      text: "Allez. Le zéro tombe",
      timestamps: {
        word: [
          { word: "Allez.", start: 0, end: 0.5 },
          { word: "Le", start: 1.6, end: 1.8 },
          { word: "zéro", start: 1.8, end: 2.2 },
          { word: "tombe", start: 2.2, end: 2.8 },
        ],
      },
    });
    expect(segs.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [0, 500, "Allez."],
      [1600, 2800, "Le zéro tombe"],
    ]);
  });

  it("sans clé ni transcription : erreur claire", async () => {
    const d = fakeMontageAiDeps({ files: { [WAV]: wavBytes } });
    await expect(transcribeClip({ ...d, stt: undefined }, WAV)).rejects.toMatchObject({ code: "no_stt" });
  });

  it("client Venice : format verbeux demandé d'abord, repli JSON si refusé, aucune clé dans l'erreur", async () => {
    const forms: FormData[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      if (forms.length === 1) return new Response("bad", { status: 400 });
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;
    const stt = createVeniceStt({ apiKey: "sk-secret", fetch: fakeFetch });
    const out = await stt.transcribe({ audio: wavBytes, fileName: "a.wav", mimeType: "audio/wav", language: "fr", prompt: null, temperature: 0.4 });
    expect(out).toEqual({ text: "ok" });
    expect(forms[0]!.get("response_format")).toBe("verbose_json");
    expect(forms[1]!.get("response_format")).toBe("json");
    expect(forms[1]!.get("prompt")).toBeNull();
    const failing = createVeniceStt({ apiKey: "sk-secret", fetch: (async () => new Response("x", { status: 500 })) as unknown as typeof fetch });
    await expect(failing.transcribe({ audio: wavBytes, fileName: "a.wav", mimeType: "audio/wav", language: null, prompt: null, temperature: 0 })).rejects.toThrow(/statut 500/);
    await failing.transcribe({ audio: wavBytes, fileName: "a.wav", mimeType: "audio/wav", language: null, prompt: null, temperature: 0 }).catch((e: Error) => expect(e.message).not.toContain("sk-secret"));
  });
});

const seg = (startMs: number, endMs: number, text: string, confidence = 0.98, src: TranscribedSegment["confidenceSource"] = "model"): TranscribedSegment => ({ startMs, endMs, text, confidence, confidenceSource: src });

/** Opus qui recopie la version A de chaque segment, sans doute. */
const echoA = (req: { user: string }) => {
  const segments = [...req.user.matchAll(/#(\d+) \[[^\n]*\n\s*A : ([^\n]*)/g)].map((m) => ({ index: Number(m[1]), text: m[2], uncertain: false, reason: "" }));
  return JSON.stringify({ segments });
};

describe("verifySubtitles", () => {
  it("deux versions identiques, confiance haute → aucun doute", async () => {
    const llm = createFakeMontageLlm([echoA]);
    const d = fakeMontageAiDeps({ llm });
    const first = [seg(0, 2000, "Je lance la martingale."), seg(2000, 4000, "Et c'est le jackpot !")];
    const r = await verifySubtitles(d, { segments: first, secondPass: [seg(0, 4000, "je lance la martingale et c'est le jackpot")], threshold: 0.95 });
    expect(r.uncertain).toEqual([]);
    expect(r.segments.map((s) => s.text)).toEqual(["Je lance la martingale.", "Et c'est le jackpot !"]);
    expect(llm.calls[0]!.model).toBe("claude-opus-5-5");
    expect(llm.calls[0]!.system).toContain("N'ENTENDS PAS");
  });

  it("« martingale » / « martindale » → incertain avec les deux variantes", async () => {
    const llm = createFakeMontageLlm([echoA]);
    const d = fakeMontageAiDeps({ llm });
    const r = await verifySubtitles(d, {
      segments: [seg(0, 1500, "Salut à tous."), seg(6000, 10_000, "Là je fais une martingale sur le rouge")],
      secondPass: [seg(0, 1500, "Salut à tous"), seg(6000, 10_000, "là je fais une martindale sur le rouge")],
      threshold: 0.95,
    });
    expect(r.uncertain).toHaveLength(1);
    expect(r.uncertain[0]).toMatchObject({ index: 1, text: "Là je fais une martingale sur le rouge", alternatives: ["martingale", "martindale"] });
    expect(r.uncertain[0]!.atMs).toBeGreaterThanOrEqual(6000);
    expect(r.uncertain[0]!.atMs).toBeLessThan(10_000);
    expect(llm.calls[0]!.user).toContain("« martingale » / « martindale »");
  });

  it("un « euh » de différence ne rend pas incertain", async () => {
    const d = fakeMontageAiDeps({ llm: createFakeMontageLlm([echoA]) });
    const r = await verifySubtitles(d, { segments: [seg(0, 2000, "Euh je mise dix euros")], secondPass: [seg(0, 2000, "je mise dix euros")], threshold: 0.95 });
    expect(r.uncertain).toEqual([]);
  });

  it("mot inventé par l'IA → refusé : texte de l'écoute gardé, passage incertain", async () => {
    const llm = createFakeMontageLlm([JSON.stringify({ segments: [{ index: 0, text: "Je fais une martingale gagnante", uncertain: false }] })]);
    const d = fakeMontageAiDeps({ llm });
    const r = await verifySubtitles(d, { segments: [seg(0, 3000, "Je fais une martindale")], secondPass: [seg(0, 3000, "je fais une martindale")], threshold: 0.95 });
    expect(r.segments[0]!.text).toBe("Je fais une martindale");
    expect(r.segments[0]!.text).not.toContain("gagnante");
    expect(r.uncertain).toHaveLength(1);
    expect(r.uncertain[0]!.alternatives.join(" ")).not.toContain("gagnante");
  });

  it("l'IA peut corriger ponctuation et majuscules avec les mots entendus", async () => {
    const llm = createFakeMontageLlm([JSON.stringify({ segments: [{ index: 0, text: "Allez, le Jackpot !", uncertain: false }] })]);
    const r = await verifySubtitles(fakeMontageAiDeps({ llm }), { segments: [seg(0, 2000, "allez le jackpot")], secondPass: [seg(0, 2000, "allez le jackpot")], threshold: 0.95 });
    expect(r.segments[0]!.text).toBe("Allez, le Jackpot !");
    expect(r.uncertain).toEqual([]);
  });

  it("confiance sous le seuil, ou doute de l'IA → incertain", async () => {
    const low = await verifySubtitles(fakeMontageAiDeps({ llm: createFakeMontageLlm([echoA]) }), { segments: [seg(0, 2000, "mise max", 0.8)], secondPass: [seg(0, 2000, "mise max")], threshold: 0.95 });
    expect(low.uncertain).toHaveLength(1);
    const doubt = await verifySubtitles(fakeMontageAiDeps({ llm: createFakeMontageLlm([JSON.stringify({ segments: [{ index: 0, text: "mise max", uncertain: true }] })]) }), {
      segments: [seg(0, 2000, "mise max")],
      secondPass: [seg(0, 2000, "mise max")],
      threshold: 0.95,
    });
    expect(doubt.uncertain).toHaveLength(1);
  });

  it("confiance déduite : sûre seulement si les deux écoutes concordent", async () => {
    const ok = await verifySubtitles(fakeMontageAiDeps({ llm: createFakeMontageLlm([echoA]) }), { segments: [seg(0, 2000, "rien ne va plus", 0.9, "deduced")], secondPass: [seg(0, 2000, "Rien ne va plus.")], threshold: 0.95 });
    expect(ok.uncertain).toEqual([]);
    expect(ok.segments[0]!.confidence).toBe(0.95);
    const noSecond = await verifySubtitles(fakeMontageAiDeps({ llm: createFakeMontageLlm([echoA]) }), { segments: [seg(0, 2000, "rien ne va plus", 0.9, "deduced")], threshold: 0.95 });
    expect(noSecond.uncertain).toHaveLength(1);
  });

  it("deuxième écoute faite ici depuis le son : sans biais de vocabulaire, autre température", async () => {
    const stt = createFakeStt([{ text: "je fais une martindale", duration: 2 }]);
    const d = fakeMontageAiDeps({ llm: createFakeMontageLlm([echoA]), stt, files: { [WAV]: wavBytes } });
    const r = await verifySubtitles(d, { segments: [seg(0, 2000, "Je fais une martingale")], threshold: 0.95, wavPath: WAV });
    expect(stt.calls[0]).toMatchObject({ prompt: null, temperature: 0.4 });
    expect(r.uncertain[0]!.alternatives).toEqual(["martingale", "martindale"]);
  });

  it("réponse illisible ou Opus en panne → erreur (pas de repli)", async () => {
    await expect(verifySubtitles(fakeMontageAiDeps({ llm: createFakeMontageLlm(["???"]) }), { segments: [seg(0, 1000, "a b")], secondPass: [], threshold: 0.95 })).rejects.toMatchObject({ code: "invalid_output" });
    await expect(verifySubtitles(fakeMontageAiDeps({ llm: createFakeMontageLlm([new Error("x")]) }), { segments: [seg(0, 1000, "a b")], secondPass: [], threshold: 0.95 })).rejects.toMatchObject({ code: "ai_failed" });
  });

  it("aucun segment : rien à vérifier, aucun appel", async () => {
    const llm = createFakeMontageLlm([echoA]);
    expect(await verifySubtitles(fakeMontageAiDeps({ llm }), { segments: [], threshold: 0.95 })).toEqual({ segments: [], uncertain: [] });
    expect(llm.calls).toHaveLength(0);
  });
});

describe("applyClientCorrection", () => {
  const segs = [seg(0, 1000, "Salut"), seg(1000, 4000, "Là je fais une martingale sur le rouge", 0.97)];
  it("variante choisie : remplace la partie en doute", () => {
    const out = applyClientCorrection(segs, 1, "martindale", { alternatives: ["martingale", "martindale"] });
    expect(out[1]).toMatchObject({ text: "Là je fais une martindale sur le rouge", confidence: 1 });
    expect(out[0]).toBe(segs[0]);
    expect(segs[1]!.text).toContain("martingale"); // pur
  });
  it("texte libre : remplace le segment", () => {
    expect(applyClientCorrection(segs, 1, "Je joue la martingale", { alternatives: ["martingale", "martindale"] })[1]!.text).toBe("Je joue la martingale");
  });
  it("erreurs claires", () => {
    expect(() => applyClientCorrection(segs, 5, "x")).toThrow(/introuvable/);
    expect(() => applyClientCorrection(segs, 0, "  ")).toThrow(/vide/);
  });
});

describe("SRT", () => {
  it("horodatage exact", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(3_723_456)).toBe("01:02:03,456");
    expect(srtTime(8_005)).toBe("00:00:08,005");
  });

  it("blocs numérotés, 42 caractères et 2 lignes au plus, segments longs répartis", () => {
    const long = "Là je mets cinquante euros sur le rouge et on va voir si la martingale tient le coup jusqu'au bout de la soirée";
    const srt = subtitlesToSrt([seg(0, 2000, "Salut à tous"), seg(2000, 12_000, long)]);
    const blocks = srt.trim().split(/\n\n/);
    expect(blocks[0]).toBe("1\n00:00:00,000 --> 00:00:02,000\nSalut à tous");
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      const lines = b.split("\n");
      const text = lines.slice(2);
      expect(text.length).toBeLessThanOrEqual(2);
      for (const l of text) expect(l.length).toBeLessThanOrEqual(42);
    }
    expect(blocks[blocks.length - 1]).toMatch(/--> 00:00:12,000/);
    expect(blocks.map((b) => b.split("\n").slice(2).join(" ")).join(" ")).toBe(`Salut à tous ${long}`);
  });

  it("aucun chevauchement, balises et accolades retirées", () => {
    const srt = subtitlesToSrt([seg(0, 3000, "un {\\an8}deux"), seg(2500, 4000, "<b>trois</b>")]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:03,000\nun \\an8deux\n\n2\n00:00:03,000 --> 00:00:04,000\nbtrois/b\n");
  });

  it("découpe des lignes", () => {
    expect(wrapSubtitleLines("a".repeat(50))).toEqual(["a".repeat(42), "a".repeat(8)]);
    expect(wrapSubtitleLines("mot ".repeat(15).trim()).every((l) => l.length <= 42)).toBe(true);
  });

  it("comparaison mot à mot", () => {
    expect(wordDiff(["je", "fais", "une", "martingale"], ["je", "fais", "une", "martindale"])).toEqual([{ aFrom: 3, aTo: 4, bFrom: 3, bTo: 4 }]);
    expect(wordDiff(["a", "b"], ["a", "b"])).toEqual([]);
  });
});
