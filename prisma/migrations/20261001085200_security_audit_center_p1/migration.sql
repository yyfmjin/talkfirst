-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" UUID NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "riskLevel" VARCHAR(8) NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "factors" JSONB,
    "userId" UUID,
    "ip" VARCHAR(45),
    "deviceHash" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "method" VARCHAR(8),
    "path" VARCHAR(256),
    "statusCode" INTEGER,
    "requestId" VARCHAR(64),
    "success" BOOLEAN NOT NULL DEFAULT true,
    "detail" JSONB,
    "handledAt" TIMESTAMP(3),
    "handledBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" UUID NOT NULL,
    "requestId" VARCHAR(64) NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(256) NOT NULL,
    "queryDigest" VARCHAR(512),
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "userId" UUID,
    "authenticated" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "ip" VARCHAR(45),
    "deviceHash" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "referer" VARCHAR(256),
    "origin" VARCHAR(128),
    "acceptLanguage" VARCHAR(64),
    "contentType" VARCHAR(96),
    "errorCode" VARCHAR(48),
    "riskLevel" VARCHAR(8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceIdentity" (
    "id" UUID NOT NULL,
    "deviceHash" VARCHAR(64) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgents" JSONB,

    CONSTRAINT "DeviceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceUser" (
    "deviceHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loginCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeviceUser_pkey" PRIMARY KEY ("deviceHash","userId")
);

-- CreateIndex
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_ip_createdAt_idx" ON "SecurityEvent"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_deviceHash_createdAt_idx" ON "SecurityEvent"("deviceHash", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_riskLevel_createdAt_idx" ON "SecurityEvent"("riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_createdAt_idx" ON "AccessLog"("createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_ip_createdAt_idx" ON "AccessLog"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_userId_createdAt_idx" ON "AccessLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_path_createdAt_idx" ON "AccessLog"("path", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_statusCode_createdAt_idx" ON "AccessLog"("statusCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceIdentity_deviceHash_key" ON "DeviceIdentity"("deviceHash");

-- CreateIndex
CREATE INDEX "DeviceIdentity_lastSeenAt_idx" ON "DeviceIdentity"("lastSeenAt");

-- CreateIndex
CREATE INDEX "DeviceUser_userId_idx" ON "DeviceUser"("userId");

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
