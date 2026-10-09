-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "abGroupId" TEXT,
ADD COLUMN     "abVariant" TEXT,
ADD COLUMN     "vertical" "Vertical";

-- CreateIndex
CREATE INDEX "Post_abGroupId_idx" ON "Post"("abGroupId");

-- CreateIndex
CREATE INDEX "Post_isTemplate_vertical_idx" ON "Post"("isTemplate", "vertical");
