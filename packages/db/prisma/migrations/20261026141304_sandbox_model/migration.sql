-- CreateTable
CREATE TABLE "sandboxes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "volumeName" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sandboxes_userId_key" ON "sandboxes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sandboxes_volumeName_key" ON "sandboxes"("volumeName");

-- CreateIndex
CREATE UNIQUE INDEX "sandboxes_containerName_key" ON "sandboxes"("containerName");

-- AddForeignKey
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
