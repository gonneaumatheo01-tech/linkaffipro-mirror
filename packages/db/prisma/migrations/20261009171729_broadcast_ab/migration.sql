-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "abGroupId" TEXT,
ADD COLUMN     "abSplit" INTEGER,
ADD COLUMN     "abVariant" TEXT;

-- CreateIndex
CREATE INDEX "Broadcast_abGroupId_idx" ON "Broadcast"("abGroupId");
