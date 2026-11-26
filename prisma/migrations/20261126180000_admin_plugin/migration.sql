-- Plugin Admin de Better Auth : rôle et suspension des comptes.
ALTER TABLE "user" ADD COLUMN "role" TEXT DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN "banned" BOOLEAN DEFAULT false;
ALTER TABLE "user" ADD COLUMN "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN "banExpires" TIMESTAMP(3);

-- Sessions ouvertes par un administrateur « en tant que » un utilisateur.
ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;
