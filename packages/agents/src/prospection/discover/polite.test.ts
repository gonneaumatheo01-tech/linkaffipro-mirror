import { describe, expect, it } from "vitest";
import { PROSPECTION_SETTINGS } from "../contract";
import { ProspectFetchError, activeSourcePauses, clearSourcePause, isBotWall, politeProspectFetch } from "./polite";
import { DISCOVER_NOW, discoverKit, readProspectionFixture } from "./testing";

const TG = "https://tgstat.com";

describe("politeProspectFetch", () => {
  it("t.me : 3 s entre deux requêtes, sans robots.txt (horodatages)", async () => {
    const k = discoverKit({ routes: { "https://t.me/a_channel": { body: "a" }, "https://t.me/b_channel": { body: "b" }, "https://t.me/c_channel": { body: "c" } } });
    for (const n of ["a", "b", "c"]) await politeProspectFetch(k.deps, `https://t.me/${n}_channel`, { kind: "tme" });
    const at = k.web.fetches.map((f) => f.at - DISCOVER_NOW.getTime());
    expect(at).toEqual([0, 3000, 6000]);
    expect(k.web.fetches.some((f) => f.url.includes("robots.txt"))).toBe(false);
  });

  it("annuaires : robots.txt lu une fois (cache), 10 s par domaine, réglage plus court ignoré", async () => {
    const k = discoverKit({
      routes: { [`${TG}/robots.txt`]: { body: readProspectionFixture("directories/robots-tgstat.txt") }, [`${TG}/sport`]: { body: "s" }, [`${TG}/gambling`]: { body: "g" } },
      seed: { setting: [{ key: PROSPECTION_SETTINGS.directoryRateLimitMs.key, value: 2000 }] },
    });
    await politeProspectFetch(k.deps, `${TG}/sport`, { kind: "directory" });
    await politeProspectFetch(k.deps, `${TG}/gambling`, { kind: "directory" });
    expect(k.web.fetches.map((f) => [f.url, f.at - DISCOVER_NOW.getTime()])).toEqual([
      [`${TG}/robots.txt`, 0],
      [`${TG}/sport`, 10_000],
      [`${TG}/gambling`, 20_000],
    ]);
  });

  it("robots.txt qui interdit → erreur robots, aucune lecture de la page", async () => {
    const k = discoverKit({ routes: { [`${TG}/robots.txt`]: { body: readProspectionFixture("directories/robots-tgstat.txt") }, [`${TG}/search?q=x`]: { body: "x" } } });
    await expect(politeProspectFetch(k.deps, `${TG}/search?q=x`, { kind: "directory" })).rejects.toMatchObject({ code: "robots" });
    expect(k.web.fetches.map((f) => f.url)).toEqual([`${TG}/robots.txt`]);
  });

  it("403 → pause 24 h de la source, puis plus aucune requête", async () => {
    const k = discoverKit({ routes: { "https://telemetr.io/robots.txt": { status: 404, body: "" }, "https://telemetr.io/en/catalog/global/sport": { status: 403, body: "Forbidden" } } });
    const err = await politeProspectFetch(k.deps, "https://telemetr.io/en/catalog/global/sport", { kind: "directory" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProspectFetchError);
    expect(err.code).toBe("blocked");
    const pauses = await activeSourcePauses(k.deps);
    expect(pauses["directory:telemetr.io"]!.until).toBe(new Date(k.c.clock() + 24 * 3600_000).toISOString());
    const before = k.web.fetches.length;
    await expect(politeProspectFetch(k.deps, "https://telemetr.io/en/catalog/global/sport", { kind: "directory" })).rejects.toMatchObject({ code: "paused" });
    expect(k.web.fetches.length).toBe(before);
    // 24 h plus tard, la pause est échue.
    k.c.advance(24 * 3600_000 + 1);
    expect(await activeSourcePauses(k.deps)).toEqual({});
    await clearSourcePause(k.deps, "directory:telemetr.io");
  });

  it("page captcha (200) → pause, jamais de contournement", async () => {
    const k = discoverKit({ routes: { "https://tlgrm.eu/robots.txt": { status: 404, body: "" }, "https://tlgrm.eu/channels/sport": { body: readProspectionFixture("directories/captcha.html") } } });
    await expect(politeProspectFetch(k.deps, "https://tlgrm.eu/channels/sport", { kind: "directory" })).rejects.toMatchObject({ code: "blocked" });
    expect(Object.keys(await activeSourcePauses(k.deps))).toEqual(["directory:tlgrm.eu"]);
  });

  it("le mot « captcha » dans un long catalogue n'est pas un mur ; un vrai défi l'est", () => {
    expect(isBotWall(200, `<script>captcha</script>${"x".repeat(20_000)}`)).toBe(false);
    expect(isBotWall(200, "<title>Just a moment...</title>")).toBe(true);
    expect(isBotWall(200, "<div id=cf-challenge-running></div>")).toBe(true);
    expect(isBotWall(429, "")).toBe(true);
    expect(isBotWall(404, "not found")).toBe(false);
  });

  it("lien d'invitation privé jamais ouvert ; sans accès web, rien n'est lu", async () => {
    const k = discoverKit();
    await expect(politeProspectFetch(k.deps, "https://t.me/+AbCdEf123456", { kind: "tme" })).rejects.toMatchObject({ code: "invite" });
    await expect(politeProspectFetch(k.deps, "https://t.me/joinchat/AbCdEf123456", { kind: "tme" })).rejects.toMatchObject({ code: "invite" });
    expect(k.web.fetches).toEqual([]);
    await expect(politeProspectFetch({ ...k.deps, web: undefined }, "https://t.me/abcdef", { kind: "tme" })).rejects.toMatchObject({ code: "no_web" });
  });
});
