-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Broadcast_createdAt_idx" ON "Broadcast"("createdAt");

-- CreateIndex
CREATE INDEX "Click_isBot_createdAt_idx" ON "Click"("isBot", "createdAt");

-- CreateIndex
CREATE INDEX "Event_occurredAt_idx" ON "Event"("occurredAt");

-- CreateIndex
CREATE INDEX "InviteLink_kind_createdAt_idx" ON "InviteLink"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "InviteLink_campaignId_idx" ON "InviteLink"("campaignId");

-- CreateIndex
CREATE INDEX "Member_lastSeenAt_idx" ON "Member"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Member_firstSeenAt_idx" ON "Member"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Member_anonymizedAt_lastSeenAt_idx" ON "Member"("anonymizedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "MemberBotState_botId_canDm_idx" ON "MemberBotState"("botId", "canDm");

-- CreateIndex
CREATE INDEX "Membership_channelId_requestedAt_idx" ON "Membership"("channelId", "requestedAt");

-- CreateIndex
CREATE INDEX "Membership_inviteLinkId_requestedAt_idx" ON "Membership"("inviteLinkId", "requestedAt");

-- CreateIndex
CREATE INDEX "Membership_requestedAt_idx" ON "Membership"("requestedAt");

-- CreateIndex
CREATE INDEX "Membership_approvedAt_idx" ON "Membership"("approvedAt");

-- CreateIndex
CREATE INDEX "Membership_joinedAt_idx" ON "Membership"("joinedAt");

-- CreateIndex
CREATE INDEX "Membership_leftAt_idx" ON "Membership"("leftAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_memberId_status_sentAt_idx" ON "OutboundMessage"("memberId", "status", "sentAt");

-- CreateIndex
CREATE INDEX "Player_clickId_idx" ON "Player"("clickId");

-- CreateIndex
CREATE INDEX "Player_registeredAt_idx" ON "Player"("registeredAt");

-- CreateIndex
CREATE INDEX "Player_ftdAt_idx" ON "Player"("ftdAt");

-- CreateIndex
CREATE INDEX "Player_lastEventAt_idx" ON "Player"("lastEventAt");

-- CreateIndex
CREATE INDEX "Player_createdAt_idx" ON "Player"("createdAt");

-- CreateIndex
CREATE INDEX "Post_isTemplate_scheduledAt_idx" ON "Post"("isTemplate", "scheduledAt");

-- CreateIndex
CREATE INDEX "Post_categoryId_idx" ON "Post"("categoryId");

-- CreateIndex
CREATE INDEX "TrackingLink_kind_createdAt_idx" ON "TrackingLink"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingLink_inviteLinkId_idx" ON "TrackingLink"("inviteLinkId");

-- CreateIndex
CREATE INDEX "TrackingLink_channelId_idx" ON "TrackingLink"("channelId");

-- CreateIndex
CREATE INDEX "TrackingLink_affiliateCampaignId_idx" ON "TrackingLink"("affiliateCampaignId");
