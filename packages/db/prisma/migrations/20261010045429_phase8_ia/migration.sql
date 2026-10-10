-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "input" TEXT NOT NULL,
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costEur" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "usedIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSuggestion_userId_createdAt_idx" ON "AiSuggestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_createdAt_idx" ON "AiSuggestion"("createdAt");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
