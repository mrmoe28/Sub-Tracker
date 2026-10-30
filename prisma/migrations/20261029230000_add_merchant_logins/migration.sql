-- CreateTable
CREATE TABLE "MerchantLogin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordCiphertext" BYTEA NOT NULL,
    "passwordIv" BYTEA NOT NULL,
    "passwordAuthTag" BYTEA NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "loginUrl" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastAttemptStatus" TEXT,
    "lastAttemptNote" TEXT,
    "lastFoundUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantLogin_userId_merchantId_key" ON "MerchantLogin"("userId", "merchantId");

-- CreateIndex
CREATE INDEX "MerchantLogin_merchantId_idx" ON "MerchantLogin"("merchantId");

-- AddForeignKey
ALTER TABLE "MerchantLogin" ADD CONSTRAINT "MerchantLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantLogin" ADD CONSTRAINT "MerchantLogin_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
