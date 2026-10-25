/**
 * Phase 35, chantier D — Kevin et les bookmakers lus directement : phrases du client sur la fausse IA, droits (un
 * membre présenté lit seulement), ancien nom `test_bookmaker`, capacités des ordres, voix contrôlée, aucune mise.
 * Les lectures des chantiers A / B / C passent par `bookmakers/ops`, simulé ; aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ops = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  events: [] as unknown[],
}));

vi.mock("../bookmakers/ops", () => ({
  enqueueReadJob: vi.fn(async (_d: unknown, i: Record<string, unknown>) => {
    const row = { id: `job${ops.jobs.length + 1}`, status: "PENDING", ...i };
    ops.jobs.push(row);
    return row;
  }),
  waitReadJob: vi.fn(async () => null),
  macAlive: vi.fn(async () => true),
  macHeartbeatFresh: () => true,
  readMacHeartbeat: vi.fn(async () => ({
    at: new Date().toISOString(),
    kinds: [],
    version: null,
    visible: false,
  })),
  learnSite: vi.fn(async () => ({ ok: true, status: "READY", message: "prêt" })),
  readEvents: vi.fn(async () => ops.events),
  readMarkets: vi.fn(async () => []),
  readOddsTwice: vi.fn(async () => ({ ok: false, reason: "x", reads: [] })),
}));
vi.mock("../missions/lifecycle", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  continueMission: vi.fn(async () => undefined),
}));

process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

import { ensureDefaultSites } from "../bookmakers/sites";
import { BOOKMAKER_DEFAULT_CREDENTIALS_KEY } from "../bookmakers/contract";
import { saveSecret } from "../human/secrets";
import { capabilitiesForAgent, capability } from "../orders/registry";
import { bossAiTurn } from "./execute";
import { BOSS_CATALOG, bossActionAllowed } from "./catalog";
import {
  BOOKMAKER_ACTIONS,
  BOOKMAKER_ADMIN_ACTION_KEYS,
  BOOKMAKER_READ_ACTION_KEYS,
} from "./catalog-bookmakers";
import { createBossKit } from "./testing";
import { voiceCheck } from "./voice";
import { isSecretAdminText } from "../admin/commands";

const call = (name: string, input: Record<string, unknown> = {}) => ({ name, input });
const MEMBER = {
  kind: "member",
  telegramUserId: 7n,
  memberId: "m",
  role: "MEMBER",
  firstName: "Zoé",
} as const;

beforeEach(() => {
  ops.jobs.length = 0;
  ops.events = [];
});

describe("catalogue de Kevin : bookmakers", () => {
  it("entrées uniques, lectures permises aux membres présentés, gestes réservés à l'admin", () => {
    const keys = BOSS_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of [
      "voir_matchs",
      "etat_bookmakers",
      "cote_de",
      "tester_site",
      "test_bookmaker",
      "apprendre_site",
      "ajouter_bookmaker",
      "ouvrir_navigateur",
      "identifiants_bookmakers",
    ])
      expect(keys, k).toContain(k);
    const by = (k: string) => BOOKMAKER_ACTIONS.find((a) => a.key === k)!;
    for (const k of BOOKMAKER_READ_ACTION_KEYS)
      expect(bossActionAllowed(by(k), MEMBER), k).toBe(true);
    for (const k of BOOKMAKER_ADMIN_ACTION_KEYS)
      expect(bossActionAllowed(by(k), MEMBER), k).toBe(false);
    for (const a of BOOKMAKER_ACTIONS)
      expect(a.description).not.toMatch(/recette|scraping|\bDOM\b|\bAPI\b/i);
  });

  it("les phrases que Kevin conseille ne sont jamais prises pour un secret ; une valeur collée l'est toujours", () => {
    for (const t of [
      "identifiants bookmakers",
      "nouveaux identifiants bookmakers",
      "les identifiants des bookmakers",
    ])
      expect(isSecretAdminText(t), t).toBe(false);
    for (const t of [
      "identifiants bookmakers Mdp-de-test-0000",
      "le mot de passe c'est Mdp-de-test-0000",
    ])
      expect(isSecretAdminText(t), t).toBe(true);
  });

  it("capacités des ordres (équipe Paris, agent Cotes & sélection)", () => {
    for (const k of [
      "voir_matchs",
      "etat_bookmakers",
      "cote_de",
      "tester_site",
      "apprendre_site",
      "ajouter_bookmaker",
      "ouvrir_navigateur",
    ])
      expect(capability("sports", k), k).toBeTruthy();
    expect(capabilitiesForAgent("cotes").map((c) => c.key)).toEqual(
      expect.arrayContaining(["voir_matchs", "cote_de", "tester_site"]),
    );
  });

  it("phrases du client : identifiants demandés en privé, test, apprentissage, ajout, navigateur, état — voix contrôlée", async () => {
    const phrases: Array<[string, ReturnType<typeof call>, RegExp]> = [
      ["teste Celsius", call("tester_site", { bookmaker: "Celsius" }), /identifiants/],
      ["identifiants bookmakers", call("identifiants_bookmakers", {}), /en privé/],
      ["les bookmakers ça va ?", call("etat_bookmakers", {}), /Celsius[\s\S]*Mac/],
    ];
    const kit = await createBossKit(phrases.map(([p, c]) => [p, c] as const));
    await ensureDefaultSites(kit.deps);
    for (const [phrase, , expected] of phrases) {
      const r = await bossAiTurn(kit.deps, kit.input(phrase));
      expect(r.reply ?? "", phrase).toMatch(expected);
      expect(voiceCheck(r.reply ?? "").problems, `${phrase}\n${r.reply}`).toEqual([]);
    }
    expect(kit.tables("humanRequest").filter((r) => r.kind === "SECRET")).toHaveLength(2);
    expect(ops.jobs).toHaveLength(0);
  });

  it("avec les identifiants : tester (ancien nom compris), apprendre avec une nouvelle adresse, ajouter, ouvrir le navigateur", async () => {
    const phrases: Array<[string, ReturnType<typeof call>]> = [
      ["teste la connexion a sportaza", call("test_bookmaker", { bookmaker: "sportaza" })],
      [
        "Bet Portal c'est betportal.io, apprends-le",
        call("apprendre_site", { bookmaker: "Bet Portal", adresse: "betportal.io" }),
      ],
      [
        "ajoute le bookmaker Unibet, c'est unibet.fr",
        call("ajouter_bookmaker", { nom: "Unibet", adresse: "unibet.fr" }),
      ],
      [
        "ouvre le navigateur sur le Mac pour Celsius",
        call("ouvrir_navigateur", { bookmaker: "Celsius" }),
      ],
      [
        "quels matchs sur Sportaza ce soir ?",
        call("voir_matchs", { bookmaker: "Sportaza", moment: "soir" }),
      ],
    ];
    const kit = await createBossKit(phrases);
    await ensureDefaultSites(kit.deps);
    await saveSecret(
      kit.deps,
      BOOKMAKER_DEFAULT_CREDENTIALS_KEY,
      JSON.stringify({ email: "compte.test@example.com", password: "Mdp-de-test-0000" }),
      { userId: null, via: "TELEGRAM" },
    );
    const replies: string[] = [];
    for (const [phrase] of phrases) {
      const r = await bossAiTurn(kit.deps, kit.input(phrase));
      replies.push(r.reply ?? "");
      expect(voiceCheck(r.reply ?? "").problems, `${phrase}\n${r.reply}`).toEqual([]);
    }
    expect(ops.jobs.map((j) => [j.kind, j.siteKey])).toEqual([
      ["test", "sportaza"],
      ["learn", "betportal"],
      ["learn", "unibet"],
      ["visible", "celsius"],
    ]);
    expect(kit.tables("bookmakerSite").find((s) => s.key === "betportal")!.baseUrl).toBe(
      "https://betportal.io/",
    );
    expect(replies[4]).toMatch(/Sportaza/);
    // Jamais un mot du moteur dans les réponses.
    expect(replies.join("\n")).not.toMatch(/recette|scraping|\bDOM\b|\bAPI\b/i);
  });
});
