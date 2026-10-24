-- Phase 25 : index pour la supervision des agents (fiches de posts par date, missions par mise à jour et par jour du plan).
-- CreateIndex
CREATE INDEX "AgentMission_updatedAt_idx" ON "AgentMission"("updatedAt");

-- CreateIndex
CREATE INDEX "AgentMission_channelId_planDay_idx" ON "AgentMission"("channelId", "planDay");

-- CreateIndex
CREATE INDEX "PostInsight_sentAt_idx" ON "PostInsight"("sentAt");

