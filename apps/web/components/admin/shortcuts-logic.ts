/**
 * Liste des raccourcis clavier (fenêtre « ? ») : règle pure, testée dans shortcuts-logic.test.ts. Les touches de
 * mise en forme viennent de l'éditeur de texte (`shortcutLabel`) : la liste dit toujours ce que fait l'éditeur.
 */
import { shortcutLabel, type EditorCommand } from "@/components/editor/editor-logic";

export type ShortcutRow = { keys: string; label: string };
export type ShortcutSection = { key: string; title: string; rows: ShortcutRow[] };

/** Mise en forme dans un texte de message, dans l'ordre de la barre d'outils de l'éditeur. */
const EDITOR_SHORTCUTS: ReadonlyArray<[EditorCommand, string]> = [
  ["bold", "Gras"],
  ["italic", "Italique"],
  ["underline", "Souligné"],
  ["link", "Lien (au lieu de la recherche)"],
  ["strike", "Barré"],
];

/** Sections de la liste, touches écrites comme sur le clavier de la personne (⌘ sur Mac, Ctrl ailleurs). */
export function shortcutSections(mac: boolean): ShortcutSection[] {
  return [
    {
      key: "everywhere",
      title: "Partout",
      rows: [
        { keys: mac ? "⌘K" : "Ctrl+K", label: "Ouvrir la recherche" },
        { keys: "Échap", label: "Fermer la fenêtre ouverte" },
      ],
    },
    {
      key: "outside-fields",
      title: "Hors d'un champ de saisie",
      rows: [
        { keys: "/", label: "Ouvrir la recherche" },
        { keys: "?", label: "Afficher cette liste" },
        { keys: "n", label: "Nouveau message (page Messages)" },
      ],
    },
    {
      key: "editor",
      title: "Dans un texte de message",
      rows: EDITOR_SHORTCUTS.map(([cmd, label]) => ({
        keys: shortcutLabel(cmd, mac) ?? "",
        label,
      })).filter((r) => r.keys),
    },
  ];
}
