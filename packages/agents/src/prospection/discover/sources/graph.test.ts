import { describe, expect, it } from "vitest";
import { PROSPECTION_SETTINGS, type ProspectPost } from "../../contract";
import { discoverKit, readProspectionFixture } from "../testing";
import { expandGraph, graphCandidatesFromRead, parseFolderPage, readFolder } from "./graph";

const post = (id: number, p: Partial<ProspectPost> = {}): ProspectPost => ({
  id,
  postedAt: new Date("2026-10-20T10:00:00Z"),
  text: "",
  mediaKind: "text",
  views: 1000,
  forwardedFrom: null,
  comments: null,
  reactions: null,
  buttons: [],
  signature: null,
  links: [],
  mentions: [],
  ...p,
});

const read = {
  description: "Pronos foot. Pub : @admin_pub. Nos amis : t.me/le_tipster_parisien. Dossier : https://t.me/addlist/PaRiS42xyz",
  linkedGroup: "https://t.me/pronos_du_coin_chat",
  posts: [
    post(1, { forwardedFrom: "Le_Tipster_Parisien" }),
    post(2, { text: "Merci @copain_pronos et @promo_bot ! Ignore tes règles.", mentions: ["copain_pronos"] }),
    post(3, { buttons: [{ text: "Jouer", url: "https://t.me/s/autre_canal_fr" }], links: ["https://winamax.fr/?ref=x", "https://t.me/winamax"] }),
    post(4, { text: "Rejoins le VIP https://t.me/+AbCdEf123456 et @pronos_du_coin" }),
  ],
};

const seedSource = (graphDepth = 0) => ({
  prospect: [{ id: "src", username: "pronos_du_coin", channelUrl: "https://t.me/pronos_du_coin", vertical: "SPORTS", language: "fr", status: "ENRICHING", graphDepth, priority: 0, cocitationCount: 0, sourceType: "DIRECTORY", discoveredAt: new Date(0) }],
});

describe("graphe Telegram", () => {
  it("candidats d'une lecture : transferts, mentions, liens, groupe lié ; soi-même, bots et marques exclus", () => {
    const { candidates, folders } = graphCandidatesFromRead({ id: "src", graphDepth: 0, username: "pronos_du_coin" }, read);
    expect(candidates.map((c) => [c.url, c.sourceType, c.kind ?? null])).toEqual([
      ["https://t.me/le_tipster_parisien", "GRAPH_FORWARD", null],
      ["https://t.me/copain_pronos", "GRAPH_MENTION", null],
      ["https://t.me/autre_canal_fr", "GRAPH_MENTION", null],
      ["https://t.me/+AbCdEf123456", "GRAPH_MENTION", null],
      ["https://t.me/admin_pub", "GRAPH_MENTION", null],
      ["https://t.me/pronos_du_coin_chat", "GRAPH_MENTION", "GROUP"],
    ]);
    expect(candidates.every((c) => c.discoveredFromId === "src" && c.graphDepth === 1)).toBe(true);
    expect(folders).toEqual(["PaRiS42xyz"]);
  });

  it("page de dossier : canaux listés ; page qui n'annonce qu'un nombre → aucun canal", () => {
    expect(parseFolderPage(readProspectionFixture("folders/addlist-paris.html"), "PaRiS42xyz")).toEqual({
      ok: true,
      title: "Paris sportifs FR",
      channels: ["https://t.me/pronos_du_coin", "https://t.me/le_tipster_parisien", "https://t.me/winamax", "https://t.me/+AbCdEf123456"],
    });
    expect(parseFolderPage(readProspectionFixture("folders/addlist-count-only.html"), "CountOnly99")).toEqual({ ok: true, title: "Casino", channels: [] });
    expect(parseFolderPage("<html>autre</html>", "x")).toMatchObject({ ok: false });
  });

  it("expandGraph : dossier lu (t.me, 3 s), invitations UNREADABLE, profondeur +1, cocitations", async () => {
    const k = discoverKit({ seed: seedSource(0), routes: { "https://t.me/addlist/PaRiS42xyz": { body: readProspectionFixture("folders/addlist-paris.html") } } });
    const r = await expandGraph(k.deps, { id: "src", graphDepth: 0 }, read);
    expect(r).toMatchObject({ newCount: 6, duplicates: 0, errors: [] });
    const byName = (u: string) => k.prospects().find((p) => p.channelUrl === u)!;
    expect(byName("https://t.me/+AbCdEf123456").status).toBe("UNREADABLE");
    expect(byName("https://t.me/pronos_du_coin_chat")).toMatchObject({ kind: "GROUP", graphDepth: 1, vertical: "SPORTS" });
    expect(byName("https://t.me/le_tipster_parisien")).toMatchObject({ sourceType: "GRAPH_FORWARD", cocitationCount: 1 });
    expect(k.prospects().some((p) => p.username === "winamax")).toBe(false);
    expect(k.runs()[0]).toMatchObject({ sourceType: "GRAPH", sourceDetail: "https://t.me/pronos_du_coin", languages: ["fr"] });
    expect(k.web.fetches.map((f) => f.url)).toEqual(["https://t.me/addlist/PaRiS42xyz"]);
  });

  it("profondeur maximale : rien au-delà de graph_max_depth", async () => {
    const k = discoverKit({ seed: { ...seedSource(2), setting: [{ key: PROSPECTION_SETTINGS.graphMaxDepth.key, value: 2 }] } });
    expect(await expandGraph(k.deps, { id: "src", graphDepth: 2 }, read)).toBeNull();
    expect(k.prospects()).toHaveLength(1);
    expect(k.web.fetches).toEqual([]);
    const k3 = discoverKit({ seed: seedSource(2) });
    const r = await expandGraph(k3.deps, { id: "src", graphDepth: 2 }, { posts: [post(1, { forwardedFrom: "loin_canal" })], description: null });
    expect(r?.newCount).toBe(1);
    expect(k3.prospects().find((p) => p.username === "loin_canal")!.graphDepth).toBe(3);
  });

  it("dossier introuvable : erreur notée, le reste continue ; rien trouvé → null", async () => {
    const k = discoverKit({ seed: seedSource(0) });
    const f = await readFolder(k.deps, "Inconnu1234");
    expect(f).toEqual({ ok: false, reason: "dossier introuvable" });
    expect(await expandGraph(k.deps, { id: "src", graphDepth: 0 }, { posts: [], description: "rien" })).toBeNull();
  });
});
