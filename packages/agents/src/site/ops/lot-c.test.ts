/**
 * Phase 34, lot C — règles de confirmation des métadonnées (relecture adverse) : suppression = SUPPRIMER, envoi à des
 * membres = aperçu exact + OUI, hausse de budget / dépense = OUI, suppressions réservées aux administrateurs.
 */
import { describe, expect, it } from "vitest";
import { LOT_C_OPS } from "./lot-c";

const op = (key: string) => {
  const m = LOT_C_OPS.find((o) => o.key === key);
  if (!m) throw new Error(`opération absente : ${key}`);
  return m;
};

/** Envois à soi seul (message de test) : pas d'aperçu à confirmer. */
const SELF_TESTS = new Set(["envois.tester_sur_moi", "automatisations.tester_sur_moi"]);

describe("métadonnées du lot C", () => {
  it("suppression ⇔ SUPPRIMER et ADMIN ; envoi à des membres ⇒ aperçu exact + OUI", () => {
    for (const m of LOT_C_OPS) {
      if (m.kind === "delete") expect(m.confirm, m.key).toBe("delete");
      if (m.confirm === "delete") expect(m.kind, m.key).toBe("delete");
      if (m.kind === "send" && !SELF_TESTS.has(m.key)) expect(m.confirm, m.key).toBe("send");
      if (m.kind === "delete" && m.key !== "membres.note_supprimer") expect(m.role, m.key).toBe("ADMIN");
    }
  });

  it("modifier une campagne (budget par jour, statut, compte pub) demande un OUI", () => {
    expect(op("campagnes.modifier").confirm).toBe("yes");
  });

  it("relances : régler une carte déjà active = envoi (aperçu exact) ; modifier une relance sur mesure = OUI", () => {
    expect(op("automatisations.carte").confirm).toBe("send");
    expect(op("automatisations.enregistrer").confirm).toBe("yes");
    expect(op("automatisations.activer").confirm).toBe("send");
  });
});
