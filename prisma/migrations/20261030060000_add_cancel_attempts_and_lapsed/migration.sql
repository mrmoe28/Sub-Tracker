-- AlterEnum
ALTER TYPE "SubscriptionCandidateStatus" ADD VALUE 'LAPSED';

-- CreateEnum
CREATE TYPE "CancelAttemptStatus" AS ENUM ('RUNNING', 'AWAITING_APPROVAL', 'NEEDS_CODE', 'CANCELED', 'FAILED', 'ABORTED');

-- CreateTable
CREATE TABLE "CancelAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "merchantId" TEXT,
    "status" "CancelAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "note" TEXT,
    "url" TEXT,
    "pendingControlText" TEXT,
    "steps" JSONB,
    "confirmationText" TEXT,
    "approvalScreenshot" BYTEA,
    "proofScreenshot" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CancelAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CancelAttempt_userId_status_idx" ON "CancelAttempt"("userId", "status");

-- CreateIndex
CREATE INDEX "CancelAttempt_candidateId_createdAt_idx" ON "CancelAttempt"("candidateId", "createdAt");

-- AddForeignKey
ALTER TABLE "CancelAttempt" ADD CONSTRAINT "CancelAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancelAttempt" ADD CONSTRAINT "CancelAttempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SubscriptionCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
