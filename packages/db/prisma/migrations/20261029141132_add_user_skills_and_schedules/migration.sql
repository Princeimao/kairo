-- CreateTable
CREATE TABLE "user_skills" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "mode" "AgentRunMode" NOT NULL DEFAULT 'CREATE',
    "intervalMinutes" INTEGER,
    "dailyAt" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_skills_userId_idx" ON "user_skills"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_skills_userId_name_key" ON "user_skills"("userId", "name");

-- CreateIndex
CREATE INDEX "scheduled_runs_active_nextRunAt_idx" ON "scheduled_runs"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "scheduled_runs_userId_idx" ON "scheduled_runs"("userId");

-- AddForeignKey
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
