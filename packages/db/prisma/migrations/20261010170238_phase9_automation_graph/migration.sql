-- Phase 9 : relances automatiques à branches (migration additive, colonnes facultatives, aucune donnée modifiée).
-- AutomationRule.graph vide = règle linéaire (actions), exécutée exactement comme avant.
-- AutomationRule.templateKey : carte « prête à l'emploi » que la règle implémente (vide = relance sur mesure).
-- AutomationRun.nodeId : bloc courant d'une exécution de graphe (vide pour une règle linéaire).

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "graph" JSONB,
ADD COLUMN     "templateKey" TEXT;

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "nodeId" TEXT;
