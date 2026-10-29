/**
 * Phase 30, chantier B — branchements du QA Global (« dernier verrou ») dans les sorties de chaque équipe : posts et
 * verrou d'envoi, rapports et alertes des Analystes, règles publicitaires, recommandations, réponses de Kevin
 * rédigées par l'IA, file de rattrapage `qa-sweep` et alertes internes du QA (`qa-alerts`).
 */
export * from "./gate";
export * from "./posts";
export * from "./analysts";
export * from "./recommendations";
export * from "./kevin";
export * from "./jobs";
// Réponse du client « publier quand même / laisser tomber » (enregistrée au chargement).
import "./register";
