-- AlterTable
ALTER TABLE "MomentComment" ADD COLUMN     "parentCommentId" UUID;

-- CreateIndex
CREATE INDEX "MomentComment_parentCommentId_idx" ON "MomentComment"("parentCommentId");

-- AddForeignKey
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "MomentComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
