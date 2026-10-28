-- CreateTable
CREATE TABLE "github_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "action" TEXT,
    "installationId" TEXT,
    "repoOwner" TEXT,
    "repoName" TEXT,
    "number" INTEGER,
    "title" TEXT,
    "url" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_events_deliveryId_key" ON "github_events"("deliveryId");

-- CreateIndex
CREATE INDEX "github_events_userId_createdAt_idx" ON "github_events"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "github_events" ADD CONSTRAINT "github_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
