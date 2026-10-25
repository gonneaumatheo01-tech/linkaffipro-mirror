/**
 * Phase 34, lot B — métadonnées et correspondance des actions serveur des canaux, messages, pages, étiquettes et
 * catégories : chaque fonction exportée des 12 fichiers d'actions du lot a son opération ; chaque opération est bien
 * formée (deux exemples au moins, schéma strict, suppression → SUPPRIMER, envoi → aperçu ou test sur soi).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexSiteOps } from "../registry";
import { scanServerActions } from "../parity-scan";
import { LOT_B_OPS } from "./lot-b";
import { LOT_B_PARITY } from "../parity/lot-b";

const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "apps", "web");
const FILES = [
  "app/(admin)/channels/[id]/actions.ts",
  "app/(admin)/channels/[id]/sequences/actions.ts",
  "app/(admin)/channels/actions.ts",
  "app/(admin)/channels/[id]/share-links-actions.ts",
  "lib/approval/resend-welcome-action.ts",
  "app/(admin)/messages/actions.ts",
  "app/(admin)/messages/emojis/actions.ts",
  "app/(admin)/messages/move-action.ts",
  "app/(admin)/messages/categories/inline-actions.ts",
  "app/(admin)/settings/categories/actions.ts",
  "app/(admin)/pages/actions.ts",
  "app/(admin)/settings/tags/actions.ts",
];

describe("lot B : opérations pour Kevin", () => {
  const index = indexSiteOps(LOT_B_OPS);

  it("clés bien formées et uniques, domaines du lot", () => {
    expect(index.size).toBe(LOT_B_OPS.length);
    for (const op of LOT_B_OPS) expect(["canaux", "messages", "pages", "reglages"]).toContain(op.domain);
  });

  it("chaque opération : description, deux exemples, schéma strict, règle de confirmation", () => {
    for (const op of LOT_B_OPS) {
      expect(op.description.length, op.key).toBeGreaterThan(10);
      expect(op.examples.length, op.key).toBeGreaterThanOrEqual(2);
      expect(op.params, op.key).toMatchObject({ type: "object", additionalProperties: false });
      if (op.kind === "delete") expect(op.confirm, op.key).toBe("delete");
      if (op.confirm === "delete") expect(op.kind, op.key).toBe("delete");
      if (op.kind === "send" && op.key !== "canaux.accueil_tester") expect(op.confirm, op.key).toBe("send");
      expect(op.secretParams ?? [], op.key).toEqual([]);
      expect(op.serverActions.length, op.key).toBeGreaterThan(0);
    }
  });

  it("réservé aux administrateurs comme sur le site : suppressions et réglages", () => {
    const admin = LOT_B_OPS.filter((o) => o.role === "ADMIN").map((o) => o.key);
    for (const k of [
      "canaux.exception_supprimer",
      "messages.supprimer_telegram",
      "messages.retirer",
      "messages.emoji_retirer",
      "pages.supprimer",
      "reglages.etiquette_creer",
      "reglages.etiquette_supprimer",
      "reglages.categorie_supprimer",
    ])
      expect(admin).toContain(k);
    expect(admin).not.toContain("pages.creer");
    expect(admin).not.toContain("messages.programmer");
  });

  it("effacer un texte = SUPPRIMER ; réglages d'un canal (canal de test, actif, bot principal) = OUI", () => {
    expect(index.get("canaux.accueil_langue_retirer")).toMatchObject({ kind: "delete", confirm: "delete" });
    // Un canal marqué « test » reçoit ensuite les ordres de Kevin « pour de faux » sans OUI (orders/recap.ts).
    expect(index.get("canaux.regler")?.confirm).toBe("yes");
    expect(index.get("canaux.ajouter")?.confirm).toBe("yes");
  });

  it("message transféré accepté pour créer un post ou un message du bot", () => {
    for (const k of ["messages.programmer", "messages.brouillon", "messages.modifier", "canaux.accueil_texte"])
      expect(index.get(k)?.inputs ?? []).toContain("forwarded");
  });

  it("chaque fonction exportée des fichiers du lot a sa correspondance, vers une opération du lot qui la cite", () => {
    const actions = scanServerActions(FILES.map((path) => ({ path, content: readFileSync(join(WEB, path), "utf8") })));
    expect(actions.length).toBe(53);
    const keys = actions.map((a) => a.key).sort();
    expect(Object.keys(LOT_B_PARITY).sort()).toEqual(keys);
    for (const [action, entry] of Object.entries(LOT_B_PARITY)) {
      expect("op" in entry, action).toBe(true);
      const op = index.get((entry as { op: string }).op);
      expect(op, action).toBeTruthy();
      expect(op!.serverActions, action).toContain(action);
    }
    for (const op of LOT_B_OPS) for (const a of op.serverActions) expect(keys, op.key).toContain(a);
  });
});
