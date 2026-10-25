/**
 * Phase 34, chantier A — garde-fou « tout par Kevin » (règle 5) : inventaire des actions serveur du site et
 * correspondance avec Kevin. 1. Fixture de 5 fichiers d'actions (`fixtures/site-parity/`). 2. Le VRAI site
 * (`apps/web`) : zéro manquant, zéro correspondance fausse (désactivable pendant la phase 34 par
 * `KEVIN_PARITY_PENDING=1`, le temps que les lots des chantiers B à E soient remplis).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SiteOpMeta, SiteParityEntry } from "./contract";
import { checkParity, guessNature, isUseServerFile, parityMarkdown, parityOk, parityTable, scanServerActions, type ServerActionFile } from "./parity-scan";
import { indexSiteOps } from "./registry";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(HERE, "..", "..", "fixtures", "site-parity");
const WEB = join(HERE, "..", "..", "..", "..", "apps", "web");

function fixtureFiles(): ServerActionFile[] {
  const out: ServerActionFile[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(FIXTURE, p).split(sep).join("/").replace(/\.txt$/, ""), content: readFileSync(p, "utf8") });
    }
  };
  walk(FIXTURE);
  return out;
}

const OPS: SiteOpMeta[] = [
  {
    key: "campagnes.creer",
    domain: "campagnes",
    description: "Créer une campagne",
    examples: ["crée une campagne pour Celsius en France avec un CPA de 120"],
    kind: "create",
    role: "MANAGER",
    confirm: "none",
    params: { type: "object", properties: {} },
    serverActions: ["app/(admin)/campaigns/actions.ts#createCampaignAction"],
  },
  {
    key: "campagnes.supprimer",
    domain: "campagnes",
    description: "Supprimer une campagne",
    examples: ["supprime la campagne Celsius"],
    kind: "delete",
    role: "ADMIN",
    confirm: "delete",
    params: { type: "object", properties: {} },
    serverActions: ["app/(admin)/campaigns/actions.ts#deleteCampaignAction"],
  },
  {
    key: "reglages.etiquette_renommer",
    domain: "reglages",
    description: "Renommer une étiquette",
    examples: ["renomme l'étiquette VIP en fidèles"],
    kind: "setting",
    role: "ADMIN",
    confirm: "none",
    params: { type: "object", properties: {} },
    serverActions: ["app/(admin)/settings/tags/actions.ts#renameTagAction"],
  },
];

const FULL: Record<string, SiteParityEntry> = {
  "app/(admin)/campaigns/actions.ts#createCampaignAction": { op: "campagnes.creer" },
  "app/(admin)/campaigns/actions.ts#deleteCampaignAction": { op: "campagnes.supprimer" },
  "app/(admin)/settings/tags/actions.ts#renameTagAction": { op: "reglages.etiquette_renommer" },
  "app/(admin)/channels/actions.ts#pauseChannelAction": { catalog: "pause" },
  "app/(admin)/members/actions.ts#sendBroadcastAction": { capability: "transverse.faire_comme_si" },
  "app/login/actions.ts#loginAction": { excluded: { reason: "connexion au site (sécurité du compte)", replacement: "je t'envoie le lien de connexion, valable 15 minutes" } },
};

const check = (parity: Record<string, SiteParityEntry>, impls: string[] | null = OPS.map((o) => o.key)) =>
  checkParity({
    actions: scanServerActions(fixtureFiles()),
    parity,
    ops: OPS,
    impls,
    capabilityExists: (team, key) => team === "transverse" && key === "faire_comme_si",
    catalogKeys: new Set(["pause", "aide"]),
  });

describe("inventaire des actions serveur (fixture)", () => {
  it("seuls les fichiers dont la première instruction est « use server » ; fonctions et constantes async exportées", () => {
    const actions = scanServerActions(fixtureFiles());
    expect(actions.map((a) => a.key)).toEqual([
      "app/(admin)/campaigns/actions.ts#createCampaignAction",
      "app/(admin)/campaigns/actions.ts#deleteCampaignAction",
      "app/(admin)/channels/actions.ts#pauseChannelAction",
      "app/(admin)/members/actions.ts#sendBroadcastAction",
      "app/(admin)/settings/tags/actions.ts#renameTagAction",
      "app/login/actions.ts#loginAction",
    ]);
    const by = new Map(actions.map((a) => [a.name, a]));
    expect(by.get("createCampaignAction")).toMatchObject({ nature: "create", role: "MANAGER", pages: ["/campaigns"] });
    expect(by.get("deleteCampaignAction")).toMatchObject({ nature: "delete", role: "ADMIN" });
    // Page trouvée à travers le composant qui importe l'action.
    expect(by.get("renameTagAction")).toMatchObject({ role: "ADMIN", pages: ["/settings/tags"] });
    expect(by.get("sendBroadcastAction")!.nature).toBe("send");
    expect(by.get("loginAction")).toMatchObject({ role: "?", pages: ["/login"] });
    expect(isUseServerFile('// x\n/* y */\n"use server";\nexport async function a() {}')).toBe(true);
    expect(isUseServerFile('import x from "y";\n"use server";')).toBe(false);
    expect(guessNature("saveBookmakerCredentialsAction")).toBe("secret");
    expect(guessNature("listMembersAction")).toBe("read");
  });

  it("tout couvert ou exclu : passe ; tableau et document en français", () => {
    const r = check(FULL);
    expect(r.missing).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(parityOk(r)).toBe(true);
    expect(r.covered).toHaveLength(5);
    expect(r.excluded).toHaveLength(1);
    const table = parityTable(r);
    expect(table).toContain("6 actions serveur : 5 couvertes, 1 exclues, 0 manquantes.");
    const md = parityMarkdown(r, { date: "25 octobre 2026" });
    expect(md).toContain("## /campaigns");
    expect(md).toContain("« crée une campagne pour Celsius en France avec un CPA de 120 »");
    expect(md).toContain("Kevin propose : je t'envoie le lien de connexion, valable 15 minutes.");
  });

  it("une action sans correspondance : MANQUANTE (échec)", () => {
    const { ["app/(admin)/channels/actions.ts#pauseChannelAction"]: _gone, ...rest } = FULL;
    const r = check(rest);
    expect(r.missing.map((m) => m.name)).toEqual(["pauseChannelAction"]);
    expect(parityOk(r)).toBe(false);
    expect(parityTable(r)).toContain("MANQUANT");
  });

  it("capacité inconnue, entrée du catalogue inconnue, opération sans cœur : échec", () => {
    expect(parityOk(check({ ...FULL, "app/(admin)/members/actions.ts#sendBroadcastAction": { capability: "transverse.inventee" } }))).toBe(false);
    expect(parityOk(check({ ...FULL, "app/(admin)/members/actions.ts#sendBroadcastAction": { capability: "sansequipe" } }))).toBe(false);
    expect(parityOk(check({ ...FULL, "app/(admin)/channels/actions.ts#pauseChannelAction": { catalog: "inconnue" } }))).toBe(false);
    expect(parityOk(check({ ...FULL, "app/(admin)/channels/actions.ts#pauseChannelAction": { op: "canaux.inconnue" } }))).toBe(false);
    const noImpl = check(FULL, ["campagnes.creer"]);
    expect(noImpl.errors.join("\n")).toContain("sans cœur");
  });

  it("exclusion sans remplacement (ou sans raison) : échec ; correspondance d'une action disparue : échec", () => {
    const noRepl = check({ ...FULL, "app/login/actions.ts#loginAction": { excluded: { reason: "sécurité du compte", replacement: " " } } });
    expect(noRepl.errors.join("\n")).toContain("sans remplacement");
    const noReason = check({ ...FULL, "app/login/actions.ts#loginAction": { excluded: { reason: "", replacement: "lien" } } });
    expect(noReason.errors.join("\n")).toContain("sans raison");
    const stale = check({ ...FULL, "app/old.ts#goneAction": { catalog: "aide" } });
    expect(stale.errors.join("\n")).toContain("n'existe plus");
  });
});

describe("registre des opérations", () => {
  it("doublon ou clé hors domaine refusés", () => {
    expect(() => indexSiteOps([OPS[0]!, OPS[0]!])).toThrow(/double/);
    expect(() => indexSiteOps([{ ...OPS[0]!, domain: "canaux" }])).toThrow(/domaine/);
    expect(indexSiteOps(OPS).size).toBe(3);
  });
});

describe("le vrai site : chaque action serveur est faisable par Kevin", () => {
  // Le coordinateur de la phase 34 rend ce test obligatoire quand les lots B à E sont remplis (sans la variable).
  it.skipIf(process.env.KEVIN_PARITY_PENDING === "1")("zéro manquant, zéro correspondance fausse (pnpm kevin:parity)", async () => {
    const { realParity } = await import("./parity-real");
    const { report } = realParity(WEB);
    expect(report.covered.length + report.excluded.length + report.missing.length).toBeGreaterThan(100);
    expect(report.errors, report.errors.join("\n")).toEqual([]);
    expect(report.missing.map((m) => m.key), parityTable(report)).toEqual([]);
  }, 120_000);
});
