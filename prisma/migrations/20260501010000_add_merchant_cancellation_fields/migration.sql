-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "cancellationNotes" TEXT,
ADD COLUMN     "cancellationUrl" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "supportUrl" TEXT,
ADD COLUMN     "website" TEXT;

