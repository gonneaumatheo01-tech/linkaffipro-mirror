import { describe, expect, it } from "vitest";
import {
  PHASE10_SUMMARY_ACTION,
  PHASE9_TEMPLATE_TEXTS,
  rewriteTemplates,
  TEMPLATE_REWRITTEN_ACTION,
  type Phase10Db,
} from "./phase10-templates";
import { buildTemplateRows } from "./seed-templates";

// Reprise phase 10 des modèles fournis (logique, base simulée). Le passage sur base réelle est dans
// apps/worker/tests/integration/phase10-templates.test.ts.

type Row = {
  id: string;
  code: string;
  text: string;
  buttons: unknown;
  templateName: string;
  mediaAssetIds: unknown;
  updatedById: string | null;
  isTemplate: boolean;
  updatedAt: Date;
};

const names = new Map(buildTemplateRows().map((r) => [r.code, r.templateName]));

/**
 * Base simulée : les 63 modèles d'origine (textes de la phase 9, sans bouton, sans média, nom de la bibliothèque,
 * jamais enregistrés depuis le site), journal en mémoire.
 */
function fakeDb(opts: { omit?: string[] } = {}) {
  const posts = new Map<string, Row>();
  let tick = 1;
  for (const [code, text] of Object.entries(PHASE9_TEMPLATE_TEXTS)) {
    if (opts.omit?.includes(code)) continue;
    posts.set(code, {
      id: `p-${code}`,
      code,
      text,
      buttons: [],
      templateName: names.get(code)!,
      mediaAssetIds: [],
      updatedById: null,
      isTemplate: true,
      updatedAt: new Date(1_000 + tick++),
    });
  }
  const audit: Array<Record<string, unknown>> = [];
  /** Hook appelé juste avant une écriture conditionnelle (simule une modification concurrente de l'équipe). */
  const before: { updateMany?: (id: string) => void } = {};
  const db = {
    post: {
      findMany: async ({ where }: { where: { code: { in: string[] }; isTemplate: boolean } }) =>
        [...posts.values()]
          .filter((p) => where.code.in.includes(p.code) && p.isTemplate === where.isTemplate)
          .map((p) => ({ ...p })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; text: string; updatedAt: Date };
        data: { text: string; buttons: unknown };
      }) => {
        before.updateMany?.(where.id);
        const p = [...posts.values()].find((x) => x.id === where.id);
        if (!p || p.text !== where.text || p.updatedAt.getTime() !== where.updatedAt.getTime())
          return { count: 0 };
        Object.assign(p, data, { updatedAt: new Date(10_000 + tick++) });
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      },
    },
  };
  return { db: db as unknown as Phase10Db, posts, audit, before };
}

const quiet = () => undefined;
const rows = buildTemplateRows();
const changed = rows.filter((r) => r.text !== PHASE9_TEMPLATE_TEXTS[r.code] || r.buttons.length);
const unchanged = rows.filter((r) => !changed.includes(r));

describe("reprise phase 10 des modèles fournis", () => {
  it("réécrit les modèles encore à leur texte d'origine (texte + bouton Offre), journal par modèle", async () => {
    const { db, posts, audit } = fakeDb();
    const r = await rewriteTemplates(db, quiet);
    expect(r.updated.sort()).toEqual(changed.map((x) => x.code).sort());
    expect(r.upToDate.sort()).toEqual(unchanged.map((x) => x.code).sort());
    expect(r.keptByTeam).toEqual([]);
    expect(r.missing).toEqual([]);
    for (const row of rows) {
      expect(posts.get(row.code)!.text, row.code).toBe(row.text);
      expect(posts.get(row.code)!.buttons, row.code).toEqual(row.buttons);
    }
    const perPost = audit.filter((a) => a.action === TEMPLATE_REWRITTEN_ACTION);
    expect(perPost).toHaveLength(changed.length);
    expect(perPost[0]).toMatchObject({
      entityType: "Post",
      entityId: expect.stringMatching(/^p-/),
    });
    const summary = audit.filter((a) => a.action === PHASE10_SUMMARY_ACTION);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.metadata).toMatchObject({ updated: r.updated, keptByTeam: [] });
  });

  it("relancé : ne réécrit rien (tout est déjà à jour), seul le résumé du passage est journalisé", async () => {
    const { db, audit } = fakeDb();
    await rewriteTemplates(db, quiet);
    const before = audit.length;
    const second = await rewriteTemplates(db, quiet);
    expect(second.updated).toEqual([]);
    expect(second.upToDate).toHaveLength(63);
    expect(audit.slice(before).map((a) => a.action)).toEqual([PHASE10_SUMMARY_ACTION]);
  });

  it("ne touche jamais un modèle modifié par l'équipe (texte, ou bouton ajouté)", async () => {
    const { db, posts } = fakeDb();
    posts.get("modele:casino:bonus:1")!.text = "Notre version à nous, {prenom} !";
    posts.get("modele:sports:rappel:2")!.buttons = [
      [{ text: "Site", type: "URL", url: "https://x.fr" }],
    ];
    const logs: string[] = [];
    const r = await rewriteTemplates(db, (m) => logs.push(m));
    expect(r.keptByTeam.sort()).toEqual(["modele:casino:bonus:1", "modele:sports:rappel:2"]);
    expect(posts.get("modele:casino:bonus:1")!.text).toBe("Notre version à nous, {prenom} !");
    expect(posts.get("modele:sports:rappel:2")!.text).toBe(
      PHASE9_TEMPLATE_TEXTS["modele:sports:rappel:2"],
    );
    expect(logs.join("\n")).toContain("Casino · Bonus · Bonus de bienvenue");
    expect(logs.join("\n")).toMatch(/2 modifié\(s\) par l'équipe/);
  });

  it("texte d'origine mais modèle renommé, avec une image, ou enregistré depuis le site : jamais touché", async () => {
    const { db, posts, audit } = fakeDb();
    const renamed = posts.get("modele:casino:bonus:2")!;
    renamed.templateName = "Nos tours gratuits du vendredi";
    const withMedia = posts.get("modele:sports:bonus:1")!;
    withMedia.mediaAssetIds = ["media-1"];
    // Ouvert puis enregistré dans « Modifier » (catégorie, langue, options…), texte resté identique.
    const savedFromSite = posts.get("modele:dating:rappel:1")!;
    savedFromSite.updatedById = "user-1";
    const logs: string[] = [];
    const r = await rewriteTemplates(db, (m) => logs.push(m));
    const kept = [renamed, withMedia, savedFromSite].map((p) => p.code);
    expect(r.keptByTeam.sort()).toEqual(kept.sort());
    for (const p of [renamed, withMedia, savedFromSite]) {
      expect(p.text, p.code).toBe(PHASE9_TEMPLATE_TEXTS[p.code]);
      expect(p.buttons, p.code).toEqual([]);
      expect(audit.some((a) => a.entityId === p.id)).toBe(false);
    }
    expect(renamed.templateName).toBe("Nos tours gratuits du vendredi");
    expect(withMedia.mediaAssetIds).toEqual(["media-1"]);
    // Le journal nomme le modèle par son nom actuel (celui que l'équipe voit).
    expect(logs.join("\n")).toContain("« Nos tours gratuits du vendredi »");
    expect(r.updated).toHaveLength(changed.length - kept.length);
  });

  it("modification de l'équipe pendant le passage : l'écriture conditionnelle n'écrase rien", async () => {
    const { db, posts, audit, before } = fakeDb();
    const target = posts.get("modele:dating:bonus:1")!;
    before.updateMany = (id) => {
      if (id === target.id && target.text === PHASE9_TEMPLATE_TEXTS[target.code]) {
        target.text = "Changé à l'instant par l'équipe";
        target.updatedAt = new Date(999_999);
      }
    };
    const r = await rewriteTemplates(db, quiet);
    expect(r.keptByTeam).toEqual(["modele:dating:bonus:1"]);
    expect(target.text).toBe("Changé à l'instant par l'équipe");
    expect(audit.some((a) => a.entityId === target.id)).toBe(false);
  });

  it("modèle absent : signalé (à créer par seed:templates), jamais créé ici", async () => {
    const { db, posts } = fakeDb({ omit: ["modele:casino:teasing:2"] });
    const logs: string[] = [];
    const r = await rewriteTemplates(db, (m) => logs.push(m));
    expect(r.missing).toEqual(["modele:casino:teasing:2"]);
    expect(posts.has("modele:casino:teasing:2")).toBe(false);
    expect(logs.join("\n")).toContain("pnpm seed:templates");
  });

  it("référence d'origine : les 63 codes de la bibliothèque, avec les repères d'avant", () => {
    expect(Object.keys(PHASE9_TEMPLATE_TEXTS).sort()).toEqual(rows.map((r) => r.code).sort());
    const all = Object.values(PHASE9_TEMPLATE_TEXTS);
    expect(all.filter((t) => t.includes("{offre}"))).toHaveLength(43);
    expect(all.filter((t) => t.includes("{prenom}"))).toHaveLength(13);
  });
});
