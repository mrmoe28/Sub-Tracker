-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlaidItemStatus" AS ENUM ('ACTIVE', 'LOGIN_REQUIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'ANNUALLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PlaidStreamStatus" AS ENUM ('MATURE', 'EARLY_DETECTION', 'TOMBSTONED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PlaidStreamConfidence" AS ENUM ('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SubscriptionCandidateSource" AS ENUM ('PLAID_STREAM', 'HEURISTIC', 'USER');

-- CreateEnum
CREATE TYPE "SubscriptionCandidateStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'DISMISSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubscriptionDecision" AS ENUM ('KEEP', 'CANCEL_REQUESTED', 'CANCELED', 'IGNORE', 'SNOOZE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaidItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "accessTokenCiphertext" BYTEA NOT NULL,
    "accessTokenIv" BYTEA NOT NULL,
    "accessTokenAuthTag" BYTEA NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "PlaidItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "transactionsCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "consentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaidAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "currency" TEXT,
    "currentBalance" DECIMAL(14,2),
    "availableBalance" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plaidMerchantId" TEXT,
    "domain" TEXT,
    "logoUrl" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationLink" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "instructions" TEXT,
    "source" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "merchantId" TEXT,
    "recurringStreamId" TEXT,
    "plaidTransactionId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantName" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "isoCurrencyCode" TEXT,
    "date" DATE NOT NULL,
    "authorizedDate" DATE,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT[],
    "categoryId" TEXT,
    "pfcPrimary" TEXT,
    "pfcDetailed" TEXT,
    "pfcConfidenceLevel" TEXT,
    "paymentChannel" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringStream" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "merchantId" TEXT,
    "plaidStreamId" TEXT NOT NULL,
    "isInflow" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "merchantName" TEXT,
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'UNKNOWN',
    "status" "PlaidStreamStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" "PlaidStreamConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "averageAmount" DECIMAL(14,2),
    "lastAmount" DECIMAL(14,2),
    "isoCurrencyCode" TEXT,
    "firstDate" DATE,
    "lastDate" DATE,
    "predictedNextDate" DATE,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT,
    "recurringStreamId" TEXT,
    "name" TEXT NOT NULL,
    "source" "SubscriptionCandidateSource" NOT NULL DEFAULT 'HEURISTIC',
    "status" "SubscriptionCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'UNKNOWN',
    "lastAmount" DECIMAL(14,2),
    "normalizedMonthlyAmount" DECIMAL(14,2),
    "isoCurrencyCode" TEXT,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "predictedNextDate" DATE,
    "confidence" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubscriptionDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "decision" "SubscriptionDecision" NOT NULL,
    "notes" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSubscriptionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidItem_plaidItemId_key" ON "PlaidItem"("plaidItemId");

-- CreateIndex
CREATE INDEX "PlaidItem_userId_idx" ON "PlaidItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidAccount_plaidAccountId_key" ON "PlaidAccount"("plaidAccountId");

-- CreateIndex
CREATE INDEX "PlaidAccount_userId_idx" ON "PlaidAccount"("userId");

-- CreateIndex
CREATE INDEX "PlaidAccount_plaidItemId_idx" ON "PlaidAccount"("plaidItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_name_key" ON "Merchant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_plaidMerchantId_key" ON "Merchant"("plaidMerchantId");

-- CreateIndex
CREATE INDEX "CancellationLink_merchantId_idx" ON "CancellationLink"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_plaidTransactionId_key" ON "Transaction"("plaidTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_merchantId_idx" ON "Transaction"("merchantId");

-- CreateIndex
CREATE INDEX "Transaction_recurringStreamId_idx" ON "Transaction"("recurringStreamId");

-- CreateIndex
CREATE INDEX "Transaction_pfcPrimary_idx" ON "Transaction"("pfcPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringStream_plaidStreamId_key" ON "RecurringStream"("plaidStreamId");

-- CreateIndex
CREATE INDEX "RecurringStream_userId_idx" ON "RecurringStream"("userId");

-- CreateIndex
CREATE INDEX "RecurringStream_accountId_idx" ON "RecurringStream"("accountId");

-- CreateIndex
CREATE INDEX "RecurringStream_merchantId_idx" ON "RecurringStream"("merchantId");

-- CreateIndex
CREATE INDEX "SubscriptionCandidate_userId_status_idx" ON "SubscriptionCandidate"("userId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionCandidate_merchantId_idx" ON "SubscriptionCandidate"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCandidate_userId_recurringStreamId_key" ON "SubscriptionCandidate"("userId", "recurringStreamId");

-- CreateIndex
CREATE INDEX "UserSubscriptionDecision_userId_decision_idx" ON "UserSubscriptionDecision"("userId", "decision");

-- CreateIndex
CREATE INDEX "UserSubscriptionDecision_candidateId_idx" ON "UserSubscriptionDecision"("candidateId");

-- AddForeignKey
ALTER TABLE "PlaidItem" ADD CONSTRAINT "PlaidItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidAccount" ADD CONSTRAINT "PlaidAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidAccount" ADD CONSTRAINT "PlaidAccount_plaidItemId_fkey" FOREIGN KEY ("plaidItemId") REFERENCES "PlaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationLink" ADD CONSTRAINT "CancellationLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlaidAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringStreamId_fkey" FOREIGN KEY ("recurringStreamId") REFERENCES "RecurringStream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringStream" ADD CONSTRAINT "RecurringStream_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringStream" ADD CONSTRAINT "RecurringStream_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlaidAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringStream" ADD CONSTRAINT "RecurringStream_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCandidate" ADD CONSTRAINT "SubscriptionCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCandidate" ADD CONSTRAINT "SubscriptionCandidate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCandidate" ADD CONSTRAINT "SubscriptionCandidate_recurringStreamId_fkey" FOREIGN KEY ("recurringStreamId") REFERENCES "RecurringStream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscriptionDecision" ADD CONSTRAINT "UserSubscriptionDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscriptionDecision" ADD CONSTRAINT "UserSubscriptionDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SubscriptionCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

