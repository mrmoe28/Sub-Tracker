-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "suggestedAt" TIMESTAMP(3),
ADD COLUMN     "suggestedCategoryId" TEXT,
ADD COLUMN     "suggestedCategoryName" TEXT,
ADD COLUMN     "suggestedConfidence" TEXT,
ADD COLUMN     "suggestedSource" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_userId_suggestedCategoryId_idx" ON "Transaction"("userId", "suggestedCategoryId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
