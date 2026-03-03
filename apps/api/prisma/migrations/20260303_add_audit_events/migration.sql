-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "runId" TEXT,
    "actionId" TEXT,
    "toolName" TEXT,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AuditEvent_userId_idx" ON "AuditEvent"("userId");
CREATE INDEX "AuditEvent_deviceId_idx" ON "AuditEvent"("deviceId");
CREATE INDEX "AuditEvent_runId_idx" ON "AuditEvent"("runId");
CREATE INDEX "AuditEvent_actionId_idx" ON "AuditEvent"("actionId");
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
