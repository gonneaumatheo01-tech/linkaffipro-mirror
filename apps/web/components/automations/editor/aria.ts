/** Textes du canevas @xyflow/react pour les lecteurs d'écran, en français (prop `ariaLabelConfig`). */
const DIRECTIONS: Record<string, string> = {
  up: "le haut",
  down: "le bas",
  left: "la gauche",
  right: "la droite",
};

export const FLOW_ARIA_FR = {
  "node.a11yDescription.default":
    "Entrée ou Espace pour choisir ce bloc et le régler dans le panneau de droite. Suppr pour le supprimer, Échap pour annuler.",
  "node.a11yDescription.keyboardDisabled":
    "Entrée ou Espace pour choisir ce bloc ; les flèches le déplacent. Suppr pour le supprimer, Échap pour annuler.",
  "node.a11yDescription.ariaLiveMessage": ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) =>
    `Bloc déplacé vers ${DIRECTIONS[direction] ?? direction}. Nouvelle position : ${Math.round(x)}, ${Math.round(y)}.`,
  "edge.a11yDescription.default":
    "Entrée ou Espace pour choisir ce lien, puis Suppr pour le retirer, Échap pour annuler.",
  "controls.ariaLabel": "Commandes du canevas",
  "controls.zoomIn.ariaLabel": "Zoom avant",
  "controls.zoomOut.ariaLabel": "Zoom arrière",
  "controls.fitView.ariaLabel": "Ajuster à l'écran",
  "controls.interactive.ariaLabel": "Verrouiller le canevas",
  "minimap.ariaLabel": "Mini-carte du parcours",
  "handle.ariaLabel": "Point de connexion",
};
