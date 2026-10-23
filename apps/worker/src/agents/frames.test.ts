import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createFrameExtractor, frameTimes, type CommandRunner } from "./frames";

describe("extraction d'images (ffmpeg simulé)", () => {
  it("instants : début, milieu, fin ; durée inconnue → 0, 1, 2 s", () => {
    expect(frameTimes(10, 3)).toEqual([1, 5, 9]);
    expect(frameTimes(10, 1)).toEqual([5]);
    expect(frameTimes(null, 3)).toEqual([0, 1, 2]);
  });
  it("durée lue par ffprobe, 3 images écrites par ffmpeg ; ffmpeg en échec → null", async () => {
    const calls: string[][] = [];
    const ok: CommandRunner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "ffprobe") return { code: 0, stdout: "12.0\n" };
      await writeFile(args[args.length - 1]!, Buffer.from([0xff, 0xd8, calls.length]));
      return { code: 0, stdout: "" };
    };
    const res = await createFrameExtractor(ok)({ bytes: new Uint8Array([1, 2]), mimeType: "video/mp4" }, 3);
    expect(res?.durationSec).toBe(12);
    expect(res?.frames).toHaveLength(3);
    expect(calls.filter((c) => c[0] === "ffmpeg").map((c) => c[c.indexOf("-ss") + 1])).toEqual(["1.2", "6", "10.8"]);
    const ko: CommandRunner = async () => ({ code: 1, stdout: "" });
    expect(await createFrameExtractor(ko)({ bytes: new Uint8Array([1]), mimeType: "video/mp4" }, 3)).toBeNull();
  });
});
