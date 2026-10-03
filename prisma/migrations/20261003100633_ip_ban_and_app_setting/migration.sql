-- CreateEnum
CREATE TYPE "IpBanLevel" AS ENUM ('SECONDARY', 'PRIMARY');

-- CreateTable
CREATE TABLE "IpBan" (
    "id" UUID NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "level" "IpBanLevel" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" UUID,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedById" UUID,

    CONSTRAINT "IpBan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "IpBan_ip_liftedAt_idx" ON "IpBan"("ip", "liftedAt");

-- CreateIndex
CREATE INDEX "IpBan_createdAt_idx" ON "IpBan"("createdAt");

-- CreateIndex
CREATE INDEX "AppSetting_key_idx" ON "AppSetting"("key");

-- AddForeignKey
ALTER TABLE "IpBan" ADD CONSTRAINT "IpBan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpBan" ADD CONSTRAINT "IpBan_liftedById_fkey" FOREIGN KEY ("liftedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
