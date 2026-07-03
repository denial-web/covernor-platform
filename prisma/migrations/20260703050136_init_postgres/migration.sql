-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default_tenant',
    "idempotencyKey" TEXT,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default_tenant',
    "taskId" TEXT NOT NULL,
    "parentProposalId" TEXT,
    "recommendedOption" JSONB NOT NULL,
    "fallbackOptions" JSONB NOT NULL,
    "contextSignals" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default_tenant',
    "proposalId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "policyResults" JSONB NOT NULL,
    "constraints" JSONB,
    "requiredApprovers" INTEGER NOT NULL DEFAULT 1,
    "approvalsCount" INTEGER NOT NULL DEFAULT 0,
    "approverIdentities" TEXT,
    "approvedPayloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionRecord" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default_tenant',
    "taskId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "providerIdempotencyKey" TEXT,
    "status" TEXT NOT NULL,
    "errorClassification" TEXT,
    "rollbackData" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default_tenant',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposalId" TEXT,
    "decisionId" TEXT,
    "actionDetails" JSONB NOT NULL,
    "amount" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "recipientAccount" TEXT,
    "providerTransactionId" TEXT,
    "policyVersion" TEXT DEFAULT 'v1.2',
    "approverIdentities" TEXT,
    "reconciliationStatus" TEXT,
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalToken" (
    "nonce" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "policyVersionHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalToken_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "GovernorPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default_tenant',
    "versionHash" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernorPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'llm_providers',
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_tenantId_status_idx" ON "Task"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Task_expiresAt_idx" ON "Task"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_tenantId_idempotencyKey_key" ON "Task"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Proposal_tenantId_taskId_idx" ON "Proposal"("tenantId", "taskId");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Decision_tenantId_proposalId_idx" ON "Decision"("tenantId", "proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRecord_decisionId_key" ON "ExecutionRecord"("decisionId");

-- CreateIndex
CREATE INDEX "ExecutionRecord_tenantId_status_idx" ON "ExecutionRecord"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ExecutionRecord_providerTransactionId_idx" ON "ExecutionRecord"("providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRecord_tenantId_idempotencyKey_key" ON "ExecutionRecord"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_timestamp_idx" ON "AuditLog"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_proposalId_idx" ON "AuditLog"("proposalId");

-- CreateIndex
CREATE INDEX "AuditLog_decisionId_idx" ON "AuditLog"("decisionId");

-- CreateIndex
CREATE INDEX "ApprovalToken_tenantId_decisionId_idx" ON "ApprovalToken"("tenantId", "decisionId");

-- CreateIndex
CREATE INDEX "ApprovalToken_expiresAt_idx" ON "ApprovalToken"("expiresAt");

-- CreateIndex
CREATE INDEX "GovernorPolicy_tenantId_isActive_idx" ON "GovernorPolicy"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GovernorPolicy_tenantId_versionHash_key" ON "GovernorPolicy"("tenantId", "versionHash");

-- CreateIndex
CREATE INDEX "UserRole_tenantId_idx" ON "UserRole"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_tenantId_userId_key" ON "UserRole"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "SystemSettings_tenantId_category_idx" ON "SystemSettings"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_tenantId_category_key_key" ON "SystemSettings"("tenantId", "category", "key");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionRecord" ADD CONSTRAINT "ExecutionRecord_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
