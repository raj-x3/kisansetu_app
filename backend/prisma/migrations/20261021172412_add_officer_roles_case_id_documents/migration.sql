-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FARMER', 'OPERATOR', 'ADMIN', 'MANAGER', 'GATE_OFFICER', 'DOCUMENT_OFFICER', 'QUALITY_OFFICER', 'WEIGHT_OFFICER', 'PROCUREMENT_OFFICER', 'PAYMENT_OFFICER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ProcurementStage" AS ENUM ('REGISTERED', 'SLOT_BOOKED', 'ARRIVED', 'VERIFIED', 'QUALITY_CHECKED', 'WEIGHED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('IDENTITY_PROOF', 'LAND_RECORD', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'CORRECTION_REQUESTED');

-- CreateEnum
CREATE TYPE "QualityResult" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'INITIATED', 'PROCESSING', 'CREDITED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farmers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "farmerCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "preferredCentreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farmers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_centres" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "dailyCapacity" INTEGER NOT NULL,
    "operatingStart" TEXT NOT NULL,
    "operatingEnd" TEXT NOT NULL,
    "numMachines" INTEGER NOT NULL,
    "numOperators" INTEGER NOT NULL,
    "avgProcessingMin" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentToken" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "tokenNumber" INTEGER NOT NULL,
    "crop" TEXT NOT NULL,
    "quantityKg" DOUBLE PRECISION NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stage" "ProcurementStage" NOT NULL DEFAULT 'SLOT_BOOKED',
    "calledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "moisturePercent" DOUBLE PRECISION NOT NULL,
    "foreignMatter" DOUBLE PRECISION NOT NULL,
    "qualityGrade" TEXT NOT NULL,
    "remarks" TEXT,
    "result" "QualityResult" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weighments" (
    "id" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "grossWeightKg" DOUBLE PRECISION NOT NULL,
    "netWeightKg" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weighments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurements" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "operatorUserId" TEXT,
    "crop" TEXT NOT NULL,
    "pricePerKg" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION,
    "status" "ProcurementStage" NOT NULL DEFAULT 'ARRIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'generic',
    "params" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "bookingId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_predictions" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "queueLength" INTEGER NOT NULL,
    "activeMachines" INTEGER NOT NULL,
    "activeOperators" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "farmersArrived" INTEGER NOT NULL,
    "averageProcessingTime" DOUBLE PRECISION NOT NULL,
    "predictedWaitingMinutes" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "reviewNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "farmers_userId_key" ON "farmers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "farmers_farmerCode_key" ON "farmers"("farmerCode");

-- CreateIndex
CREATE UNIQUE INDEX "operators_userId_key" ON "operators"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "slots_centreId_date_startTime_key" ON "slots"("centreId", "date", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_caseId_key" ON "bookings"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_bookingId_key" ON "queue_entries"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_checks_procurementId_key" ON "quality_checks"("procurementId");

-- CreateIndex
CREATE UNIQUE INDEX "weighments_procurementId_key" ON "weighments"("procurementId");

-- CreateIndex
CREATE UNIQUE INDEX "procurements_bookingId_key" ON "procurements"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_procurementId_key" ON "payments"("procurementId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "documents_bookingId_idx" ON "documents"("bookingId");

-- AddForeignKey
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farmers" ADD CONSTRAINT "farmers_preferredCentreId_fkey" FOREIGN KEY ("preferredCentreId") REFERENCES "procurement_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "procurement_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "procurement_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "farmers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weighments" ADD CONSTRAINT "weighments_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "farmers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "procurement_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "farmers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "farmers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
