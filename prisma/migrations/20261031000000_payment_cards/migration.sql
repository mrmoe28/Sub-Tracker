CREATE TABLE "PaymentCard" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "issuer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentCard_userId_last4_key" ON "PaymentCard"("userId", "last4");
CREATE INDEX "PaymentCard_userId_idx" ON "PaymentCard"("userId");
ALTER TABLE "PaymentCard" ADD CONSTRAINT "PaymentCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
