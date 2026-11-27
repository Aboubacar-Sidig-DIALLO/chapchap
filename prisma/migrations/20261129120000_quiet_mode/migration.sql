-- CreateTable
CREATE TABLE "quiet_mode" (
    "userId" TEXT NOT NULL,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER NOT NULL DEFAULT 1320,
    "endMinute" INTEGER NOT NULL DEFAULT 420,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "manualOn" BOOLEAN NOT NULL DEFAULT false,
    "manualUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiet_mode_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "quiet_mode" ADD CONSTRAINT "quiet_mode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
