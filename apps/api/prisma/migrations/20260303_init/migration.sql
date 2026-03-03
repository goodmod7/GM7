-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "deviceName" TEXT,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "deviceToken" TEXT,
    "pairingCode" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "controlEnabled" BOOLEAN NOT NULL DEFAULT false,
    "screenStreamEnabled" BOOLEAN NOT NULL DEFAULT false,
    "screenDisplayId" TEXT,
    "screenFps" INTEGER,
    "workspaceRootName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "constraintsJson" JSONB,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "latestProposalJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "logsJson" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "errorCode" TEXT,
    "redactedSummaryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolEvent" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "runId" TEXT,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceToken_key" ON "Device"("deviceToken");

-- CreateIndex
CREATE INDEX "Device_ownerUserId_idx" ON "Device"("ownerUserId");

-- CreateIndex
CREATE INDEX "Run_ownerUserId_idx" ON "Run"("ownerUserId");

-- CreateIndex
CREATE INDEX "Run_deviceId_idx" ON "Run"("deviceId");

-- CreateIndex
CREATE INDEX "RunStep_runId_idx" ON "RunStep"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "RunStep_runId_stepId_key" ON "RunStep"("runId", "stepId");

-- CreateIndex
CREATE INDEX "Action_ownerUserId_idx" ON "Action"("ownerUserId");

-- CreateIndex
CREATE INDEX "Action_deviceId_idx" ON "Action"("deviceId");

-- CreateIndex
CREATE INDEX "Action_runId_idx" ON "Action"("runId");

-- CreateIndex
CREATE INDEX "ToolEvent_ownerUserId_idx" ON "ToolEvent"("ownerUserId");

-- CreateIndex
CREATE INDEX "ToolEvent_deviceId_idx" ON "ToolEvent"("deviceId");

-- CreateIndex
CREATE INDEX "ToolEvent_runId_idx" ON "ToolEvent"("runId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolEvent" ADD CONSTRAINT "ToolEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolEvent" ADD CONSTRAINT "ToolEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolEvent" ADD CONSTRAINT "ToolEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

