import { describe, expect, it } from "vitest";
import { shortcutCommand } from "@/components/editor/editor-logic";
import { shortcutSections } from "./shortcuts-logic";

const editorRows = (mac: boolean) =>
  shortcutSections(mac).find((s) => s.key === "editor")?.rows ?? [];

describe("liste des raccourcis", () => {
  it("donne la mise en forme d'un texte de message : ⌘B gras, ⌘I italique, ⌘U souligné, ⌘K lien, ⌘⇧X barré", () => {
    expect(editorRows(true)).toEqual([
      { keys: "⌘B", label: "Gras" },
      { keys: "⌘I", label: "Italique" },
      { keys: "⌘U", label: "Souligné" },
      { keys: "⌘K", label: "Lien (au lieu de la recherche)" },
      { keys: "⌘⇧X", label: "Barré" },
    ]);
  });

  it("écrit Ctrl hors d'un Mac", () => {
    expect(editorRows(false).map((r) => r.keys)).toEqual([
      "Ctrl+B",
      "Ctrl+I",
      "Ctrl+U",
      "Ctrl+K",
      "Ctrl+Maj+X",
    ]);
    expect(shortcutSections(false)[0]?.rows[0]?.keys).toBe("Ctrl+K");
    expect(shortcutSections(true)[0]?.rows[0]?.keys).toBe("⌘K");
  });

  it("chaque raccourci de mise en forme affiché est bien celui que l'éditeur reconnaît", () => {
    const commands = editorRows(true).map((row) =>
      shortcutCommand(
        {
          key: row.keys.slice(-1).toLowerCase(),
          metaKey: true,
          ctrlKey: false,
          shiftKey: row.keys.includes("⇧"),
          altKey: false,
        },
        true,
      ),
    );
    expect(commands).toEqual(["bold", "italic", "underline", "link", "strike"]);
  });

  it("garde les raccourcis de navigation (recherche, liste, nouveau message, Échap)", () => {
    const all = shortcutSections(true).flatMap((s) => s.rows.map((r) => r.keys));
    expect(all).toEqual(expect.arrayContaining(["⌘K", "/", "?", "Échap", "n"]));
    // Pas de doublon de touche dans une même section.
    for (const s of shortcutSections(true)) {
      const keys = s.rows.map((r) => r.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
