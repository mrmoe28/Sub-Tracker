CREATE TABLE "TransactionCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "group" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction" ADD COLUMN "userCategoryId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "userCategoryName" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "userCategoryNotes" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "categorizedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "TransactionCategory_name_key" ON "TransactionCategory"("name");
CREATE INDEX "TransactionCategory_userId_sortOrder_idx" ON "TransactionCategory"("userId", "sortOrder");
CREATE INDEX "Transaction_userCategoryId_idx" ON "Transaction"("userCategoryId");

ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userCategoryId_fkey" FOREIGN KEY ("userCategoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
