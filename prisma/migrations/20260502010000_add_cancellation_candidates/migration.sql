CREATE TYPE "CancellationCandidateStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

CREATE TABLE "CancellationCandidate" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "snippet" TEXT,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" "CancellationCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CancellationCandidate_merchantId_url_key" ON "CancellationCandidate"("merchantId", "url");
CREATE INDEX "CancellationCandidate_merchantId_status_idx" ON "CancellationCandidate"("merchantId", "status");

ALTER TABLE "CancellationCandidate" ADD CONSTRAINT "CancellationCandidate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
