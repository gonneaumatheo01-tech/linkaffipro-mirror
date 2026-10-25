import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipPosition, ShortFormat, ShortRenderSpec } from "../contract";
import { MONTAGE_LIMITS, MONTAGE_SETTINGS } from "../contract";
import {
  atempoChain,
  buildFilterGraph,
  buildRenderArgs,
  compressShort,
  drawableOverlayText,
  escapeFilterValue,
  fitOverlayText,
  formatSize,
  pipCrop,
  renderedDurationMs,
  renderShort,
} from "./render";
import { createFakeFfmpegRunner, fakeProbeJson } from "./runner";
import { MontageMediaError } from "./probe";

const base: ShortRenderSpec = {
  source: "/tmp/montage/job1/source.mp4",
  output: "/tmp/montage/job1/short-1.mp4",
  startMs: 150_000,
  endMs: 165_000,
  format: "VERTICAL_9_16",
  pipPosition: "NONE",
  speed: null,
  srtPath: null,
  subtitleStyle: MONTAGE_SETTINGS.subtitleStyle.value,
  overlayText: null,
  fontFile: null,
  crf: 18,
  preset: "slow",
  sourceCodec: "h264",
  fpsRaw: "30/1",
};
const spec = (p: Partial<ShortRenderSpec> = {}): ShortRenderSpec => ({ ...base, ...p });
const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const countOf = (args: string[], flag: string) => args.filter((a) => a === flag).length;

/** Découpe un graphe en filtres en respectant les échappements `\x` (pour vérifier qu'aucun texte ne casse le graphe). */
function splitGraph(graph: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < graph.length; i++) {
    const c = graph[i]!;
    if (c === "\\") {
      cur += c + (graph[i + 1] ?? "");
      i++;
    } else if (c === "," || c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Désescape un niveau (comme `av_get_token`, hors guillemets). */
function unescapeOnce(s: string): string {
  return s.replace(/\\(.)/gs, "$1");
}

describe("formatSize / pipCrop", () => {
  it("donne les trois tailles", () => {
    expect(formatSize("VERTICAL_9_16")).toEqual({ width: 1080, height: 1920 });
    expect(formatSize("HORIZONTAL_16_9")).toEqual({ width: 1920, height: 1080 });
    expect(formatSize("SQUARE_1_1")).toEqual({ width: 1080, height: 1080 });
  });
  it("découpe le coin nommé de la source et le replace au même coin, marges 10 px", () => {
    expect(pipCrop("NONE")).toBeNull();
    expect(pipCrop("TOP_RIGHT")).toMatchObject({ crop: "crop=iw/4:ih/4:iw*3/4:0", overlay: "W-w-10:10" });
    expect(pipCrop("TOP_LEFT")).toMatchObject({ crop: "crop=iw/4:ih/4:0:0", overlay: "10:10" });
    expect(pipCrop("BOTTOM_RIGHT")).toMatchObject({ crop: "crop=iw/4:ih/4:iw*3/4:ih*3/4", overlay: "W-w-10:H-h-10" });
    expect(pipCrop("BOTTOM_LEFT")).toMatchObject({ crop: "crop=iw/4:ih/4:0:ih*3/4", overlay: "10:H-h-10" });
  });
});

describe("atempoChain", () => {
  it("garde chaque facteur entre 0,5 et 2 et le produit exact", () => {
    for (const s of [0.25, 0.3, 0.5, 0.75, 1.25, 1.5, 2, 2.5, 3, 4]) {
      const chain = atempoChain(s);
      for (const f of chain) {
        expect(f).toBeGreaterThanOrEqual(0.5);
        expect(f).toBeLessThanOrEqual(2);
      }
      expect(chain.reduce((a, b) => a * b, 1)).toBeCloseTo(s, 5);
    }
    expect(atempoChain(3)).toEqual([2, 1.5]);
    expect(atempoChain(0.25)).toEqual([0.5, 0.5]);
  });
});

describe("escapeFilterValue", () => {
  it("échappe les deux niveaux comme la documentation de ffmpeg", () => {
    // Exemple de la documentation : this is a 'string': may contain one, or more, special characters
    expect(escapeFilterValue("this is a 'string': may contain one, or more, special characters")).toBe(
      "this is a \\\\\\'string\\\\\\'\\\\: may contain one\\, or more\\, special characters",
    );
  });
  it("redonne le texte exact après les deux niveaux de lecture", () => {
    const nasty = "C'est l'heure : 10:30, [gros gain] ; 100% \\ fou 🎰🔥";
    const escaped = escapeFilterValue(nasty);
    expect(unescapeOnce(unescapeOnce(escaped))).toBe(nasty);
    // Aucun séparateur de graphe nu.
    expect(escaped.replace(/\\./gs, "")).not.toMatch(/[,;[\]']/);
  });
});

describe("buildRenderArgs : structure commune", () => {
  it("coupe avant -i, durée exacte, un seul -i, un seul -filter_complex, une seule sortie (la dernière)", () => {
    const args = buildRenderArgs(spec());
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args.indexOf("-t")).toBeLessThan(args.indexOf("-i"));
    expect(valueAfter(args, "-ss")).toBe("150.000");
    expect(valueAfter(args, "-t")).toBe("15.000");
    expect(countOf(args, "-i")).toBe(1);
    expect(valueAfter(args, "-i")).toBe(base.source);
    expect(countOf(args, "-filter_complex")).toBe(1);
    expect(args).not.toContain("-vf");
    expect(args).not.toContain("-af");
    expect(args.at(-1)).toBe(base.output);
    expect(args.filter((a) => a.endsWith(".mp4"))).toEqual([base.source, base.output]);
    expect(valueAfter(args, "-avoid_negative_ts")).toBe("make_zero");
    expect(valueAfter(args, "-movflags")).toBe("+faststart");
    expect(valueAfter(args, "-c:v")).toBe("libx264");
    expect(valueAfter(args, "-crf")).toBe("18");
    expect(valueAfter(args, "-preset")).toBe("slow");
    expect(valueAfter(args, "-pix_fmt")).toBe("yuv420p");
    expect(valueAfter(args, "-c:a")).toBe("aac");
    expect(valueAfter(args, "-b:a")).toBe("160k");
    expect(valueAfter(args, "-fps_mode")).toBe("passthrough");
    expect(args).toContain("-y");
    expect(args).toContain("-nostdin");
  });
  it("maps explicites : [lap_v] et la 1re piste son", () => {
    const args = buildRenderArgs(spec());
    const maps = args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []));
    expect(maps).toEqual(["[lap_v]", "0:a:0"]);
  });
  it("source sans son : ni atempo ni piste audio", () => {
    const args = buildRenderArgs(spec({ speed: 2 }), { hasAudio: false });
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
    expect(valueAfter(args, "-filter_complex")).not.toContain("atempo");
    expect(valueAfter(args, "-filter_complex")).not.toContain("[0:a");
    expect(args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []))).toEqual(["[lap_v]"]);
  });
  it("source HEVC → libx265 étiqueté hvc1", () => {
    for (const codec of ["hevc", "HEVC", "h265"]) {
      const args = buildRenderArgs(spec({ sourceCodec: codec }));
      expect(valueAfter(args, "-c:v")).toBe("libx265");
      expect(valueAfter(args, "-tag:v")).toBe("hvc1");
    }
    expect(valueAfter(buildRenderArgs(spec({ sourceCodec: null })), "-c:v")).toBe("libx264");
    expect(buildRenderArgs(spec({ sourceCodec: "vp9" }))).not.toContain("-tag:v");
  });
  it("refuse les réglages impossibles avec une erreur en français", () => {
    expect(() => buildRenderArgs(spec({ endMs: 150_000 }))).toThrow(MontageMediaError);
    expect(() => buildRenderArgs(spec({ startMs: -1 }))).toThrow(/Début/);
    expect(() => buildRenderArgs(spec({ crf: 60 }))).toThrow(/CRF/);
    expect(() => buildRenderArgs(spec({ preset: "turbo" }))).toThrow(/inconnu/);
    expect(() => buildRenderArgs(spec({ speed: 10 }))).toThrow(/Vitesse/);
    expect(() => buildRenderArgs(spec({ output: base.source }))).toThrow(/source/);
    expect(() => buildRenderArgs(spec({ output: "-f" }))).toThrow(/invalide/);
  });
});

describe("buildRenderArgs : chaque cas (format × caméra × vitesse × sous-titres × texte × HEVC)", () => {
  const formats: ShortFormat[] = ["VERTICAL_9_16", "HORIZONTAL_16_9", "SQUARE_1_1"];
  const pips: PipPosition[] = ["NONE", "TOP_RIGHT", "TOP_LEFT", "BOTTOM_RIGHT", "BOTTOM_LEFT"];
  const speeds = [null, 1, 1.5, 0.5, 3];
  const cases: Array<[ShortFormat, PipPosition, number | null, boolean, boolean, boolean]> = [];
  for (const f of formats) for (const p of pips) for (const s of speeds) for (const srt of [false, true]) for (const txt of [false, true]) for (const hevc of [false, true]) cases.push([f, p, s, srt, txt, hevc]);

  it(`${cases.length} combinaisons : graphe cohérent, un seul passage`, () => {
    for (const [format, pipPosition, speed, srt, txt, hevc] of cases) {
      const s = spec({
        format,
        pipPosition,
        speed,
        srtPath: srt ? "/tmp/montage/job1/short-1.srt" : null,
        overlayText: txt ? "Gros gain !" : null,
        fontFile: txt ? "/usr/share/fonts/noto/NotoSans-Bold.ttf" : null,
        sourceCodec: hevc ? "hevc" : "h264",
      });
      const args = buildRenderArgs(s);
      const graph = valueAfter(args, "-filter_complex")!;
      const { width, height } = formatSize(format);
      const ctx = JSON.stringify({ format, pipPosition, speed, srt, txt, hevc });
      expect(countOf(args, "-filter_complex"), ctx).toBe(1);
      expect(countOf(args, "-i"), ctx).toBe(1);
      expect(args.at(-1), ctx).toBe(base.output);
      expect(graph, ctx).toContain(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
      expect(graph, ctx).toContain(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`);
      expect(graph, ctx).toContain("setsar=1");
      expect(graph.endsWith("[lap_v]") || graph.includes("[lap_v];"), ctx).toBe(true);
      // Caméra
      const pip = pipCrop(pipPosition);
      if (pip) {
        expect(graph, ctx).toContain("[0:v:0]split=2[lap_bg][lap_fg]");
        expect(graph, ctx).toContain(pip.crop);
        expect(graph, ctx).toContain(`overlay=${pip.overlay}`);
      } else {
        expect(graph, ctx).not.toContain("split");
        expect(graph, ctx).not.toContain("overlay");
      }
      // Vitesse
      const eff = speed !== null && speed !== 1 ? speed : null;
      if (eff) {
        expect(graph, ctx).toContain(`setpts=PTS/${eff}`);
        expect(graph, ctx).toContain("[0:a:0]atempo=");
        expect(args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : [])), ctx).toEqual(["[lap_v]", "[lap_a]"]);
        expect(valueAfter(args, "-r"), ctx).toBe("30/1");
        expect(args, ctx).not.toContain("-fps_mode");
      } else {
        expect(graph, ctx).not.toContain("setpts");
        expect(graph, ctx).not.toContain("atempo");
        expect(valueAfter(args, "-fps_mode"), ctx).toBe("passthrough");
      }
      // Sous-titres et texte : sur l'image finale, avant la vitesse.
      if (srt) expect(graph, ctx).toContain("subtitles=filename=/tmp/montage/job1/short-1.srt:force_style=");
      else expect(graph, ctx).not.toContain("subtitles");
      if (txt) expect(graph, ctx).toContain("drawtext=fontfile=/usr/share/fonts/noto/NotoSans-Bold.ttf:text=Gros gain !:expansion=none");
      else expect(graph, ctx).not.toContain("drawtext");
      const order = ["pad=", "subtitles=", "drawtext=", "setpts="].map((k) => graph.indexOf(k)).filter((i) => i >= 0);
      expect([...order].sort((a, b) => a - b), ctx).toEqual(order);
      // Codec
      expect(valueAfter(args, "-c:v"), ctx).toBe(hevc ? "libx265" : "libx264");
      // Toutes les étiquettes produites sont consommées une fois.
      const produced = [...graph.matchAll(/\[(lap_[a-z]+)\](?=;|$)/g)].map((m) => m[1]);
      for (const label of produced) {
        if (label === "lap_v" || label === "lap_a") continue;
        expect(graph.split(`[${label}]`).length - 1, `${ctx} ${label}`).toBe(2);
      }
    }
  });

  it("vitesse 1 (ou null) = aucune modification du temps", () => {
    expect(buildRenderArgs(spec({ speed: 1 }))).toEqual(buildRenderArgs(spec({ speed: null })));
  });
  it("vitesse 3 → atempo en chaîne 2 × 1,5", () => {
    expect(valueAfter(buildRenderArgs(spec({ speed: 3 })), "-filter_complex")).toContain("[0:a:0]atempo=2,atempo=1.5[lap_a]");
  });
  it("cadence inconnue ou invalide → images de la source telles quelles", () => {
    const args = buildRenderArgs(spec({ speed: 2, fpsRaw: "0/0" }));
    expect(valueAfter(args, "-fps_mode")).toBe("passthrough");
    expect(valueAfter(buildRenderArgs(spec({ speed: 2, fpsRaw: "30000/1001" })), "-r")).toBe("30000/1001");
  });
  it("durée rendue = passage ÷ vitesse", () => {
    expect(renderedDurationMs(spec())).toBe(15_000);
    expect(renderedDurationMs(spec({ speed: 1.5 }))).toBe(10_000);
    expect(renderedDurationMs(spec({ speed: 0.5 }))).toBe(30_000);
  });
  it("texte sous la caméra quand elle est en haut, en haut de l'image sinon", () => {
    const top = buildFilterGraph(spec({ overlayText: "x", pipPosition: "TOP_RIGHT" })).graph;
    const bottom = buildFilterGraph(spec({ overlayText: "x", pipPosition: "BOTTOM_RIGHT" })).graph;
    expect(top).toMatch(/:y=293(,|\[)/);
    expect(bottom).toMatch(/:y=115(,|\[)/);
  });
  it("sans police donnée : police du système (fontconfig)", () => {
    expect(buildFilterGraph(spec({ overlayText: "x" })).graph).toContain("drawtext=font=Sans:text=x");
  });
});

describe("fitOverlayText", () => {
  it("texte court : une ligne, police normale", () => {
    expect(fitOverlayText("Gros gain !", 1080, 64)).toEqual({ lines: ["Gros gain !"], fontSize: 64 });
  });
  it("texte long : coupé aux espaces, 3 lignes au plus, tient dans 90 % de la largeur", () => {
    const r = fitOverlayText("Regarde cette série de mises incroyable sur la roulette ce soir avec un gain énorme à la fin", 1080, 64);
    expect(r.lines.length).toBeLessThanOrEqual(3);
    expect(r.lines.join(" ")).toBe("Regarde cette série de mises incroyable sur la roulette ce soir avec un gain énorme à la fin");
    for (const l of r.lines) expect([...l].length * r.fontSize * 0.58).toBeLessThanOrEqual(1080 * 0.9);
  });
  it("mot interminable : police réduite (32 px au moins) ; sauts de ligne du client gardés", () => {
    expect(fitOverlayText("SUPERMEGAJACKPOTINCROYABLEDELANNEE2026", 1080, 64).fontSize).toBeLessThan(64);
    expect(fitOverlayText("x".repeat(200), 1080, 64).fontSize).toBe(32);
    expect(fitOverlayText("Ligne 1\nLigne 2", 1080, 64).lines).toEqual(["Ligne 1", "Ligne 2"]);
  });
});

describe("buildRenderArgs : échappements (rien n'est injecté dans le graphe)", () => {
  const nastyText = "C'est l'heure : x35, [jackpot] ; 100% 🎰🔥 \\o/";
  const nastyPath = "/tmp/montage/l'été: [a],b;c/short 1.srt";
  const style = "FontName=Open Sans,FontSize=14,PrimaryColour=&HFFFFFF";

  it("le graphe garde exactement ses filtres, le texte et le chemin redonnés tels quels", () => {
    const s = spec({ overlayText: nastyText, srtPath: nastyPath, subtitleStyle: style, fontFile: "/fonts/My,Font's.ttf", pipPosition: "TOP_LEFT", speed: 1.25 });
    const graph = valueAfter(buildRenderArgs(s), "-filter_complex")!;
    const filters = splitGraph(graph).map((f) => f.replace(/^(\[[a-z0-9_:]+\])+/, ""));
    // split, crop, scale, scale, pad, setsar, overlay, subtitles, drawtext, setpts, format, atempo
    expect(filters.map((f) => f.split("=")[0])).toEqual([
      "split", "crop", "scale", "scale", "pad", "setsar", "overlay", "subtitles", "drawtext", "setpts", "format", "atempo",
    ]);
    const subtitles = filters.find((f) => f.startsWith("subtitles="))!;
    const drawtext = filters.find((f) => f.startsWith("drawtext="))!;
    // Niveau 2 lu → options séparées par « : » non échappés → niveau 1 lu.
    const optionsOf = (filter: string) => {
      const body = unescapeOnce(filter).replace(/^[a-z]+=/, "");
      const opts: string[] = [];
      let cur = "";
      for (let i = 0; i < body.length; i++) {
        if (body[i] === "\\") {
          cur += body[i]! + (body[i + 1] ?? "");
          i++;
        } else if (body[i] === ":") {
          opts.push(unescapeOnce(cur));
          cur = "";
        } else cur += body[i];
      }
      opts.push(unescapeOnce(cur));
      return opts;
    };
    expect(optionsOf(subtitles)).toEqual([`filename=${nastyPath}`, `force_style=${style}`]);
    const dt = optionsOf(drawtext);
    expect(dt[0]).toBe("fontfile=/fonts/My,Font's.ttf");
    const drawn = drawableOverlayText(nastyText);
    expect(drawn).toBe("C'est l'heure : x35, [jackpot] ; 100% \\o/");
    expect(dt[1]).toBe(`text=${fitOverlayText(drawn, 1080, 64).lines.join("\n")}`);
    expect(dt[1]!.replace(/\n/g, " ")).toBe(`text=${drawn}`);
    expect(dt[2]).toBe("expansion=none");
  });
  it("le texte n'apparaît jamais comme argument séparé de la ligne de commande", () => {
    const args = buildRenderArgs(spec({ overlayText: "--help -y ; rm -rf /" }));
    expect(args.some((a) => a.startsWith("--help"))).toBe(false);
    expect(args.filter((a) => a.includes("rm -rf")).length).toBe(1);
    expect(valueAfter(args, "-filter_complex")).toContain("rm -rf /");
  });
  it("texte vide, blanc ou seulement des emojis : pas de drawtext", () => {
    expect(buildFilterGraph(spec({ overlayText: "   " })).graph).not.toContain("drawtext");
    expect(buildFilterGraph(spec({ overlayText: "🎰🔥 👍🏽 🇫🇷" })).graph).not.toContain("drawtext");
  });
  it("emojis retirés du texte incrusté (drawtext dessinerait un carré vide), accents gardés", () => {
    expect(drawableOverlayText("Gros gain 🎰🔥 à la roulette 👍🏽 !")).toBe("Gros gain à la roulette !");
    expect(drawableOverlayText("Ligne 1 ❤️\r\nLigne 2")).toBe("Ligne 1\nLigne 2");
  });
});

describe("renderShort / compressShort (faux exécuteur)", () => {
  it("relit la source (son ?), rend en un passage, puis lit la sortie", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lap-render-"));
    const runner = createFakeFfmpegRunner({
      ffprobe: [{ stdout: fakeProbeJson({ width: 1920, height: 1080, durationMs: 3_600_000, hasAudio: false }) }, { stdout: fakeProbeJson({ durationMs: 15_000 }) }],
    });
    const probe = await renderShort(runner, spec({ output: join(dir, "out", "s1.mp4") }), { timeoutMs: 1234 });
    expect(probe).toMatchObject({ width: 1080, height: 1920, durationMs: 15_000 });
    expect(runner.ffmpegCalls()).toHaveLength(1);
    expect(runner.calls[1]!.timeoutMs).toBe(1234);
    expect(runner.ffmpegCalls()[0]).toContain("-an");
    expect(runner.ffprobeCalls().map((a) => a.at(-1))).toEqual([base.source, join(dir, "out", "s1.mp4")]);
    // Aucun fichier intermédiaire écrit par le moteur lui-même.
    expect(await readdir(join(dir, "out"))).toEqual([]);
  });
  it("passage qui commence après la fin de la source : erreur claire, aucun rendu", async () => {
    const runner = createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson({ durationMs: 60_000 }) } });
    await expect(renderShort(runner, spec())).rejects.toThrow(/après la fin/);
    expect(runner.ffmpegCalls()).toHaveLength(0);
  });
  it("échec de ffmpeg : erreur de montage, sortie partielle effacée", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lap-render-"));
    const out = join(dir, "s1.mp4");
    const runner = createFakeFfmpegRunner({
      ffmpeg: async () => {
        await writeFile(out, "moitié");
        return { code: 1, stderr: "Error while filtering\nConversion failed!" };
      },
    });
    const err = await renderShort(runner, spec({ output: out }), { hasAudio: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MontageMediaError);
    expect((err as MontageMediaError).message).toBe("Le montage de ce short a échoué.");
    expect((err as MontageMediaError).detail).toContain("Conversion failed!");
    expect(await readdir(dir)).toEqual([]);
  });
  it("compression : rien si le short tient sous la limite", async () => {
    const runner = createFakeFfmpegRunner({ ffprobe: { stdout: fakeProbeJson({ sizeBytes: 10 * 1024 * 1024 }) } });
    const r = await compressShort(runner, spec());
    expect(r).toMatchObject({ compressed: false, crf: 18, overLimit: false });
    expect(runner.ffmpegCalls()).toHaveLength(0);
  });
  it("compression : un seul nouveau rendu DEPUIS LA SOURCE, CRF + 4, puis remplace le short", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lap-compress-"));
    const out = join(dir, "s1.mp4");
    await writeFile(out, "gros short");
    const runner = createFakeFfmpegRunner({
      writeOutputs: true,
      ffprobe: [
        { stdout: fakeProbeJson({ sizeBytes: 63 * 1024 * 1024 }) }, // short actuel
        { stdout: fakeProbeJson({ width: 1920, height: 1080, durationMs: 3_600_000 }) }, // source
        { stdout: fakeProbeJson({ sizeBytes: 41 * 1024 * 1024 }) }, // short compressé
      ],
    });
    const r = await compressShort(runner, spec({ output: out }), MONTAGE_LIMITS.telegramVideoMaxBytes);
    expect(r).toMatchObject({ compressed: true, crf: 22, overLimit: false });
    const calls = runner.ffmpegCalls();
    expect(calls).toHaveLength(1);
    expect(valueAfter(calls[0]!, "-i")).toBe(base.source);
    expect(valueAfter(calls[0]!, "-crf")).toBe("22");
    expect(calls[0]!.at(-1)).toBe(join(dir, "s1.crf22.mp4"));
    expect(await readdir(dir)).toEqual(["s1.mp4"]);
    expect(await readFile(out, "utf8")).toContain("faux fichier");
  });
  it("compression : encore trop lourd → signalé, jamais une 2e fois", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lap-compress-"));
    const runner = createFakeFfmpegRunner({ writeOutputs: true, ffprobe: { stdout: fakeProbeJson({ sizeBytes: 80 * 1024 * 1024, durationMs: 3_600_000 }) } });
    const r = await compressShort(runner, spec({ output: join(dir, "s1.mp4") }));
    expect(r).toMatchObject({ compressed: true, overLimit: true });
    expect(runner.ffmpegCalls()).toHaveLength(1);
  });
});
